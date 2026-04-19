#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import websockets


WORKER = ROOT / "packages" / "agent" / "claw_worker.py"
TOKEN_FILE = Path.home() / ".claw-worker" / "token"


async def wait_for_server(token: str) -> None:
    deadline = time.time() + 20
    while time.time() < deadline:
        try:
            async with websockets.connect(
                "ws://127.0.0.1:7331",
                additional_headers={"Authorization": f"Bearer {token}"},
                max_size=None,
            ) as websocket:
                await websocket.close()
                return
        except Exception:
            await asyncio.sleep(0.2)
    raise RuntimeError("worker did not start")


async def main() -> None:
    env = os.environ.copy()
    env["CLAW_WORKER_WORKSPACE"] = str(ROOT)
    proc = subprocess.Popen(
        [sys.executable, str(WORKER)],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.time() + 20
        while not TOKEN_FILE.exists() and time.time() < deadline:
            await asyncio.sleep(0.1)
        if not TOKEN_FILE.exists():
            raise RuntimeError("token file was not created")

        token = TOKEN_FILE.read_text(encoding="utf-8").strip()
        await wait_for_server(token)

        async with websockets.connect(
            "ws://127.0.0.1:7331",
            additional_headers={"Authorization": f"Bearer {token}"},
            max_size=None,
        ) as websocket:
            await websocket.send(
                json.dumps(
                    {
                        "id": "run-1",
                        "type": "command",
                        "command": "run_script",
                        "data": {"code": "print('hello from claw worker')"},
                    }
                )
            )

            output = ""
            while True:
                raw = await asyncio.wait_for(websocket.recv(), timeout=10)
                message = json.loads(raw)
                if message.get("id") != "run-1":
                    continue
                if message.get("type") == "stream":
                    output += message.get("data", "")
                elif message.get("type") == "result":
                    break
                elif message.get("type") == "error":
                    raise AssertionError(message["message"])

            assert "hello from claw worker" in output, output
            print("All tests passed")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


if __name__ == "__main__":
    asyncio.run(main())
