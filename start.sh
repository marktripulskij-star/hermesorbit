#!/bin/bash
# Start both server and client
cd "$(dirname "$0")"

echo "Starting Ad Concept Generator..."

# Start server
(cd server && node index.js) &
SERVER_PID=$!

# Start client
(cd client && npx vite) &
CLIENT_PID=$!

echo "Server: http://localhost:3001"
echo "App:    http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop both."

trap "kill $SERVER_PID $CLIENT_PID 2>/dev/null" INT TERM
wait
