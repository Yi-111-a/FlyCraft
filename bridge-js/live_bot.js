#!/usr/bin/env node
'use strict'

const path = require('path')
const fs = require('fs')
const readline = require('readline')
const { spawn } = require('child_process')
const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')

const ROOT = path.resolve(__dirname, '..')
const HOSTILES = new Set([
  'zombie', 'zombie_villager', 'husk', 'drowned', 'skeleton', 'stray',
  'bogged', 'wither_skeleton', 'spider', 'cave_spider', 'creeper', 'witch',
  'pillager', 'vindicator', 'evoker', 'ravager', 'vex', 'slime', 'magma_cube',
  'silverfish', 'endermite', 'guardian', 'elder_guardian', 'blaze', 'ghast',
  'phantom', 'hoglin', 'zoglin', 'piglin_brute', 'shulker', 'warden', 'withers'
])

const ARENA = { minX: 201.5, maxX: 214.5, minZ: 201.5, maxZ: 214.5, y: 81 }

const host = process.env.MC_HOST || '127.0.0.1'
const port = Number(process.env.MC_PORT || 25565)
const username = process.env.MC_USERNAME || 'FlyBot'
const duration = Number(process.env.LIVE_DURATION || 0)
const python = process.env.FLYCRAFT_PYTHON ||
  (fs.existsSync(path.join(ROOT, '.venv', 'bin', 'python'))
    ? path.join(ROOT, '.venv', 'bin', 'python') : 'python3')

const ATTACK_RANGE = 3.2
const ATTACK_COOLDOWN_MS = 650
const HURT_WINDOW_MS = 700
const WANDER_INTERVAL_MS = 2800
// Opt1 motion: prefer robust control chase; optional limited pathfinder only when far.
const PATHFINDER_MIN_DIST = 8.5
const PATHFINDER_COOLDOWN_MS = 4500
const STUCK_MS = 900
const USE_LIMITED_PATHFINDER = process.env.FLY_USE_PATHFINDER === '1'

const py = spawn(python, ['-u', '-m', 'flycraft.sim.live_server'], {
  cwd: ROOT,
  env: { ...process.env, PYTHONPATH: [ROOT, process.env.PYTHONPATH].filter(Boolean).join(':') },
  stdio: ['pipe', 'pipe', 'pipe']
})
py.stderr.on('data', data => process.stderr.write(data))
py.on('exit', (code, signal) => {
  if (!stopping) console.error(`[fly] Python controller exited code=${code} signal=${signal}`)
})

const bot = mineflayer.createBot({ host, port, username, version: '1.20.4', auth: 'offline' })

const rawWrite = bot._client.write.bind(bot._client)
const lastFiniteMove = { x: 208, y: 81, z: 208, yaw: 0, pitch: 0 }
bot._client.write = function guardedWrite (name, params = {}) {
  if (['position', 'position_look', 'look', 'flying'].includes(name)) {
    params = { ...params }
    for (const key of ['x', 'y', 'z', 'yaw', 'pitch']) {
      if (!(key in params)) continue
      if (!Number.isFinite(params[key]) || (['x', 'y', 'z'].includes(key) && Math.abs(params[key]) > 29999984)) {
        console.error(`[fly] guarded invalid ${name}.${key}=${params[key]}`)
        params[key] = lastFiniteMove[key]
      } else {
        lastFiniteMove[key] = params[key]
      }
    }
  }
  return rawWrite(name, params)
}

// Load pathfinder for Movements API compatibility, but do NOT set goals (Paper invalid-move / too-quick).
bot.loadPlugin(pathfinder)

let spawned = false
let stopping = false
let waiting = false
let hurtUntil = 0
let lastHealth = 20
let lastProgram = ''
let lastChat = 0
let lastLog = 0
let lastAttack = 0
let lastAttackTarget = null
let senseTimer = null
let telemTimer = null
let tickTimer = null
let swordCheckedAt = 0
let lastProgramName = 'idle'
let wanderYaw = 0
let wanderUntil = 0
let stuckSince = 0
let lastPos = null
let lookBusy = false
let lastPathGoalAt = 0
let stuckPhase = 0
let fleeStrafeSign = 1
let selectedTargetId = null

function finitePos (pos) {
  return pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z)
}

function repairEntityPose () {
  if (!bot.entity) return false
  let fixed = false
  if (!Number.isFinite(bot.entity.position.x) || !Number.isFinite(bot.entity.position.y) || !Number.isFinite(bot.entity.position.z)) {
    bot.entity.position.x = lastFiniteMove.x
    bot.entity.position.y = lastFiniteMove.y
    bot.entity.position.z = lastFiniteMove.z
    fixed = true
  }
  if (!Number.isFinite(bot.entity.yaw)) { bot.entity.yaw = lastFiniteMove.yaw || 0; fixed = true }
  if (!Number.isFinite(bot.entity.pitch)) { bot.entity.pitch = lastFiniteMove.pitch || 0; fixed = true }
  if (fixed) {
    // Halt controls briefly so mineflayer physics does not keep emitting NaN packets.
    try { stopManualControls() } catch (_) {}
    console.log('[fly] repaired NaN pose from lastFiniteMove')
  } else if (finitePos(bot.entity.position)) {
    // Keep lastFiniteMove fresh from healthy poses (reduces repair drift).
    lastFiniteMove.x = bot.entity.position.x
    lastFiniteMove.y = bot.entity.position.y
    lastFiniteMove.z = bot.entity.position.z
    if (Number.isFinite(bot.entity.yaw)) lastFiniteMove.yaw = bot.entity.yaw
    if (Number.isFinite(bot.entity.pitch)) lastFiniteMove.pitch = bot.entity.pitch
  }
  return fixed
}

function inArenaEdge (margin = 1.2) {
  if (!bot.entity || !finitePos(bot.entity.position)) return true
  const p = bot.entity.position
  return p.x <= ARENA.minX + margin || p.x >= ARENA.maxX - margin ||
    p.z <= ARENA.minZ + margin || p.z >= ARENA.maxZ - margin
}

function listHostiles (maxDist = 24) {
  if (!bot.entity || !finitePos(bot.entity.position)) return []
  const out = []
  for (const id of Object.keys(bot.entities)) {
    const entity = bot.entities[id]
    if (!entity || entity === bot.entity || !finitePos(entity.position)) continue
    const name = String(entity.name || '').toLowerCase()
    if (!HOSTILES.has(name)) continue
    // Drop dead / unloaded husks so surrounding_count stays honest
    const hpMeta = entity.metadata?.[9]
    if (typeof hpMeta === 'number' && hpMeta <= 0) continue
    if (entity.isValid === false) continue
    const d = bot.entity.position.distanceTo(entity.position)
    if (!Number.isFinite(d) || d > maxDist) continue
    out.push({ entity, dist: d, name })
  }
  out.sort((a, b) => a.dist - b.dist)
  return out
}

function nearestHostile () {
  const list = listHostiles()
  return list.length ? list[0].entity : null
}

/** Opt2 multi-target: score by distance, sticky id, and elevation preference. */
function selectTarget (preferId = null) {
  const list = listHostiles(20)
  if (!list.length) return null
  let best = null
  let bestScore = -1e9
  for (const h of list) {
    let score = 40 - h.dist * 2.2
    if (preferId != null && h.entity.id === preferId) score += 8
    if (selectedTargetId != null && h.entity.id === selectedTargetId) score += 5
    if (bot.entity && Number.isFinite(bot.entity.position.y) && Number.isFinite(h.entity.position.y)) {
      const dy = Math.abs(h.entity.position.y - bot.entity.position.y)
      score -= dy * 1.5
    }
    if (score > bestScore) {
      bestScore = score
      best = h
    }
  }
  return best
}

function clearPathGoal () {
  try { bot.pathfinder.setGoal(null) } catch (_) {}
}

function maybeLimitedPathNear (target, distance) {
  if (!USE_LIMITED_PATHFINDER || !target || !finitePos(target.position)) return false
  if (distance < PATHFINDER_MIN_DIST) {
    clearPathGoal()
    return false
  }
  const now = Date.now()
  if (now - lastPathGoalAt < PATHFINDER_COOLDOWN_MS) return true
  try {
    const { goals } = require('mineflayer-pathfinder')
    // Soft GoalNear — only when far; clear often to avoid Paper invalid-move.
    bot.pathfinder.setGoal(new goals.GoalNear(
      Math.floor(target.position.x),
      Math.floor(target.position.y),
      Math.floor(target.position.z),
      2
    ), true)
    lastPathGoalAt = now
    return true
  } catch (_) {
    clearPathGoal()
    return false
  }
}

function recoverStuck (program) {
  stuckPhase = (stuckPhase + 1) % 4
  if (stuckPhase === 0) {
    bot.setControlState('jump', true)
    setTimeout(() => bot.setControlState('jump', false), 180)
  } else if (stuckPhase === 1) {
    bot.setControlState('left', true)
    bot.setControlState('forward', true)
    setTimeout(() => bot.setControlState('left', false), 280)
  } else if (stuckPhase === 2) {
    bot.setControlState('right', true)
    bot.setControlState('back', true)
    setTimeout(() => {
      bot.setControlState('right', false)
      bot.setControlState('back', false)
    }, 280)
  } else {
    // reverse heading briefly
    if (bot.entity && Number.isFinite(bot.entity.yaw)) {
      safeLook(bot.entity.yaw + Math.PI, 0).catch(() => {})
    }
    bot.setControlState('forward', true)
  }
  console.log(`[fly] stuck_recover phase=${stuckPhase} program=${program}`)
}

function stopManualControls () {
  for (const key of ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']) {
    bot.setControlState(key, false)
  }
}

function ensureSword () {
  const now = Date.now()
  if (now - swordCheckedAt < 4000) return
  swordCheckedAt = now
  try {
    const held = bot.heldItem
    if (held && /sword/i.test(held.name || '')) return
    const sword = bot.inventory.items().find(i => /sword/i.test(i.name || ''))
    if (sword) bot.equip(sword, 'hand').catch(() => {})
  } catch (_) {}
}

function emitTelem () {
  repairEntityPose()
  if (!bot.entity || !finitePos(bot.entity.position)) return
  if (!Number.isFinite(bot.health)) return
  const hostiles = listHostiles(20)
  const hostile = hostiles.length ? hostiles[0].entity : null
  const d = hostiles.length ? hostiles[0].dist : null
  const surrounding = hostiles.filter(h => h.dist <= 8).length
  const p = bot.entity.position
  console.log(
    `[fly] telem hp=${Number(bot.health).toFixed(1)} x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} z=${p.z.toFixed(2)} ` +
    `hostileDist=${d == null || !Number.isFinite(d) ? '-' : d.toFixed(2)} program=${lastProgramName} ` +
    `surrounding=${surrounding}`
  )
}

function status (program) {
  const now = Date.now()
  lastProgramName = program
  if ((program === 'fight' || program === 'flee') &&
      (program !== lastProgram || now - lastChat > 8000)) {
    try { bot.chat(`[fly] ${program}`) } catch (_) {}
    lastChat = now
  }
  lastProgram = program
}

async function safeLookAt (pos) {
  // Avoid bot.lookAt — Mineflayer 4.20 can derive NaN pitch/yaw from entity metadata on Paper 1.20.4.
  if (!finitePos(pos) || !bot.entity || !finitePos(bot.entity.position) || lookBusy) return
  const eyeY = bot.entity.position.y + 1.6
  const dx = pos.x - bot.entity.position.x
  const dy = pos.y - eyeY
  const dz = pos.z - bot.entity.position.z
  const yaw = Math.atan2(-dx, -dz)
  const ground = Math.sqrt(dx * dx + dz * dz) || 0.001
  const pitch = Math.atan2(-dy, ground) // mineflayer pitch: negative looks up
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return
  lookBusy = true
  try {
    await bot.look(yaw, Math.max(-1.5, Math.min(1.5, pitch)), true)
  } catch (_) {}
  lookBusy = false
}

async function safeLook (yaw, pitch = 0) {
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch) || lookBusy) return
  // Skip micro-turns that can thrash look packets into NaN on Paper 1.20.4.
  if (bot.entity && Number.isFinite(bot.entity.yaw)) {
    let dy = Math.abs(yaw - bot.entity.yaw) % (Math.PI * 2)
    if (dy > Math.PI) dy = Math.PI * 2 - dy
    if (dy < 0.08 && Math.abs((bot.entity.pitch || 0) - pitch) < 0.08) return
  }
  lookBusy = true
  try {
    await bot.look(yaw, pitch, true)
  } catch (_) {}
  lookBusy = false
}

let lastHitLogAt = 0
let lastHitEntity = null
function recordHit (entityId, name, dist) {
  const now = Date.now()
  // debounce duplicate damage_event + metadata paths
  if (entityId === lastHitEntity && now - lastHitLogAt < 400) return
  if (now - lastHitLogAt < 200) return
  lastHitLogAt = now
  lastHitEntity = entityId
  console.log(`[fly] hit id=${entityId} name=${name} dist=${Number(dist).toFixed(2)}`)
}

async function executeAction (action) {
  repairEntityPose()
  if (!bot.entity || !finitePos(bot.entity.position)) return
  const preferId = (action.target_id != null) ? action.target_id : selectedTargetId
  const picked = selectTarget(preferId)
  const hostile = picked ? picked.entity : null
  if (hostile) selectedTargetId = hostile.id
  else selectedTargetId = null
  let program = action.program
  if (program === 'turn_left' || program === 'turn_right' || program === 'jump' ||
      program === 'approach_food') {
    program = 'idle'
  }
  status(program)
  ensureSword()

  if (program === 'fight' && hostile) {
    clearPathGoal()
    const distance = bot.entity.position.distanceTo(hostile.position)
    selectedTargetId = hostile.id
    await safeLookAt(hostile.position.offset(0, 1.0, 0))
    if (distance > ATTACK_RANGE) {
      const usingPath = maybeLimitedPathNear(hostile, distance)
      if (!usingPath) {
        bot.setControlState('sprint', distance > 4)
        bot.setControlState('forward', true)
        bot.setControlState('back', false)
        bot.setControlState('jump', false)
        if (inArenaEdge(0.8)) {
          // nudge toward center instead of running into bars forever
          const cx = 208 - bot.entity.position.x
          const cz = 208 - bot.entity.position.z
          await safeLook(Math.atan2(-cx, -cz), 0)
        }
      } else {
        // pathfinder active for far chase — keep sprint soft
        bot.setControlState('sprint', false)
      }
    } else {
      clearPathGoal()
      bot.setControlState('sprint', false)
      bot.setControlState('forward', distance > 2.1)
      bot.setControlState('back', false)
      bot.setControlState('jump', false)
      if (Date.now() - lastAttack >= ATTACK_COOLDOWN_MS) {
        try {
          bot.attack(hostile)
          lastAttack = Date.now()
          lastAttackTarget = hostile.id
          console.log(`[fly] attack dist=${distance.toFixed(2)} id=${hostile.id} name=${hostile.name}`)
        } catch (err) {
          console.error(`[fly] attack failed: ${err.message}`)
        }
      }
    }
  } else if (program === 'flee') {
    clearPathGoal()
    const hostiles = listHostiles(18)
    if (hostiles.length) {
      // Composite flee: average away from nearby threats, prefer closest.
      let ax = 0
      let az = 0
      let wsum = 0
      for (const h of hostiles.slice(0, 4)) {
        const dx = bot.entity.position.x - h.entity.position.x
        const dz = bot.entity.position.z - h.entity.position.z
        const w = 1.0 / Math.max(0.6, h.dist)
        ax += (dx / (Math.hypot(dx, dz) || 0.001)) * w
        az += (dz / (Math.hypot(dx, dz) || 0.001)) * w
        wsum += w
      }
      ax /= wsum || 1
      az /= wsum || 1
      // Lateral bias so flee path is not a straight reverse into a wall.
      const lx = -az * fleeStrafeSign * 0.35
      const lz = ax * fleeStrafeSign * 0.35
      ax += lx
      az += lz
      if (inArenaEdge(1.0)) {
        const cx = 208 - bot.entity.position.x
        const cz = 208 - bot.entity.position.z
        const cl = Math.hypot(cx, cz) || 0.001
        ax = ax * 0.65 + (cx / cl) * 0.35
        az = az * 0.65 + (cz / cl) * 0.35
        fleeStrafeSign *= -1
      }
      const yaw = Math.atan2(-ax, -az)
      await safeLook(yaw, 0)
      bot.setControlState('forward', true)
      bot.setControlState('back', false)
      bot.setControlState('sprint', true)
      bot.setControlState('jump', false)
    } else {
      // No visible hostile: keep moving to avoid idle freeze during low-HP flee.
      if (Date.now() > wanderUntil) {
        wanderYaw = (Math.random() * 2 - 1) * Math.PI
        wanderUntil = Date.now() + 1200
      }
      if (inArenaEdge(1.0)) {
        const cx = 208 - bot.entity.position.x
        const cz = 208 - bot.entity.position.z
        wanderYaw = Math.atan2(-cx, -cz)
      }
      await safeLook(wanderYaw, 0)
      bot.setControlState('forward', true)
      bot.setControlState('sprint', true)
      bot.setControlState('back', false)
      bot.setControlState('jump', false)
    }
  } else {
    clearPathGoal()
    const now = Date.now()
    if (now > wanderUntil) {
      wanderYaw = (Math.random() * 2 - 1) * Math.PI
      wanderUntil = now + WANDER_INTERVAL_MS
    }
    if (inArenaEdge(1.0)) {
      const cx = 208 - bot.entity.position.x
      const cz = 208 - bot.entity.position.z
      wanderYaw = Math.atan2(-cx, -cz)
    }
    await safeLook(wanderYaw, 0)
    bot.setControlState('forward', true)
    bot.setControlState('sprint', false)
    bot.setControlState('back', false)
    bot.setControlState('jump', false)
  }

  // Opt1 stuck recovery: jump / strafe / reverse cycle
  if (lastPos && finitePos(bot.entity.position)) {
    const moved = Math.hypot(bot.entity.position.x - lastPos.x, bot.entity.position.z - lastPos.z)
    if (moved < 0.06 && (program === 'fight' || program === 'flee' || program === 'idle')) {
      if (!stuckSince) stuckSince = Date.now()
      if (Date.now() - stuckSince > STUCK_MS) {
        recoverStuck(program)
        stuckSince = Date.now()
      }
    } else stuckSince = 0
  }
  if (finitePos(bot.entity.position)) {
    lastPos = bot.entity.position.clone()
  }

  const now = Date.now()
  if (program !== lastProgram || now - lastLog > 1800 || program === 'fight' || program === 'flee') {
    const d = hostile ? bot.entity.position.distanceTo(hostile.position).toFixed(2) : '-'
    const score = Number((action.scores || {})[program] || (action.scores || {})[action.program] || 0).toFixed(3)
    console.log(`[fly] decision=${program} hp=${bot.health.toFixed(1)} hostile=${hostile ? hostile.name : 'none'} dist=${d} event=${action.neural_event} reason=${action.reason} score=${score}`)
    lastLog = now
  }
}

const output = readline.createInterface({ input: py.stdout, crlfDelay: Infinity })
output.on('line', line => {
  waiting = false
  let action
  try { action = JSON.parse(line) } catch (err) {
    console.error(`[fly] bad Python output: ${line}`)
    return
  }
  if (action.type === 'error') {
    console.error(`[fly] controller error: ${action.error}`)
    return
  }
  executeAction(action).catch(err => console.error(`[fly] action error: ${err.message}`))
})

let lastHurtFrom = null // {dx,dz,at} Opt4 hurt direction

function sense () {
  if (!spawned || stopping || waiting || !py.stdin.writable) return
  repairEntityPose()
  if (!bot.entity || !finitePos(bot.entity.position)) return
  if (!Number.isFinite(bot.health)) return
  const hostiles = listHostiles(20)
  const picked = selectTarget(selectedTargetId)
  const hostile = picked ? picked.entity : null
  let dist = picked ? picked.dist : null
  if (dist != null && !Number.isFinite(dist)) dist = null
  const surrounding = hostiles.filter(h => h.dist <= 8).length
  let visible = false
  if (hostile && dist != null) {
    const dy = Math.abs(hostile.position.y - bot.entity.position.y)
    visible = dist <= 14 && dy < 3.5
  }
  let hurtDir = null
  if (lastHurtFrom && Date.now() - lastHurtFrom.at < 1200) {
    hurtDir = { dx: lastHurtFrom.dx, dz: lastHurtFrom.dz }
  }
  const obs = {
    type: 'observation',
    t: Date.now(),
    health: bot.health,
    food: bot.food,
    hurt: Date.now() < hurtUntil,
    surrounding_count: surrounding,
    visible: visible,
    hurt_dir: hurtDir,
    hostiles: hostiles.slice(0, 6).map(h => ({
      id: h.entity.id,
      name: h.name,
      distance: Number(h.dist.toFixed(3)),
      dy: Number((h.entity.position.y - bot.entity.position.y).toFixed(2))
    })),
    hostile: (hostile && dist != null)
      ? {
          id: hostile.id,
          name: hostile.name,
          distance: dist,
          dy: Number((hostile.position.y - bot.entity.position.y).toFixed(2))
        }
      : null
  }
  waiting = true
  py.stdin.write(JSON.stringify(obs) + '\n')
}

bot.once('spawn', () => {
  spawned = true
  lastHealth = bot.health
  try {
    const movement = new Movements(bot)
    movement.canDig = false
    bot.pathfinder.setMovements(movement)
    bot.pathfinder.setGoal(null)
  } catch (_) {}
  console.log(`[fly] spawned user=${username} server=${host}:${port} version=1.20.4 python=${python}`)
  senseTimer = setInterval(sense, 350)
  telemTimer = setInterval(emitTelem, 250)
  // Recover if a sense reply is dropped after NaN storms
  setInterval(() => { if (waiting) waiting = false }, 2000)
  sense()
  emitTelem()
  if (duration > 0) setTimeout(() => shutdown(`duration ${duration}s complete`), duration * 1000)
})

bot.on('health', () => {
  if (bot.health < lastHealth) {
    hurtUntil = Date.now() + HURT_WINDOW_MS
    const h = nearestHostile()
    if (h && bot.entity && finitePos(bot.entity.position) && finitePos(h.position)) {
      lastHurtFrom = {
        dx: bot.entity.position.x - h.position.x,
        dz: bot.entity.position.z - h.position.z,
        at: Date.now()
      }
    }
  }
  lastHealth = bot.health
})

// Cheap NaN watchdog: repair before physics emits more corrupt packets.
bot.on('move', () => {
  if (!bot.entity) return
  if (!finitePos(bot.entity.position) || !Number.isFinite(bot.entity.yaw) || !Number.isFinite(bot.entity.pitch)) {
    repairEntityPose()
  }
})

// 1.20.4: entityHurt often does not fire; damage_event does.
bot._client.on('damage_event', (data) => {
  try {
    const eid = data.entityId
    if (!bot.entity || eid === bot.entity.id) {
      hurtUntil = Date.now() + HURT_WINDOW_MS
      const h = nearestHostile()
      if (h && finitePos(bot.entity.position) && finitePos(h.position)) {
        lastHurtFrom = {
          dx: bot.entity.position.x - h.position.x,
          dz: bot.entity.position.z - h.position.z,
          at: Date.now()
        }
      }
      return
    }
    if (Date.now() - lastAttack > 1000) return
    const ent = bot.entities[eid]
    if (!ent) return
    const name = String(ent.name || '').toLowerCase()
    if (!HOSTILES.has(name)) return
    if (!finitePos(bot.entity.position) || !finitePos(ent.position)) return
    const d = bot.entity.position.distanceTo(ent.position)
    if (d <= 4.8) recordHit(eid, name, d)
  } catch (_) {}
})

// Backup: metadata health drops after our swing
const lastHostileHp = new Map()
bot.on('entityUpdate', (entity) => {
  try {
    const name = String(entity.name || '').toLowerCase()
    if (!HOSTILES.has(name)) return
    const hp = entity.metadata?.[9]
    if (typeof hp !== 'number') return
    const prev = lastHostileHp.get(entity.id)
    lastHostileHp.set(entity.id, hp)
    if (prev != null && hp < prev - 0.2 && Date.now() - lastAttack <= 1000) {
      if (bot.entity && finitePos(bot.entity.position) && finitePos(entity.position)) {
        const d = bot.entity.position.distanceTo(entity.position)
        if (d <= 4.8) recordHit(entity.id, name, d)
      }
    }
  } catch (_) {}
})

bot.on('death', () => {
  console.log('[fly] death; awaiting respawn')
  stopManualControls()
  lastAttackTarget = null
})
bot.on('respawn', () => {
  console.log('[fly] respawned')
  lastHealth = bot.health
  stopManualControls()
})
bot.on('kicked', reason => console.error(`[fly] kicked: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`))
bot.on('error', err => console.error(`[fly] bot error: ${err.message}`))
bot.on('end', reason => {
  console.error(`[fly] connection ended: ${reason}`)
  shutdown('connection ended', false)
})

function shutdown (reason, quitBot = true) {
  if (stopping) return
  stopping = true
  console.log(`[fly] stopping: ${reason}`)
  if (senseTimer) clearInterval(senseTimer)
  if (telemTimer) clearInterval(telemTimer)
  if (tickTimer) clearInterval(tickTimer)
  stopManualControls()
  try { bot.pathfinder.setGoal(null) } catch (_) {}
  try { py.stdin.end() } catch (_) {}
  setTimeout(() => { try { py.kill('SIGTERM') } catch (_) {} }, 300)
  if (quitBot && bot._client && bot._client.state !== 'disconnected') {
    try { bot.quit('FlyCraft demo complete') } catch (_) {}
  }
  setTimeout(() => process.exit(0), 700)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
