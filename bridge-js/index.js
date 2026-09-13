#!/usr/bin/env node
/**
 * FlyCraft Mineflayer stub.
 * Default: dry-run — read NDJSON events from stdin (or fake sequence) and print actions.
 * Real Minecraft: set MC_HOST (and optional MC_PORT / MC_USERNAME).
 */
'use strict';

const readline = require('readline');

const DRY = process.argv.includes('--dry-run') || process.env.FLYCRAFT_DRY === '1' || !process.env.MC_HOST;

const FAKE_EVENTS = [
  { type: 'event', name: 'light_on', t: 0 },
  { type: 'event', name: 'player_near', t: 1 },
  { type: 'event', name: 'attack', t: 2 },
  { type: 'event', name: 'food_near', t: 3 },
  { type: 'event', name: 'blank', t: 4 },
];

/** Naive local mapping mirroring Python body programs (stub only). */
function naiveProgram(eventName) {
  switch (eventName) {
    case 'attack':
      return 'flee';
    case 'hostile_near':
      return 'fight';
    case 'player_near':
      return 'flee';
    case 'food_near':
      return 'approach_food';
    case 'light_on':
      return 'turn_left';
    default:
      return 'idle';
  }
}

function commandsFor(program) {
  const table = {
    flee: [{ op: 'sprint_back', ticks: 12 }],
    fight: [{ op: 'look_at_nearest', tag: 'hostile' }, { op: 'attack' }],
    approach_food: [{ op: 'forward', ticks: 15 }, { op: 'use_item', hand: 'main' }],
    turn_left: [{ op: 'look', yaw_delta: -45 }],
    turn_right: [{ op: 'look', yaw_delta: 45 }],
    jump: [{ op: 'jump', ticks: 4 }],
    idle: [{ op: 'wait', ticks: 5 }],
  };
  return table[program] || table.idle;
}

function emitAction(event) {
  const program = naiveProgram(event.name);
  const action = {
    type: 'action',
    program,
    commands: commandsFor(program),
    t: event.t ?? 0,
    source_event: event.name,
    dry_run: true,
  };
  console.log(JSON.stringify(action));
}

async function runDryFromStdinOrFake() {
  console.error('[flycraft-bridge] dry-run mode (no Minecraft). MC_HOST TODO for live bot.');
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let got = false;
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    got = true;
    let ev;
    try {
      ev = JSON.parse(trimmed);
    } catch {
      ev = { type: 'event', name: trimmed, t: 0 };
    }
    emitAction(ev);
  }
  if (!got) {
    console.error('[flycraft-bridge] no stdin events; using fake sequence');
    for (const ev of FAKE_EVENTS) emitAction(ev);
  }
}

async function runLive() {
  // Keep the legacy dry-run contract here; live implementation is isolated.
  require('./live_bot.js');
}


(async () => {
  if (DRY) await runDryFromStdinOrFake();
  else await runLive();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
