@echo off
title Backend Spring Boot (Port 8080)
echo ===================================================
echo Memulai Backend Spring Boot Asrama (Port 8080)...
echo ===================================================
cd /d "%~dp0backend"
mvn spring-boot:run
pause
