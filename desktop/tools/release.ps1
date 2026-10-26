# ================================================================
#  release.ps1 - Build the signed NSIS bundle and produce latest.json
#
#  What it does:
#    1. Reads the version from tauri.conf.json
#    2. Builds with TAURI_SIGNING_PRIVATE_KEY set (required for updater
#       artifacts - the build fails without it)
#    3. Copies the updater artifact to desktop/dist with an ASCII name
#       (productName is Chinese, which breaks release asset URLs)
#    4. Writes desktop/dist/latest.json for the updater endpoint
#
#  Usage:
#    powershell -ExecutionPolicy Bypass -File tools\release.ps1
#    powershell -ExecutionPolicy Bypass -File tools\release.ps1 -Notes "fix: ..."
#    powershell -ExecutionPolicy Bypass -File tools\release.ps1 -SkipBuild
#
#  Then upload dist\* to the GitHub release tagged v<version>.
# ================================================================
param(
  [string]$Notes = "",
  [switch]$SkipBuild,
  [string]$Repo = "Rhapsody-x/lulu-notes",
  # Prefix of the mirror used for users without a proxy. Must be reachable
  # from mainland China and must accept "https://github.com/..." as a suffix.
  [string]$MirrorPrefix = "https://gh-proxy.com/"
)

$ErrorActionPreference = "Stop"

$root     = Split-Path -Parent $PSScriptRoot
$srcTauri = Join-Path $root "src-tauri"
$confPath = Join-Path $srcTauri "tauri.conf.json"
$dist     = Join-Path $root "dist"

if (-not (Test-Path $confPath)) { throw "tauri.conf.json not found: $confPath" }

# Read as UTF-8 explicitly: Get-Content -Raw would use the ANSI codepage
# on Windows PowerShell 5.1 and corrupt the Chinese product name.
$confRaw = [System.IO.File]::ReadAllText($confPath, [System.Text.Encoding]::UTF8)
$conf    = $confRaw | ConvertFrom-Json
$version = $conf.version
Write-Host "Version under release: $version"

$keyPath = Join-Path $env:USERPROFILE ".tauri\lulu-notes.key"
if (-not (Test-Path $keyPath)) {
  throw "Signing key not found: $keyPath. Run 'cargo tauri signer generate' first."
}

if (-not $SkipBuild) {
  $env:TAURI_SIGNING_PRIVATE_KEY = $keyPath

  # cargo writes progress to stderr; with ErrorActionPreference=Stop that would
  # be turned into a terminating error, so relax it for the native call only.
  $prevEap = $ErrorActionPreference
  $buildExit = 0
  Push-Location $srcTauri
  try {
    $ErrorActionPreference = "Continue"
    cargo tauri build
    $buildExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEap
    Pop-Location
  }
  if ($buildExit -ne 0) { throw "cargo tauri build failed with exit code $buildExit" }
}

$bundleDir = Join-Path $srcTauri "target\release\bundle\nsis"
if (-not (Test-Path $bundleDir)) { throw "Bundle directory not found: $bundleDir" }

# Tauri signs the NSIS installer itself (no zip wrapper). Filter by version so a
# stale artifact from an older build is never picked up.
$artifact = Get-ChildItem $bundleDir -Filter "*${version}*-setup.exe" |
  Where-Object { $_.Name -notlike "*.sig" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $artifact) { throw "NSIS installer for version $version not found in $bundleDir" }

$sigPath = "$($artifact.FullName).sig"
if (-not (Test-Path $sigPath)) {
  throw "Signature not found: $sigPath (check createUpdaterArtifacts and TAURI_SIGNING_PRIVATE_KEY)"
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null

# productName is Chinese, which would end up percent-encoded in the release
# asset URL. Rename to ASCII for the download link.
$assetName = "lulu-notes_${version}_x64-setup.exe"
Copy-Item $artifact.FullName (Join-Path $dist $assetName) -Force
Copy-Item $sigPath (Join-Path $dist "$assetName.sig") -Force

$signature = (Get-Content $sigPath -Raw).Trim()
$url = "https://github.com/$Repo/releases/download/v$version/$assetName"

# github.com is unreachable from mainland China without a proxy, so the app
# ships two manifests with identical content but different download URLs:
#   latest-cn.json -> mirror URL (no proxy needed)
#   latest.json    -> official GitHub URL (used as the fallback endpoint)
$urlMirror = "$MirrorPrefix$url"
$pubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

function New-Manifest([string]$downloadUrl) {
  [ordered]@{
    version   = $version
    notes     = $Notes
    pub_date  = $pubDate
    platforms = [ordered]@{
      "windows-x86_64" = [ordered]@{
        signature = $signature
        url       = $downloadUrl
      }
    }
  }
}

# UTF-8 without BOM: a BOM would break the updater's JSON parser.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$json = New-Manifest $url | ConvertTo-Json -Depth 6
$jsonCn = New-Manifest $urlMirror | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText((Join-Path $dist "latest.json"), $json, $utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $dist "latest-cn.json"), $jsonCn, $utf8NoBom)

Write-Host ""
Write-Host "Release assets ready in: $dist"
Get-ChildItem $dist | Select-Object Name, @{ n = "KB"; e = { [math]::Round($_.Length / 1KB, 1) } } | Format-Table -AutoSize

Write-Host "Upload these to the GitHub release tagged v$version :"
Write-Host "  latest.json"
Write-Host "  latest-cn.json"
Write-Host "  $assetName"
Write-Host ""
Write-Host "Verify (no proxy needed):"
Write-Host "  ${MirrorPrefix}https://github.com/$Repo/releases/latest/download/latest-cn.json"
