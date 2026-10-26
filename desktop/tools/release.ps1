# ================================================================
#  release.ps1 - Build the signed NSIS bundle and produce the update manifests
#
#  What it does:
#    1. Reads the version from tauri.conf.json
#    2. Builds with TAURI_SIGNING_PRIVATE_KEY set (required for updater
#       artifacts - the build fails without it)
#    3. Copies the installer to desktop/dist with an ASCII name
#       (productName is Chinese, which breaks release asset URLs)
#    4. Writes TWO manifests with identical content but different
#       download URLs:
#         desktop/dist/latest.json  -> GitHub asset, uploaded to the Release
#         <repo>/latest.json        -> Gitee asset, committed to the repo
#
#  Why the Gitee manifest is a repo file:
#    Gitee has no "releases/latest/download/<file>" permanent link, so the
#    manifest cannot live in a Release (its URL would change with every tag).
#    It is served from the raw URL instead:
#      https://gitee.com/<GiteeRepo>/raw/<GiteeBranch>/latest.json
#
#  Usage:
#    powershell -ExecutionPolicy Bypass -File tools\release.ps1
#    powershell -ExecutionPolicy Bypass -File tools\release.ps1 -Notes "fix: ..."
#    powershell -ExecutionPolicy Bypass -File tools\release.ps1 -SkipBuild
#
#  Publish order matters (see the reminder printed at the end):
#    1. create the Release on Gitee and upload the installer FIRST
#    2. only then commit + push latest.json
#    Doing it the other way round makes every client request a 404.
# ================================================================
param(
  [string]$Notes = "",
  [switch]$SkipBuild,
  [string]$Repo = "Rhapsody-x/lulu-notes",
  # Mainland-friendly mirror. The manifest is a repo file served over raw,
  # the installer is a Release asset.
  [string]$GiteeRepo = "xu0523/lulu-notes",
  [string]$GiteeBranch = "master"
)

$ErrorActionPreference = "Stop"

$root     = Split-Path -Parent $PSScriptRoot          # desktop/
$repoRoot = Split-Path -Parent $root                  # repository root
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

# Drop the manifest from the previous (gh-proxy) scheme if it is still around.
$staleCn = Join-Path $dist "latest-cn.json"
if (Test-Path $staleCn) { Remove-Item $staleCn -Force }

$signature = (Get-Content $sigPath -Raw).Trim()
$urlGithub = "https://github.com/$Repo/releases/download/v$version/$assetName"
$urlGitee = "https://gitee.com/$GiteeRepo/releases/download/v$version/$assetName"
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
$jsonGithub = New-Manifest $urlGithub | ConvertTo-Json -Depth 6
$jsonGitee = New-Manifest $urlGitee | ConvertTo-Json -Depth 6

$githubManifest = Join-Path $dist "latest.json"
$giteeManifest = Join-Path $repoRoot "latest.json"
[System.IO.File]::WriteAllText($githubManifest, $jsonGithub, $utf8NoBom)
[System.IO.File]::WriteAllText($giteeManifest, $jsonGitee, $utf8NoBom)

Write-Host ""
Write-Host "Release assets ready in: $dist"
Get-ChildItem $dist | Select-Object Name, @{ n = "KB"; e = { [math]::Round($_.Length / 1KB, 1) } } | Format-Table -AutoSize

Write-Host "Publish order (do not swap these two steps):"
Write-Host "  1) Gitee release v$version : upload $assetName"
Write-Host "     https://gitee.com/$GiteeRepo/releases/new?tag=v$version"
Write-Host "  2) Commit and push the manifest:"
Write-Host "     git add latest.json; git commit -m `"release: v$version`"; git push gitee HEAD:$GiteeBranch"
Write-Host ""
Write-Host "Also upload to GitHub (fallback endpoint):"
Write-Host "  $githubManifest"
Write-Host "  $assetName"
Write-Host ""
Write-Host "Verify after pushing (no proxy needed):"
Write-Host "  https://gitee.com/$GiteeRepo/raw/$GiteeBranch/latest.json"
