#!/usr/bin/env python3
"""
Local overlay server for "YouTube Music -> OBS Overlay".

Usage:
    python server.py [--port 8787]
"""

import argparse
import socket
import sys
import threading

from http_conn import handle_connection
from platform_utils import is_windowed, log, notify_error


def main():
    parser = argparse.ArgumentParser(description="YouTube Music -> OBS overlay server")
    parser.add_argument("--port", type=int, default=8787, help="Port to listen on")
    parser.add_argument("--host", default="127.0.0.1", help="Host/interface to bind")
    args = parser.parse_args()

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((args.host, args.port))
    server.listen(16)

    log("Overlay server running:")
    log(f"  OBS Browser Source URL : http://localhost:{args.port}/")
    log(f"  Extension WebSocket    : ws://localhost:{args.port}/ws")
    log("Press Ctrl+C to stop.")

    try:
        while True:
            conn, addr = server.accept()
            conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            threading.Thread(target=handle_connection, args=(conn, addr), daemon=True).start()
    except KeyboardInterrupt:
        log("\nShutting down.")
    finally:
        server.close()


if __name__ == "__main__":
    main()
