@echo off
cd /d "%~dp0"
if not exist ".lan-deps\websockets\asyncio\server.py" (
    python -m pip install --target .lan-deps -r requirements-lan.txt
    if errorlevel 1 exit /b 1
)
python serve.py --lan --port 8766
if errorlevel 1 pause
