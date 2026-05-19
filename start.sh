#!/usr/bin/env bash
# ─────────────────────────────────────────
# AI Studio — Startup Script
# ─────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Load .env if present
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# Check required env vars
missing=0
for var in GEMINI_API_KEY CLAUDE_API_KEY XAI_API_KEY; do
  if [ -z "${!var}" ]; then
    echo "⚠️  $var が未設定です (.env を確認してください)"
    missing=1
  fi
done
[ $missing -eq 1 ] && echo "  → .env.example を参考に .env を作成してください" && echo ""

# Install deps (only if needed)
if ! python3 -c "import fastapi" 2>/dev/null; then
  echo "📦 依存関係をインストール中..."
  pip3 install -r requirements.txt --break-system-packages -q
fi

echo "🚀 AI Studio を起動中..."
echo "   URL: http://0.0.0.0:8765"
echo "   Tailscale経由: http://$(tailscale ip -4 2>/dev/null || echo '<tailscale-ip>'):8765"
echo ""
echo "   Ctrl+C で停止"
echo ""

cd "$SCRIPT_DIR/backend" && python3 server.py
