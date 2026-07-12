"""Optional system-tray icon so a windowless server can be closed."""


def run_tray_icon(on_quit, port):
    """Run a system tray icon so a windowless server can be closed.

    Returns True if the tray started (and blocks until quit), False if the
    optional dependencies are unavailable.
    """
    try:
        import pystray
        from PIL import Image, ImageDraw
    except ImportError:
        return False

    # Draw a simple round "play" icon.
    size = 64
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse((2, 2, size - 2, size - 2), fill=(200, 40, 40, 255))
    draw.polygon([(24, 18), (24, 46), (48, 32)], fill=(255, 255, 255, 255))

    def _quit(icon, _item):
        icon.stop()
        on_quit()

    icon = pystray.Icon(
        "ytmusic-overlay-server",
        image,
        f"YT Music Overlay (port {port})",
        menu=pystray.Menu(
            pystray.MenuItem(f"Running on port {port}", None, enabled=False),
            pystray.MenuItem("Quit", _quit),
        ),
    )
    icon.run()
    return True
