#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CliTs = Join-Path $ScriptDir "..\backend\src\cli\index.ts"
$DistJs = Join-Path $ScriptDir "..\dist\cli\index.js"

$bun = Get-Command bun -ErrorAction SilentlyContinue
if ($bun) {
  & bun run $CliTs @args
  exit $LASTEXITCODE
}

if (Test-Path "D:\dev\bun\bin\bun.exe") {
  & "D:\dev\bun\bin\bun.exe" run $CliTs @args
  exit $LASTEXITCODE
}

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  if (Test-Path $DistJs) {
    & node $DistJs @args
  } else {
    & npx tsx $CliTs @args
  }
  exit $LASTEXITCODE
}

Write-Error "[OCR ERROR] Neither bun nor node found in PATH."
exit 1
