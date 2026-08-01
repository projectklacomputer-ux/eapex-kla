@echo off
REM ===========================================================================
REM  EAPEX - Electronic Approval & Capex
REM  PT KLA TEKNOLOGI INDONESIA
REM
REM  Klik dua kali berkas ini untuk menyalakan aplikasi di komputer ini.
REM  Jangan tutup jendela hitam ini selama aplikasi dipakai.
REM ===========================================================================
title EAPEX - PT KLA Teknologi Indonesia
cd /d "%~dp0"

if not exist "node_modules" (
  echo.
  echo   Memasang komponen yang diperlukan, mohon tunggu...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   GAGAL memasang komponen. Pastikan komputer tersambung internet.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  echo.
  echo   Berkas .env belum ada - dibuat otomatis dari contoh.
  copy ".env.example" ".env" >nul
)

echo.
echo   Menyalakan EAPEX...
echo   Setelah muncul tulisan "Alamat", buka alamat itu di peramban.
echo   Untuk mematikan aplikasi: tekan Ctrl+C atau tutup jendela ini.
echo.

start "" http://localhost:4700
node server.js

echo.
echo   EAPEX berhenti.
pause
