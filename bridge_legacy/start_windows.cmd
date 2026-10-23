@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
node --version
node bridge.mjs
if errorlevel 1 pause