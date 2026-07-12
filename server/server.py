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
from platform_utils import is_windowed, log, notify_error, port_in_use
from tray import run_tray_icon


def main():
    parser = argparse.ArgumentParser(description="YouTube Music -> OBS overlay server")
    parser.add_argument("--port", type=int, default=8787, help="Port to listen on")
    parser.add_argument("--host", default="127.0.0.1", help="Host/interface to bind")
    args = parser.parse_args()

    if port_in_use(args.host, args.port):
        notify_error(
            "Overlay server",
            f"Port {args.port} is already in use.\n"
            "Another instance may already be running.",
        )
        sys.exit(1)

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

    if sys.platform != "win32":
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        server.bind((args.host, args.port))
    except OSError as exc:
        notify_error(
            "Overlay server",
            f"Could not bind port {args.port}.\n{exc}",
        )
        sys.exit(1)
    server.listen(16)

    log("Overlay server running:")
    log(f"  OBS Browser Source URL : http://localhost:{args.port}/")
    log(f"  Extension WebSocket    : ws://localhost:{args.port}/ws")
    log("Press Ctrl+C to stop.")

    def serve_forever():
        try:
            while True:
                conn, addr = server.accept()
                conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                threading.Thread(
                    target=handle_connection, args=(conn, addr), daemon=True
                ).start()
        except OSError:
            pass

    if is_windowed():
        accept_thread = threading.Thread(target=serve_forever, daemon=True)
        accept_thread.start()
        started = run_tray_icon(server.close, args.port)
        if started:
            server.close()
            return
        try:
            accept_thread.join()
        except KeyboardInterrupt:
            pass
        server.close()
        return

    try:
        serve_forever()
    except KeyboardInterrupt:
        log("\nShutting down.")
    finally:
        server.close()


if __name__ == "__main__":
    main()
