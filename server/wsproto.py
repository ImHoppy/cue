"""Minimal WebSocket protocol: framing, handshake, and the client handler."""

import base64
import hashlib
import json
import struct
import threading

from hub import HUB

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
                is_settings = False
                try:
                    parsed = json.loads(text)
                    if isinstance(parsed, dict):
                        if parsed.get("role"):
                            continue
                        is_settings = parsed.get("type") == "SETTINGS"
                except (ValueError, TypeError):
                    pass
                HUB.broadcast(text, sender=client, is_settings=is_settings)
    finally:
        HUB.remove(client)
        try:
            conn.close()
        except OSError:
            pass
