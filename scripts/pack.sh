#!/bin/bash
# Nexa 打包脚本 - 跨平台打包为可执行文件
#
# 用法:
#   ./scripts/pack.sh              # 仅打包当前平台
#   ./scripts/pack.sh mac          # 仅打包 macOS
#   ./scripts/pack.sh win          # 仅打包 Windows
#   ./scripts/pack.sh linux        # 仅打包 Linux
#   ./scripts/pack.sh all          # 打包所有平台

set -e

cd "$(dirname "$0")/.."

detect_os() {
  case "$(uname -s)" in
    Darwin)  echo "mac" ;;
    Linux)   echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "win" ;;
    *)       echo "unknown" ;;
  esac
}

TARGET="${1:-$(detect_os)}"

echo "=== Nexa Pack ==="
echo "Target: $TARGET"
echo ""

echo "[1/2] Building..."
npm run build

echo ""
echo "[2/2] Running electron-builder..."

case "$TARGET" in
  mac|macos|darwin)
    npx electron-builder --mac
    echo ""
    echo "=== Pack Complete ==="
    ls -la dist/*.dmg dist/*.zip 2>/dev/null
    ;;
  win|windows)
    npx electron-builder --win
    echo ""
    echo "=== Pack Complete ==="
    ls -la dist/*.exe 2>/dev/null
    ;;
  linux)
    npx electron-builder --linux
    echo ""
    echo "=== Pack Complete ==="
    ls -la dist/*.AppImage dist/*.deb 2>/dev/null
    ;;
  all)
    npx electron-builder --mac --win --linux
    echo ""
    echo "=== Pack Complete ==="
    echo "macOS:"
    ls -la dist/*.dmg dist/*.zip 2>/dev/null || echo "  (none)"
    echo "Windows:"
    ls -la dist/*.exe 2>/dev/null || echo "  (none)"
    echo "Linux:"
    ls -la dist/*.AppImage dist/*.deb 2>/dev/null || echo "  (none)"
    ;;
  *)
    echo "Unknown target: $TARGET"
    echo "Usage: $0 [mac|win|linux|all]"
    exit 1
    ;;
esac
