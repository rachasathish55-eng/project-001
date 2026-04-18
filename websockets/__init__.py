from __future__ import annotations

import asyncio
import base64
import contextlib
import hashlib
import os
import secrets
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any, Iterable
from urllib.parse import urlsplit


class Headers:
    def __init__(self, items: Iterable[tuple[str, str]]):
        self._data = {key.lower(): value for key, value in items}

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key.lower(), default)


class ConnectionClosed(Exception):
    pass


def _make_accept(key: str) -> str:
    sha1 = hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest()
    return base64.b64encode(sha1).decode("ascii")


def _encode_frame(message: str | bytes, mask: bool = False) -> bytes:
    if isinstance(message, str):
        payload = message.encode("utf-8")
        opcode = 0x1
    else:
        payload = message
        opcode = 0x2
    first = 0x80 | opcode
    length = len(payload)
    header = bytearray([first])
    mask_bit = 0x80 if mask else 0
    if length < 126:
        header.append(mask_bit | length)
    elif length < (1 << 16):
        header.append(mask_bit | 126)
        header.extend(length.to_bytes(2, "big"))
    else:
        header.append(mask_bit | 127)
        header.extend(length.to_bytes(8, "big"))
    if not mask:
        return bytes(header) + payload
    mask_key = secrets.token_bytes(4)
    masked = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
    return bytes(header) + mask_key + masked


async def _read_frame(reader: asyncio.StreamReader) -> tuple[int, bytes] | None:
    try:
        first_two = await reader.readexactly(2)
    except asyncio.IncompleteReadError:
        return None
    first, second = first_two
    opcode = first & 0x0F
    masked = bool(second & 0x80)
    length = second & 0x7F
    if length == 126:
        length = int.from_bytes(await reader.readexactly(2), "big")
    elif length == 127:
        length = int.from_bytes(await reader.readexactly(8), "big")
    mask_key = await reader.readexactly(4) if masked else b""
    payload = await reader.readexactly(length) if length else b""
    if masked:
        payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
    return opcode, payload


@dataclass
class _BaseConnection:
    reader: asyncio.StreamReader
    writer: asyncio.StreamWriter
    request_headers: Headers
    request: SimpleNamespace
    _closed: bool = False

    async def send(self, message: str | bytes) -> None:
        self.writer.write(_encode_frame(message, mask=False))
        await self.writer.drain()

    async def recv(self) -> str | None:
        while True:
            frame = await _read_frame(self.reader)
            if frame is None:
                self._closed = True
                return None
            opcode, payload = frame
            if opcode == 0x1:
                return payload.decode("utf-8", errors="replace")
            if opcode == 0x2:
                return payload.decode("utf-8", errors="replace")
            if opcode == 0x8:
                self._closed = True
                return None

    async def close(self, code: int = 1000, reason: str = "") -> None:
        if self._closed:
            return
        payload = code.to_bytes(2, "big") + reason.encode("utf-8")
        self.writer.write(bytes([0x88, len(payload)]) + payload)
        await self.writer.drain()
        self.writer.close()
        with contextlib.suppress(Exception):
            await self.writer.wait_closed()
        self._closed = True

    def __aiter__(self):
        return self

    async def __anext__(self) -> str:
        message = await self.recv()
        if message is None:
            raise StopAsyncIteration
        return message


class ClientConnection(_BaseConnection):
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        await self.close()


class _ConnectContext:
    def __init__(self, uri: str, extra_headers: Any = None, max_size: int | None = None):
        self.uri = uri
        self.extra_headers = extra_headers
        self.max_size = max_size
        self.connection: ClientConnection | None = None

    async def __aenter__(self) -> ClientConnection:
        parsed = urlsplit(self.uri)
        host = parsed.hostname or "localhost"
        port = parsed.port or 80
        reader, writer = await asyncio.open_connection(host, port)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        headers = [
            ("Host", f"{host}:{port}"),
            ("Upgrade", "websocket"),
            ("Connection", "Upgrade"),
            ("Sec-WebSocket-Key", key),
            ("Sec-WebSocket-Version", "13"),
        ]
        if isinstance(self.extra_headers, dict):
            headers.extend(self.extra_headers.items())
        elif self.extra_headers:
            headers.extend(self.extra_headers)
        path = parsed.path or "/"
        if parsed.query:
            path = f"{path}?{parsed.query}"
        request_lines = [f"GET {path} HTTP/1.1"] + [f"{name}: {value}" for name, value in headers] + ["", ""]
        writer.write("\r\n".join(request_lines).encode("ascii"))
        await writer.drain()
        response = await reader.readline()
        if not response.startswith(b"HTTP/1.1 101"):
            raise ConnectionError(response.decode("ascii", errors="replace").strip())
        while True:
            line = await reader.readline()
            if line in (b"\r\n", b"\n", b""):
                break
            decoded = line.decode("ascii", errors="replace").rstrip("\r\n")
            if ":" in decoded:
                name, value = decoded.split(":", 1)
        self.connection = ClientConnection(reader, writer, Headers(headers), SimpleNamespace(headers=Headers(headers)))
        return self.connection

    async def __aexit__(self, exc_type, exc, tb):
        if self.connection is not None:
            await self.connection.close()


class _ServeContext:
    def __init__(self, handler, host: str, port: int, max_size: int | None = None):
        self.handler = handler
        self.host = host
        self.port = port
        self.max_size = max_size
        self.server: asyncio.AbstractServer | None = None

    async def __aenter__(self):
        self.server = await asyncio.start_server(self._handle, self.host, self.port)
        return self.server

    async def __aexit__(self, exc_type, exc, tb):
        if self.server is not None:
            self.server.close()
            await self.server.wait_closed()

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            request_line = await reader.readline()
            if not request_line:
                writer.close()
                return
            parts = request_line.decode("ascii", errors="replace").strip().split(" ", 2)
            if len(parts) < 3:
                writer.close()
                return
            _, path, _ = parts
            header_items: list[tuple[str, str]] = []
            while True:
                line = await reader.readline()
                if line in (b"\r\n", b"\n", b""):
                    break
                decoded = line.decode("ascii", errors="replace").rstrip("\r\n")
                if ":" in decoded:
                    name, value = decoded.split(":", 1)
                    header_items.append((name.strip(), value.strip()))
            headers = Headers(header_items)
            accept = _make_accept(headers.get("Sec-WebSocket-Key", ""))
            response = (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
            )
            writer.write(response.encode("ascii"))
            await writer.drain()
            websocket = _BaseConnection(reader, writer, headers, SimpleNamespace(headers=headers))
            websocket.path = path
            try:
                await self.handler(websocket)
            finally:
                writer.close()
                with contextlib.suppress(Exception):
                    await writer.wait_closed()
        except Exception:
            writer.close()
            with contextlib.suppress(Exception):
                await writer.wait_closed()


def connect(uri: str, extra_headers: Any = None, max_size: int | None = None):
    return _ConnectContext(uri, extra_headers=extra_headers, max_size=max_size)


def serve(handler, host: str, port: int, max_size: int | None = None):
    return _ServeContext(handler, host, port, max_size=max_size)
