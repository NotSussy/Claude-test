#!/usr/bin/env bash
# MC Bedrock Connector — one-time install script
# Sets up the server as a systemd service so it starts automatically on boot.
# Run once with: sudo bash install.sh

set -e

SERVICE_NAME="mc-bedrock-connector"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Sanity checks ─────────────────────────────────────────────────────────────

if [ "$EUID" -ne 0 ]; then
  echo "Please run with sudo: sudo bash install.sh"
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "Node.js is not installed. Install it from https://nodejs.org (v18+) and re-run."
  exit 1
fi

echo "=== MC Bedrock Connector — Install ==="
echo "Install directory: $INSTALL_DIR"
echo ""

# ── Install npm dependencies ───────────────────────────────────────────────────

echo "[1/3] Installing npm dependencies..."
npm install --prefix "$INSTALL_DIR" --omit=dev
echo "      Done."

# ── Write systemd service file ─────────────────────────────────────────────────

echo "[2/3] Creating systemd service at $SERVICE_FILE..."
sed "s|INSTALL_DIR|${INSTALL_DIR}|g" "$INSTALL_DIR/mc-bedrock-connector.service" > "$SERVICE_FILE"
echo "      Done."

# ── Enable and start the service ───────────────────────────────────────────────

echo "[3/3] Enabling and starting service..."
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
echo "      Done."

# ── Print result ───────────────────────────────────────────────────────────────

echo ""
echo "=== Install complete! ==="
echo ""
echo "The server now starts automatically on boot."
echo ""
echo "Useful commands:"
echo "  systemctl status $SERVICE_NAME    — check if it's running"
echo "  journalctl -u $SERVICE_NAME -f    — live logs"
echo "  systemctl stop $SERVICE_NAME      — stop the server"
echo "  systemctl disable $SERVICE_NAME   — remove from auto-start"
echo ""

# Show the local IP so the user knows where to find the web UI
LOCAL_IP=$(node -e "
const os = require('os');
const nets = os.networkInterfaces();
for (const name of Object.keys(nets)) {
  for (const net of nets[name]) {
    if (net.family === 'IPv4' && !net.internal) { process.stdout.write(net.address); process.exit(0); }
  }
}
process.stdout.write('localhost');
" 2>/dev/null || echo "localhost")

echo "Web UI (configure your target server):  https://${LOCAL_IP}"
echo ""
echo "Your browser will warn about the self-signed certificate — click"
echo "  Advanced → Proceed  (Chrome)  or  Accept the Risk  (Firefox)."
echo ""
echo "Minecraft on any device on this LAN will now see this machine"
echo "in the server list (via RakNet LAN discovery on port 19132)."
