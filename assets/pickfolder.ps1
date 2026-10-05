<#
  DSH notify-card folder picker.

  The settings page lives in the browser, which cannot read a local path, so
  choosing the folder of background pictures has to happen on this machine. This
  script shows the native FolderBrowserDialog and writes the answer to the file
  named in the payload:

    payload: { "output": "<json file>", "initial": "<folder to open at>",
               "description": "<dialog caption, may be non-ASCII>" }
    output:  { "path": "<chosen folder>", "cancelled": true|false }

  ASCII only: every string that must be localized travels through the JSON
  payload, because a UTF-8 script file is not read reliably by Windows
  PowerShell 5.1 (see notify.ps1 for the same rule).

  Usage: powershell -STA -File pickfolder.ps1 -PayloadPath <utf8-json-file>
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

function Write-Result {
  param([string]$Output, [string]$Path, [bool]$Cancelled)
  $body = @{ path = $Path; cancelled = $Cancelled } | ConvertTo-Json -Compress
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Output, $body, $encoding)
}

$payload = $null
try {
  $raw = [System.IO.File]::ReadAllText($PayloadPath, [System.Text.Encoding]::UTF8)
  $payload = $raw | ConvertFrom-Json
} catch {
  $payload = $null
}

try { Remove-Item -LiteralPath $PayloadPath -Force -ErrorAction SilentlyContinue } catch { }

$output = Get-Field $payload 'output' ''
$initial = Get-Field $payload 'initial' ''
if ([string]::IsNullOrWhiteSpace($output)) {
  # Nothing to report to: fail loudly instead of hanging with a dialog nobody
  # can match to a request.
  exit 2
}

$chosen = ''
$cancelled = $true
$owner = $null

try {
  Add-Type -AssemblyName System.Windows.Forms
} catch {
  Write-Result -Output $output -Path '' -Cancelled $true
  exit 3
}

try {
  # A zero-opacity owner keeps the picker in front of the DSH window. It is
  # parked far off-screen and kept out of the taskbar so it can never be seen,
  # and it lives exactly as long as the dialog.
  $owner = New-Object System.Windows.Forms.Form
  $owner.FormBorderStyle = 'None'
  $owner.ShowInTaskbar = $false
  $owner.StartPosition = 'Manual'
  $owner.Location = New-Object System.Drawing.Point(-3000, -3000)
  $owner.Size = New-Object System.Drawing.Size(1, 1)
  $owner.Opacity = 0
  $owner.TopMost = $true
  $owner.Show()

  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = Get-Field $payload 'description' 'Select the folder that holds the background pictures'
  $dialog.ShowNewFolderButton = $false
  if (-not [string]::IsNullOrWhiteSpace($initial) -and (Test-Path -LiteralPath $initial -PathType Container)) {
    $dialog.SelectedPath = $initial
  }

  $result = $dialog.ShowDialog($owner)
  if ($result -eq [System.Windows.Forms.DialogResult]::OK -and -not [string]::IsNullOrWhiteSpace($dialog.SelectedPath)) {
    $chosen = $dialog.SelectedPath
    $cancelled = $false
  }
  $dialog.Dispose()
} catch {
  $chosen = ''
  $cancelled = $true
} finally {
  if ($null -ne $owner) {
    try { $owner.Close() } catch { }
    try { $owner.Dispose() } catch { }
  }
}

try {
  Write-Result -Output $output -Path $chosen -Cancelled $cancelled
} catch {
  exit 4
}

exit 0
