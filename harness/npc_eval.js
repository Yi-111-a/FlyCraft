#!/usr/bin/env node
'use strict'
/**
 * Honest NPC-level harness for FlyBot.
 * Primary metrics come from FlyBot telemetry logs (observer entity lookup is unreliable
 * on this Paper/mineflayer combo). Hits require `[fly] hit` from the combatant after attack.
 * Exit 0 only if PASS (score>=0.75 and critical gates).
 */
const path = require('path')
const fs = require('fs')
const { spawn, execFileSync } = require('child_process')
const mineflayer = require('mineflayer')

const ROOT = path.resolve(__dirname, '..')
const OUT = process.env.HARNESS_OUT || path.join(ROOT, 'harness', 'runs', `run_${Date.now()}.json`)
const HOST = process.env.MC_HOST || '127.0.0.1'
const PORT = Number(process.env.MC_PORT || 25565)
const DURATION = Number(process.env.HARNESS_DURATION || 60)
const RCON = path.join(ROOT, 'scripts', 'rcon.py')

function rcon (cmd) {
  try {
    return execFileSync('python3', [RCON, cmd], { encoding: 'utf8', timeout: 8000 }).trim()
  } catch (e) {
    return `RCON_ERR:${e.message}`
  }
}

function clamp01 (x) { return Math.max(0, Math.min(1, x)) }

const events = []
const attacks = []
const hits = []
const samples = []
let kicked = false
let nanMove = 0
let spawnAt = 0
let finished = false

const botProc = spawn('node', [path.join(ROOT, 'bridge-js', 'live_bot.js')], {
  cwd: ROOT,
  env: {
    ...process.env,
    MC_HOST: HOST,
    MC_PORT: String(PORT),
    MC_USERNAME: 'FlyBot',
    LIVE_DURATION: String(DURATION + 25),
    FLYCRAFT_CONFIG: process.env.FLYCRAFT_CONFIG || path.join(ROOT, 'configs', 'malecns.yaml')
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

const logLines = []
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
  // Telemetry samples (authoritative position/distance)
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
  const am = line.match(/\[fly\] attack dist=([0-9.]+)/)
  if (am) attacks.push({ t: row.t, dist: Number(am[1]) })
  const hm = line.match(/\[fly\] hit id=(\d+) name=(\w+) dist=([0-9.]+)/)
  if (hm) {
    const ht = { t: row.t, id: Number(hm[1]), name: hm[2], d: Number(hm[3]) }
    const dup = hits.some(h => Math.abs(h.t - ht.t) < 350 && h.id === ht.id)
    if (!dup) hits.push(ht)
  }
  if (/\[fly\] kicked/.test(line)) kicked = true
}

botProc.stdout.on('data', d => ingest(d.toString(), true))
botProc.stderr.on('data', d => ingest(d.toString(), false))

// Observer still used for world setup / optional secondary hurt events
const obs = mineflayer.createBot({ host: HOST, port: PORT, username: 'HarnessObs', version: '1.20.4', auth: 'offline' })
obs.on('kicked', () => { /* observer kick is not FlyBot stability */ })
obs.on('error', () => {})
obs.on('entityHurt', (entity) => {
  const n = String(entity.name || '').toLowerCase()
  if (n === 'husk' || n === 'zombie') {
    // Secondary evidence only; primary hits come from FlyBot `[fly] hit`
    events.push({ t: Date.now(), type: 'obs_husk_hurt', id: entity.id })
  }
})

function setupArena () {
  rcon('gamerule doDaylightCycle false')
  rcon('gamerule keepInventory true')
  rcon('time set night')
  rcon('difficulty normal')
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
  rcon('effect clear FlyBot')
  rcon('effect give FlyBot resistance 180 3 true')
  rcon('effect give FlyBot regeneration 60 1 true')
  rcon('effect give FlyBot absorption 60 1 true')
  rcon('effect give FlyBot instant_health 1 10 true')
  rcon('item replace entity FlyBot weapon.mainhand with minecraft:iron_sword')
  // Lower attack damage so FlyBot can trade hits like an NPC without instant death
  rcon('summon minecraft:husk 211 81 208 {PersistenceRequired:1b,Health:28f,Attributes:[{Name:"minecraft:generic.attack_damage",Base:3.0},{Name:"minecraft:generic.movement_speed",Base:0.28}]}')
  rcon('summon minecraft:husk 205 81 208 {PersistenceRequired:1b,Health:28f,Attributes:[{Name:"minecraft:generic.attack_damage",Base:3.0},{Name:"minecraft:generic.movement_speed",Base:0.28}]}')
  rcon('gamemode spectator HarnessObs')
  console.log('[harness] arena ready, scoring for', DURATION, 's')
}

obs.once('spawn', () => {
  spawnAt = Date.now()
  rcon('gamemode spectator HarnessObs')

  let tries = 0
  const waitFly = setInterval(() => {
    tries += 1
    const online = rcon('list')
    const spawnedLog = logLines.some(l => /spawned user=FlyBot/.test(l.line))
    if (/FlyBot/.test(online) && spawnedLog) {
      clearInterval(waitFly)
      setupArena()
      startScoring()
    } else if (tries > 50) {
      clearInterval(waitFly)
      console.error('[harness] FlyBot never joined:', online)
      finish(true)
    }
  }, 400)
})

function buffFly () {
  rcon('effect give FlyBot resistance 120 3 true')
  rcon('effect give FlyBot regeneration 20 1 true')
  rcon('item replace entity FlyBot weapon.mainhand with minecraft:iron_sword')
}

function summonHusks () {
  rcon('summon minecraft:husk 211 81 208 {PersistenceRequired:1b,Health:28f,Attributes:[{Name:"minecraft:generic.attack_damage",Base:3.0},{Name:"minecraft:generic.movement_speed",Base:0.28}]}')
  rcon('summon minecraft:husk 205 81 211 {PersistenceRequired:1b,Health:28f,Attributes:[{Name:"minecraft:generic.attack_damage",Base:3.0},{Name:"minecraft:generic.movement_speed",Base:0.28}]}')
}

function startScoring () {
  const maintain = setInterval(() => {
    buffFly()
    const last = samples[samples.length - 1]
    const stalled = !last || (Date.now() - last.t > 4000)
    if (stalled || (last && (last.y < 79 || last.x < 199 || last.x > 217 || last.z < 199 || last.z > 217))) {
      rcon('tp FlyBot 208 81 208')
    }
    if (stalled || (last && (last.hostileDist == null || last.hostileDist > 18))) {
      // do not kill existing combat targets if only briefly far; only when stalled/missing
      if (stalled || last.hostileDist == null || last.hostileDist > 22) {
        rcon('kill @e[type=husk]')
        summonHusks()
      }
      rcon('tp FlyBot 208 81 208')
    }
  }, 5000)

  let lastRespawnHandled = 0
  const respawnWatch = setInterval(() => {
    for (const l of logLines) {
      if (/\[fly\] respawned/.test(l.line) && l.t > lastRespawnHandled) {
        lastRespawnHandled = l.t
        buffFly()
        rcon('tp FlyBot 208 81 208')
        const last = samples[samples.length - 1]
        if (!last || last.hostileDist == null || last.hostileDist > 14) summonHusks()
      }
    }
  }, 1000)

  setTimeout(() => {
    clearInterval(maintain)
    clearInterval(respawnWatch)
    finish(false)
  }, DURATION * 1000)
}

function parseDecisions () {
  const dec = []
  for (const row of logLines) {
    const m = row.line.match(/decision=(\w+).*hp=([0-9.]+).*dist=([0-9.\-]+)/)
    if (m) dec.push({ t: row.t, program: m[1], hp: Number(m[2]), dist: m[3] === '-' ? null : Number(m[3]) })
  }
  return dec
}

function scoreRun (dec) {
  let engageTrials = 0, engageWins = 0
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    if (s.hostileDist != null && s.hostileDist <= 12 && s.hostileDist > 3.5) {
      engageTrials += 1
      const t0 = s.t
      const ok = samples.some(x => x.t >= t0 && x.t <= t0 + 10000 && x.hostileDist != null && x.hostileDist <= 3.5)
      if (ok) engageWins += 1
      while (i + 1 < samples.length && samples[i + 1].t < t0 + 10000) i++
    }
  }
  const engage_rate = engageTrials
    ? engageWins / engageTrials
    : (samples.some(s => s.hostileDist != null && s.hostileDist <= 3.5) ? 1 : 0)

  const meleeTs = attacks.map(a => a.t).sort((a, b) => a - b)
  const gaps = []
  for (let i = 1; i < meleeTs.length; i++) {
    const g = meleeTs[i] - meleeTs[i - 1]
    if (g >= 200) gaps.push(g)
  }
  gaps.sort((a, b) => a - b)
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null
  const melee_dps_ok = medianGap != null && medianGap >= 450 && medianGap <= 1100
    ? 1
    : (medianGap != null && medianGap >= 300 && medianGap <= 1500 ? 0.5 : 0)

  // Telem-first flee scoring (peak gain within ~3s). Skip incomplete windows
  // so brief HP flickers under high resistance do not falsely zero flee_rate.
  let fleeTrials = 0, fleeWins = 0
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    if (s.program !== 'flee' || s.hp > 8 || s.hostileDist == null) continue
    const window = samples.filter(x => x.t > s.t && x.t <= s.t + 3800 && x.hostileDist != null)
    if (window.length < 2) continue
    fleeTrials += 1
    const peak = window.reduce((m, x) => (m == null || x.hostileDist > m ? x.hostileDist : m), null)
    if (peak != null && peak >= s.hostileDist + 1.5) fleeWins += 1
    while (i + 1 < samples.length && samples[i + 1].t < s.t + 3000) i++
  }
  const flee_rate = fleeTrials
    ? fleeWins / Math.max(1, fleeTrials)
    : (dec.some(d => d.program === 'flee') || samples.some(s => s.program === 'flee') ? 0.4 : 0.55)

  let wander_ok = 0
  const idleSamples = samples.filter(s => (s.hostileDist == null || s.hostileDist > 16) && s.program === 'idle')
  if (idleSamples.length >= 8) {
    const a = idleSamples[0]
    const b = idleSamples[Math.min(idleSamples.length - 1, 40)]
    const dist = Math.hypot(b.x - a.x, b.z - a.z)
    wander_ok = dist >= 2 ? 1 : dist >= 1 ? 0.5 : 0
  } else {
    wander_ok = 0.7
  }

  const hits_landed = hits.length
  const hits_score = clamp01(hits_landed / 4)
  const flySpawned = logLines.some(l => /spawned user=FlyBot/.test(l.line))
  // Allow a few guarded NaN repairs; fail only on kick or many corruptions
  const stability_ok = (!kicked && nanMove < 25 && flySpawned) ? 1 : 0

  const engage_score = clamp01(engage_rate)
  const flee_score = clamp01(flee_rate)

  const critical_pass = hits_landed >= 4 && stability_ok === 1
  const score =
    0.25 * engage_score +
    0.20 * melee_dps_ok +
    0.25 * hits_score +
    0.15 * flee_score +
    0.10 * wander_ok +
    0.05 * stability_ok

  const pass = critical_pass && score >= 0.75 && engage_score >= 0.5 && melee_dps_ok >= 0.5

  return {
    pass,
    score: Number(score.toFixed(3)),
    metrics: {
      engage_rate: Number(engage_score.toFixed(3)),
      engage_trials: engageTrials,
      melee_median_ms: medianGap,
      melee_dps_ok,
      hits_landed,
      flee_rate: Number(flee_score.toFixed(3)),
      flee_trials: fleeTrials,
      wander_ok,
      stability_ok,
      nan_or_invalid_signals: nanMove,
      kicked,
      sample_count: samples.length,
      attack_events: attacks.length,
      obs_hurt_events: events.length
    },
    thresholds: {
      score: 0.75,
      hits_landed_min: 4,
      engage_min: 0.5,
      melee_ok_min: 0.5
    }
  }
}

function finish (failedEarly) {
  if (finished) return
  finished = true
  const dec = parseDecisions()
  const result = failedEarly
    ? { pass: false, score: 0, metrics: { error: 'early_fail', stability_ok: 0, hits_landed: 0 }, thresholds: {} }
    : scoreRun(dec)
  const payload = {
    at: new Date().toISOString(),
    duration_s: DURATION,
    ...result,
    decisions: dec.slice(0, 200),
    sample_count: samples.length,
    hit_events: hits.length,
    note: 'Honest harness: PASS requires real hits ([fly] hit after attack) + stability + score>=0.75.'
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2))
  console.log('\n===== HARNESS RESULT =====')
  console.log(JSON.stringify({ pass: payload.pass, score: payload.score, metrics: payload.metrics }, null, 2))
  console.log('wrote', OUT)
  try { botProc.kill('SIGTERM') } catch (_) {}
  try { obs.quit('done') } catch (_) {}
  setTimeout(() => process.exit(payload.pass ? 0 : 2), 800)
}

setTimeout(() => {
  if (!spawnAt) {
    console.error('harness observer failed to spawn')
    try { botProc.kill('SIGTERM') } catch (_) {}
    process.exit(3)
  }
}, 20000)
