@echo off
setlocal
set "CLI_TS=%~dp0..\backend\src\cli\index.ts"
set "DIST_JS=%~dp0..\dist\cli\index.js"

where bun >nul 2>nul
if %ERRORLEVEL% equ 0 (
  bun run "%CLI_TS%" %*
  exit /b %ERRORLEVEL%
)

if exist "D:\dev\bun\bin\bun.exe" (
  "D:\dev\bun\bin\bun.exe" run "%CLI_TS%" %*
  exit /b %ERRORLEVEL%
)

where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
  if exist "%DIST_JS%" (
    node "%DIST_JS%" %*
    exit /b %ERRORLEVEL%
  )
  npx tsx "%CLI_TS%" %*
  exit /b %ERRORLEVEL%
)

echo [OCR ERROR] Neither bun nor node found on PATH.
exit /b 1
