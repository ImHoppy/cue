"""HTTP request parsing and per-connection dispatch (static vs websocket)."""

from static_files import serve_static
from wsproto import handle_websocket


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
