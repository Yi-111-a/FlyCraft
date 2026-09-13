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
# Opt5 defaults: measurable flee/survival in main score
export HARNESS_NO_RESIST="${HARNESS_NO_RESIST:-1}"
export HARNESS_ELEVATION="${HARNESS_ELEVATION:-0}"
echo "[harness] writing $OUT duration=${HARNESS_DURATION}s no_resist=${HARNESS_NO_RESIST} elevation=${HARNESS_ELEVATION} ablation=${FLYCRAFT_ABLATION:-0}"
node "$ROOT/harness/npc_eval.js"
