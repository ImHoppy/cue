"""Static file serving for the bundled overlay/ web assets."""

import os
import sys

if getattr(sys, "frozen", False):
    OVERLAY_DIR = os.path.join(sys._MEIPASS, "overlay")
else:
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
