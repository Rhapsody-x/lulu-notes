# ================================================================
#  publish.ps1 - 一条命令发版：改版本号 -> 构建 -> 发 Gitee 发行版 -> 推清单
#
#  用法（改完代码、提交之后）：
#      powershell -ExecutionPolicy Bypass -File tools\publish.ps1
#  脚本会问你要版本号，然后全自动完成：
#      1. 同时改 Cargo.toml 与 tauri.conf.json 的版本号
#      2. 带签名密钥构建 NSIS 安装包
#      3. 提交版本号、打 tag、推代码到 Gitee
#      4. 调 Gitee API 建发行版、上传安装包
#      5. 生成 latest.json，提交并推送（Gitee master + GitHub dev）
#      6. 回读线上清单，确认版本号已生效
#
#  顺序不可颠倒：安装包必须先传上去，清单才能推。
#  否则客户端会拿到一个还不存在的下载地址，直接 404。
#
#  前置条件：
#    * 签名私钥   %USERPROFILE%\.tauri\lulu-notes.key
#    * Gitee 令牌 %USERPROFILE%\.gitee-token（权限勾 projects，只读文件，不进仓库）
#
#  可选参数：
#    -Version 2.6.0   跳过询问
#    -Notes "..."     发行说明，默认取最后一条提交信息
#    -SkipBuild       复用已有安装包（发版中途失败后重试用）
#    -DryRun          只打印计划，不改文件、不联网
# ================================================================
param(
  [string]$Version = "",
  [string]$Notes = "",
  [switch]$SkipBuild,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# git 输出的是 UTF-8，而 Windows PowerShell 5.1 默认按控制台代码页（中文系统是 GBK）
# 解码原生命令的输出，直接读会把中文提交信息变成乱码。统一成 UTF-8。
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
  # 没有控制台时（如被调度器拉起）忽略即可，不影响功能。
}

$GiteeRepo    = "xu0523/lulu-notes"
$GiteeBranch  = "master"
$GithubRepo   = "Rhapsody-x/lulu-notes"
$GithubBranch = "dev"

$root      = Split-Path -Parent $PSScriptRoot          # desktop/
$repoRoot  = Split-Path -Parent $root                  # 仓库根目录
$srcTauri  = Join-Path $root "src-tauri"
$confPath  = Join-Path $srcTauri "tauri.conf.json"
$cargoPath = Join-Path $srcTauri "Cargo.toml"
$dist      = Join-Path $root "dist"
$keyPath   = Join-Path $env:USERPROFILE ".tauri\lulu-notes.key"
$tokenPath = Join-Path $env:USERPROFILE ".gitee-token"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# ---------------- 输出与工具 ----------------

function Fail([string]$msg) {
  Write-Host "`n✗ $msg" -ForegroundColor Red
  exit 1
}

# 空行用 "`n" 前缀写进字符串里，而不是单独 Write-Host ""。
# 后者在输出被重定向（例如被其他程序捕获）时不产生换行，会跟上一行粘在一起。
function Step([string]$msg) {
  Write-Host "`n==> $msg" -ForegroundColor Cyan
}

function Info([string]$msg) {
  Write-Host "    $msg" -ForegroundColor Gray
}

function Ok([string]$msg) {
  Write-Host "    ✓ $msg" -ForegroundColor Green
}

function Read-Text([string]$path) {
  return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

function Write-Text([string]$path, [string]$text) {
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}

function Get-VersionParts([string]$text) {
  $clean = $text.Trim().TrimStart('v', 'V')
  $parts = New-Object System.Collections.ArrayList
  foreach ($piece in $clean.Split('.')) {
    $n = 0
    if ([int]::TryParse($piece, [ref]$n)) { [void]$parts.Add($n) } else { [void]$parts.Add(0) }
  }
  return , $parts
}

function Compare-Version([string]$a, [string]$b) {
  $left = Get-VersionParts $a
  $right = Get-VersionParts $b
  $len = [Math]::Max($left.Count, $right.Count)
  for ($i = 0; $i -lt $len; $i++) {
    $l = 0
    $r = 0
    if ($i -lt $left.Count) { $l = $left[$i] }
    if ($i -lt $right.Count) { $r = $right[$i] }
    if ($l -ne $r) {
      if ($l -gt $r) { return 1 }
      return -1
    }
  }
  return 0
}

# git 把进度写到 stderr，而 ErrorActionPreference=Stop 会把原生命令的
# stderr 当成终止性异常。所以原生调用前后临时切成 Continue，自己看退出码。
function Invoke-Git {
  param([string[]]$Arguments)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & git -C $repoRoot @Arguments 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
  return @{ Code = $code; Output = ($output | Out-String).Trim() }
}

function Require-Git {
  param([string[]]$Arguments, [string]$What)
  $r = Invoke-Git $Arguments
  if ($r.Code -ne 0) { Fail "$What 失败：`n$($r.Output)" }
  return $r
}

# ---------------- 1. 确定版本号 ----------------

if (-not (Test-Path $confPath)) { Fail "找不到配置文件：$confPath" }
if (-not (Test-Path $cargoPath)) { Fail "找不到 Cargo.toml：$cargoPath" }

$conf = (Read-Text $confPath) | ConvertFrom-Json
$currentVersion = $conf.version

if ([string]::IsNullOrWhiteSpace($Version)) {
  Write-Host ""
  Write-Host "当前版本：$currentVersion" -ForegroundColor Yellow
  $Version = Read-Host "请输入要发布的版本号（例如 2.6.0）"
}

$Version = $Version.Trim().TrimStart('v', 'V')
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  Fail "版本号格式不对，应为 X.Y.Z（例如 2.6.0），收到的是：'$Version'"
}
if ((Compare-Version $Version $currentVersion) -le 0) {
  Fail "新版本号必须大于当前版本 $currentVersion，不能发布 $Version"
}

# ---------------- 2. 发行说明 ----------------

if ([string]::IsNullOrWhiteSpace($Notes)) {
  $lastMsg = (Invoke-Git @("log", "-1", "--format=%s")).Output
  if ([string]::IsNullOrWhiteSpace($lastMsg)) {
    $Notes = "v$Version"
  } else {
    $Notes = $lastMsg.Trim()
  }
}

# ---------------- 3. 前置检查 ----------------

Step "前置检查"

$dirty = (Invoke-Git @("status", "--porcelain")).Output
if (-not [string]::IsNullOrWhiteSpace($dirty)) {
  Fail "工作区有未提交的改动，请先提交或暂存后再发版：`n`n$dirty"
}
Ok "工作区干净"

if (-not (Test-Path $keyPath)) {
  Fail "找不到签名私钥：$keyPath`n没有它无法产出可被客户端校验的更新包。"
}
Ok "签名私钥存在"

$token = ""
if (Test-Path $tokenPath) {
  $token = (Get-Content $tokenPath -Raw).Trim()
}
if ([string]::IsNullOrWhiteSpace($token) -and -not $DryRun) {
  Fail "找不到 Gitee 令牌：$tokenPath`n`n请到 https://gitee.com/profile/personal_access_tokens 生成，`n权限勾选 projects，把令牌内容单独一行存进上面那个文件。"
}
if ($token) { Ok "Gitee 令牌已读取（长度 $($token.Length)）" }

# ---------------- 4. 计划预览 ----------------

$assetName = "lulu-notes_${Version}_x64-setup.exe"
$assetPath = Join-Path $dist $assetName
$urlGitee  = "https://gitee.com/$GiteeRepo/releases/download/v$Version/$assetName"
$urlGithub = "https://github.com/$GithubRepo/releases/download/v$Version/$assetName"

Write-Host "`n------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host " 版本      $currentVersion  ->  $Version"
Write-Host " 说明      $Notes"
Write-Host " 安装包    $assetName"
Write-Host " 下载地址  $urlGitee"
Write-Host "------------------------------------------------------------" -ForegroundColor DarkGray

if ($DryRun) {
  Write-Host "`nDryRun：只做检查，未修改任何文件。" -ForegroundColor Yellow
  exit 0
}

# ---------------- 5. 改版本号 ----------------

Step "修改版本号（两处）"

$cargoRaw = Read-Text $cargoPath
$m = [regex]::Match($cargoRaw, '(?m)^version\s*=\s*"[^"]*"')
if (-not $m.Success) { Fail "在 Cargo.toml 里找不到 version 字段" }
Write-Text $cargoPath ($cargoRaw.Substring(0, $m.Index) + "version = `"$Version`"" + $cargoRaw.Substring($m.Index + $m.Length))
Ok "Cargo.toml"

$confRaw = Read-Text $confPath
$m = [regex]::Match($confRaw, '(?m)^(\s*)"version"\s*:\s*"[^"]*"')
if (-not $m.Success) { Fail "在 tauri.conf.json 里找不到 version 字段" }
$indent = $m.Groups[1].Value
Write-Text $confPath ($confRaw.Substring(0, $m.Index) + $indent + '"version": "' + $Version + '"' + $confRaw.Substring($m.Index + $m.Length))
Ok "tauri.conf.json"

# ---------------- 6. 构建 ----------------

$bundleDir = Join-Path $srcTauri "target\release\bundle\nsis"

if ($SkipBuild) {
  Step "跳过构建（-SkipBuild）"
} else {
  Step "构建 v$Version（约 1 分钟）"
  $env:TAURI_SIGNING_PRIVATE_KEY = $keyPath

  $prev = $ErrorActionPreference
  $buildExit = 0
  Push-Location $srcTauri
  try {
    $ErrorActionPreference = "Continue"
    cargo tauri build
    $buildExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
    Pop-Location
  }
  if ($buildExit -ne 0) { Fail "cargo tauri build 失败，退出码 $buildExit" }
  Ok "构建完成"
}

if (-not (Test-Path $bundleDir)) { Fail "找不到产物目录：$bundleDir" }

$artifact = Get-ChildItem $bundleDir -Filter "*${Version}*-setup.exe" |
  Where-Object { $_.Name -notlike "*.sig" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $artifact) { Fail "在 $bundleDir 里找不到 $Version 的安装包" }

$sigPath = "$($artifact.FullName).sig"
if (-not (Test-Path $sigPath)) { Fail "找不到签名文件：$sigPath" }

New-Item -ItemType Directory -Force -Path $dist | Out-Null
Copy-Item $artifact.FullName $assetPath -Force
Copy-Item $sigPath (Join-Path $dist "$assetName.sig") -Force
Ok "安装包已就绪：$assetName（$([math]::Round((Get-Item $assetPath).Length / 1KB, 1)) KB）"

# ---------------- 7. 提交版本号并打 tag ----------------

Step "提交版本号并推送代码"

Require-Git @("add", "desktop/src-tauri/Cargo.toml", "desktop/src-tauri/tauri.conf.json", "desktop/src-tauri/Cargo.lock") "暂存版本号" | Out-Null
$commit = Invoke-Git @("commit", "-m", "chore: 版本升至 v$Version")
if ($commit.Code -ne 0 -and $commit.Output -notmatch "nothing to commit") {
  Fail "提交版本号失败：`n$($commit.Output)"
}
Ok "版本号已提交"

# tag 已存在就先删掉重建，避免指向旧提交
if ((Invoke-Git @("tag", "-l", "v$Version")).Output) {
  Require-Git @("tag", "-d", "v$Version") "删除旧 tag" | Out-Null
}
Require-Git @("tag", "v$Version") "创建 tag" | Out-Null
Ok "已打 tag v$Version"

Require-Git @("push", "gitee", "HEAD:$GiteeBranch") "推送代码到 Gitee" | Out-Null
Require-Git @("push", "gitee", "refs/tags/v$Version") "推送 tag 到 Gitee" | Out-Null
Ok "代码与 tag 已推送到 Gitee"

# ---------------- 8. 建 Gitee 发行版 ----------------

Step "创建 Gitee 发行版 v$Version"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$releaseBody = [ordered]@{
  access_token     = $token
  tag_name         = "v$Version"
  name             = "v$Version"
  body             = $Notes
  target_commitish = $GiteeBranch
  prerelease       = $false
} | ConvertTo-Json

try {
  $release = Invoke-RestMethod -Method Post `
    -Uri "https://gitee.com/api/v5/repos/$GiteeRepo/releases" `
    -ContentType "application/json; charset=utf-8" `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($releaseBody)) `
    -TimeoutSec 60
} catch {
  Fail "创建发行版失败：$($_.Exception.Message)`n`n如果提示已存在，请到 Gitee 手动删掉 v$Version 那个发行版再重试（加 -SkipBuild 可跳过重新构建）。"
}

$releaseId = $release.id
if (-not $releaseId) { Fail "创建发行版没有返回 id，响应：$($release | ConvertTo-Json -Depth 4)" }
Ok "发行版已创建（id $releaseId）"

# ---------------- 9. 上传安装包 ----------------

Step "上传安装包"

Add-Type -AssemblyName System.Net.Http

$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromMinutes(10)
$fileStream = $null
try {
  $fileStream = [System.IO.File]::OpenRead($assetPath)
  $filePart = New-Object System.Net.Http.StreamContent($fileStream)
  $filePart.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("application/octet-stream")

  $form = New-Object System.Net.Http.MultipartFormDataContent
  $form.Add($filePart, "file", $assetName)

  $uploadUrl = "https://gitee.com/api/v5/repos/$GiteeRepo/releases/$releaseId/attach_files?access_token=$token"
  $resp = $client.PostAsync($uploadUrl, $form).Result
  $respText = $resp.Content.ReadAsStringAsync().Result
  if (-not $resp.IsSuccessStatusCode) {
    Fail "上传安装包失败（HTTP $([int]$resp.StatusCode)）：`n$respText"
  }
} finally {
  if ($fileStream) { $fileStream.Dispose() }
  $client.Dispose()
}
Ok "安装包已上传"

# ---------------- 10. 生成并推送清单 ----------------

Step "生成更新清单"

$signature = (Get-Content $sigPath -Raw).Trim()
$pubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

function New-Manifest([string]$downloadUrl) {
  [ordered]@{
    version   = $Version
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

# Gitee 版放仓库根目录：Gitee 没有 releases/latest/download 永久链接，
# 清单只能作为仓库文件走 raw 地址。
Write-Text (Join-Path $repoRoot "latest.json") ((New-Manifest $urlGitee) | ConvertTo-Json -Depth 6)
Write-Text (Join-Path $dist "latest.json") ((New-Manifest $urlGithub) | ConvertTo-Json -Depth 6)
Ok "latest.json（Gitee）与 dist/latest.json（GitHub 兜底）"

Step "推送清单"

Require-Git @("add", "latest.json") "暂存清单" | Out-Null
Require-Git @("commit", "-m", "release: v$Version") "提交清单" | Out-Null
Require-Git @("push", "gitee", "HEAD:$GiteeBranch") "推送清单到 Gitee" | Out-Null
Ok "清单已推送 Gitee"

$ghPush = Invoke-Git @("push", "origin", "HEAD:$GithubBranch")
if ($ghPush.Code -eq 0) {
  Ok "代码与清单已推送 GitHub"
} else {
  Write-Host "    ! 推送 GitHub 失败（不影响 Gitee 更新）：$($ghPush.Output)" -ForegroundColor Yellow
}

# ---------------- 11. 回读验证 ----------------

Step "验证线上清单"

$verified = $false
for ($i = 1; $i -le 5; $i++) {
  Start-Sleep -Seconds 2
  try {
    $live = Invoke-RestMethod -Uri "https://gitee.com/$GiteeRepo/raw/$GiteeBranch/latest.json?t=$([DateTime]::Now.Ticks)" -TimeoutSec 30
  } catch {
    Info "第 $i 次读取失败：$($_.Exception.Message)"
    continue
  }
  if ($live.version -eq $Version) {
    $verified = $true
    break
  }
  Info "第 $i 次读到的是 $($live.version)，等待生效…"
}

if ($verified) {
  Ok "线上清单已是 v$Version"
} else {
  Write-Host "    ! 线上清单暂未更新，稍等几十秒再手动确认：" -ForegroundColor Yellow
  Write-Host "      https://gitee.com/$GiteeRepo/raw/$GiteeBranch/latest.json" -ForegroundColor Yellow
}

# ---------------- 完成 ----------------

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host " v$Version 已发布" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "`n 发行版页面  https://gitee.com/$GiteeRepo/releases/tag/v$Version"
Write-Host " 更新清单    https://gitee.com/$GiteeRepo/raw/$GiteeBranch/latest.json"
Write-Host "`n 已装旧版的用户：" -ForegroundColor DarkGray
Write-Host "   * 当天开过程序的话，自动检查有 24 小时节流，需手动点「检查更新」" -ForegroundColor DarkGray
Write-Host "   * 第二天起开程序会自动发现" -ForegroundColor DarkGray
Write-Host "`n 可选：把 dist/latest.json 与 $assetName 也传到 GitHub Release" -ForegroundColor DarkGray
Write-Host "       https://github.com/$GithubRepo/releases/new?tag=v$Version" -ForegroundColor DarkGray
Write-Host ""
