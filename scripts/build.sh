#!/bin/bash
# Nexa 构建脚本 - 构建主进程 + 渲染进程

set -e

cd "$(dirname "$0")/.."

echo "=== Nexa Build ==="

echo "[1/2] Building main process (TypeScript → dist/main)..."
npx tsc -p config/tsconfig.main.json

echo "[2/2] Building renderer (Vite → dist/renderer)..."
npx vite build --config config/vite.renderer.config.ts

echo ""
echo "=== Build Complete ==="
echo "   Main:     dist/main/main/index.js"
echo "   Renderer: dist/renderer/"
echo ""
echo "Run with: npm start (Electron) or npx electron dist/main/main/index.js"
