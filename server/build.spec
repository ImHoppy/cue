import os

HERE = SPECPATH
OVERLAY_SRC = os.path.normpath(os.path.join(HERE, "..", "overlay"))

a = Analysis(
    ["server.py"],
    pathex=[HERE],
    binaries=[],
    datas=[(OVERLAY_SRC, "overlay")],  # bundle overlay/* -> _MEIPASS/overlay/*
    hiddenimports=["pystray", "PIL", "PIL.Image", "PIL.ImageDraw"],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
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
)
