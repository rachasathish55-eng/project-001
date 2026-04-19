#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import os
import platform
import shutil
import secrets
import socket
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import uuid4

WORKSPACE_ROOT = Path(os.environ.get("CLAW_WORKER_WORKSPACE", Path.home() / "workspace")).resolve()
if str(WORKSPACE_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_ROOT))

import psutil
import websockets


HOST = "0.0.0.0"
PORT = 7331
TOKEN_DIR = Path.home() / ".claw-worker"
TOKEN_FILE = TOKEN_DIR / "token"
WORKER_ID = os.environ.get("CLAW_WORKER_ID") or socket.gethostname()
WORKER_VERSION = os.environ.get("CLAW_WORKER_VERSION")


def ensure_token() -> str:
    TOKEN_DIR.mkdir(parents=True, exist_ok=True)
    if TOKEN_FILE.exists():
        return TOKEN_FILE.read_text(encoding="utf-8").strip()
    token = secrets.token_hex(16)
    TOKEN_FILE.write_text(token, encoding="utf-8")
    return token


def get_header(websocket: Any, name: str) -> str | None:
    headers = getattr(websocket, "request_headers", None)
    if headers is None:
        request = getattr(websocket, "request", None)
        headers = getattr(request, "headers", None) if request is not None else None
    if headers is None:
        return None
    return headers.get(name)


def resource_stats() -> dict[str, float | None]:
    gpu_pct: float | None = None
    if shutil.which("nvidia-smi") is not None:
        try:
            result = subprocess.run(
                [
                    "nvidia-smi",
                    "--query-gpu=utilization.gpu",
                    "--format=csv,noheader,nounits",
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=1,
            )
            raw_gpu_pct = result.stdout.strip().splitlines()[0].strip()
            gpu_pct = float(raw_gpu_pct) if raw_gpu_pct else None
        except (OSError, ValueError, subprocess.SubprocessError):
            gpu_pct = None

    return {
        "cpu_pct": psutil.cpu_percent(interval=None),
        "mem_pct": psutil.virtual_memory().percent,
        "gpu_pct": gpu_pct,
    }


def resolve_workspace_path(raw_path: str) -> Path:
    target = Path(raw_path)
    if not target.is_absolute():
        target = WORKSPACE_ROOT / target
    resolved = target.resolve()
    workspace = WORKSPACE_ROOT.resolve()
    if resolved != workspace and workspace not in resolved.parents:
        raise ValueError("path must stay within workspace")
    return resolved


def directory_listing(path: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for item in sorted(path.iterdir(), key=lambda entry: entry.name.lower()):
        stat = item.stat()
        entries.append(
            {
                "name": item.name,
                "path": str(item),
                "type": "dir" if item.is_dir() else "file",
                "size": stat.st_size,
                "mtime": stat.st_mtime,
            }
        )
    return entries


@dataclass
class ScriptJob:
    script_id: str
    process: asyncio.subprocess.Process
    completed: bool = False
    result_sent: bool = False
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


ACTIVE_SCRIPTS: dict[str, ScriptJob] = {}


async def send_json(websocket: Any, payload: dict[str, Any]) -> None:
    await websocket.send(json.dumps(payload))


async def send_result(websocket: Any, message_id: str, data: Any) -> None:
    await send_json(websocket, {"id": message_id, "type": "result", "data": data})


async def send_error(websocket: Any, message_id: str, message: str) -> None:
    await send_json(websocket, {"id": message_id, "type": "error", "message": message})


async def finalize_job(job: ScriptJob, websocket: Any, message_id: str, data: Any) -> None:
    async with job.lock:
        if job.result_sent:
            return
        job.result_sent = True
    await send_result(websocket, message_id, data)


async def heartbeat_loop(websocket: Any) -> None:
    while True:
        await asyncio.sleep(5)
        stats = resource_stats()
        await send_json(
            websocket,
            {
                "type": "heartbeat",
                "ts": time.time(),
                "cpu_pct": stats["cpu_pct"],
                "mem_pct": stats["mem_pct"],
                "gpu_pct": stats["gpu_pct"],
                "worker_id": WORKER_ID,
                "hostname": socket.gethostname(),
                "os": platform.platform(),
                "pid": os.getpid(),
                "version": WORKER_VERSION,
            },
        )


async def stream_process_output(job: ScriptJob, websocket: Any, message_id: str) -> None:
    async def read_stream(stream_name: str, stream: asyncio.StreamReader | None) -> None:
        if stream is None:
            return
        while True:
            chunk = await stream.readline()
            if not chunk:
                break
            await send_json(
                websocket,
                {
                    "id": message_id,
                    "type": "stream",
                    "stream": stream_name,
                    "data": chunk.decode("utf-8", errors="replace"),
                },
            )

    await asyncio.gather(
        read_stream("stdout", job.process.stdout),
        read_stream("stderr", job.process.stderr),
    )
    rc = await job.process.wait()
    await finalize_job(
        job,
        websocket,
        message_id,
        {"script_id": job.script_id, "pid": job.process.pid, "exit_code": rc},
    )
    ACTIVE_SCRIPTS.pop(job.script_id, None)


async def run_script(websocket: Any, message_id: str, data: dict[str, Any]) -> None:
    code = data.get("code")
    if not isinstance(code, str) or not code.strip():
        await send_error(websocket, message_id, "run_script requires non-empty code")
        return

    script_id = uuid4().hex
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-u",
        "-c",
        code,
        cwd=str(WORKSPACE_ROOT),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    job = ScriptJob(script_id=script_id, process=process)
    ACTIVE_SCRIPTS[script_id] = job
    asyncio.create_task(stream_process_output(job, websocket, message_id))


async def stop_script(websocket: Any, message_id: str, data: dict[str, Any]) -> None:
    script_id = data.get("script_id")
    if not isinstance(script_id, str) or not script_id:
        await send_error(websocket, message_id, "stop_script requires script_id")
        return

    job = ACTIVE_SCRIPTS.get(script_id)
    if job is None:
        await send_error(websocket, message_id, f"unknown script_id: {script_id}")
        return

    if job.process.returncode is None:
        job.process.terminate()
        try:
            await asyncio.wait_for(job.process.wait(), timeout=5)
        except TimeoutError:
            job.process.kill()
            await job.process.wait()

    async with job.lock:
        job.completed = True
    await finalize_job(
        job,
        websocket,
        message_id,
        {"script_id": script_id, "pid": job.process.pid, "stopped": True, "exit_code": job.process.returncode},
    )
    ACTIVE_SCRIPTS.pop(script_id, None)


async def get_status(websocket: Any, message_id: str) -> None:
    stats = resource_stats()
    await send_result(
        websocket,
        message_id,
        {
            "ts": time.time(),
            "cpu_pct": stats["cpu_pct"],
            "mem_pct": stats["mem_pct"],
            "gpu_pct": stats["gpu_pct"],
        },
    )


async def upload_file(websocket: Any, message_id: str, data: dict[str, Any]) -> None:
    raw_path = data.get("path")
    if not isinstance(raw_path, str) or not raw_path.strip():
        await send_error(websocket, message_id, "upload_file requires path")
        return

    chunks = data.get("chunks")
    if isinstance(chunks, str):
        chunks = [chunks]
    if not isinstance(chunks, list) or not chunks:
        await send_error(websocket, message_id, "upload_file requires chunks")
        return

    target = resolve_workspace_path(raw_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as handle:
        for chunk in chunks:
            if not isinstance(chunk, str):
                await send_error(websocket, message_id, "upload_file chunks must be base64 strings")
                return
            handle.write(base64.b64decode(chunk))

    await send_result(websocket, message_id, {"path": str(target), "bytes_written": target.stat().st_size})


async def list_files(websocket: Any, message_id: str, data: dict[str, Any]) -> None:
    raw_path = data.get("path", ".")
    if not isinstance(raw_path, str) or not raw_path.strip():
        await send_error(websocket, message_id, "list_files requires path")
        return

    target = resolve_workspace_path(raw_path)
    if not target.exists() or not target.is_dir():
        await send_error(websocket, message_id, f"not a directory: {raw_path}")
        return

    await send_result(websocket, message_id, {"path": str(target), "entries": directory_listing(target)})


async def handle_command(websocket: Any, payload: dict[str, Any]) -> None:
    message_id = str(payload.get("id", uuid4().hex))
    command = payload.get("command")
    data = payload.get("data") or {}
    if not isinstance(data, dict):
        await send_error(websocket, message_id, "data must be an object")
        return

    if command == "run_script":
        await run_script(websocket, message_id, data)
    elif command == "stop_script":
        await stop_script(websocket, message_id, data)
    elif command == "get_status":
        await get_status(websocket, message_id)
    elif command == "upload_file":
        await upload_file(websocket, message_id, data)
    elif command == "list_files":
        await list_files(websocket, message_id, data)
    else:
        await send_error(websocket, message_id, f"unknown command: {command}")


async def client_handler(websocket: Any) -> None:
    token = ensure_token()
    auth_header = get_header(websocket, "Authorization")
    if auth_header != f"Bearer {token}":
        await websocket.close(code=4401, reason="Unauthorized")
        return

    await send_json(
        websocket,
        {
            "type": "identity",
            "worker_id": WORKER_ID,
            "hostname": socket.gethostname(),
            "os": platform.platform(),
            "pid": os.getpid(),
            "version": WORKER_VERSION,
        },
    )

    connection_jobs: set[str] = set()
    heartbeat_task = asyncio.create_task(heartbeat_loop(websocket))
    try:
        async for raw_message in websocket:
            payload = json.loads(raw_message)
            if not isinstance(payload, dict):
                raise ValueError("message must be a JSON object")
            if payload.get("type") not in {"command", "request", None} and "command" not in payload:
                await send_error(websocket, str(payload.get("id", uuid4().hex)), "unsupported message type")
                continue
            if payload.get("command") == "run_script":
                before = set(ACTIVE_SCRIPTS)
                await handle_command(websocket, payload)
                connection_jobs.update(set(ACTIVE_SCRIPTS) - before)
                continue
            await handle_command(websocket, payload)
    finally:
        heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task
        for script_id in list(connection_jobs):
            job = ACTIVE_SCRIPTS.pop(script_id, None)
            if job is not None and job.process.returncode is None:
                job.process.terminate()
                with contextlib.suppress(Exception):
                    await job.process.wait()


async def main() -> None:
    ensure_token()
    async with websockets.serve(client_handler, HOST, PORT, max_size=None):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
