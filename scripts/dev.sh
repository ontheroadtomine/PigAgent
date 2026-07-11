#!/bin/bash
# Nexa 启动脚本 - 启动 bridge 服务器 + Vite 开发服务器

set -e

cd "$(dirname "$0")/.."

echo "=== Nexa Dev ==="

# 1. 编译主进程
echo "[1/3] Building main process..."
npx tsc -p config/tsconfig.main.json

# 2. 启动 bridge 服务器（后台）
echo "[2/3] Starting bridge server on :9876..."
lsof -ti:9876 | xargs kill -9 2>/dev/null || true
node dist/main/main/dev-bridge.js &
BRIDGE_PID=$!
sleep 1
echo "       Bridge PID: $BRIDGE_PID"

# 3. 启动 Vite 开发服务器
echo "[3/3] Starting Vite dev server on :5173..."
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
npx vite --config config/vite.renderer.config.ts &
VITE_PID=$!
sleep 2
echo "       Vite PID: $VITE_PID"

echo ""
echo "=== Nexa Dev Ready ==="
echo "   UI:   http://localhost:5173"
echo "   Bridge: http://localhost:9876"
echo ""
echo "Press Ctrl+C to stop all"

trap "kill $BRIDGE_PID $VITE_PID 2>/dev/null; exit" INT TERM
wait
