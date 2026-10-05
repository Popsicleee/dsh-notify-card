<#
  DSH notify-card popup renderer.

  Renders a small always-on-top Windows card at the bottom-right of the monitor
  the mouse is on, then exits. All user-visible text arrives through a UTF-8 JSON
  payload file so that this script itself stays pure ASCII (Windows PowerShell
  5.1 would otherwise mis-decode non-ASCII literals).

  Usage: powershell -File notify.ps1 -PayloadPath <utf8-json-file>

  Payload fields (all optional except title/summary):
    title, session, headline, summary, tools, files, footer,
    status ('ok' | 'warn' | 'error'), timeoutSeconds, accent, background,
    theme ('light' | 'dark'; missing -> the Windows application theme),
    backgroundImage (absolute image path, drawn cover-cropped behind the text),
    dim (0-90, how much the background image is darkened),
    focusX / focusY (0-100: which part of the image the crop keeps),
    anchor ('tl'..'br'), marginX / marginY (work-area margins),
    maxWidth / maxHeight (pixel caps; maxHeight 0 = grow with the content),
    animate ('1'/'0') and animationMs (slide-in AND slide-out duration),
    sessionId / jump / appMatch (a click jumps to that conversation and raises the app),
    sound ('none' | 'asterisk' | 'exclamation' | 'hand' | 'question' | 'beep'),
    soundFile (absolute .wav path, played instead of a system sound)
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

# Windows dialog sound. The system sound respects the user's current sound
# scheme (Control Panel > Sound > Sounds); a missing scheme entry plays nothing.
# A .wav path in `soundFile` overrides it and is played asynchronously, so the
# player object is kept alive in the script scope until the card closes.
function Play-NotifySound {
  param([string]$Kind, [string]$File)
  try {
    if (-not [string]::IsNullOrWhiteSpace($File) -and (Test-Path -LiteralPath $File -PathType Leaf)) {
      $script:soundPlayer = New-Object System.Media.SoundPlayer($File)
      $script:soundPlayer.Play()
      return
    }
    switch ($Kind) {
      'none'        { return }
      'beep'        { [System.Media.SystemSounds]::Beep.Play(); return }
      'exclamation' { [System.Media.SystemSounds]::Exclamation.Play(); return }
      'hand'        { [System.Media.SystemSounds]::Hand.Play(); return }
      'question'    { [System.Media.SystemSounds]::Question.Play(); return }
      'asterisk'    { [System.Media.SystemSounds]::Asterisk.Play(); return }
      default       { [System.Media.SystemSounds]::Asterisk.Play(); return }
    }
  } catch { }
}

# Bring the harness window forward: switching the conversation in the browser is
# only useful if the window showing it is actually visible.
#
# The window's own state is never changed here. `ShowWindow(SW_RESTORE)` is used
# only when the window is *minimised*, where it puts the window back the way it
# was (a maximised window returns maximised). Calling it on a maximised window is
# what used to shrink the harness to its restored size on every jump.
function Show-AppWindow {
  param([string]$Match)
  try {
    foreach ($candidate in [System.Diagnostics.Process]::GetProcesses()) {
      try {
        if ($candidate.MainWindowHandle -eq [IntPtr]::Zero) { continue }
        if ([string]::IsNullOrWhiteSpace($candidate.MainWindowTitle)) { continue }
        if (-not [string]::IsNullOrWhiteSpace($Match) -and $candidate.ProcessName -notlike ('*' + $Match + '*')) { continue }
        if ([DshFocus]::IsIconic($candidate.MainWindowHandle)) {
          [void][DshFocus]::ShowWindow($candidate.MainWindowHandle, 9)
        }
        [void][DshFocus]::SetForegroundWindow($candidate.MainWindowHandle)
        return
      } catch { }
    }
  } catch { }
}

function New-UiFont {
  param([string]$Family, [double]$Size, [bool]$Bold = $false)
  $style = if ($Bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  foreach ($name in @($Family, 'Microsoft YaHei UI', 'Microsoft YaHei', 'Segoe UI')) {
    if ([string]::IsNullOrWhiteSpace($name)) { continue }
    try { return (New-Object System.Drawing.Font($name, $Size, $style)) } catch { }
  }
  return (New-Object System.Drawing.Font([System.Drawing.FontFamily]::GenericSansSerif, $Size, $style))
}

function Measure-Block {
  param([string]$Text, $Font, [int]$Width)
  if ([string]::IsNullOrEmpty($Text)) { return 0 }
  $flags = [System.Windows.Forms.TextFormatFlags]::WordBreak
  $probe = New-Object System.Drawing.Size($Width, 4000)
  return ([System.Windows.Forms.TextRenderer]::MeasureText($Text, $Font, $probe, $flags)).Height
}

$payload = $null
try {
  $raw = [System.IO.File]::ReadAllText($PayloadPath, [System.Text.Encoding]::UTF8)
  $payload = $raw | ConvertFrom-Json
} catch {
  $payload = $null
}

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
} catch {
  exit 0
}

# Only for the jump: the card is the foreground window when it is clicked, so it
# is allowed to hand focus to the application window.
try {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DshFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@
} catch { }

if ($null -eq $payload) {
  # Unreadable payload: exit quietly rather than showing a dialog with a close
  # button. The host records the spawn in its own trace log.
  try { [System.IO.File]::WriteAllText($PayloadPath + '.unreadable', 'payload could not be parsed') } catch { }
  exit 0
}

$title    = Get-Field $payload 'title' 'DSH'
$session  = Get-Field $payload 'session'
# The conversation this card is about, when that is not already the session line.
$target   = Get-Field $payload 'target' ''
# Clicking the card can also take the user to that conversation: the card drops a
# marker the host picks up, and the browser half performs the navigation.
$sessionId = Get-Field $payload 'sessionId' ''
$jumpRaw = (Get-Field $payload 'jump' '0').Trim().ToLower()
$jump = -not ($jumpRaw -eq '0' -or $jumpRaw -eq 'false' -or $jumpRaw -eq 'no' -or $jumpRaw -eq 'off')
# Which application window to bring forward when jumping (process name match).
$appMatch = Get-Field $payload 'appMatch' 'DeepSeek'
$headline = Get-Field $payload 'headline'
$summary  = Get-Field $payload 'summary'
$tools    = Get-Field $payload 'tools'
$files    = Get-Field $payload 'files'
$footer   = Get-Field $payload 'footer' ''
$status   = Get-Field $payload 'status' 'ok'
$sound    = Get-Field $payload 'sound' ''
$soundFile = Get-Field $payload 'soundFile' ''
if ([string]::IsNullOrWhiteSpace($sound) -and [string]::IsNullOrWhiteSpace($soundFile)) {
  switch ($status) {
    'error' { $sound = 'hand' }
    'warn'  { $sound = 'exclamation' }
    default { $sound = 'asterisk' }
  }
}
$timeout  = 0
try { $timeout = [int](Get-Field $payload 'timeoutSeconds' '25') } catch { $timeout = 25 }
if ($timeout -lt 0) { $timeout = 0 }

# Where the card lands ('tl'..'br', default bottom-right) and how it arrives.
$anchor = Get-Field $payload 'anchor' 'br'
$marginX = 24
$marginY = 24
try { $marginX = [int](Get-Field $payload 'marginX' '24') } catch { $marginX = 24 }
try { $marginY = [int](Get-Field $payload 'marginY' '24') } catch { $marginY = 24 }
if ($marginX -lt 0) { $marginX = 0 }
if ($marginY -lt 0) { $marginY = 0 }

# Upper bounds for the card: width always applies, height only when > 0
# (0 = grow with the content). The renderer narrows the summary, then drops the
# tool/file lines, to respect them.
$maxWidth = 460
$maxHeight = 0
try { $maxWidth = [int](Get-Field $payload 'maxWidth' '460') } catch { $maxWidth = 460 }
try { $maxHeight = [int](Get-Field $payload 'maxHeight' '0') } catch { $maxHeight = 0 }
if ($maxWidth -lt 240) { $maxWidth = 240 }
if ($maxWidth -gt 1600) { $maxWidth = 1600 }
if ($maxHeight -lt 0) { $maxHeight = 0 }
if ($maxHeight -gt 2000) { $maxHeight = 2000 }
$animateRaw = (Get-Field $payload 'animate' '1').Trim().ToLower()
# JSON booleans arrive as "True"/"False" through Get-Field, so compare textually.
$animate = -not ($animateRaw -eq '0' -or $animateRaw -eq 'false' -or $animateRaw -eq 'no' -or $animateRaw -eq 'off')
$animationMs = 500
try { $animationMs = [int](Get-Field $payload 'animationMs' '500') } catch { $animationMs = 500 }
if ($animationMs -lt 0) { $animationMs = 0 }
if ($animationMs -gt 3000) { $animationMs = 3000 }

# Optional cover image behind the whole card. Loaded here so a missing or broken
# file degrades to the plain palette background instead of failing the card.
$backgroundImagePath = Get-Field $payload 'backgroundImage' ''
$dimPercent = 45
try { $dimPercent = [int](Get-Field $payload 'dim' '45') } catch { $dimPercent = 45 }
if ($dimPercent -lt 0) { $dimPercent = 0 }
if ($dimPercent -gt 90) { $dimPercent = 90 }
# Which part of the image the cover crop keeps: 0 = left/top edge, 100 =
# right/bottom, 50 = centred (the same percentage rule as CSS background-position).
$focusX = 50
$focusY = 50
try { $focusX = [int](Get-Field $payload 'focusX' '50') } catch { $focusX = 50 }
try { $focusY = [int](Get-Field $payload 'focusY' '50') } catch { $focusY = 50 }
if ($focusX -lt 0) { $focusX = 0 }
if ($focusX -gt 100) { $focusX = 100 }
if ($focusY -lt 0) { $focusY = 0 }
if ($focusY -gt 100) { $focusY = 100 }
$script:coverImage = $null
if (-not [string]::IsNullOrWhiteSpace($backgroundImagePath) -and (Test-Path -LiteralPath $backgroundImagePath -PathType Leaf)) {
  try { $script:coverImage = [System.Drawing.Image]::FromFile($backgroundImagePath) } catch { $script:coverImage = $null }
}

# Palette. The payload carries an explicit `theme` ('light' | 'dark'); a missing
# or unknown value is resolved here from the Windows application theme, so the
# card still follows the system when this script is run on its own.
$theme = Get-Field $payload 'theme' ''
if ($theme -ne 'light' -and $theme -ne 'dark') {
  $appLight = 0
  try {
    $appLight = [int](Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -Name AppsUseLightTheme -ErrorAction Stop).AppsUseLightTheme
  } catch { $appLight = 0 }
  $theme = if ($appLight -eq 1) { 'light' } else { 'dark' }
}

if ($theme -eq 'light') {
  $background  = '#FFFFFF'
  $borderColor = '#E1E4E8'
  $foreMain    = '#1F2328'
  $foreSub     = '#6B7280'
  $foreBody    = '#3A4048'
  $foreHint    = '#98A0AA'
  $accentOk    = '#22C55E'
  $accentWarn  = '#F59E0B'
  $accentError = '#EF4444'
} else {
  $background  = '#1E1F22'
  $borderColor = '#33363B'
  $foreMain    = '#E8EAED'
  $foreSub     = '#9AA0A6'
  $foreBody    = '#D5D8DC'
  $foreHint    = '#6F757E'
  $accentOk    = '#4ADE80'
  $accentWarn  = '#FBBF24'
  $accentError = '#F87171'
}

# A photo background is always darkened by `dim`, so the card keeps the
# light-on-dark text colors there whatever the theme says.
if ($null -ne $script:coverImage) {
  $foreMain    = '#E8EAED'
  $foreSub     = '#9AA0A6'
  $foreBody    = '#D5D8DC'
  $foreHint    = '#6F757E'
  $accentOk    = '#4ADE80'
  $accentWarn  = '#FBBF24'
  $accentError = '#F87171'
}

$backgroundOverride = Get-Field $payload 'background' ''
if (-not [string]::IsNullOrEmpty($backgroundOverride)) { $background = $backgroundOverride }

$accent = Get-Field $payload 'accent' ''
if ([string]::IsNullOrEmpty($accent)) {
  switch ($status) {
    'error' { $accent = $accentError }
    'warn'  { $accent = $accentWarn }
    default { $accent = $accentOk }
  }
}

$text = $summary
if ([string]::IsNullOrWhiteSpace($text)) { $text = $headline }
if ([string]::IsNullOrWhiteSpace($text)) { $text = $session }

try {
  try {
    Add-Type -Namespace DshNotify -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();' -ErrorAction Stop
    [void][DshNotify.Dpi]::SetProcessDPIAware()
  } catch { }
  [void][System.Windows.Forms.Application]::EnableVisualStyles()

  $form = New-Object System.Windows.Forms.Form
  # Borderless and chrome-less: no title bar, so no close (X) button anywhere.
  $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
  $form.ControlBox = $false
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.ShowIcon = $false
  $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $form.ShowInTaskbar = $false
  $form.TopMost = $true
  $form.KeyPreview = $true
  $form.BackColor = [System.Drawing.ColorTranslator]::FromHtml($background)
  $form.Text = $title
  # Borderless forms have no frame, so draw the 1px outline the light palette needs.
  $form.Add_Paint({
    param($sender, $event)
    try {
      $pen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml($borderColor))
      $event.Graphics.DrawRectangle($pen, 0, 0, ($form.ClientSize.Width - 1), ($form.ClientSize.Height - 1))
      $pen.Dispose()
    } catch { }
  })

  # The work area bounds both the card's size and where it lands, so resolve it
  # before laying anything out.
  $area = $null
  try { $area = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea } catch { }
  if ($null -eq $area) { $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea }

  $pad = 18
  $width = [Math]::Max(240, [Math]::Min($maxWidth, $area.Width - (2 * $marginX) - 8))
  $inner = $width - (2 * $pad)

  $fontTitle = New-UiFont 'Microsoft YaHei UI' 11.5 $true
  $fontMeta  = New-UiFont 'Microsoft YaHei UI' 9 $false
  $fontBody  = New-UiFont 'Microsoft YaHei UI' 9.5 $false
  $fontSmall = New-UiFont 'Microsoft YaHei UI' 8.5 $false

  # ---- measure pass ----------------------------------------------------------
  # The build below adds one block after another, so the heights it will use are
  # computed here first: that is what lets `maxHeight` shrink the summary, then
  # drop the tool/file lines, and finally trim the text with an ellipsis.
  $showSession = (-not [string]::IsNullOrWhiteSpace($session)) -and ($session -ne $title)
  # Same rule the host applies: never print the same conversation twice.
  $showTarget = (-not [string]::IsNullOrWhiteSpace($target)) -and ($target -ne $session) -and ($target -ne $title)
  $lineHeights = @()
  foreach ($line in @($tools, $files)) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $lineHeight = Measure-Block $line $fontSmall $inner
    if ($lineHeight -lt 16) { $lineHeight = 16 }
    $lineHeights += $lineHeight
  }
  $lineBlock = 0
  foreach ($lineHeight in $lineHeights) { $lineBlock += $lineHeight + 4 }

  function Get-ChromeHeight([bool]$withLines) {
    $total = 4 + 16
    if (-not [string]::IsNullOrWhiteSpace($title)) { $total += 26 }
    if ($showSession) { $total += 22 }
    if ($showTarget) { $total += 22 }
    if (-not [string]::IsNullOrWhiteSpace($headline)) { $total += 24 }
    if ($withLines) { $total += $lineBlock }
    if (-not [string]::IsNullOrWhiteSpace($footer)) { $total += 8 + 32 } else { $total += 8 + 6 }
    return $total
  }

  $useLines = $lineHeights.Count -gt 0
  $bodyBudget = 280
  if ($maxHeight -gt 0) {
    $limit = [Math]::Max(140, $maxHeight)
    $bodyBudget = $limit - (Get-ChromeHeight $useLines) - 12
    if ($bodyBudget -lt 60 -and $useLines) {
      $useLines = $false
      $bodyBudget = $limit - (Get-ChromeHeight $false) - 12
    }
    $bodyBudget = [Math]::Max(18, [Math]::Min(280, $bodyBudget))
  }

  if (-not [string]::IsNullOrWhiteSpace($text)) {
    if ((Measure-Block $text $fontBody $inner) -gt $bodyBudget) {
      $trimmed = $text
      while ($trimmed.Length -gt 10) {
        $step = [Math]::Max(1, [int]($trimmed.Length * 0.1))
        $trimmed = $trimmed.Substring(0, $trimmed.Length - $step).TrimEnd()
        if ((Measure-Block ($trimmed + '...') $fontBody $inner) -le $bodyBudget) { break }
      }
      $text = $trimmed + '...'
    }
  }

  $accentBar = New-Object System.Windows.Forms.Panel
  $accentBar.Location = New-Object System.Drawing.Point(0, 0)
  $accentBar.Size = New-Object System.Drawing.Size($width, 4)
  $accentBar.BackColor = [System.Drawing.ColorTranslator]::FromHtml($accent)
  $form.Controls.Add($accentBar)

  $y = 4 + 16

  if (-not [string]::IsNullOrWhiteSpace($title)) {
    $lblTitle = New-Object System.Windows.Forms.Label
    $lblTitle.Text = $title
    $lblTitle.Font = $fontTitle
    $lblTitle.ForeColor = [System.Drawing.ColorTranslator]::FromHtml($foreMain)
    $lblTitle.AutoSize = $false
    $lblTitle.Location = New-Object System.Drawing.Point($pad, $y)
    $lblTitle.Size = New-Object System.Drawing.Size($inner, 24)
    $form.Controls.Add($lblTitle)
    $y += 26
  }

  if (-not [string]::IsNullOrWhiteSpace($session) -and $session -ne $title) {
    $lblSession = New-Object System.Windows.Forms.Label
    $lblSession.Text = $session
    $lblSession.Font = $fontMeta
    $lblSession.ForeColor = [System.Drawing.ColorTranslator]::FromHtml($foreSub)
    $lblSession.AutoSize = $false
    $lblSession.Location = New-Object System.Drawing.Point($pad, $y)
    $lblSession.Size = New-Object System.Drawing.Size($inner, 20)
    $form.Controls.Add($lblSession)
    $y += 22
  }

  if ($showTarget) {
    $lblTarget = New-Object System.Windows.Forms.Label
    $lblTarget.Text = $target
    $lblTarget.Font = $fontMeta
    # Brighter than the session line: with several conversations open, which one is
    # waiting for the user is the thing the card has to make obvious.
    $lblTarget.ForeColor = [System.Drawing.ColorTranslator]::FromHtml($foreMain)
    $lblTarget.AutoSize = $false
    $lblTarget.Location = New-Object System.Drawing.Point($pad, $y)
    $lblTarget.Size = New-Object System.Drawing.Size($inner, 20)
    $form.Controls.Add($lblTarget)
    $y += 22
  }

  if (-not [string]::IsNullOrWhiteSpace($headline)) {
    $lblHead = New-Object System.Windows.Forms.Label
    $lblHead.Text = $headline
    $lblHead.Font = $fontSmall
    $lblHead.ForeColor = [System.Drawing.ColorTranslator]::FromHtml($foreSub)
    $lblHead.AutoSize = $false
    $lblHead.Location = New-Object System.Drawing.Point($pad, $y)
    $lblHead.Size = New-Object System.Drawing.Size($inner, 18)
    $form.Controls.Add($lblHead)
    $y += 24
  }

  if (-not [string]::IsNullOrWhiteSpace($text)) {
    $bodyHeight = Measure-Block $text $fontBody $inner
    if ($bodyHeight -lt 18) { $bodyHeight = 18 }
    if ($bodyHeight -gt $bodyBudget) { $bodyHeight = $bodyBudget }
    $lblBody = New-Object System.Windows.Forms.Label
    $lblBody.Text = $text
    $lblBody.Font = $fontBody
    $lblBody.ForeColor = [System.Drawing.ColorTranslator]::FromHtml($foreBody)
    $lblBody.AutoSize = $false
    $lblBody.Location = New-Object System.Drawing.Point($pad, $y)
    $lblBody.Size = New-Object System.Drawing.Size($inner, $bodyHeight)
    $form.Controls.Add($lblBody)
    $y += $bodyHeight + 12
  }

  if ($useLines) {
    foreach ($line in @($tools, $files)) {
      if ([string]::IsNullOrWhiteSpace($line)) { continue }
      $lineHeight = Measure-Block $line $fontSmall $inner
      if ($lineHeight -lt 16) { $lineHeight = 16 }
      $lbl = New-Object System.Windows.Forms.Label
      $lbl.Text = $line
      $lbl.Font = $fontSmall
      $lbl.ForeColor = [System.Drawing.ColorTranslator]::FromHtml($foreSub)
      $lbl.AutoSize = $false
      $lbl.Location = New-Object System.Drawing.Point($pad, $y)
      $lbl.Size = New-Object System.Drawing.Size($inner, $lineHeight)
      $form.Controls.Add($lbl)
      $y += $lineHeight + 4
    }
  }

  $y += 8
  $lblFooter = $null
  if (-not [string]::IsNullOrWhiteSpace($footer)) {
    $lblFooter = New-Object System.Windows.Forms.Label
    $lblFooter.Text = $footer
    $lblFooter.Font = $fontSmall
    $lblFooter.ForeColor = [System.Drawing.ColorTranslator]::FromHtml($foreHint)
    $lblFooter.AutoSize = $false
    $lblFooter.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
    $lblFooter.Location = New-Object System.Drawing.Point($pad, $y)
    $lblFooter.Size = New-Object System.Drawing.Size($inner, 18)
    $form.Controls.Add($lblFooter)
    $y += 18 + 14
  } else {
    $y += 6
  }

  $form.ClientSize = New-Object System.Drawing.Size($width, $y)

  # Bake the cover image at exactly the card's size (center-cropped, no
  # distortion) with the dim layer already composited, then hand it to
  # BackgroundImage: the transparent labels below paint it correctly.
  if ($null -ne $script:coverImage) {
    try {
      $scale = [Math]::Max($width / $script:coverImage.Width, $y / $script:coverImage.Height)
      $srcW = [int][Math]::Min($script:coverImage.Width, [Math]::Ceiling($width / $scale))
      $srcH = [int][Math]::Min($script:coverImage.Height, [Math]::Ceiling($y / $scale))
      $srcX = [int][Math]::Max(0, [Math]::Round(($script:coverImage.Width - $srcW) * $focusX / 100))
      $srcY = [int][Math]::Max(0, [Math]::Round(($script:coverImage.Height - $srcH) * $focusY / 100))
      $card = New-Object System.Drawing.Bitmap($width, $y)
      $canvas = [System.Drawing.Graphics]::FromImage($card)
      $canvas.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $canvas.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $dest = New-Object System.Drawing.Rectangle(0, 0, $width, $y)
      $canvas.DrawImage($script:coverImage, $dest, $srcX, $srcY, $srcW, $srcH, [System.Drawing.GraphicsUnit]::Pixel)
      if ($dimPercent -gt 0) {
        $alpha = [int][Math]::Round(255 * $dimPercent / 100)
        $scrim = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($alpha, 0, 0, 0))
        $canvas.FillRectangle($scrim, 0, 0, $width, $y)
        $scrim.Dispose()
      }
      $canvas.Dispose()
      $form.BackgroundImage = $card
      $form.BackgroundImageLayout = [System.Windows.Forms.ImageLayout]::None
      foreach ($control in $form.Controls) {
        if ($control -is [System.Windows.Forms.Label]) { $control.BackColor = [System.Drawing.Color]::Transparent }
      }
    } catch { }
  }

  # Where the card lands on the work area: one of nine anchors (`br` = the
  # historical bottom-right) plus its margin. `$area` was resolved before layout.
  $cardHeight = $y
  $leftX = $area.Left + $marginX
  $rightX = $area.Right - $width - $marginX
  $topY = $area.Top + $marginY
  $bottomY = $area.Bottom - $cardHeight - $marginY
  $centerX = $area.Left + [int](($area.Width - $width) / 2)
  $centerY = $area.Top + [int](($area.Height - $cardHeight) / 2)
  switch ($anchor) {
    'tl' { $targetX = $leftX;   $targetY = $topY }
    'tc' { $targetX = $centerX; $targetY = $topY }
    'tr' { $targetX = $rightX;  $targetY = $topY }
    'cl' { $targetX = $leftX;   $targetY = $centerY }
    'cc' { $targetX = $centerX; $targetY = $centerY }
    'cr' { $targetX = $rightX;  $targetY = $centerY }
    'bl' { $targetX = $leftX;   $targetY = $bottomY }
    'bc' { $targetX = $centerX; $targetY = $bottomY }
    default { $targetX = $rightX; $targetY = $bottomY }
  }
  $targetX = [Math]::Max($area.Left + 4, [Math]::Min($area.Right - $width - 4, $targetX))
  $targetY = [Math]::Max($area.Top + 4, [Math]::Min($area.Bottom - $cardHeight - 4, $targetY))

  # The card slides in from the screen edge it is docked to: a left-column
  # anchor enters from the left, a right-column anchor from the right, and a
  # horizontally centred one from the top or bottom; dead centre only fades.
  $slideFrom = 'none'
  if ($anchor -eq 'tl' -or $anchor -eq 'cl' -or $anchor -eq 'bl') { $slideFrom = 'left' }
  elseif ($anchor -eq 'tr' -or $anchor -eq 'cr' -or $anchor -eq 'br') { $slideFrom = 'right' }
  elseif ($anchor -eq 'tc') { $slideFrom = 'top' }
  elseif ($anchor -eq 'bc') { $slideFrom = 'bottom' }

  $form.Location = New-Object System.Drawing.Point($targetX, $targetY)

  # Where the card leaves towards when it closes: the same off-screen spot it
  # slid in from, so the exit is the reverse of the entrance. Both stay equal to
  # the target for a dead-centre card, which makes its exit a pure fade.
  $fromX = $targetX
  $fromY = $targetY

  $animTimer = $null
  if ($animate -and $animationMs -gt 0) {
    $startX = $targetX
    $startY = $targetY
    switch ($slideFrom) {
      'left'   { $startX = $area.Left - $width - 8 }
      'right'  { $startX = $area.Right + 8 }
      'top'    { $startY = $area.Top - $cardHeight - 8 }
      'bottom' { $startY = $area.Bottom + 8 }
      default  { }
    }
    $fromX = $startX
    $fromY = $startY
    if ($startX -ne $targetX -or $startY -ne $targetY) {
      $form.Location = New-Object System.Drawing.Point($startX, $startY)
      $form.Opacity = 0.05
    }
    # The clock starts in Add_Shown, NOT here: building and showing the window
    # costs 100-300 ms, and charging that to a 300 ms animation made it invisible.
    $script:animStart = $null
    $animTimer = New-Object System.Windows.Forms.Timer
    $animTimer.Interval = 15
    $animTimer.Add_Tick({
      $elapsed = ((Get-Date) - $script:animStart).TotalMilliseconds
      $t = [Math]::Min(1.0, $elapsed / $animationMs)
      $eased = 1 - [Math]::Pow(1 - $t, 3)
      try {
        $form.Location = New-Object System.Drawing.Point(
          ([int][Math]::Round($startX + ($targetX - $startX) * $eased)),
          ([int][Math]::Round($startY + ($targetY - $startY) * $eased)))
        $form.Opacity = [Math]::Min(1.0, 0.05 + 0.95 * $eased)
      } catch { }
      if ($t -ge 1.0) {
        try {
          $form.Location = New-Object System.Drawing.Point($targetX, $targetY)
          $form.Opacity = 1.0
          $animTimer.Stop()
          $animTimer.Dispose()
        } catch { }
      }
    })
  }

  $script:remaining = $timeout
  function Set-FooterText {
    if ($null -eq $lblFooter) { return }
    if ($timeout -le 0) { $lblFooter.Text = $footer; return }
    if ($script:remaining -gt 0) {
      $lblFooter.Text = ("{0}   ({1}s)" -f $footer, $script:remaining)
    } else {
      $lblFooter.Text = $footer
    }
  }
  Set-FooterText

  $drag = @{ active = $false; x = 0; y = 0 }

  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 1000
  $timer.Add_Tick({
    $script:remaining = $script:remaining - 1
    if ($script:remaining -le 0) { & $close } else { Set-FooterText }
  })

  # Closing is animated: the card used to disappear the instant it was clicked or
  # its countdown ran out. Now it leaves the way it arrived - sliding back towards
  # the screen edge it is docked to while fading out - and only then closes, so
  # the exit reads as the reverse of the entrance. Everything (click, Esc,
  # countdown) goes through this one block, and the first caller wins.
  #
  # The state below lives in the script scope on purpose: `$close` runs as its own
  # scope and the timer body is a nested script block, so variables that `$close`
  # assigns are NOT visible from the timer body (they came back as $null, which
  # made the card jump to 0,0 at alpha 0 - an invisible exit).
  $script:exitTimer = $null
  $script:exitBeginX = 0
  $script:exitBeginY = 0
  $script:exitBeginOpacity = 1.0
  $script:closing = $false
  $close = {
    if ($script:closing) { return }
    $script:closing = $true
    try { $timer.Stop() } catch { }
    $drag.active = $false
    if (-not $animate -or $animationMs -le 0) {
      try { $form.Close() } catch { }
      return
    }
    # Start from where the card actually is: it may have been dragged, and a click
    # during the entrance leaves it part-way in.
    $script:exitBeginX = $form.Location.X
    $script:exitBeginY = $form.Location.Y
    $script:exitBeginOpacity = 1.0
    try { if ($form.Opacity -gt 0 -and $form.Opacity -le 1) { $script:exitBeginOpacity = $form.Opacity } } catch { }
    # Whatever is left of the slide-in must not fight the slide-out.
    try { if ($null -ne $animTimer) { $animTimer.Stop(); $animTimer.Dispose() } } catch { }
    $script:exitStart = Get-Date
    $script:exitTimer = New-Object System.Windows.Forms.Timer
    $script:exitTimer.Interval = 15
    $script:exitTimer.Add_Tick({
      $elapsed = ((Get-Date) - $script:exitStart).TotalMilliseconds
      $t = [Math]::Min(1.0, $elapsed / $animationMs)
      # Accelerating away: the mirror of the ease-out entrance.
      $eased = $t * $t
      try {
        $form.Location = New-Object System.Drawing.Point(
          ([int][Math]::Round($script:exitBeginX + ($fromX - $script:exitBeginX) * $eased)),
          ([int][Math]::Round($script:exitBeginY + ($fromY - $script:exitBeginY) * $eased)))
        $form.Opacity = [Math]::Max(0.0, $script:exitBeginOpacity * (1 - $eased))
      } catch { }
      if ($t -ge 1.0) {
        # Stop only: disposing a timer from inside its own tick throws. FormClosed
        # disposes it.
        try { $script:exitTimer.Stop() } catch { }
        try { $form.Close() } catch { }
      }
    })
    try { $script:exitTimer.Start() } catch { try { $form.Close() } catch { } }
  }

  # The host drops a `<payload>.close` marker once the prompt this card is about
  # has been handled (the question answered, the approval allowed or rejected).
  # The card then leaves through the same animated exit as a click does, so a
  # "waiting for you" card does not sit on the desktop after the fact. Polling a
  # file is the one channel both halves already share.
  $closeWatcher = New-Object System.Windows.Forms.Timer
  $closeWatcher.Interval = 250
  $closeWatcher.Add_Tick({
    try {
      if (Test-Path -LiteralPath ($PayloadPath + '.close')) {
        $closeWatcher.Stop()
        & $close
      }
    } catch { }
  })
  $closeWatcher.Start()

  # A click means "take me there": drop the jump marker for the host (which asks
  # the browser half to select that conversation) and bring the application window
  # forward, then leave like any other dismissal. Esc, the countdown and a
  # resolved request keep using $close, which never jumps.
  $click = {
    if ($jump) {
      try {
        if (-not [string]::IsNullOrWhiteSpace($sessionId)) {
          [System.IO.File]::WriteAllText($PayloadPath + '.jump', $sessionId, (New-Object System.Text.UTF8Encoding($false)))
        }
      } catch { }
      Show-AppWindow -Match $appMatch
    }
    & $close
  }

  foreach ($control in @($form.Controls)) {
    $control.Add_MouseClick($click)
    $control.Add_MouseDown({
      param($sender, $event)
      if ($event.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        $drag.active = $true
        $drag.x = $event.X
        $drag.y = $event.Y
      }
    })
    $control.Add_MouseMove({
      param($sender, $event)
      if ($drag.active) {
        $form.Location = New-Object System.Drawing.Point(($form.Location.X + $event.X - $drag.x), ($form.Location.Y + $event.Y - $drag.y))
      }
    })
    $control.Add_MouseUp({ $drag.active = $false })
  }
  $form.Add_MouseClick($click)
  $form.Add_KeyDown({ param($sender, $event) if ($event.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { & $close } })
  $form.Add_FormClosed({
    try { $timer.Stop(); $timer.Dispose() } catch { }
    try { if ($null -ne $animTimer) { $animTimer.Stop(); $animTimer.Dispose() } } catch { }
    try { if ($null -ne $script:exitTimer) { $script:exitTimer.Stop(); $script:exitTimer.Dispose() } } catch { }
    try { if ($null -ne $closeWatcher) { $closeWatcher.Stop(); $closeWatcher.Dispose() } } catch { }
    try { if ($null -ne $form.BackgroundImage) { $form.BackgroundImage.Dispose() } } catch { }
    try { if ($null -ne $script:coverImage) { $script:coverImage.Dispose() } } catch { }
  })

  $form.Add_Shown({
    try { $form.Activate() } catch { }
    if ($null -ne $animTimer) {
      # Start the clock exactly when the card becomes visible, and make the
      # first frame the off-screen one so the slide really is seen from its edge.
      $script:animStart = Get-Date
      try {
        $form.Location = New-Object System.Drawing.Point($startX, $startY)
        $form.Opacity = 0.05
      } catch { }
      try { $animTimer.Start() } catch { }
    }
    Play-NotifySound -Kind $sound -File $soundFile
  })
  # A zero timeout means "stay until dismissed". The timer used to be started
  # unconditionally, so `remaining` went straight to -1 on its first tick and the
  # card closed itself after one second - the opposite of what the setting says.
  if ($timeout -gt 0) { $timer.Start() }
  [void]$form.ShowDialog()
  $timer.Stop()
  $form.Dispose()
} catch {
  # Fallback card: still borderless (no X, nothing to click but the text) so a
  # failure never degrades into a dialog with a close button. The marker file
  # beside the payload records why the main card could not be built.
  try { [System.IO.File]::WriteAllText($PayloadPath + '.fallback', $_.Exception.ToString()) } catch { }
  try {
    $lines = @($session, $headline, $text, $tools, $files) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $fbBody = ($lines -join "`r`n`r`n")
    $fbWidth = 460
    $fbHeight = 150
    $fbFont = New-UiFont 'Microsoft YaHei UI' 9.5 $false
    $fbMeasure = New-Object System.Drawing.Size(($fbWidth - 36), 4000)
    $fbText = ([System.Windows.Forms.TextRenderer]::MeasureText($fbBody, $fbFont, $fbMeasure, [System.Windows.Forms.TextFormatFlags]::WordBreak)).Height
    if ($fbText -gt 260) { $fbText = 260 }
    $fbHeight = $fbText + 96

    $fb = New-Object System.Windows.Forms.Form
    $fb.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $fb.ControlBox = $false
    $fb.ShowInTaskbar = $false
    $fb.TopMost = $true
    $fb.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $fb.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#1E1F22')
    $fb.ClientSize = New-Object System.Drawing.Size($fbWidth, $fbHeight)

    $fbBar = New-Object System.Windows.Forms.Panel
    $fbBar.Location = New-Object System.Drawing.Point(0, 0)
    $fbBar.Size = New-Object System.Drawing.Size($fbWidth, 4)
    $fbBar.BackColor = [System.Drawing.ColorTranslator]::FromHtml($accent)
    $fb.Controls.Add($fbBar)

    $fbTitle = New-Object System.Windows.Forms.Label
    $fbTitle.Text = $title
    $fbTitle.Font = (New-UiFont 'Microsoft YaHei UI' 11.5 $true)
    $fbTitle.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#E8EAED')
    $fbTitle.AutoSize = $false
    $fbTitle.Location = New-Object System.Drawing.Point(18, 20)
    $fbTitle.Size = New-Object System.Drawing.Size(($fbWidth - 36), 24)
    $fb.Controls.Add($fbTitle)

    $fbLabel = New-Object System.Windows.Forms.Label
    $fbLabel.Text = $fbBody
    $fbLabel.Font = $fbFont
    $fbLabel.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#D5D8DC')
    $fbLabel.AutoSize = $false
    $fbLabel.Location = New-Object System.Drawing.Point(18, 48)
    $fbLabel.Size = New-Object System.Drawing.Size(($fbWidth - 36), $fbText)
    $fb.Controls.Add($fbLabel)

    $fbArea = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $fb.Location = New-Object System.Drawing.Point(($fbArea.Right - $fbWidth - 24), ($fbArea.Bottom - $fbHeight - 24))
    $fb.Add_MouseClick({ try { $fb.Close() } catch { } })
    foreach ($control in @($fb.Controls)) { $control.Add_MouseClick({ try { $fb.Close() } catch { } }) }
    $fb.Add_KeyDown({ param($sender, $event) if ($event.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { try { $fb.Close() } catch { } } })
    $fbTimer = New-Object System.Windows.Forms.Timer
    $fbTimer.Interval = 1000
    $script:fbLeft = 15
    $fbTimer.Add_Tick({ $script:fbLeft = $script:fbLeft - 1; if ($script:fbLeft -le 0) { try { $fb.Close() } catch { } } })
    $fbTimer.Start()
    [void]$fb.ShowDialog()
    $fbTimer.Stop()
    $fb.Dispose()
  } catch { }
}

try { Remove-Item -LiteralPath $PayloadPath -Force -ErrorAction SilentlyContinue } catch { }
try { Remove-Item -LiteralPath ($PayloadPath + '.close') -Force -ErrorAction SilentlyContinue } catch { }
exit 0
