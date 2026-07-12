import os

HERE = SPECPATH
OVERLAY_SRC = os.path.normpath(os.path.join(HERE, "..", "overlay"))
ICON = os.path.join(HERE, "icon.ico")

a = Analysis(
    ["server.py"],
    pathex=[HERE],
    binaries=[],
    datas=[
        (OVERLAY_SRC, "overlay"),  # bundle overlay/* -> _MEIPASS/overlay/*
        (ICON, "."),               # tray icon, read at runtime by tray.py
    ],
    hiddenimports=["pystray"],
    hookspath=[],
    runtime_hooks=[],
    # Keep the exe small: the tray feeds pystray raw .ico bytes via a duck-typed
    # wrapper, so Pillow is never needed. Exclude it (and other heavy stacks) so
    # PyInstaller can't accidentally pull it in through pystray.
    excludes=["tkinter", "PIL", "numpy"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="ytmusic-overlay-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,         # windowless: no console pops up when launched
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=ICON,             # use the extension artwork for the exe itself
)
