# Windows PowerShell wrapper for Server-Side AES-256-GCM Backfill
param(
  [string]$DataKey = $env:SETU_DATA_KEY,
  [string]$DatabaseUrl = $env:DATABASE_URL
)

$toolsPath = "C:\Users\dell\.gemini\antigravity\scratch\tools\node-v20.18.0-win-x64"
if (Test-Path $toolsPath) {
  $env:PATH = "$toolsPath;$env:PATH"
}

if (-not $DataKey) {
  Write-Host "Usage: .\scripts\server_encrypt_backfill.ps1 -DataKey 'v1:your-64-character-hex-key' -DatabaseUrl 'postgres://...'" -ForegroundColor Yellow
  exit 1
}

$env:SETU_DATA_KEY = $DataKey
if ($DatabaseUrl) {
  $env:DATABASE_URL = $DatabaseUrl
}

node (Join-Path $PSScriptRoot "server_encrypt_backfill.js")
