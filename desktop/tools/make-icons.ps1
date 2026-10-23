# 从 icons/LLB.png 生成桌面端所需的多尺寸 PNG 与 Windows ICO
# 用法： powershell -ExecutionPolicy Bypass -File .\tools\make-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root    = Split-Path -Parent $PSScriptRoot
$srcPath = Join-Path (Split-Path -Parent $root) 'icons\LLB.png'
$outDir  = Join-Path $root 'src-tauri\icons'

if (-not (Test-Path $srcPath)) { throw "找不到源图标: $srcPath" }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$src = [System.Drawing.Image]::FromFile($srcPath)

function New-SquarePng {
    param([int]$Size, [string]$Target)
    $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $padding = [Math]::Max(1, [int]($Size * 0.06))
    $scale = [Math]::Min(($Size - 2 * $padding) / $src.Width, ($Size - 2 * $padding) / $src.Height)
    $w = [Math]::Max(1, [int]($src.Width * $scale))
    $h = [Math]::Max(1, [int]($src.Height * $scale))
    $x = [int](($Size - $w) / 2)
    $y = [int](($Size - $h) / 2)
    $g.DrawImage($src, $x, $y, $w, $h)

    $g.Dispose()
    $bmp.Save($Target, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

$frames = @(16, 24, 32, 48, 64, 128, 256)
foreach ($size in $frames) {
    New-SquarePng -Size $size -Target (Join-Path $outDir ("frame-{0}.png" -f $size))
}

New-SquarePng -Size 256 -Target (Join-Path $outDir 'icon.png')
New-SquarePng -Size 32  -Target (Join-Path $outDir '32x32.png')
New-SquarePng -Size 128 -Target (Join-Path $outDir '128x128.png')
New-SquarePng -Size 256 -Target (Join-Path $outDir '128x128@2x.png')

# 组装 ICO（PNG 压缩帧，Windows Vista+ 原生支持）
$icoPath = Join-Path $outDir 'icon.ico'
$stream = [System.IO.File]::Create($icoPath)
$writer = New-Object System.IO.BinaryWriter($stream)
try {
    $writer.Write([UInt16]0)              # reserved
    $writer.Write([UInt16]1)              # type = icon
    $writer.Write([UInt16]$frames.Count)  # image count

    $payloads = @()
    foreach ($size in $frames) {
        $path = Join-Path $outDir ("frame-{0}.png" -f $size)
        $payloads += ,([System.IO.File]::ReadAllBytes($path))
    }

    $offset = 6 + 16 * $frames.Count
    for ($i = 0; $i -lt $frames.Count; $i++) {
        $size = $frames[$i]
        $bytes = $payloads[$i]
        $dim = if ($size -ge 256) { 0 } else { $size }
        $writer.Write([byte]$dim)   # width
        $writer.Write([byte]$dim)   # height
        $writer.Write([byte]0)      # palette
        $writer.Write([byte]0)      # reserved
        $writer.Write([UInt16]1)    # planes
        $writer.Write([UInt16]32)   # bpp
        $writer.Write([UInt32]$bytes.Length)
        $writer.Write([UInt32]$offset)
        $offset += $bytes.Length
    }
    foreach ($bytes in $payloads) { $writer.Write($bytes) }
}
finally {
    $writer.Dispose()
    $stream.Dispose()
    $src.Dispose()
}

Get-ChildItem $outDir -Filter 'frame-*.png' | Remove-Item -Force

Write-Host "图标已生成: $outDir"
Get-ChildItem $outDir | Select-Object Name, Length | Format-Table -AutoSize
