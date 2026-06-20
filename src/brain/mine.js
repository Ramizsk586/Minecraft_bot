// Brain: Mine Module
// Local mining and woodcutting intelligence with built-in threat scanning,
// tool progression, retreat logic, and autonomous gather behavior.

const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { sleep, findBestTool } = require('../utils');

const attackBrain = require('./attack');
const defanceBrain = require('./defance');
const craftBrain = require('./craft');
const libraryData = require('../library/data');

const LOG_TYPES = [
  'oak_log', 'spruce_log', 'birch_log', 'jungle_log',
  'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
];

const SOFT_BLOCKS = new Set([
  'grass_block', 'dirt', 'coarse_dirt', 'podzol', 'mud', 'sand', 'red_sand',
  'gravel', 'clay', 'snow', 'snow_block', 'oak_log', 'spruce_log', 'birch_log',
  'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
  'oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves',
  'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves',
  'grass', 'tall_grass',
]);

const THREAT_LEVELS = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const DEFAULT_STATE = {
  active: false,
  mode: 'idle',
  preferredBlock: 'stone',
  lastThreatReportAt: 0,
  busy: false,
};

let _mineHandle = null;

function ensureState(bot) {
  if (!bot._mineBrainState) {
    bot._mineBrainState = { ...DEFAULT_STATE };
  }
  return bot._mineBrainState;
}

function countHostiles(bot, options = {}) {
  const owner = options.owner?.toLowerCase();

  return Object.values(bot.entities)
    .filter(entity => {
      if (!entity || !entity.isValid) return false;
      if (entity.id === bot.entity.id) return false;
      if (owner && entity.username?.toLowerCase() === owner) return false;
      if (entity.type === 'player') return true;
      const info = libraryData.getMobInfo(entity.name || '');
      return !!info && (info.type === 'hostile' || info.threat >= 2);
    });
}

function scoreThreat(bot, entity) {
  const distance = bot.entity.position.distanceTo(entity.position);
  const base = entity.type === 'player' ? 4 : libraryData.getMobThreat(entity.name || '', 1);
  const distanceBonus = distance <= 3 ? 3 : distance <= 6 ? 2 : distance <= 10 ? 1 : 0;
  const verticalPenalty = Math.abs(entity.position.y - bot.entity.position.y) > 3 ? 1 : 0;
  return Math.max(0, base + distanceBonus - verticalPenalty);
}

function scanThreatLevel(bot, options = {}) {
  const hostiles = countHostiles(bot, options)
    .map(entity => ({
      entity,
      name: attackBrain.describeEntity(entity),
      distance: bot.entity.position.distanceTo(entity.position),
      score: scoreThreat(bot, entity),
    }))
    .filter(entry => entry.distance <= 18)
    .sort((a, b) => b.score - a.score);

  const totalScore = hostiles.reduce((sum, entry) => sum + entry.score, 0);
  const closeThreats = hostiles.filter(entry => entry.distance <= 6).length;

  let level = 'none';
  if (totalScore >= 12 || closeThreats >= 3 || bot.health <= 8) {
    level = 'high';
  } else if (totalScore >= 6 || closeThreats >= 2) {
    level = 'medium';
  } else if (totalScore > 0) {
    level = 'low';
  }

  return {
    level,
    totalScore,
    closeThreats,
    hostiles,
    primaryThreat: hostiles[0]?.entity || null,
  };
}

function hasTool(bot, type) {
  return bot.inventory.items().some(item => item.name.endsWith(`_${type}`));
}

function bestTierName(bot, type) {
  const tiers = ['netherite', 'diamond', 'iron', 'stone', 'wooden', 'golden'];
  for (const tier of tiers) {
    const found = bot.inventory.items().find(item => item.name === `${tier}_${type}`);
    if (found) return found.name;
  }
  return null;
}

function findTreeRoot(bot) {
  const ids = LOG_TYPES
    .map(name => bot.registry.blocksByName[name]?.id)
    .filter(id => id != null);

  const nearestLog = bot.findBlock({ matching: ids, maxDistance: 48 });
  if (!nearestLog) return null;

  let pos = nearestLog.position.clone();
  while (true) {
    const below = bot.blockAt(pos.offset(0, -1, 0));
    if (!below || !LOG_TYPES.includes(below.name)) break;
    pos = pos.offset(0, -1, 0);
  }

  return bot.blockAt(pos);
}

function findConnectedLogs(bot, rootBlock) {
  if (!rootBlock) return [];

  const visited = new Set();
  const queue = [rootBlock.position];
  const found = [];

  while (queue.length > 0 && found.length < 48) {
    const pos = queue.shift();
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const block = bot.blockAt(pos);
    if (!block || !LOG_TYPES.includes(block.name)) continue;
    found.push(block);

    const offsets = [
      new Vec3(0, 1, 0), new Vec3(0, -1, 0),
      new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1), new Vec3(0, 0, -1),
      new Vec3(1, 1, 0), new Vec3(-1, 1, 0),
      new Vec3(0, 1, 1), new Vec3(0, 1, -1),
    ];

    for (const offset of offsets) {
      queue.push(pos.plus(offset));
    }
  }

  return found.sort((a, b) => a.position.y - b.position.y);
}

function canMineQuickly(bot, block) {
  if (!block) return false;
  if (SOFT_BLOCKS.has(block.name)) return true;

  try {
    const bestTool = findBestTool(bot, block.name);
    const held = bot.heldItem;
    const digTime = bot.digTime(block);
    if (bestTool) return digTime <= 1600;
    return digTime <= 900;
  } catch {
    return SOFT_BLOCKS.has(block.name);
  }
}

async function equipToolFor(bot, blockName) {
  const tool = findBestTool(bot, blockName);
  if (!tool) return null;

  try {
    await bot.equip(tool, 'hand');
    return tool;
  } catch {
    return null;
  }
}

async function retreatFromThreats(bot, report) {
  const primary = report.primaryThreat;
  if (!primary) return false;

  const away = bot.entity.position.minus(primary.position);
  const dir = away.norm() > 0 ? away.scaled(1 / away.norm()) : new Vec3(1, 0, 0);
  const target = bot.entity.position.offset(dir.x * 8, 0, dir.z * 8);

  bot.chat(`Too many threats. Repositioning before re-engaging.`);

  try {
    await bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 2));
    return true;
  } catch (err) {
    console.log(`Brain:Mine retreat error: ${err.message}`);
    return false;
  }
}

async function fightOneByOne(bot, report, options = {}) {
  const threats = report.hostiles
    .filter(entry => entry.distance <= 18)
    .sort((a, b) => a.distance - b.distance);

  if (threats.length === 0) return false;

  try {
    await craftBrain.ensureWeapon(bot);
  } catch {}

  for (const entry of threats.slice(0, 2)) {
    if (bot.health <= 5) break;
    await attackBrain.startAttack(bot, entry.entity, options);
    await sleep(1500);
  }

  return true;
}

async function ensureProgression(bot) {
  const results = [];
  const logs = craftBrain.countAnyOf(bot, craftBrain.LOG_TYPES);
  const planks = craftBrain.countAnyOf(bot, craftBrain.PLANK_TYPES);
  const sticks = craftBrain.countItem(bot, 'stick');
  const hasTable = craftBrain.countItem(bot, 'crafting_table') > 0 ||
    !!bot.findBlock({ matching: bot.registry.blocksByName['crafting_table']?.id, maxDistance: 12 });

  if (logs > 0 && planks < 4) {
    const batches = Math.min(logs, 2);
    const crafted = await craftBrain.craft(bot, 'planks', batches, { silent: true });
    if (crafted.success) results.push('planks');
  }

  if (planks >= 2 && sticks < 4) {
    const crafted = await craftBrain.craft(bot, 'stick', 1, { silent: true });
    if (crafted.success) results.push('sticks');
  }

  if (!hasTable && (planks >= 4 || logs > 0)) {
    const crafted = await craftBrain.craft(bot, 'crafting_table', 1, { silent: true });
    if (crafted.success) results.push('crafting_table');
  }

  if (!hasTool(bot, 'axe')) {
    const crafted = await craftBrain.craftBestTiered(bot, 'axe', 1, { silent: true });
    if (crafted.success) results.push(crafted.crafted);
  }

  if (!hasTool(bot, 'pickaxe')) {
    const crafted = await craftBrain.craftBestTiered(bot, 'pickaxe', 1, { silent: true });
    if (crafted.success) results.push(crafted.crafted);
  }

  if (!bestTierName(bot, 'sword')) {
    const crafted = await craftBrain.craftBestTiered(bot, 'sword', 1, { silent: true });
    if (crafted.success) results.push(crafted.crafted);
  }

  return results;
}

async function cutTreeSafely(bot, options = {}) {
  const report = scanThreatLevel(bot, options);
  if (report.level === 'high') {
    return { success: false, reason: 'area too dangerous' };
  }

  const root = findTreeRoot(bot);
  if (!root) {
    return { success: false, reason: 'no tree found' };
  }

  const logs = findConnectedLogs(bot, root);
  if (logs.length === 0) {
    return { success: false, reason: 'no connected logs' };
  }

  await equipToolFor(bot, logs[0].name);

  try {
    await bot.pathfinder.goto(new goals.GoalNear(root.position.x, root.position.y, root.position.z, 2));
  } catch {}

  let chopped = 0;
  for (const log of logs) {
    const fresh = bot.blockAt(log.position);
    if (!fresh || !LOG_TYPES.includes(fresh.name)) continue;

    const liveThreat = scanThreatLevel(bot, options);
    if (liveThreat.level === 'high') {
      return { success: false, reason: `interrupted by ${liveThreat.level} threat`, chopped };
    }

    try {
      await equipToolFor(bot, fresh.name);
      await bot.dig(fresh);
      chopped++;
      await sleep(150);
    } catch (err) {
      console.log(`Brain:Mine chop error: ${err.message}`);
    }
  }

  return { success: chopped > 0, reason: chopped > 0 ? 'tree chopped' : 'nothing chopped', chopped };
}

async function mineSoftTargets(bot, options = {}) {
  const candidates = ['grass_block', 'dirt', 'oak_log', 'spruce_log', 'birch_log'];

  for (const name of candidates) {
    const block = bot.findBlock({
      matching: bot.registry.blocksByName[name]?.id,
      maxDistance: 24,
    });

    if (!block) continue;
    if (!canMineQuickly(bot, block)) continue;

    try {
      await equipToolFor(bot, block.name);
      await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 3));
      const fresh = bot.blockAt(block.position);
      if (fresh) {
        await bot.dig(fresh);
        return { success: true, block: fresh.name };
      }
    } catch (err) {
      console.log(`Brain:Mine soft target error: ${err.message}`);
    }
  }

  return { success: false, block: null };
}

async function runMineDecision(bot, options = {}) {
  const state = ensureState(bot);
  const report = scanThreatLevel(bot, options);

  if (report.level === 'none') {
    const progression = await ensureProgression(bot);
    if (progression.length > 0) {
      return { success: true, reason: `progressed: ${progression.join(', ')}`, threat: report.level };
    }

    const tree = await cutTreeSafely(bot, options);
    if (tree.success) {
      await ensureProgression(bot);
      return { success: true, reason: `chopped ${tree.chopped} logs`, threat: report.level };
    }

    if (state.preferredBlock) {
      const soft = await mineSoftTargets(bot, options);
      if (soft.success) {
        return { success: true, reason: `mined ${soft.block}`, threat: report.level };
      }
    }

    return { success: false, reason: 'no work target found', threat: report.level };
  }

  if (report.level === 'low' || report.level === 'medium') {
    const soft = await mineSoftTargets(bot, options);
    if (soft.success) {
      return { success: true, reason: `mined ${soft.block} under pressure`, threat: report.level };
    }

    await fightOneByOne(bot, report, options);
    return { success: true, reason: 'cleared nearby threats', threat: report.level };
  }

  const hasPickaxe = hasTool(bot, 'pickaxe');
  const canFight = !!attackBrain.pickBestWeapon(bot) || bestTierName(bot, 'sword');

  if (!hasPickaxe) {
    const soft = await mineSoftTargets(bot, options);
    if (soft.success) {
      return { success: true, reason: `mined ${soft.block} while under high threat`, threat: report.level };
    }
  }

  if (report.hostiles.length >= 3 || bot.health <= 7) {
    await retreatFromThreats(bot, report);
    const refreshed = scanThreatLevel(bot, options);
    if (refreshed.hostiles.length > 0 && canFight) {
      await fightOneByOne(bot, refreshed, options);
    }
    return { success: true, reason: 'retreated and split threats', threat: report.level };
  }

  if (canFight) {
    await fightOneByOne(bot, report, options);
    return { success: true, reason: 'engaged threats directly', threat: report.level };
  }

  await retreatFromThreats(bot, report);
  return { success: true, reason: 'retreated due to weak gear', threat: report.level };
}

function mineReport(bot, options = {}) {
  const report = scanThreatLevel(bot, options);
  const lines = [];

  lines.push(`Mine Report | Threat: ${report.level.toUpperCase()} | Score: ${report.totalScore}`);
  lines.push(`Tools: axe=${bestTierName(bot, 'axe') || 'none'}, pickaxe=${bestTierName(bot, 'pickaxe') || 'none'}, sword=${bestTierName(bot, 'sword') || 'none'}`);

  if (report.hostiles.length > 0) {
    const summary = report.hostiles
      .slice(0, 3)
      .map(entry => {
        const mobInfo = libraryData.getMobInfo(entry.entity.name || '');
        const drops = mobInfo?.drops?.slice(0, 2).join('/') || 'unknown drops';
        return `${entry.name}@${entry.distance.toFixed(1)} (${entry.score}, ${drops})`;
      })
      .join(', ');
    lines.push(`Threats: ${summary}`);
  } else {
    lines.push('Threats: none nearby');
  }

  const preferredDrop = libraryData.getBlockDrop(ensureState(bot).preferredBlock || 'stone');
  const recipe = libraryData.getRecipe(bestTierName(bot, 'pickaxe') ? 'shield' : 'wooden_pickaxe');
  if (preferredDrop) {
    lines.push(`Mining target drop: ${(ensureState(bot).preferredBlock || 'stone')} -> ${preferredDrop}`);
  }
  if (recipe) {
    const ingredients = recipe.ingredients.map(part => `${part.item} x${part.count}`).join(', ');
    lines.push(`Useful recipe hint: ${bestTierName(bot, 'pickaxe') ? 'shield' : 'wooden_pickaxe'} needs ${ingredients}`);
  }

  return lines;
}

async function autonomousMineTick(bot, options = {}) {
  const state = ensureState(bot);
  if (!state.active || state.busy) return;
  if (bot._currentTask && !String(bot._currentTask).startsWith('autonomy:')) return;
  if (bot._combatState?.target) return;
  if (bot.isThinking) return;

  state.busy = true;
  bot._currentTask = `autonomy:mine:${state.mode}`;

  try {
    const result = await runMineDecision(bot, options);
    const now = Date.now();
    if (now - state.lastThreatReportAt > 10000) {
      console.log(`Brain:Mine ${state.mode} -> ${result.reason} | threat=${result.threat}`);
      state.lastThreatReportAt = now;
    }
  } catch (err) {
    console.log(`Brain:Mine tick error: ${err.message}`);
  } finally {
    if (String(bot._currentTask).startsWith('autonomy:mine:')) {
      bot._currentTask = null;
    }
    state.busy = false;
  }
}

function setMiningMode(bot, mode = 'mixed') {
  const state = ensureState(bot);
  state.active = mode !== 'idle';
  state.mode = mode;
  return state;
}

function startAutoMine(bot, options = {}) {
  stopAutoMine();
  ensureState(bot);
  _mineHandle = setInterval(() => {
    autonomousMineTick(bot, options).catch(err => {
      console.log(`Brain:Mine loop error: ${err.message}`);
    });
  }, 4000);
  console.log('Brain:Mine monitor started');
}

function stopAutoMine() {
  if (_mineHandle) {
    clearInterval(_mineHandle);
    _mineHandle = null;
  }
}

module.exports = {
  LOG_TYPES,
  SOFT_BLOCKS,
  THREAT_LEVELS,
  scanThreatLevel,
  ensureProgression,
  cutTreeSafely,
  mineSoftTargets,
  retreatFromThreats,
  fightOneByOne,
  runMineDecision,
  mineReport,
  autonomousMineTick,
  setMiningMode,
  startAutoMine,
  stopAutoMine,
};
