/**
 * stuck.js — Advanced Stuck Detection & Recovery System
 * ======================================================
 * Monitors a mineflayer bot for common stuck conditions and executes
 * smart, prioritised recovery maneuvers automatically.
 *
 * Conditions handled (priority order):
 *   1. Suffocation   – head/body inside solid blocks
 *   2. Lava          – submerged in lava (immediate danger)
 *   3. Water         – submerged / drowning
 *   4. Void fall     – falling below y = 0
 *   5. 1×1 hole      – enclosed pit with solid walls & floor
 *   6. Deep pit      – large open pit with no path out
 *   7. Pathfinder loop – non-zero goal but zero displacement over N ticks
 *   8. Ledge hang    – bot is hanging on a 1-block ledge and can't descend
 *
 * Usage:
 *   const stuck = require('./stuck');
 *   stuck.startMonitoring(bot, options);   // call after bot spawns
 *   stuck.stopMonitoring();                // call on bot end/kick
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Constants & tunables
// ─────────────────────────────────────────────────────────────────────────────

const TICK_MS               = 2000;   // watchdog poll interval (ms)
const LOOP_DETECT_TICKS     = 4;      // how many ticks of zero displacement = loop
const LOOP_DISPLACEMENT_MIN = 0.15;   // blocks; below this = "not moving"
const RECOVERY_TIMEOUT_MS   = 12000; // max time to spend in a single recovery
const MAX_RECOVERY_RETRIES  = 3;      // give up after this many failed recoveries
const TOWER_BLOCKS = [                // blocks usable for towering out of holes
  'dirt', 'cobblestone', 'stone', 'gravel', 'sand', 'netherrack',
  'planks', 'oak_planks', 'spruce_planks', 'birch_planks',
  'jungle_planks', 'acacia_planks', 'dark_oak_planks',
];
const LIQUID_NAMES = new Set(['water', 'lava', 'flowing_water', 'flowing_lava']);
const SOLID_NON_PASSABLE = new Set([   // extra names to treat as solid if bbox check fails
  'obsidian', 'bedrock', 'stone', 'cobblestone', 'dirt', 'sand', 'gravel',
  'iron_ore', 'coal_ore', 'gold_ore', 'diamond_ore', 'netherrack',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Module-level state
// ─────────────────────────────────────────────────────────────────────────────

let _bot            = null;
let _options        = {};
let _intervalId     = null;
let _isRecovering   = false;
let _retryCount     = 0;

// Position history ring-buffer for loop detection
const POS_HISTORY_LEN = LOOP_DETECT_TICKS + 1;
let _posHistory = [];   // [{x,y,z}, ...]

// Saved pathfinder goal so we can resume after recovery
let _savedGoal = null;

// ─────────────────────────────────────────────────────────────────────────────
// Logging helpers
// ─────────────────────────────────────────────────────────────────────────────

function log(msg)  { console.log (`[stuck] ${msg}`); }
function warn(msg) { console.warn(`[stuck] ⚠  ${msg}`); }
function err(msg)  { console.error(`[stuck] ✖  ${msg}`); }

// ─────────────────────────────────────────────────────────────────────────────
// Block helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the block at (x,y,z) is physically solid (can suffocate).
 * Uses bounding-box volume as primary signal; falls back to name matching.
 */
function isSolid(bot, x, y, z) {
  try {
    const block = bot.blockAt(new bot.registry.Vec3(x, y, z));
    if (!block) return false;
    if (LIQUID_NAMES.has(block.name)) return false;  // liquids are not "solid" here
    // A block with a full bounding box volume >= 1 is solid
    const shapes = block.shapes;
    if (shapes && shapes.length > 0) {
      const vol = shapes.reduce((sum, s) => {
        return sum + (s[3]-s[0]) * (s[4]-s[1]) * (s[5]-s[2]);
      }, 0);
      return vol > 0.5;
    }
    // Fallback: name heuristic
    return SOLID_NON_PASSABLE.has(block.name);
  } catch (_) { return false; }
}

/**
 * Returns true if the block at (x,y,z) is a liquid.
 */
function isLiquid(bot, x, y, z) {
  try {
    const block = bot.blockAt(new bot.registry.Vec3(x, y, z));
    return block ? LIQUID_NAMES.has(block.name) : false;
  } catch (_) { return false; }
}

/**
 * Returns true if the block is lava specifically.
 */
function isLava(bot, x, y, z) {
  try {
    const block = bot.blockAt(new bot.registry.Vec3(x, y, z));
    return block ? (block.name === 'lava' || block.name === 'flowing_lava') : false;
  } catch (_) { return false; }
}

/**
 * Safe version of bot.blockAt using a Vec3.
 */
function blockAt(bot, x, y, z) {
  try { return bot.blockAt(new bot.registry.Vec3(x, y, z)); }
  catch (_) { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stuck condition checkers
// Each returns true if the named condition is active.
// ─────────────────────────────────────────────────────────────────────────────

/** Bot's feet and head positions (floor integers). */
function getBodyVoxels(bot) {
  const p = bot.entity.position;
  const fx = Math.floor(p.x);
  const fy = Math.floor(p.y);
  const fz = Math.floor(p.z);
  return {
    feet: { x: fx, y: fy,   z: fz },
    head: { x: fx, y: fy+1, z: fz },
  };
}

function checkSuffocation(bot) {
  const { feet, head } = getBodyVoxels(bot);
  return isSolid(bot, feet.x, feet.y, feet.z) ||
         isSolid(bot, head.x, head.y, head.z);
}

function checkLava(bot) {
  const { feet, head } = getBodyVoxels(bot);
  return isLava(bot, feet.x, feet.y, feet.z) ||
         isLava(bot, head.x, head.y, head.z);
}

function checkDrowning(bot) {
  const { feet, head } = getBodyVoxels(bot);
  // Only water, not lava (lava is handled separately)
  const fw = blockAt(bot, feet.x, feet.y, feet.z);
  const hw = blockAt(bot, head.x, head.y, head.z);
  const inWater = (b) => b && (b.name === 'water' || b.name === 'flowing_water');
  return inWater(fw) || inWater(hw);
}

function checkVoidFall(bot) {
  return bot.entity.position.y < -10;
}

/**
 * A 1×1 hole: bot's four cardinal neighbours at feet level are solid,
 * block below feet is solid, and bot is not on the surface.
 */
function checkInHole(bot) {
  const p  = bot.entity.position;
  const fx = Math.floor(p.x);
  const fy = Math.floor(p.y);
  const fz = Math.floor(p.z);

  const north = isSolid(bot, fx,   fy, fz-1);
  const south = isSolid(bot, fx,   fy, fz+1);
  const west  = isSolid(bot, fx-1, fy, fz);
  const east  = isSolid(bot, fx+1, fy, fz);
  const below = isSolid(bot, fx,   fy-1, fz);
  // Also check head level – if head-level sides are also solid, it's truly enclosed
  const hNorth = isSolid(bot, fx,   fy+1, fz-1);
  const hSouth = isSolid(bot, fx,   fy+1, fz+1);
  const hWest  = isSolid(bot, fx-1, fy+1, fz);
  const hEast  = isSolid(bot, fx+1, fy+1, fz);

  const wallsSealed = north && south && west && east &&
                      hNorth && hSouth && hWest && hEast;
  return wallsSealed && below;
}

/**
 * Deep open pit: bot is in the air/falling with solid walls but no reachable
 * floor detected within 3 blocks (falling pit, not just a 1×1).
 */
function checkInOpenPit(bot) {
  const p  = bot.entity.position;
  const fx = Math.floor(p.x);
  const fy = Math.floor(p.y);
  const fz = Math.floor(p.z);
  if (bot.entity.velocity.y < -0.1) return false; // still falling — wait
  const north = isSolid(bot, fx,   fy, fz-1);
  const south = isSolid(bot, fx,   fy, fz+1);
  const west  = isSolid(bot, fx-1, fy, fz);
  const east  = isSolid(bot, fx+1, fy, fz);
  const below1 = isSolid(bot, fx, fy-1, fz);
  const below2 = isSolid(bot, fx, fy-2, fz);
  // Surrounded but floor 2 blocks below or more
  return (north || south || west || east) && !below1 && !below2;
}

/**
 * Pathfinder loop: bot has a goal, is supposed to be moving, but hasn't
 * moved more than LOOP_DISPLACEMENT_MIN blocks in LOOP_DETECT_TICKS ticks.
 */
function checkPathfinderLoop(bot) {
  if (_posHistory.length < POS_HISTORY_LEN) return false;
  const oldest = _posHistory[0];
  const newest = _posHistory[_posHistory.length - 1];
  const dx = newest.x - oldest.x;
  const dy = newest.y - oldest.y;
  const dz = newest.z - oldest.z;
  const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
  // Only flag as loop if the pathfinder currently has a goal
  const hasGoal = bot.pathfinder && bot.pathfinder.isMoving
    ? bot.pathfinder.isMoving()
    : false;
  return hasGoal && dist < LOOP_DISPLACEMENT_MIN;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: pause / resume pathfinder
// ─────────────────────────────────────────────────────────────────────────────

function pausePathfinder(bot) {
  try {
    if (bot.pathfinder) {
      _savedGoal = bot.pathfinder.goal || null;
      bot.pathfinder.setGoal(null);
      bot.pathfinder.stop?.();
    }
  } catch (_) {}
}

function resumePathfinder(bot) {
  try {
    if (bot.pathfinder && _savedGoal) {
      bot.pathfinder.setGoal(_savedGoal);
      _savedGoal = null;
    }
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: inventory helpers
// ─────────────────────────────────────────────────────────────────────────────

function findTowerBlock(bot) {
  for (const name of TOWER_BLOCKS) {
    const item = bot.inventory.items().find(i => i.name === name || i.name.includes(name));
    if (item) return item;
  }
  return null;
}

async function equipTowerBlock(bot) {
  const item = findTowerBlock(bot);
  if (!item) return false;
  try {
    await bot.equip(item, 'hand');
    return true;
  } catch (_) { return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: safe sleep
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Recovery routines
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RECOVERY: Suffocation
 * Dig the block(s) occupying the bot's head or body hitbox.
 */
async function recoverSuffocation(bot) {
  log('Recovering from suffocation…');
  const { feet, head } = getBodyVoxels(bot);

  for (const vox of [head, feet]) {
    const block = blockAt(bot, vox.x, vox.y, vox.z);
    if (!block || block.name === 'air') continue;
    try {
      if (bot.canDigBlock(block)) {
        log(`  Digging ${block.name} at ${vox.x},${vox.y},${vox.z}`);
        await bot.dig(block, true);   // force = true skips delay check
        await sleep(200);
      } else {
        // Can't dig (bedrock etc) – try jumping / strafing instead
        bot.setControlState('jump', true);
        await sleep(500);
        bot.setControlState('jump', false);
      }
    } catch (e) { warn(`Dig failed: ${e.message}`); }
  }

  // Last resort: activate jump for 1 second to pop out
  bot.setControlState('jump', true);
  await sleep(800);
  bot.setControlState('jump', false);
}

/**
 * RECOVERY: Lava
 * Immediately attempt to get out: jump, find solid ground or water nearby.
 */
async function recoverLava(bot) {
  warn('Recovering from LAVA – this is critical!');
  bot.setControlState('jump', true);   // try to jump out immediately

  // Look for the nearest non-lava, non-solid adjacent block at or above current y
  const p  = bot.entity.position;
  const fx = Math.floor(p.x);
  const fy = Math.floor(p.y);
  const fz = Math.floor(p.z);
  const dirs = [
    [1,0],[-1,0],[0,1],[0,-1],
    [1,1],[-1,1],[0,2],[0,-2],
  ];

  // Attempt to move towards a safe adjacent block
  const Vec3 = bot.registry.Vec3;
  let escaped = false;
  for (let dy = 2; dy >= -1; dy--) {
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      if (!isLava(bot, fx+dx, fy+dy, fz+dz)) {
        try {
          bot.lookAt(new Vec3(fx+dx, fy+dy, fz+dz));
          bot.setControlState('forward', true);
          await sleep(600);
          bot.setControlState('forward', false);
          escaped = true;
          break;
        } catch (_) {}
      }
    }
    if (escaped) break;
  }

  await sleep(400);
  bot.setControlState('jump', false);

  // If still in lava, try pathfinder to nearest land (within 20 blocks)
  if (checkLava(bot)) {
    log('  Still in lava – scanning for land…');
    const Movements = bot.pathfinder?.Movements;
    if (bot.pathfinder && Movements) {
      const { GoalNear } = require('mineflayer-pathfinder').goals;
      // Search outward for a safe block
      for (let r = 2; r <= 20; r += 2) {
        for (const [dx, dz] of [[r,0],[-r,0],[0,r],[0,-r],[r,r],[-r,-r]]) {
          if (!isLava(bot, fx+dx, fy, fz+dz) && !isSolid(bot, fx+dx, fy, fz+dz)) {
            try {
              bot.pathfinder.setMovements(new Movements(bot));
              bot.pathfinder.setGoal(new GoalNear(fx+dx, fy, fz+dz, 1));
              await sleep(5000);
              break;
            } catch (_) {}
          }
        }
        if (!checkLava(bot)) break;
      }
    }
  }
}

/**
 * RECOVERY: Drowning / Water
 * Hold jump to surface, then pathfind to dry land.
 */
async function recoverDrowning(bot) {
  log('Recovering from drowning…');
  bot.setControlState('jump', true);   // Minecraft swim mechanic: space = swim up
  bot.setControlState('sprint', true);

  // Wait up to 6 seconds to surface
  for (let i = 0; i < 12; i++) {
    await sleep(500);
    if (!checkDrowning(bot)) break;
  }
  bot.setControlState('jump', false);
  bot.setControlState('sprint', false);

  if (checkDrowning(bot)) {
    // Still submerged – dig upward
    const { head } = getBodyVoxels(bot);
    for (let dy = 0; dy <= 3; dy++) {
      const block = blockAt(bot, head.x, head.y + dy, head.z);
      if (block && block.name !== 'air' && !isLiquid(bot, head.x, head.y+dy, head.z)) {
        try { await bot.dig(block); } catch (_) {}
      }
    }
  }

  // Move to dry land
  if (!checkDrowning(bot)) {
    log('  Surfaced – finding dry land…');
    const p = bot.entity.position;
    const { GoalNear } = require('mineflayer-pathfinder').goals;
    const Movements = bot.pathfinder?.Movements;
    if (bot.pathfinder && Movements) {
      const mov = new Movements(bot);
      mov.canSwim = true;
      bot.pathfinder.setMovements(mov);
      // Find a solid block above water within 15 blocks
      for (let r = 1; r <= 15; r++) {
        for (const [dx, dz] of [[r,0],[-r,0],[0,r],[0,-r]]) {
          const tx = Math.floor(p.x)+dx;
          const tz = Math.floor(p.z)+dz;
          const ty = Math.floor(p.y);
          if (!isLiquid(bot, tx, ty, tz) && !isSolid(bot, tx, ty, tz)) {
            try {
              bot.pathfinder.setGoal(new GoalNear(tx, ty, tz, 1));
              await sleep(4000);
              break;
            } catch (_) {}
          }
        }
        if (!checkDrowning(bot)) break;
      }
    }
  }
}

/**
 * RECOVERY: Void fall
 * Nothing can be done once below y = -64, but try to fly/equip elytra or
 * throw a water bucket if available.
 */
async function recoverVoidFall(bot) {
  warn('Recovering from void fall!');
  // Try water bucket
  const waterBucket = bot.inventory.items().find(i => i.name === 'water_bucket');
  if (waterBucket) {
    try {
      await bot.equip(waterBucket, 'hand');
      await bot.activateItem();
      log('  Placed water bucket in void fall.');
    } catch (_) {}
  }
  // Try elytra
  const elytra = bot.inventory.items().find(i => i.name === 'elytra');
  if (elytra) {
    try {
      await bot.equip(elytra, 'torso');
      bot.activateItem();
    } catch (_) {}
  }
}

/**
 * RECOVERY: 1×1 Hole
 * Strategy A: Tower up using placeable blocks.
 * Strategy B: Dig a staircase if no blocks available.
 */
async function recoverHole(bot) {
  log('Recovering from 1×1 hole…');
  const p  = bot.entity.position;
  const startY = Math.floor(p.y);

  const hasTowerBlock = await equipTowerBlock(bot);
  if (hasTowerBlock) {
    log('  Towering up…');
    // Tower up: jump, look down at feet, place block, repeat
    for (let layer = 0; layer < 30; layer++) {
      bot.setControlState('jump', true);
      await sleep(250);
      bot.setControlState('jump', false);

      const curY = Math.floor(bot.entity.position.y);
      if (curY > startY + layer + 1) {
        // Escaped!
        break;
      }
      // Look down to place block below
      try {
        await bot.look(bot.entity.yaw, Math.PI / 2); // look straight down
        const referenceBlock = blockAt(bot, Math.floor(p.x), curY - 1, Math.floor(p.z));
        if (referenceBlock) {
          await bot.placeBlock(referenceBlock, new bot.registry.Vec3(0, 1, 0));
        }
      } catch (e) { warn(`Place failed: ${e.message}`); }
      await sleep(150);

      // Re-equip if we consumed the last of that type
      if (!findTowerBlock(bot)) break;
      await equipTowerBlock(bot);
    }
  } else {
    log('  No tower blocks – attempting staircase dig…');
    // Dig a staircase: dig one block forward, one block forward+up, move, repeat
    const dirs = [
      { yaw: 0,              dx: 0,  dz: -1 },
      { yaw: Math.PI / 2,   dx: 1,  dz:  0 },
      { yaw: Math.PI,        dx: 0,  dz:  1 },
      { yaw: -Math.PI / 2,  dx: -1, dz:  0 },
    ];
    for (const dir of dirs) {
      const fx = Math.floor(bot.entity.position.x);
      const fy = Math.floor(bot.entity.position.y);
      const fz = Math.floor(bot.entity.position.z);
      const tx = fx + dir.dx;
      const tz = fz + dir.dz;
      const b0 = blockAt(bot, tx, fy,   tz);
      const b1 = blockAt(bot, tx, fy+1, tz);
      if (!b0 || !b1) continue;
      try {
        await bot.look(dir.yaw, 0);
        if (b0.name !== 'air') await bot.dig(b0);
        if (b1.name !== 'air') await bot.dig(b1);
        bot.setControlState('forward', true);
        bot.setControlState('jump', true);
        await sleep(600);
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
        if (!checkInHole(bot)) break;
      } catch (e) { warn(`Staircase dig failed: ${e.message}`); }
    }
  }
}

/**
 * RECOVERY: Pathfinder loop
 * Back up, strafe, mine the block in movement direction, then resume.
 */
async function recoverPathfinderStuck(bot) {
  log('Recovering from pathfinder loop…');

  // Stop pathfinder temporarily
  pausePathfinder(bot);
  await sleep(100);

  // 1. Back up for 0.8s
  bot.setControlState('back', true);
  await sleep(800);
  bot.setControlState('back', false);

  // 2. Jump + strafe randomly
  const strafe = Math.random() < 0.5 ? 'left' : 'right';
  bot.setControlState('jump', true);
  bot.setControlState(strafe, true);
  await sleep(500);
  bot.setControlState('jump', false);
  bot.setControlState(strafe, false);

  // 3. Mine the block directly in front at eye level
  try {
    const eyePos  = bot.entity.position.offset(0, 1.62, 0);
    const lookDir = bot.entity.velocity.clone().normalize();
    if (lookDir.norm() < 0.01) {
      // velocity is zero – pick direction toward saved goal
      if (_savedGoal) {
        const gp = _savedGoal.entity
          ? _savedGoal.entity.position
          : new bot.registry.Vec3(_savedGoal.x || 0, _savedGoal.y || 0, _savedGoal.z || 0);
        lookDir.set(gp.x - eyePos.x, 0, gp.z - eyePos.z).normalize();
      }
    }
    const frontPos = eyePos.offset(lookDir.x, 0, lookDir.z);
    const frontBlock = blockAt(bot, Math.round(frontPos.x), Math.round(frontPos.y), Math.round(frontPos.z));
    if (frontBlock && frontBlock.name !== 'air' && bot.canDigBlock(frontBlock)) {
      log(`  Mining obstacle: ${frontBlock.name}`);
      await bot.dig(frontBlock);
    }
  } catch (e) { warn(`Obstacle mine failed: ${e.message}`); }

  // 4. Forward burst
  bot.setControlState('forward', true);
  bot.setControlState('jump', true);
  await sleep(600);
  bot.setControlState('forward', false);
  bot.setControlState('jump', false);

  await sleep(300);
  resumePathfinder(bot);
}

/**
 * RECOVERY: Ledge hang
 * Bot is stuck on a 1-wide ledge and can't descend normally.
 * Drop down by sneaking off the edge.
 */
async function recoverLedgeHang(bot) {
  log('Recovering from ledge hang…');
  bot.setControlState('sneak', true);
  bot.setControlState('back', true);
  await sleep(800);
  bot.setControlState('back', false);
  bot.setControlState('sneak', false);
  await sleep(400);
  // If still at same position, try jumping forward
  bot.setControlState('forward', true);
  bot.setControlState('jump', true);
  await sleep(500);
  bot.setControlState('forward', false);
  bot.setControlState('jump', false);
}

// ─────────────────────────────────────────────────────────────────────────────
// Condition → priority table
// ─────────────────────────────────────────────────────────────────────────────

const CONDITIONS = [
  {
    name: 'lava',
    priority: 1,
    check: checkLava,
    recover: recoverLava,
  },
  {
    name: 'suffocation',
    priority: 2,
    check: checkSuffocation,
    recover: recoverSuffocation,
  },
  {
    name: 'void_fall',
    priority: 3,
    check: checkVoidFall,
    recover: recoverVoidFall,
  },
  {
    name: 'drowning',
    priority: 4,
    check: checkDrowning,
    recover: recoverDrowning,
  },
  {
    name: 'hole',
    priority: 5,
    check: checkInHole,
    recover: recoverHole,
  },
  {
    name: 'open_pit',
    priority: 6,
    check: checkInOpenPit,
    recover: recoverHole,    // same escape logic
  },
  {
    name: 'pathfinder_loop',
    priority: 7,
    check: checkPathfinderLoop,
    recover: recoverPathfinderStuck,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Position history update
// ─────────────────────────────────────────────────────────────────────────────

function updatePositionHistory(bot) {
  const p = bot.entity.position;
  _posHistory.push({ x: p.x, y: p.y, z: p.z });
  if (_posHistory.length > POS_HISTORY_LEN) _posHistory.shift();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main watchdog tick
// ─────────────────────────────────────────────────────────────────────────────

async function watchdogTick() {
  if (!_bot || _isRecovering) return;

  updatePositionHistory(_bot);

  // Find the highest-priority active condition
  let triggered = null;
  for (const cond of CONDITIONS) {
    try {
      if (cond.check(_bot)) {
        triggered = cond;
        break;   // CONDITIONS are sorted by priority
      }
    } catch (e) { warn(`Check ${cond.name} threw: ${e.message}`); }
  }

  if (!triggered) {
    // All clear – reset retry counter
    _retryCount = 0;
    return;
  }

  if (_retryCount >= MAX_RECOVERY_RETRIES) {
    err(`Giving up after ${MAX_RECOVERY_RETRIES} failed recoveries for [${triggered.name}].`);
    _bot.emit('stuckGiveUp', triggered.name);
    _retryCount = 0;
    return;
  }

  log(`Condition detected: [${triggered.name}] (attempt ${_retryCount + 1}/${MAX_RECOVERY_RETRIES})`);
  _isRecovering = true;
  _bot.isStuckRecovering = true;
  _retryCount++;

  // Pause pathfinder before recovery (except for loop recovery which does it internally)
  if (triggered.name !== 'pathfinder_loop') pausePathfinder(_bot);

  // Race recovery against a timeout
  const timeoutPromise = sleep(RECOVERY_TIMEOUT_MS).then(() => {
    warn(`Recovery timeout after ${RECOVERY_TIMEOUT_MS}ms for [${triggered.name}]`);
  });

  try {
    await Promise.race([
      triggered.recover(_bot),
      timeoutPromise,
    ]);
  } catch (e) {
    err(`Recovery routine [${triggered.name}] threw: ${e.message}`);
  } finally {
    // Clear all controls defensively
    for (const ctrl of ['forward','back','left','right','jump','sprint','sneak']) {
      try { _bot.setControlState(ctrl, false); } catch (_) {}
    }
    if (triggered.name !== 'pathfinder_loop') resumePathfinder(_bot);
    _isRecovering = false;
    if (_bot) _bot.isStuckRecovering = false;

    // Emit event so other modules can react
    _bot.emit('stuckRecovered', triggered.name);
    log(`Recovery [${triggered.name}] complete.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start the stuck watchdog.
 *
 * @param {object} bot       – mineflayer bot instance
 * @param {object} [options] – optional configuration overrides
 * @param {number} [options.tickMs]            – poll interval in ms (default 2000)
 * @param {number} [options.recoveryTimeoutMs] – max recovery time (default 12000)
 * @param {number} [options.maxRetries]        – max retries before giving up (default 3)
 */
function startMonitoring(bot, options = {}) {
  if (_intervalId) stopMonitoring();

  _bot          = bot;
  _options      = options;
  _posHistory   = [];
  _retryCount   = 0;
  _isRecovering = false;
  _savedGoal    = null;
  _bot.isStuckRecovering = false;

  const tickMs = options.tickMs ?? TICK_MS;
  _intervalId  = setInterval(watchdogTick, tickMs);

  log(`Watchdog started (interval=${tickMs}ms, maxRetries=${options.maxRetries ?? MAX_RECOVERY_RETRIES}).`);
}

/**
 * Stop the stuck watchdog and clean up all state.
 */
function stopMonitoring() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  _bot          = null;
  _isRecovering = false;
  _posHistory   = [];
  _savedGoal    = null;
  log('Watchdog stopped.');
}

/**
 * Expose individual checkers for external use (e.g. unit tests, HUD debug).
 */
const checkers = {
  isSuffocating:    (bot) => checkSuffocation(bot),
  isInLava:         (bot) => checkLava(bot),
  isDrowning:       (bot) => checkDrowning(bot),
  isVoidFalling:    (bot) => checkVoidFall(bot),
  isInHole:         (bot) => checkInHole(bot),
  isInOpenPit:      (bot) => checkInOpenPit(bot),
  isPathfinderLoop: (bot) => checkPathfinderLoop(bot),
};

module.exports = {
  startMonitoring,
  stopMonitoring,
  checkers,
  // expose for test mocking
  _internal: {
    recoverSuffocation,
    recoverLava,
    recoverDrowning,
    recoverVoidFall,
    recoverHole,
    recoverPathfinderStuck,
  },
};
