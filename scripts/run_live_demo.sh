#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DURATION="${LIVE_DURATION:-60}"

if ! timeout 2 bash -c '</dev/tcp/127.0.0.1/25565' 2>/dev/null; then
  echo "Paper is not listening on 127.0.0.1:25565." >&2
  echo "Start it first: cd /workspace/mc-server && tmux new -s flycraft-server ./start.sh" >&2
  exit 1
fi

# By default stage both modes: summon after login, then lower HP to trigger flee.
if [[ "${FLYCRAFT_SUMMON:-1}" == "1" ]]; then
  (
    sleep 6
    "$ROOT/scripts/rcon.py" 'op FlyBot' || true
    "$ROOT/scripts/rcon.py" 'effect give FlyBot minecraft:instant_health 1 10 true' || true
    "$ROOT/scripts/rcon.py" 'time set midnight' || true
    "$ROOT/scripts/rcon.py" 'gamerule doMobSpawning false' || true
    "$ROOT/scripts/rcon.py" 'difficulty normal' || true
    "$ROOT/scripts/rcon.py" 'kill @e[type=zombie]' || true
    "$ROOT/scripts/rcon.py" 'execute at FlyBot run summon minecraft:zombie ~2.5 ~ ~ {PersistenceRequired:1b,IsBaby:0b}' || true
    sleep 14
    "$ROOT/scripts/rcon.py" 'damage FlyBot 12 minecraft:generic' || true
  ) &
  STAGER_PID=$!
  trap 'kill "$STAGER_PID" 2>/dev/null || true' EXIT
fi

cd "$ROOT"
MC_HOST=127.0.0.1 MC_PORT=25565 MC_USERNAME=FlyBot LIVE_DURATION="$DURATION" \
  exec node bridge-js/live_bot.js
