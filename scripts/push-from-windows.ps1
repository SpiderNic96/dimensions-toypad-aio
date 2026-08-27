$ErrorActionPreference = 'Stop'

$RepoUrl = 'https://github.com/SpiderNic96/dimensions-toypad-aio.git'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Aio = Join-Path $Root 'release\reference\dimensions-toypad-AIO-3.3.11.zip'

Write-Host "dimensions-toypad 3.3.11 - Windows Git publisher" -ForegroundColor Cyan
Write-Host "Project root: $Root"
Write-Host "Remote: $RepoUrl"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git for Windows is not installed or is not on PATH."
}

if (-not (Test-Path (Join-Path $Root 'README.md'))) {
    throw "README.md not found. Run this script from the extracted repository root."
}

Set-Location $Root

git --version
$lfsAvailable = $true
try { git lfs version | Out-Host } catch { $lfsAvailable = $false }

if (-not (Test-Path $Aio)) {
    Write-Warning "The 257 MB reference AIO ZIP is not present at:"
    Write-Warning "  $Aio"
    Write-Warning "That is OK for publishing the source repository."
    Write-Warning "The AIO ZIP should be uploaded later as a GitHub Release asset."
    $pointer = Join-Path $Root 'release\reference\dimensions-toypad-AIO-3.3.11.zip.lfs-pointer'
    if (Test-Path $pointer) { Remove-Item $pointer -Force }
}

if (-not (Test-Path '.git')) {
    git init -b main
    git remote add origin $RepoUrl
} else {
    $existing = git remote get-url origin 2>$null
    if ($existing -ne $RepoUrl) {
        git remote set-url origin $RepoUrl
    }
}

git add -A
Write-Host "`nFiles staged:" -ForegroundColor Yellow
git status --short

Write-Host "`nCommit these files and push main? (Y/N)" -ForegroundColor Yellow
$answer = Read-Host
if ($answer -notmatch '^(Y|y)$') {
    Write-Host 'Cancelled.'
    exit 0
}

if (-not (git diff --cached --quiet)) {
    git commit -m 'Publish complete dimensions-toypad 3.3.11 source and documentation'
}

git push origin main

Write-Host "`nPush completed." -ForegroundColor Green
if (-not (Test-Path $Aio)) {
    Write-Host "Next: upload the reference AIO ZIP as a GitHub Release asset." -ForegroundColor Yellow
}
