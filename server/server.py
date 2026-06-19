#!/usr/bin/env python3
"""
Local overlay server for "YouTube Music -> OBS Overlay".

Usage:
    python server.py [--port 8787]
"""

import argparse
import base64
import hashlib
import json
import os
import socket
import struct
import threading
from http import HTTPStatus


class Hub:
    def __init__(self):
        self._clients = set()
        self._last_state = None
        self._lock = threading.Lock()

    def add(self, client):
        with self._lock:
            self._clients.add(client)
            state = self._last_state
        if state is not None:
            client.send_text(state)

    def remove(self, client):
        with self._lock:
            self._clients.discard(client)

    def broadcast(self, message, sender=None):
        with self._lock:
            self._last_state = message
            targets = [c for c in self._clients if c is not sender]
        for c in targets:
            c.send_text(message)


HUB = Hub()

WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

class WSClient:
    def __init__(self, conn):
        self.conn = conn
        self._send_lock = threading.Lock()
        self.open = True

    def send_text(self, text):
        data = text.encode("utf-8")
        header = bytearray()
        header.append(0x81)  # FIN + text opcode
        n = len(data)
        if n < 126:
            header.append(n)
        elif n < 65536:
            header.append(126)
            header += struct.pack(">H", n)
        else:
            header.append(127)
            header += struct.pack(">Q", n)
        try:
            with self._send_lock:
                self.conn.sendall(bytes(header) + data)
        except OSError:
            self.open = False

    def send_close(self):
        try:
            with self._send_lock:
                self.conn.sendall(b"\x88\x00")
        except OSError:
            pass

    def send_pong(self, payload):
        header = bytearray([0x8A, len(payload) & 0x7F])
        try:
            with self._send_lock:
                self.conn.sendall(bytes(header) + payload)
        except OSError:
            self.open = False


def _recv_exact(conn, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = conn.recv(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return bytes(buf)


def read_frame(conn):
    """Return (opcode, payload_bytes) or (None, None) on close/error."""
    head = _recv_exact(conn, 2)
    if not head:
        return None, None
    b1, b2 = head[0], head[1]
    opcode = b1 & 0x0F
    masked = b2 & 0x80
    length = b2 & 0x7F

    if length == 126:
        ext = _recv_exact(conn, 2)
        if not ext:
            return None, None
        length = struct.unpack(">H", ext)[0]
    elif length == 127:
        ext = _recv_exact(conn, 8)
        if not ext:
            return None, None
        length = struct.unpack(">Q", ext)[0]

    mask = _recv_exact(conn, 4) if masked else None
    payload = _recv_exact(conn, length) if length else b""
    if payload is None:
        return None, None

    if mask:
        payload = bytes(payload[i] ^ mask[i % 4] for i in range(len(payload)))

    return opcode, payload


def perform_handshake(conn, key):
    accept = base64.b64encode(
        hashlib.sha1((key + WS_MAGIC).encode()).digest()
    ).decode()
    response = (
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
    )
    conn.sendall(response.encode())


def handle_websocket(conn, key):
    perform_handshake(conn, key)
    client = WSClient(conn)
    HUB.add(client)
    try:
        while client.open:
            opcode, payload = read_frame(conn)
            if opcode is None:
                break
            if opcode == 0x8:  # close
                client.send_close()
                break
            if opcode == 0x9:  # ping
                client.send_pong(payload)
                continue
            if opcode in (0x1, 0x2):  # text / binary -> treat as state update
                try:
                    text = payload.decode("utf-8")
                except UnicodeDecodeError:
                    continue
                # Ignore role announcements; everything else is rebroadcast.
                try:
                    parsed = json.loads(text)
                    if isinstance(parsed, dict) and parsed.get("role"):
                        continue
                except (ValueError, TypeError):
                    pass
                HUB.broadcast(text, sender=client)
    finally:
        HUB.remove(client)
        try:
            conn.close()
        except OSError:
            pass


HERE = os.path.dirname(os.path.abspath(__file__))
OVERLAY_DIR = os.path.normpath(os.path.join(HERE, "..", "overlay"))

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
}

def serve_static(conn, path):
    path = path.split("?", 1)[0].split("#", 1)[0]
    if path in ("/", ""):
        path = "/index.html"
    rel = path.lstrip("/")
    full = os.path.normpath(os.path.join(OVERLAY_DIR, rel))
    if not full.startswith(OVERLAY_DIR) or not os.path.isfile(full):
        body = b"404 Not Found"
        conn.sendall(
            b"HTTP/1.1 404 Not Found\r\nContent-Length: %d\r\n"
            b"Content-Type: text/plain\r\n\r\n%s" % (len(body), body)
        )
        return

    ext = os.path.splitext(full)[1].lower()
    ctype = CONTENT_TYPES.get(ext, "application/octet-stream")
    with open(full, "rb") as f:
        body = f.read()
    headers = (
        f"HTTP/1.1 200 OK\r\n"
        f"Content-Type: {ctype}\r\n"
        f"Content-Length: {len(body)}\r\n"
        f"Cache-Control: no-store\r\n"
        f"Access-Control-Allow-Origin: *\r\n\r\n"
    )
    conn.sendall(headers.encode() + body)


def parse_request(conn):
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = conn.recv(4096)
        if not chunk:
            return None, None, None
        data += chunk
        if len(data) > 65536:
            break
    head = data.split(b"\r\n\r\n", 1)[0].decode("latin-1")
    lines = head.split("\r\n")
    request_line = lines[0].split(" ")
    if len(request_line) < 2:
        return None, None, None
    method, path = request_line[0], request_line[1]
    headers = {}
    for line in lines[1:]:
        if ": " in line:
            k, v = line.split(": ", 1)
            headers[k.lower()] = v
    return method, path, headers


def handle_connection(conn, addr):
    try:
        method, path, headers = parse_request(conn)
        if method is None:
            conn.close()
            return
        upgrade = headers.get("upgrade", "").lower()
        if upgrade == "websocket" and path == "/ws":
            key = headers.get("sec-websocket-key", "")
            if key:
                handle_websocket(conn, key)
                return
        serve_static(conn, path)
    except OSError:
        pass
    finally:
        try:
            conn.close()
        except OSError:
            pass


def main():
    parser = argparse.ArgumentParser(description="YouTube Music -> OBS overlay server")
    parser.add_argument("--port", type=int, default=8787, help="Port to listen on")
    parser.add_argument("--host", default="127.0.0.1", help="Host/interface to bind")
    args = parser.parse_args()

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((args.host, args.port))
    server.listen(16)

    print(f"Overlay server running:")
    print(f"  OBS Browser Source URL : http://localhost:{args.port}/")
    print(f"  Extension WebSocket    : ws://localhost:{args.port}/ws")
    print("Press Ctrl+C to stop.")

    try:
        while True:
            conn, addr = server.accept()
            conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            threading.Thread(target=handle_connection, args=(conn, addr), daemon=True).start()
    except KeyboardInterrupt:
        print("\nShutting down.")
    finally:
        server.close()


if __name__ == "__main__":
    main()
