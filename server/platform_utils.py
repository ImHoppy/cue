"""Small platform helpers: logging, port probing, windowed-mode detection."""

import socket
import sys


def log(*parts):
    if sys.stdout is None:
        return
    try:
        print(*parts)
    except (OSError, ValueError):
        pass


def port_in_use(host, port):
    """Return True if something is already listening on host:port."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.settimeout(0.5)
    try:
        # Connecting to 0.0.0.0 doesn't work; probe loopback for wildcard binds.
        target = "127.0.0.1" if host in ("", "0.0.0.0") else host
        return probe.connect_ex((target, port)) == 0
    finally:
        probe.close()


def is_windowed():
    """True when running without an attached console (e.g. frozen, windowless)."""
    return sys.stdout is None or sys.stderr is None


def notify_error(title, message):
    """Show an error to the user; message box when windowed, else log."""
    if is_windowed() and sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, message, title, 0x10)
            return
        except Exception:
            pass
    log(f"{title}: {message}")
