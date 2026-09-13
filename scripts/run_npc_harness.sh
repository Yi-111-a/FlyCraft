#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p harness/runs
N="${1:-$(date +%Y%m%d_%H%M%S)}"
OUT="$ROOT/harness/runs/run_${N}.json"
export HARNESS_OUT="$OUT"
export HARNESS_DURATION="${HARNESS_DURATION:-60}"
export FLYCRAFT_CONFIG="${FLYCRAFT_CONFIG:-$ROOT/configs/malecns.yaml}"
export MC_HOST="${MC_HOST:-127.0.0.1}"
export MC_PORT="${MC_PORT:-25565}"
echo "[harness] writing $OUT duration=${HARNESS_DURATION}s"
node "$ROOT/harness/npc_eval.js"
