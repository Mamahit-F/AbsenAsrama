@echo off
title AI Service (FastAPI ArcFace)
echo ===================================================
echo Memulai Layanan AI Pengenalan Wajah Asrama (Port 8000)...
echo ===================================================
cd /d "%~dp0ai_service"
python -m uvicorn main:app --host 127.0.0.1 --port 8000
pause
