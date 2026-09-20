"""
Local web server — repo path: backend/web.py

One server, two jobs:

  127.0.0.1:8765/assets/...   portraits and logos for the QAM panel
  <lan-ip>:8765/              the phone remote, served from Web/ verbatim

Folding these together is deliberate. The panel needs somewhere to fetch 315
portraits from — Decky has no documented static-file route for plugin assets,
and base64-ing them through the RPC would be absurd. The remote already needed
a server. So it is one server.

Binds 0.0.0.0 only while the remote is enabled; otherwise loopback, so the
panel works without putting anything on the network.
"""

from __future__ import annotations

import json
import logging
import mimetypes
import socket
import threading
from functools import lru_cache
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import unquote, urlparse

log = logging.getLogger(__name__)

DEFAULT_PORT = 8765
mimetypes.add_type("image/webp", ".webp")


class Server:
    def __init__(self, root: Path, port: int = DEFAULT_PORT,
                 api: Optional[Callable[[str, dict], Optional[dict]]] = None,
                 custom_root: Optional[Path] = None) -> None:
        self.root = Path(root).resolve()
        self.custom_root = Path(custom_root).resolve() if custom_root else (self.root / "custom").resolve()
        self.port = port
        self.api = api
        self._server_sock: Optional[socket.socket] = None
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._lan = False

    @property
    def running(self) -> bool:
        return self._running and self._server_sock is not None

    def start(self, lan: bool = False) -> bool:
        if self.running and lan == self._lan:
            return True
        self.stop()

        host = "0.0.0.0" if lan else "127.0.0.1"
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind((host, self.port))
            sock.listen(128)
            sock.settimeout(0.5)
            self._server_sock = sock
        except OSError as exc:
            log.warning("web server could not bind %s:%s — %s", host, self.port, exc)
            self._server_sock = None
            return False

        self._lan = lan
        self._running = True
        self._thread = threading.Thread(target=self._serve_loop, daemon=True)
        self._thread.start()
        log.info("web server on %s:%s", host, self.port)
        return True

    def stop(self) -> None:
        self._running = False
        if self._server_sock:
            try:
                self._server_sock.close()
            except OSError:
                pass
            self._server_sock = None
        if self._thread:
            self._thread.join(timeout=2)
            self._thread = None

    def _serve_loop(self) -> None:
        while self._running and self._server_sock:
            try:
                client, _ = self._server_sock.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            t = threading.Thread(target=self._handle_client, args=(client,), daemon=True)
            t.start()

    def _handle_client(self, client: socket.socket) -> None:
        client.settimeout(10.0)
        try:
            rfile = client.makefile("rb", buffering=65536)
            req_line = rfile.readline()
            if not req_line:
                return
            parts = req_line.decode("iso-8859-1", errors="replace").strip().split()
            if len(parts) < 2:
                return
            method = parts[0].upper()
            raw_path = parts[1]

            headers: dict[str, str] = {}
            while True:
                line = rfile.readline()
                if not line or line in (b"\r\n", b"\n", b""):
                    break
                header_line = line.decode("iso-8859-1", errors="replace").strip()
                if ":" in header_line:
                    k, v = header_line.split(":", 1)
                    headers[k.strip().lower()] = v.strip()

            content_length = int(headers.get("content-length", 0))
            body_bytes = rfile.read(content_length) if content_length > 0 else b""

            route = unquote(urlparse(raw_path).path)

            if method == "OPTIONS":
                self._send_response(client, 204, "No Content", b"", "text/plain", {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "Content-Type",
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Content-Length": "0",
                })
            elif method in ("GET", "HEAD"):
                send_body = (method == "GET")
                if route.startswith("/api/"):
                    self._dispatch(client, route, {}, send_body=send_body)
                elif route.startswith("/custom/"):
                    self._serve_static(client, self.custom_root, route[len("/custom/"):], send_body=send_body)
                else:
                    rel = "web/index.html" if route in ("/", "") else route.lstrip("/")
                    if not rel.startswith(("web/", "assets/", "data/")):
                        rel = "web/" + rel
                    self._serve_static(client, self.root, rel, send_body=send_body)
            elif method == "POST":
                try:
                    payload = json.loads(body_bytes or b"{}")
                except json.JSONDecodeError:
                    self._send_json(client, {"error": "bad json"}, 400)
                    return
                self._dispatch(client, route, payload)
            else:
                self._send_response(client, 405, "Method Not Allowed", b"Method Not Allowed", "text/plain")
        except (socket.timeout, ConnectionResetError, BrokenPipeError):
            pass
        except Exception as exc:
            log.warning("error handling client request: %s", exc)
        finally:
            try:
                client.close()
            except OSError:
                pass

    def _dispatch(self, client: socket.socket, route: str, body: dict, send_body: bool = True) -> None:
        if not self.api:
            self._send_json(client, {"error": "no api"}, 503, send_body=send_body)
            return
        try:
            result = self.api(route, body)
        except Exception as exc:
            log.warning("api %s failed: %s", route, exc)
            self._send_json(client, {"error": str(exc)}, 500, send_body=send_body)
            return
        if result is None:
            self._send_json(client, {"error": "not found"}, 404, send_body=send_body)
            return
        self._send_json(client, result, send_body=send_body)

    def _serve_static(self, client: socket.socket, base: Path, rel: str, send_body: bool = True) -> None:
        try:
            target = (base / rel).resolve()
            if not str(target).startswith(str(base)):
                self._send_json(client, {"error": "forbidden"}, 403, send_body=send_body)
                return
            if not target.is_file():
                self._send_json(client, {"error": "not found"}, 404, send_body=send_body)
                return
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            cache = 86400 if rel.startswith("assets/") else (3600 if base == self.custom_root else 0)
            data = target.read_bytes()
            extra_headers = {"Cache-Control": f"max-age={cache}"} if cache else {}
            self._send_response(client, 200, "OK", data, ctype, extra_headers, send_body=send_body)
        except Exception as exc:
            log.warning("static serve error: %s", exc)
            self._send_json(client, {"error": "internal error"}, 500, send_body=send_body)

    def _send_json(self, client: socket.socket, payload: dict, status: int = 200, send_body: bool = True) -> None:
        status_text = {200: "OK", 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 500: "Internal Server Error", 503: "Service Unavailable"}.get(status, "OK")
        body = json.dumps(payload).encode("utf-8")
        self._send_response(client, status, status_text, body, "application/json", send_body=send_body)

    def _send_response(self, client: socket.socket, status: int, status_text: str,
                       body: bytes, content_type: str, extra_headers: Optional[dict[str, str]] = None,
                       send_body: bool = True) -> None:
        headers = [
            f"HTTP/1.1 {status} {status_text}",
            f"Content-Type: {content_type}",
            f"Content-Length: {len(body)}",
            "Access-Control-Allow-Origin: *",
            "Connection: close",
        ]
        if extra_headers:
            for k, v in extra_headers.items():
                headers.append(f"{k}: {v}")
        headers.append("\r\n")
        header_bytes = "\r\n".join(headers).encode("iso-8859-1")
        if send_body:
            client.sendall(header_bytes + body)
        else:
            client.sendall(header_bytes)

    # ------------------------------------------------------------------

    @staticmethod
    @lru_cache(maxsize=1)
    def lan_address() -> str:
        """
        Best-guess LAN IP for the QR code on the remote.

        Connecting a UDP socket sends nothing — it just makes the kernel pick
        the interface it would route through, which beats parsing `ip addr`.
        """
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(("192.0.2.1", 9))   # TEST-NET-1, never routed
            return sock.getsockname()[0]
        except OSError:
            return "127.0.0.1"
        finally:
            sock.close()

    def remote_url(self) -> str:
        host = self.lan_address() if self._lan else "127.0.0.1"
        return f"http://{host}:{self.port}/"
