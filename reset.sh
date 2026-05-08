#!/usr/bin/env bash
# Full reset — wipes server state, generated images, dev caches, and restarts both servers.
# Browser-side: open devtools console and run `localStorage.clear()` then hard-refresh.

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
SERVER="$ROOT/server"
CLIENT="$ROOT/client"

echo "==> Stopping running servers"
pkill -f "node index.js" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1

echo "==> Clearing server state"
rm -f "$SERVER/sessions.json"
rm -f "$SERVER/usage.json"
rm -rf "$SERVER/public/generated"/*
rm -rf "$SERVER/uploads"/*
echo "  - sessions.json: cleared"
echo "  - usage.json: cleared"
echo "  - generated images: cleared"
echo "  - uploads: cleared"

echo "==> Clearing Vite dev cache"
rm -rf "$CLIENT/node_modules/.vite"
rm -rf "$CLIENT/dist"
echo "  - .vite cache: cleared"
echo "  - dist: cleared"

echo "==> Starting backend (port 3001)"
cd "$SERVER"
nohup node index.js > /tmp/adstudio-server.log 2>&1 &
sleep 2

echo "==> Starting Vite (port 3003)"
cd "$CLIENT"
nohup npx vite > /tmp/adstudio-vite.log 2>&1 &
sleep 3

echo ""
echo "✓ Reset complete."
echo ""
echo "Logs: /tmp/adstudio-server.log + /tmp/adstudio-vite.log"
echo ""
echo "Now in your browser:"
echo "  1. Open devtools (Cmd+Opt+I) → Application tab → Local Storage → http://localhost:3003"
echo "  2. Right-click → Clear (or run 'localStorage.clear()' in Console)"
echo "  3. Hard refresh: Cmd+Shift+R"
echo ""
echo "Or fastest: open in an Incognito window → http://localhost:3003"
