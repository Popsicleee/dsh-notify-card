# dsh-notify-card self test: pops a sample card at the bottom-right of the desktop.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File selftest.ps1
#
# NOTE: this script is deliberately pure ASCII. Windows PowerShell 5.1 reads a
# BOM-less UTF-8 .ps1 file as ANSI, which corrupts non-ASCII literals (and can
# even break parsing). All user-visible Chinese text lives in the JSON payload,
# which notify.ps1 reads explicitly as UTF-8.
#
# NOTE: notify.ps1 exits 0 even when it cannot parse the payload (it only drops
# a .unreadable marker), so the exit code alone proves nothing - we check the
# marker file here.
$ErrorActionPreference = 'Stop'

$notify = Join-Path $PSScriptRoot 'assets\notify.ps1'
if (-not (Test-Path -LiteralPath $notify)) { throw "not found: $notify" }

$payload = Join-Path $env:TEMP ("dsh-notify-card-selftest-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$json = @'
{
  "title": "DSH notify-card self-test",
  "session": "plugin asset check",
  "headline": "Card script started successfully",
  "summary": "If you can see this card, assets/notify.ps1 parses and WinForms renders.",
  "footer": "click anywhere or press Esc to close",
  "status": "ok",
  "timeoutSeconds": 20,
  "sound": "asterisk",
  "animate": "1"
}
'@
[IO.File]::WriteAllText($payload, $json, [Text.UTF8Encoding]::new($false))
Write-Host "payload: $payload"
Write-Host "script : $notify"

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $notify -PayloadPath $payload

if (Test-Path -LiteralPath ($payload + '.unreadable')) {
    Write-Host 'FAILED: payload could not be parsed (see the .unreadable marker)'
    Remove-Item -LiteralPath ($payload + '.unreadable') -Force -ErrorAction SilentlyContinue
    exit 1
}
Write-Host 'OK: card rendered and closed'
