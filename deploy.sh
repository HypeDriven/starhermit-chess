#!/usr/bin/env bash
# Registers/updates the chess game on the starhermit platform and deploys server.js
# as its authoritative game script, via the starhermit admin backend.
#
# Usage:
#   ADMIN_URL=http://localhost:5040 ADMIN_API_KEY=admin-secret-key ./deploy.sh
#
# Defaults target the local dev admin backend.
set -euo pipefail

ADMIN_URL="${ADMIN_URL:-http://localhost:5040}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin-secret-key}"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> Logging in to admin backend at $ADMIN_URL"
TOKEN=$(curl -sf -X POST "$ADMIN_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"apiKey\":\"$ADMIN_API_KEY\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')

echo "==> Upserting game definition (budgets + elo leaderboard)"
curl -sf -X PUT "$ADMIN_URL/api/admin/v1/games/chess" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "name": "Chess",
    "enabled": true,
    "createLeaderboard": true,
    "stateBudgetBytesPerPlayer": 5242880,
    "cpuMillisBudgetPerInvocation": 250,
    "memoryBudgetBytesPerInvocation": 33554432,
    "maxConcurrentSessionsPerPlayer": 20,
    "timerSweepSeconds": 300
  }' | python3 -m json.tool

echo "==> Deploying server.js"
python3 - "$HERE/server.js" << 'EOF' > /tmp/chess-script-payload.json
import json, sys
print(json.dumps({"scriptSource": open(sys.argv[1]).read()}))
EOF
curl -sf -X PUT "$ADMIN_URL/api/admin/v1/games/chess/script" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data @/tmp/chess-script-payload.json \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("    scriptVersion=%s bytes=%s" % (d.get("scriptVersion"), d.get("scriptBytes")))'
rm -f /tmp/chess-script-payload.json

echo "==> Done. The chess client (index.html) can now be launched against the platform."
