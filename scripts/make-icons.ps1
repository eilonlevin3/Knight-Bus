# Draws the home-screen icons (a purple triple-decker bus) into icons/,
# and the orange test-version icons into icons-debug/ (docs/release-process.md).
# Windows PowerShell:  powershell -ExecutionPolicy Bypass -File scripts/make-icons.ps1
# @req REQ-REL-2
Add-Type -AssemblyName System.Drawing

function Draw-Icon([int]$size, [string]$file, [bool]$maskable, [string]$bgHex, [string]$out) {
  New-Item -ItemType Directory -Force $out | Out-Null
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $bg = [System.Drawing.ColorTranslator]::FromHtml($bgHex)
  $g.Clear($(if ($maskable) { $bg } else { [System.Drawing.Color]::Transparent }))
  $s = $size / 100.0
  if (-not $maskable) {
    $r = 22 * $s; $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc(0, 0, 2*$r, 2*$r, 180, 90); $p.AddArc($size-2*$r, 0, 2*$r, 2*$r, 270, 90)
    $p.AddArc($size-2*$r, $size-2*$r, 2*$r, 2*$r, 0, 90); $p.AddArc(0, $size-2*$r, 2*$r, 2*$r, 90, 90)
    $g.FillPath((New-Object System.Drawing.SolidBrush $bg), $p)
  }
  # Maskable icons must keep the drawing inside the middle 80%.
  $k = if ($maskable) { 0.72 } else { 0.86 }
  $o = (100 - 100 * $k) / 2
  function Box($x, $y, $w, $h) { New-Object System.Drawing.RectangleF (($o + $x*$k)*$s), (($o + $y*$k)*$s), ($w*$k*$s), ($h*$k*$s) }
  $body = [System.Drawing.ColorTranslator]::FromHtml('#9d4edd')
  $win  = [System.Drawing.ColorTranslator]::FromHtml('#ffd60a')
  $dark = [System.Drawing.ColorTranslator]::FromHtml('#1b0a2e')
  $g.FillRectangle((New-Object System.Drawing.SolidBrush $body), (Box 22 8 56 74))
  foreach ($row in 0..2) { foreach ($col in 0..2) {
    $g.FillRectangle((New-Object System.Drawing.SolidBrush $win), (Box (27 + $col*16.5) (13 + $row*20) 12 13))
  } }
  $g.FillRectangle((New-Object System.Drawing.SolidBrush $dark), (Box 22 72 56 4))
  foreach ($x in 26, 60) { $g.FillEllipse((New-Object System.Drawing.SolidBrush $dark), (Box $x 74 14 14)) }
  $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

$variants = @(
  @{ bg = '#3c096c'; dir = Join-Path $PSScriptRoot '..\icons' },        # main
  @{ bg = '#e85d04'; dir = Join-Path $PSScriptRoot '..\icons-debug' }   # debug: orange
)
foreach ($v in $variants) {
  Draw-Icon 192 'icon-192.png' $false $v.bg $v.dir
  Draw-Icon 512 'icon-512.png' $false $v.bg $v.dir
  Draw-Icon 512 'maskable-512.png' $true $v.bg $v.dir
  Draw-Icon 180 'apple-touch-icon.png' $true $v.bg $v.dir   # iOS rounds the corners itself
  Write-Output "Icons written to $($v.dir)"
}
