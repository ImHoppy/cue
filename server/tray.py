"""Optional system-tray icon so a windowless server can be closed."""

import os
import sys


def _icon_path():
    """Path to the bundled icon.ico (works both frozen and from source)."""
    if getattr(sys, "frozen", False):
        base = sys._MEIPASS
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, "icon.ico")


class _IcoImage:
    """Minimal stand-in for a PIL.Image that just re-emits raw .ico bytes.

    pystray only calls .save(fp, format=...) on the icon image, so this is all
    the surface we need -- and it lets us skip the Pillow dependency entirely.
    """

    def __init__(self, path):
        with open(path, "rb") as f:
            self._data = f.read()

    def save(self, fp, format=None):  # noqa: A002 - matches PIL.Image.save
        fp.write(self._data)


def run_tray_icon(on_quit, port):
    """Show a tray icon with a "Quit" menu item.

    Blocks until the user quits, then returns True. Returns False
    when pystray unavailable.
    """
    try:
        import pystray
    except ImportError:
        return False

    def _quit(icon, _item):
        icon.stop()
        on_quit()

    icon = pystray.Icon(
        "ytmusic-overlay-server",
        _IcoImage(_icon_path()),
        f"YT Music Overlay (port {port})",
        menu=pystray.Menu(
            pystray.MenuItem(f"Running on port {port}", None, enabled=False),
            pystray.MenuItem("Quit", _quit),
        ),
    )
    icon.run()
    return True
