#!/usr/bin/env bash
# ─────────────────────────────────────────
# AI Studio — systemd セットアップスクリプト
# ─────────────────────────────────────────
# 実行: bash setup-service.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
USER=$(whoami)

echo "🔧 AI Studio を systemd サービスとして登録中..."

# serviceファイルをコピー
sudo cp "$SCRIPT_DIR/ai-studio@.service" /etc/systemd/system/

# systemdをリロード
sudo systemctl daemon-reload

# サービスを有効化・起動
sudo systemctl enable "ai-studio@${USER}"
sudo systemctl start "ai-studio@${USER}"

echo ""
echo "✅ 完了！"
echo ""
echo "📋 管理コマンド:"
echo "   状態確認:  sudo systemctl status ai-studio@${USER}"
echo "   ログ確認:  journalctl -u ai-studio@${USER} -f"
echo "   再起動:    sudo systemctl restart ai-studio@${USER}"
echo "   停止:      sudo systemctl stop ai-studio@${USER}"
echo "   無効化:    sudo systemctl disable ai-studio@${USER}"
echo ""
echo "🌐 アクセス: http://$(tailscale ip -4 2>/dev/null || echo '<tailscale-ip>'):8765"
