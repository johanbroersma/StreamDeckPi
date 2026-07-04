#!/usr/bin/env bash
# ============================================================
# Pi Stream Deck — Pi Setup Script
# Run once on the Raspberry Pi to install all dependencies
# and configure auto-start services.
# ============================================================
set -euo pipefail

PROJ=/apps/StreamDeckPi
USER=${SUDO_USER:-admin}

echo "==> Installing system packages…"
apt-get update -qq
apt-get install -y --fix-missing \
    cage \
    chromium-browser \
    wlr-randr \
    fonts-noto-color-emoji \
    python3-aiohttp \
    python3-pip

echo "==> Ensuring aiohttp is available…"
python3 -c "import aiohttp" 2>/dev/null || \
    pip3 install --break-system-packages aiohttp

echo "==> Setting up user runtime dir…"
loginctl enable-linger "$USER" || true
mkdir -p /run/user/$(id -u "$USER")
chown "$USER":"$USER" /run/user/$(id -u "$USER") || true

echo "==> Installing systemd services…"
cp "$PROJ/systemd/streamdeck-server.service" /etc/systemd/system/
cp "$PROJ/systemd/streamdeck-ui.service"     /etc/systemd/system/

systemctl daemon-reload
systemctl enable streamdeck-server.service
systemctl enable streamdeck-ui.service

echo "==> Configuring Wayland / cage for Pi display…"

# Ensure vc4-fkms-v3d or vc4-kms-v3d overlay is set (for Wayland)
if ! grep -q "dtoverlay=vc4" /boot/config.txt 2>/dev/null && \
   ! grep -q "dtoverlay=vc4" /boot/firmware/config.txt 2>/dev/null; then
    echo ""
    echo "  NOTE: Add one of the following to /boot/firmware/config.txt:"
    echo "    dtoverlay=vc4-kms-v3d"
    echo "  and reboot before starting the UI service."
    echo ""
fi

# Allow video group for DRM access
usermod -aG video,render,input "$USER" 2>/dev/null || true

echo "==> Starting services…"
systemctl start streamdeck-server.service

echo ""
echo "  ✓ Setup complete!"
echo ""
echo "  Server:  http://$(hostname -I | awk '{print $1}'):7001"
echo ""
echo "  To start the kiosk UI (requires display / reboot):"
echo "    sudo systemctl start streamdeck-ui.service"
echo ""
echo "  View logs:"
echo "    journalctl -fu streamdeck-server"
echo "    journalctl -fu streamdeck-ui"
echo ""
