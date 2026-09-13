#!/usr/bin/env node
'use strict'
/**
 * Dedicated flee validation: lower resistance / force low HP, stronger husks,
 * measure program=flee + low HP → hostileDist increases ≥1.5 within ~3s.
 * Writes harness/runs/flee_check.json (does not gate main harness PASS).
 */
const path = require('path')
const fs = require('fs')
const { spawn, execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const OUT = process.env.FLEE_OUT || path.join(ROOT, 'harness', 'runs', 'flee_check.json')
const HOST = process.env.MC_HOST || '127.0.0.1'
const PORT = Number(process.env.MC_PORT || 25565)
const DURATION = Number(process.env.FLEE_DURATION || 35)
const RCON = path.join(ROOT, 'scripts', 'rcon.py')
const HP_TARGET = 6
const DIST_GAIN = 1.5
const WINDOW_MS = 3000

function rcon (cmd) {
  try {
    return execFileSync('python3', [RCON, cmd], { encoding: 'utf8', timeout: 8000 }).trim()
  } catch (e) {
    return `RCON_ERR:${e.message}`
  }
}

const samples = []
const decisions = []
const logLines = []
let kicked = false
let nanMove = 0
let finished = false
let spawnAt = 0

const botProc = spawn('node', [path.join(ROOT, 'bridge-js', 'live_bot.js')], {
  cwd: ROOT,
  env: {
    ...process.env,
    MC_HOST: HOST,
    MC_PORT: String(PORT),
    MC_USERNAME: 'FlyBot',
    LIVE_DURATION: String(DURATION + 20),
    FLYCRAFT_CONFIG: process.env.FLYCRAFT_CONFIG || path.join(ROOT, 'configs', 'malecns.yaml')
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

function ingest (s, toStdout) {
  if (toStdout) process.stdout.write(s)
  else process.stderr.write(s)
  for (const line of s.split('\n')) {
    if (!line.trim()) continue
    const row = { t: Date.now(), line: line.trim() }
    logLines.push(row)
    parseLiveLine(row)
  }
  if (/kicked|invalid move/i.test(s)) nanMove += 1
  if (/guarded invalid/i.test(s)) nanMove += 1
}

function parseLiveLine (row) {
  const line = row.line
  const tm = line.match(/\[fly\] telem hp=([0-9.]+) x=([0-9.\-]+) y=([0-9.\-]+) z=([0-9.\-]+) hostileDist=([0-9.\-]+) program=(\w+)/)
  if (tm) {
    const hd = tm[5] === '-' ? null : Number(tm[5])
    samples.push({
      t: row.t,
      hp: Number(tm[1]),
      x: Number(tm[2]), y: Number(tm[3]), z: Number(tm[4]),
      hostileDist: hd,
      program: tm[6]
    })
    if (![tm[2], tm[3], tm[4]].every(v => Number.isFinite(Number(v)))) nanMove += 1
  }
  const dm = line.match(/decision=(\w+).*hp=([0-9.]+).*dist=([0-9.\-]+)/)
  if (dm) {
    decisions.push({
      t: row.t,
      program: dm[1],
      hp: Number(dm[2]),
      dist: dm[3] === '-' ? null : Number(dm[3])
    })
  }
  if (/\[fly\] kicked/.test(line)) kicked = true
}

botProc.stdout.on('data', d => ingest(d.toString(), true))
botProc.stderr.on('data', d => ingest(d.toString(), false))

function setupFleeArena () {
  rcon('gamerule doDaylightCycle false')
  rcon('gamerule keepInventory true')
  rcon('time set night')
  rcon('difficulty hard')
  rcon('kill @e[type=husk]')
  rcon('kill @e[type=zombie]')
  rcon('fill 200 80 200 216 80 216 smooth_stone')
  rcon('fill 200 81 200 216 86 216 air')
  rcon('fill 200 81 200 216 84 200 iron_bars')
  rcon('fill 200 81 216 216 84 216 iron_bars')
  rcon('fill 200 81 200 200 84 216 iron_bars')
  rcon('fill 216 81 200 216 84 216 iron_bars')
  rcon('spawnpoint FlyBot 208 81 208')
  rcon('tp FlyBot 208 81 208')
  rcon('gamemode survival FlyBot')
  // Low / no resistance so HP stays low; no regen/absorption
  rcon('effect clear FlyBot')
  rcon('effect give FlyBot resistance 120 0 true') // Resistance I only
  rcon('item replace entity FlyBot weapon.mainhand with minecraft:iron_sword')
  // Stronger husks to pressure flee
  rcon('summon minecraft:husk 211 81 208 {PersistenceRequired:1b,Health:40f,Attributes:[{Name:"minecraft:generic.attack_damage",Base:5.0},{Name:"minecraft:generic.movement_speed",Base:0.30}]}')
  rcon('summon minecraft:husk 205 81 208 {PersistenceRequired:1b,Health:40f,Attributes:[{Name:"minecraft:generic.attack_damage",Base:5.0},{Name:"minecraft:generic.movement_speed",Base:0.30}]}')
  // Force low HP immediately
  rcon(`damage FlyBot ${20 - HP_TARGET} minecraft:generic`)
  console.log('[flee_check] arena ready (low resist, forced low HP, stronger husks), scoring', DURATION, 's')
}

function keepLowHp () {
  const last = samples[samples.length - 1]
  const hp = last ? last.hp : 20
  // Do not smash while already fleeing / very low — let distance trials complete.
  const fleeing = last && last.program === 'flee'
  if (hp > HP_TARGET + 1 && !fleeing) {
    const dmg = Math.min(10, Math.max(2, Math.ceil(hp - HP_TARGET)))
    rcon(`damage FlyBot ${dmg} minecraft:generic`)
  }
  // Refresh soft resist only; never regen
  rcon('effect clear FlyBot regeneration')
  rcon('effect clear FlyBot absorption')
  rcon('effect clear FlyBot resistance')
  rcon('effect give FlyBot resistance 30 0 true')
  rcon('item replace entity FlyBot weapon.mainhand with minecraft:iron_sword')
  if (last && (last.y < 79 || last.x < 199 || last.x > 217 || last.z < 199 || last.z > 217)) {
    rcon('tp FlyBot 208 81 208')
  }
  if (!last || last.hostileDist == null || last.hostileDist > 16) {
    rcon('kill @e[type=husk]')
    rcon('summon minecraft:husk 211 81 208 {PersistenceRequired:1b,Health:40f,Attributes:[{Name:"minecraft:generic.attack_damage",Base:5.0},{Name:"minecraft:generic.movement_speed",Base:0.30}]}')
    rcon('summon minecraft:husk 205 81 211 {PersistenceRequired:1b,Health:40f,Attributes:[{Name:"minecraft:generic.attack_damage",Base:5.0},{Name:"minecraft:generic.movement_speed",Base:0.30}]}')
    rcon('tp FlyBot 208 81 208')
    rcon(`damage FlyBot ${Math.max(2, 20 - HP_TARGET)} minecraft:generic`)
  }
}

function scoreFlee () {
  let fleeTrials = 0
  let fleeWins = 0
  const trialDetails = []

  // Prefer telem samples: program=flee + hp<=8 + hostile present
  // Win if distance ever gains ≥DIST_GAIN within ~WINDOW_MS (peak, not only endpoint).
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    if (s.program !== 'flee' || s.hp > 8 || s.hostileDist == null) continue
    fleeTrials += 1
    const windowSamples = samples.filter(x =>
      x.t > s.t && x.t <= s.t + WINDOW_MS + 800 && x.hostileDist != null
    )
    let best = null
    for (const x of windowSamples) {
      if (best == null || x.hostileDist > best.hostileDist) best = x
    }
    const gain = best ? best.hostileDist - s.hostileDist : null
    const win = gain != null && gain >= DIST_GAIN
    if (win) fleeWins += 1
    trialDetails.push({
      t0: s.t,
      hp: s.hp,
      d0: Number(s.hostileDist.toFixed(2)),
      d1: best ? Number(best.hostileDist.toFixed(2)) : null,
      gain: gain == null ? null : Number(gain.toFixed(2)),
      win
    })
    while (i + 1 < samples.length && samples[i + 1].t < s.t + 2800) i++
  }

  // Fallback: decision logs if telem missed program tag
  if (fleeTrials === 0) {
    for (const d of decisions) {
      if (d.program !== 'flee' || d.hp > 8 || d.dist == null) continue
      fleeTrials += 1
      const s0 = samples.find(s => Math.abs(s.t - d.t) < 800 && s.hostileDist != null)
      if (!s0) {
        trialDetails.push({ t0: d.t, hp: d.hp, d0: d.dist, d1: null, gain: null, win: false })
        continue
      }
      const later = samples.find(x =>
        x.t >= d.t + 2000 && x.t <= d.t + WINDOW_MS + 1500 && x.hostileDist != null
      )
      const gain = later ? later.hostileDist - s0.hostileDist : null
      const win = later != null && later.hostileDist >= s0.hostileDist + DIST_GAIN
      if (win) fleeWins += 1
      trialDetails.push({
        t0: d.t,
        hp: d.hp,
        d0: Number(s0.hostileDist.toFixed(2)),
        d1: later ? Number(later.hostileDist.toFixed(2)) : null,
        gain: gain == null ? null : Number(gain.toFixed(2)),
        win
      })
    }
  }

  const flee_rate = fleeTrials ? fleeWins / fleeTrials : 0
  const lowHpSamples = samples.filter(s => s.hp <= 8).length
  const fleeSamples = samples.filter(s => s.program === 'flee').length
  const flySpawned = logLines.some(l => /spawned user=FlyBot/.test(l.line))
  const pass = fleeTrials >= 1 && flee_rate >= 0.4 && !kicked && flySpawned

  return {
    pass,
    flee_rate: Number(flee_rate.toFixed(3)),
    flee_trials: fleeTrials,
    flee_wins: fleeWins,
    metrics: {
      flee_rate: Number(flee_rate.toFixed(3)),
      flee_trials: fleeTrials,
      flee_wins: fleeWins,
      dist_gain_threshold: DIST_GAIN,
      window_ms: WINDOW_MS,
      low_hp_samples: lowHpSamples,
      flee_program_samples: fleeSamples,
      sample_count: samples.length,
      decision_count: decisions.length,
      nan_or_invalid_signals: nanMove,
      kicked,
      fly_spawned: flySpawned,
      hp_target: HP_TARGET
    },
    trials: trialDetails.slice(0, 40)
  }
}

function finish (failedEarly, errMsg) {
  if (finished) return
  finished = true
  const result = failedEarly
    ? {
        pass: false,
        flee_rate: 0,
        flee_trials: 0,
        flee_wins: 0,
        metrics: { error: errMsg || 'early_fail', flee_trials: 0, flee_rate: 0 },
        trials: []
      }
    : scoreFlee()

  const payload = {
    at: new Date().toISOString(),
    kind: 'flee_check',
    duration_s: DURATION,
    ...result,
    note: 'Dedicated flee validation: low resistance + forced low HP + stronger husks. Success = flee_trials>0 with measured flee_rate (distance +≥1.5 within ~3s).'
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2))
  console.log('\n===== FLEE CHECK RESULT =====')
  console.log(JSON.stringify({
    pass: payload.pass,
    flee_rate: payload.flee_rate,
    flee_trials: payload.flee_trials,
    flee_wins: payload.flee_wins,
    metrics: payload.metrics
  }, null, 2))
  console.log('wrote', OUT)
  try { botProc.kill('SIGTERM') } catch (_) {}
  setTimeout(() => process.exit(payload.pass ? 0 : 2), 800)
}

// Wait for FlyBot spawn via logs + rcon list (no observer bot needed)
let tries = 0
const waitFly = setInterval(() => {
  tries += 1
  const online = rcon('list')
  const spawnedLog = logLines.some(l => /spawned user=FlyBot/.test(l.line))
  if (/FlyBot/.test(online) && spawnedLog) {
    clearInterval(waitFly)
    spawnAt = Date.now()
    setupFleeArena()
    const maintain = setInterval(keepLowHp, 2500)
    // Initial damage pulse shortly after arena
    setTimeout(() => rcon(`damage FlyBot 10 minecraft:generic`), 800)
    setTimeout(() => rcon(`damage FlyBot 8 minecraft:generic`), 2000)
    setTimeout(() => {
      clearInterval(maintain)
      finish(false)
    }, DURATION * 1000)
  } else if (tries > 60) {
    clearInterval(waitFly)
    console.error('[flee_check] FlyBot never joined:', online)
    finish(true, 'flybot_never_joined')
  }
}, 400)

setTimeout(() => {
  if (!spawnAt && !finished) {
    console.error('[flee_check] timeout waiting for FlyBot')
    finish(true, 'timeout')
  }
}, 45000)
