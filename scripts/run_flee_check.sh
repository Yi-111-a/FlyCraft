#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p harness/runs
export FLEE_OUT="${FLEE_OUT:-$ROOT/harness/runs/flee_check.json}"
export FLEE_DURATION="${FLEE_DURATION:-35}"
export FLYCRAFT_CONFIG="${FLYCRAFT_CONFIG:-$ROOT/configs/malecns.yaml}"
export MC_HOST="${MC_HOST:-127.0.0.1}"
export MC_PORT="${MC_PORT:-25565}"
# Drop stale FlyBot if any
python3 "$ROOT/scripts/rcon.py" 'kick FlyBot' >/dev/null 2>&1 || true
sleep 1
echo "[flee_check] writing $FLEE_OUT duration=${FLEE_DURATION}s"
node "$ROOT/harness/flee_check.js"
