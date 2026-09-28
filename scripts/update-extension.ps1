# Installs the newest commit-timeline release from GitHub.
#
# Sideloaded extensions never auto-update, so this is the "one command" update
# path: it looks up the latest GitHub release, downloads its VSIX and installs
# it with `code --install-extension --force`.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\update-extension.ps1
[CmdletBinding()]
param(
    [string]$Repo = 'patrick-cst1/git-graph-plus',
    [string]$CodeCli = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd"
)

$ErrorActionPreference = 'Stop'
$headers = @{ 'User-Agent' = 'commit-timeline-updater' }

Write-Host "Checking $Repo for the latest release ..."
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers $headers
$asset = $release.assets | Where-Object { $_.name -like '*.vsix' } | Select-Object -First 1
if (-not $asset) { throw "Release $($release.tag_name) has no .vsix asset." }

$dest = Join-Path $env:TEMP $asset.name
Write-Host "Downloading $($asset.name) ($($release.tag_name)) ..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest -Headers $headers

if (-not (Test-Path -LiteralPath $CodeCli)) { $CodeCli = 'code' }

Write-Host "Installing $($asset.name) ..."
& $CodeCli --install-extension $dest --force

Write-Host ''
Write-Host "Installed $($release.tag_name). Restart VS Code (or run Developer: Reload Webviews) to apply."
