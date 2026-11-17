@echo off
chcp 65001 >nul
title NukeDrive Sunucu ve Yayin
cd /d "%~dp0"
echo ====================================================
echo   NukeDrive Kisisel Bulut ve Dosya Sunucusu
echo ====================================================
echo.
echo Tarayicida aciliyor: http://localhost:4000
echo Durdurmak icin bu pencereyi kapatabilirsiniz.
echo.
start "" "http://localhost:4000"
npm start --workspace apps/server
pause
