#!/usr/bin/env bash
# Quick-start for development / testing
# Starts the backend server in foreground
set -euo pipefail

PROJ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJ/server"

echo "Starting Pi Stream Deck server on port 7001…"
echo "Access at: http://localhost:7001"
echo "Press Ctrl+C to stop."
exec python3 server.py
