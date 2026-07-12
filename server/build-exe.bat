@echo off
REM Builds ytmusic-overlay-server.exe
REM Requires Python + pip. Installs PyInstaller if missing.

cd /d "%~dp0"

python -m pip install --quiet --upgrade pyinstaller pystray pillow || (
  echo Failed to install build dependencies. Make sure Python and pip are available.
  pause
  exit /b 1
)

python -m PyInstaller --noconfirm build.spec

echo.
echo Build complete: %~dp0dist\ytmusic-overlay-server.exe
echo Double-click that exe (or point the OBS/autostart scripts at it) to run.
pause
