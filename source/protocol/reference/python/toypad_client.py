"""Reference client for LEGO Dimensions Toypad Event Protocol v1.

Depends only on the standard library. Suitable for a Decky plugin
backend or a small Flask/websocket bridge to a phone UI.

Usage::

    import asyncio
    from toypad_client import connect

    async def main():
        async with connect("127.0.0.1", 9191) as events:
            async for event in events:
                if event["type"] == "color":
                    print("color", event)

    asyncio.run(main())

The client will keep parsing events until the emulator disconnects or
the caller stops iterating.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import AsyncIterator, Dict


MAGIC = 0x55
VERSION = 0x01


class _EventIterator:
    """Wraps an asyncio reader so `async for` yields parsed events."""

    def __init__(self, reader: asyncio.StreamReader) -> None:
        self._reader = reader

    def __aiter__(self) -> "_EventIterator":
        return self

    async def __anext__(self) -> Dict:
        # Resync on the next MAGIC byte. The spec requires clients to
        # tolerate stray bytes at the start of a stream (see section 6),
        # so this is the loop that does it.
        while True:
            byte = await self._reader.readexactly(1)
            if byte[0] == MAGIC:
                break
        header = await self._reader.readexactly(4)
        version, event_type, pad, payload_len = header
        payload = await self._reader.readexactly(payload_len)
        if version != VERSION:
            return {"type": "unknown", "version": version,
                    "event_type": event_type, "pad": pad,
                    "payload_len": payload_len}
        return _decode(event_type, pad, payload)


def _decode(event_type: int, pad: int, payload: bytes) -> Dict:
    base = {"pad": pad, "raw_type": event_type}
    if event_type == 0x01 and len(payload) == 3:
        return {**base, "type": "color",
                "r": payload[0], "g": payload[1], "b": payload[2]}
    if event_type == 0x02 and len(payload) == 6:
        return {**base, "type": "flash",
                "on_ms": payload[0], "off_ms": payload[1],
                "count": payload[2],
                "r": payload[3], "g": payload[4], "b": payload[5]}
    if event_type == 0x03 and len(payload) == 11:
        return {**base, "type": "tag_placed",
                "slot": payload[0], "uid": bytes(payload[1:8]).hex(),
                "tag_id": int.from_bytes(payload[8:10], "little"),
                "tag_kind": payload[10]}
    if event_type == 0x04 and len(payload) == 1:
        return {**base, "type": "tag_removed", "slot": payload[0]}
    if event_type == 0x05 and len(payload) == 2:
        return {**base, "type": "tag_moved",
                "from_slot": payload[0], "to_slot": payload[1]}
    return {**base, "type": "unknown", "payload": payload.hex()}


@contextlib.asynccontextmanager
async def connect(host: str = "127.0.0.1", port: int = 9191,
                  hello: bool = True) -> AsyncIterator[_EventIterator]:
    """Open a toypad event connection and yield an async iterator of events.

    The connection is closed cleanly when the caller exits the context
    manager, even if it's iterating events at the time.

    Set ``hello=False`` on emulators that don't recognise the handshake
    and might mis-parse the bytes (none currently do, but the option
    exists for old builds).
    """
    reader, writer = await asyncio.open_connection(host, port)
    try:
        if hello:
            writer.write(b"HELLO\n")
            await writer.drain()
            # An emulator that speaks the handshake replies with a single
            # ASCII line starting "TOYPAD/1". We read it if it's there,
            # otherwise ignore - see spec section 5.
            try:
                greet = await asyncio.wait_for(reader.readuntil(b"\n"), timeout=0.5)
                if not greet.startswith(b"TOYPAD/1"):
                    # Not a handshake reply: the bytes are the start of a
                    # binary frame. Push them back logically by starting the
                    # parser on the combined stream.
                    reader = _ChainedReader(greet, reader)
            except (asyncio.TimeoutError, asyncio.IncompleteReadError):
                pass  # emulator doesn't do handshakes; that's fine
        yield _EventIterator(reader)
    finally:
        writer.close()
        with contextlib.suppress(Exception):
            await writer.wait_closed()


class _ChainedReader:
    """A reader that yields buffered bytes first, then delegates."""

    def __init__(self, buffered: bytes, upstream: asyncio.StreamReader) -> None:
        self._buffered = bytearray(buffered)
        self._upstream = upstream

    async def readexactly(self, n: int) -> bytes:
        if not self._buffered:
            return await self._upstream.readexactly(n)
        if len(self._buffered) >= n:
            out = bytes(self._buffered[:n])
            del self._buffered[:n]
            return out
        head = bytes(self._buffered)
        self._buffered.clear()
        tail = await self._upstream.readexactly(n - len(head))
        return head + tail


__all__ = ["connect", "MAGIC", "VERSION"]
