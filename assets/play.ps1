<#
  DSH notify-card sound preview.

  Plays one sound on the host so the settings page can offer a "listen" button
  without shipping audio through the browser. The payload uses the same fields
  as the card renderer: `sound` (system sound name) and `soundFile` (a .wav
  path), so a preview sounds exactly like the real notification.

  Usage: powershell -File play.ps1 -PayloadPath <utf8-json-file>
#>
param(
  [Parameter(Mandatory = $true)][string]$PayloadPath
)

$ErrorActionPreference = 'Stop'

function Get-Field {
  param($Object, [string]$Name, [string]$Default = '')
  if ($null -eq $Object) { return $Default }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value) { return $Default }
  return [string]$property.Value
}

$payload = $null
try {
  $raw = [System.IO.File]::ReadAllText($PayloadPath, [System.Text.Encoding]::UTF8)
  $payload = $raw | ConvertFrom-Json
} catch {
  $payload = $null
}

$kind = Get-Field $payload 'sound' 'asterisk'
$file = Get-Field $payload 'soundFile' ''

try {
  if (-not [string]::IsNullOrWhiteSpace($file) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
    # PlaySync keeps the process alive for exactly the file's duration.
    $player = New-Object System.Media.SoundPlayer($file)
    $player.PlaySync()
  } elseif ($kind -ne 'none') {
    switch ($kind) {
      'beep'        { [System.Media.SystemSounds]::Beep.Play() }
      'exclamation' { [System.Media.SystemSounds]::Exclamation.Play() }
      'hand'        { [System.Media.SystemSounds]::Hand.Play() }
      'question'    { [System.Media.SystemSounds]::Question.Play() }
      default       { [System.Media.SystemSounds]::Asterisk.Play() }
    }
    # SystemSounds plays asynchronously and a console sound request stops when
    # this process exits, so hold the process open past a typical cue.
    Start-Sleep -Milliseconds 2500
  }
} catch {
  try { Remove-Item -LiteralPath $PayloadPath -Force -ErrorAction SilentlyContinue } catch { }
  exit 1
}

try { Remove-Item -LiteralPath $PayloadPath -Force -ErrorAction SilentlyContinue } catch { }
exit 0
