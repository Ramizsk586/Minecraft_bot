'use strict';

const { Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { sleep } = require('../utils');

const WATER_NAMES = new Set(['water', 'flowing_water']);
const SAFE_GROUND_NAMES = new Set([
  'grass_block', 'dirt', 'coarse_dirt', 'podzol', 'stone', 'cobblestone',
  'sand', 'gravel', 'oak_planks', 'spruce_planks', 'birch_planks',
  'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks',
  'cherry_planks',
]);

function blockAt(bot, pos) {
  try {
    return bot.blockAt(pos);
  } catch {
    return null;
  }
}

function isWaterBlock(block) {
  return !!block && WATER_NAMES.has(block.name);
}

function isWaterlogged(bot) {
  if (!bot?.entity?.position) return false;

  const pos = bot.entity.position.floored();
  const feet = blockAt(bot, pos);
  const head = blockAt(bot, pos.offset(0, 1, 0));
  return isWaterBlock(feet) || isWaterBlock(head);
}

function isDrowningRisk(bot) {
  if (!isWaterlogged(bot)) return false;
  return bot.food <= 0 || bot.oxygenLevel < 12 || bot.health <= 8;
}

function isSafeLanding(bot, pos) {
  const feet = blockAt(bot, pos);
  const head = blockAt(bot, pos.offset(0, 1, 0));
  const below = blockAt(bot, pos.offset(0, -1, 0));

  if (!below || !feet || !head) return false;
  if (isWaterBlock(feet) || isWaterBlock(head)) return false;
  if (feet.name !== 'air' && feet.boundingBox !== 'empty') return false;
  if (head.name !== 'air' && head.boundingBox !== 'empty') return false;

  return below.boundingBox === 'block' || SAFE_GROUND_NAMES.has(below.name);
}

function findNearestDryLand(bot, radius = 12) {
  const center = bot.entity.position.floored();
  let best = null;

  for (let dy = 2; dy >= -3; dy--) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const dist = Math.abs(dx) + Math.abs(dz) + Math.abs(dy) * 1.5;
        if (dist > radius * 1.75) continue;

        const pos = center.offset(dx, dy, dz);
        if (!isSafeLanding(bot, pos)) continue;

        if (!best || dist < best.distance) {
          best = { pos, distance: dist };
        }
      }
    }
  }

  return best?.pos || null;
}

function ensureSwimMovements(bot) {
  if (!bot?.pathfinder) return null;
  const movements = new Movements(bot);
  movements.canSwim = true;
  movements.allowSprinting = true;
  bot.pathfinder.setMovements(movements);
  return movements;
}

async function forceSwimUp(bot, durationMs = 800) {
  bot.setControlState('jump', true);
  bot.setControlState('forward', true);
  if (bot.food > 6) bot.setControlState('sprint', true);
  await sleep(durationMs);
  bot.setControlState('forward', false);
  bot.setControlState('sprint', false);
  bot.setControlState('jump', false);
}

async function swimToSafety(bot, options = {}) {
  if (!isWaterlogged(bot)) {
    return { handled: false, reason: 'not_in_water' };
  }

  if (bot._combatState?.target) {
    await forceSwimUp(bot, 500);
    return { handled: true, reason: 'stayed_afloat_during_combat' };
  }

  const movement = ensureSwimMovements(bot);
  const dryLand = findNearestDryLand(bot, options.radius || 14);

  bot._swimState = {
    active: true,
    target: dryLand ? dryLand.clone?.() || new Vec3(dryLand.x, dryLand.y, dryLand.z) : null,
    startedAt: Date.now(),
    emergency: isDrowningRisk(bot),
  };

  if (!dryLand) {
    await forceSwimUp(bot, bot.oxygenLevel < 10 ? 1200 : 700);
    return { handled: true, reason: 'surfacing_without_land' };
  }

  try {
    bot.setControlState('jump', true);
    if (bot.food > 6) bot.setControlState('sprint', true);
    await bot.pathfinder.goto(new goals.GoalNear(dryLand.x, dryLand.y, dryLand.z, 1));
  } catch (err) {
    await forceSwimUp(bot, 900);
    return { handled: true, reason: `path_retry:${err.message}` };
  } finally {
    bot.setControlState('jump', false);
    bot.setControlState('sprint', false);
    if (movement) {
      movement.canSwim = true;
    }
  }

  return {
    handled: true,
    reason: isWaterlogged(bot) ? 'moved_toward_land' : 'reached_safety',
    target: dryLand,
  };
}

function clearSwimState(bot) {
  if (!bot) return;
  bot.setControlState('jump', false);
  bot.setControlState('sprint', false);
  bot._swimState = {
    active: false,
    target: null,
    startedAt: 0,
    emergency: false,
  };
}

module.exports = {
  isWaterlogged,
  isDrowningRisk,
  findNearestDryLand,
  ensureSwimMovements,
  swimToSafety,
  clearSwimState,
};
