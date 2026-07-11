# Nexa 打包脚本 (Windows PowerShell) - 跨平台打包为可执行文件
#
# 用法:
#   .\scripts\pack.ps1              # 仅打包当前平台
#   .\scripts\pack.ps1 win          # 仅打包 Windows
#   .\scripts\pack.ps1 mac          # 仅打包 macOS
#   .\scripts\pack.ps1 linux        # 仅打包 Linux
#   .\scripts\pack.ps1 all          # 打包所有平台

param(
  [string]$Target = ""
)

$ErrorActionPreference = "Stop"

Set-Location (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))

if ($Target -eq "") {
  if ($IsWindows -or $env:OS -eq "Windows_NT") {
    $Target = "win"
  } elseif ($IsMacOS) {
    $Target = "mac"
  } elseif ($IsLinux) {
    $Target = "linux"
  } else {
    $Target = "win"
  }
}

Write-Host "=== Nexa Pack ==="
Write-Host "Target: $Target"
Write-Host ""

Write-Host "[1/2] Building..."
npm run build

Write-Host ""
Write-Host "[2/2] Running electron-builder..."

switch ($Target) {
  "win" {
    npx electron-builder --win
    Write-Host ""
    Write-Host "=== Pack Complete ==="
    Get-ChildItem dist\*.exe -ErrorAction SilentlyContinue
  }
  "mac" {
    npx electron-builder --mac
    Write-Host ""
    Write-Host "=== Pack Complete ==="
    Get-ChildItem dist\*.dmg, dist\*.zip -ErrorAction SilentlyContinue
  }
  "linux" {
    npx electron-builder --linux
    Write-Host ""
    Write-Host "=== Pack Complete ==="
    Get-ChildItem dist\*.AppImage, dist\*.deb -ErrorAction SilentlyContinue
  }
  "all" {
    npx electron-builder --mac --win --linux
    Write-Host ""
    Write-Host "=== Pack Complete ==="
    Write-Host "macOS:"
    Get-ChildItem dist\*.dmg, dist\*.zip -ErrorAction SilentlyContinue
    Write-Host "Windows:"
    Get-ChildItem dist\*.exe -ErrorAction SilentlyContinue
    Write-Host "Linux:"
    Get-ChildItem dist\*.AppImage, dist\*.deb -ErrorAction SilentlyContinue
  }
  default {
    Write-Host "Unknown target: $Target"
    Write-Host "Usage: .\scripts\pack.ps1 [mac|win|linux|all]"
    exit 1
  }
}
