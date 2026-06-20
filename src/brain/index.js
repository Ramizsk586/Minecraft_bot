// Brain Controller
// Handles fast local behaviors before falling back to the LLM.
// Uses the unified Cortex loop for all autonomous decisions.

const eatBrain = require('./eat');
const attackBrain = require('./attack');
const defanceBrain = require('./defance');
const craftBrain = require('./craft');
const mineBrain = require('./mine');
const surviveBrain = require('./survive');
const chatBrain = require('./chat');
const stuckBrain = require('./stuck');
const swimBrain = require('./swim');
const cortex = require('./cortex');

let _brainBot = null;
let _brainOptions = {};

const BRAIN_PRIORITIES = {
  idle: 0,
  mine: 20,
  survive: 30,
  eat: 40,
  combat: 80,
  stuck: 100,
};

function createBrainCoordinator(bot) {
  const state = {
    owner: null,
    token: null,
    priority: 0,
    expiresAt: 0,
  };

  function clearIfExpired() {
    if (state.owner && state.expiresAt > 0 && Date.now() > state.expiresAt) {
      state.owner = null;
      state.token = null;
      state.priority = 0;
      state.expiresAt = 0;
    }
  }

  return {
    canRun(owner, priority = 0) {
      clearIfExpired();
      return !state.owner || state.owner === owner || state.priority <= priority;
    },
    acquire(owner, priority = 0, ttlMs = 15000) {
      clearIfExpired();
      if (state.owner && state.owner !== owner && state.priority > priority) {
        return null;
      }

      const token = `${owner}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      state.owner = owner;
      state.token = token;
      state.priority = priority;
      state.expiresAt = ttlMs > 0 ? Date.now() + ttlMs : 0;
      return token;
    },
    renew(owner, token, ttlMs = 15000) {
      clearIfExpired();
      if (state.owner !== owner || state.token !== token) return false;
      state.expiresAt = ttlMs > 0 ? Date.now() + ttlMs : 0;
      return true;
    },
    release(owner, token) {
      clearIfExpired();
      if (state.owner !== owner) return false;
      if (token && state.token !== token) return false;
      state.owner = null;
      state.token = null;
      state.priority = 0;
      state.expiresAt = 0;
      return true;
    },
    snapshot() {
      clearIfExpired();
      return { ...state };
    },
  };
}

const EAT_PATTERNS = [
  /^eat$/i,
  /^eat\s+(something|food|now|anything)$/i,
  /^eat\s+(.+)$/i,
  /^hungry$/i,
  /^feed\s*(me|yourself|bot)?$/i,
  /^food$/i,
  /^auto[\s-]?eat$/i,
  /^consume$/i,
];

const FOOD_REPORT_PATTERNS = [
  /^food[\s-]?(report|status|list|check|info)$/i,
  /^what.*food.*have/i,
  /^what.*can.*eat/i,
  /^show.*food/i,
  /^check.*food/i,
  /^hunger[\s-]?(status|check|report)?$/i,
];

const ATTACK_PATTERNS = [
  /^attack$/i,
  /^attack\s+(.+)$/i,
  /^fight$/i,
  /^fight\s+(.+)$/i,
  /^defend$/i,
  /^defance$/i,
  /^combat$/i,
];

const COMBAT_REPORT_PATTERNS = [
  /^combat[\s-]?(report|status|check|info)?$/i,
  /^defance[\s-]?(report|status|check|info)?$/i,
  /^attack[\s-]?(report|status|check|info)$/i,
  /^weapon[\s-]?(report|status|check|info)?$/i,
];

const CRAFT_PATTERNS = [
  /^craft\s+(\d+)?\s*(.+)$/i,
  /^make\s+(\d+)?\s*(.+)$/i,
  /^create\s+(\d+)?\s*(.+)$/i,
  /^build\s+(a\s+)?(crafting[\s_]?table)$/i,
];

const CRAFT_SPECIAL_PATTERNS = [
  /^craft[\s-]?(report|status|list|check|info)$/i,
  /^what.*can.*craft/i,
  /^show.*craft/i,
  /^materials?[\s-]?(report|status|check|info)?$/i,
  /^resources?[\s-]?(report|status|check)?$/i,
];

const GEAR_PATTERNS = [
  /^gear\s*up$/i,
  /^equip\s*(best|all|gear)$/i,
  /^arm\s*(me|yourself|up)$/i,
  /^prepare\s*for\s*(combat|fight|battle)$/i,
  /^get\s*(ready|armed|geared)$/i,
  /^craft\s*(all\s*)?(gear|tools|weapons?|armor|equipment)$/i,
  /^make\s*(all\s*)?(gear|tools|weapons?|armor|equipment)$/i,
];

const PLANKS_PATTERNS = [
  /^(make|craft|convert)\s*(all\s*)?(planks?|wood\s*planks?)$/i,
  /^(logs?\s*to\s*planks?|planks?\s*from\s*logs?)$/i,
];

const STICKS_PATTERNS = [
  /^(make|craft)\s*(all\s*)?(sticks?)$/i,
];

const MINE_PATTERNS = [
  /^mine$/i,
  /^mine\s+(.+)$/i,
  /^gather\s+(wood|logs?)$/i,
  /^chop\s+(tree|wood)$/i,
  /^cut\s+(tree|wood)$/i,
  /^auto[\s-]?(mine|mining)$/i,
  /^start\s+(mining|gathering)$/i,
];

const MINE_REPORT_PATTERNS = [
  /^mine[\s-]?(report|status|check|info)?$/i,
  /^threat[\s-]?(report|status|check|info)?$/i,
  /^scan[\s-]?threat/i,
];

async function tryHandle(bot, command) {
  const trimmed = command.trim().toLowerCase();

  const handledChat = await chatBrain.tryHandleChat(bot, _brainOptions.owner || 'Player', command);
  if (handledChat) return true;

  for (const pattern of EAT_PATTERNS) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    const specificFood = match[1];
    if (specificFood && !['something', 'food', 'now', 'anything', 'me', 'yourself', 'bot'].includes(specificFood)) {
      return await eatSpecific(bot, specificFood);
    }
    return await eatGeneral(bot);
  }

  for (const pattern of FOOD_REPORT_PATTERNS) {
    if (!pattern.test(trimmed)) continue;
    const lines = eatBrain.foodReport(bot);
    for (const line of lines) bot.chat(line);
    return true;
  }

  for (const pattern of GEAR_PATTERNS) {
    if (!pattern.test(trimmed)) continue;
    await craftBrain.gearUp(bot);
    return true;
  }

  for (const pattern of PLANKS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return await handleCraftPlanks(bot);
    }
  }

  for (const pattern of STICKS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return await handleCraftSticks(bot);
    }
  }

  for (const pattern of CRAFT_SPECIAL_PATTERNS) {
    if (!pattern.test(trimmed)) continue;
    const lines = craftBrain.craftReport(bot);
    for (const line of lines) bot.chat(line);
    return true;
  }

  for (const pattern of CRAFT_PATTERNS) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    const count = parseInt(match[1]) || 1;
    let itemName = (match[2] || '').trim();
    if (!itemName && match[2]) itemName = match[2];
    if (itemName) {
      return await handleCraft(bot, itemName, count);
    }
  }

  for (const pattern of ATTACK_PATTERNS) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    const targetName = match[1];
    if (targetName) {
      return await attackSpecific(bot, targetName);
    }
    return await attackNearest(bot);
  }

  for (const pattern of MINE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    return await handleMineCommand(bot, trimmed, match[1] || null);
  }

  for (const pattern of COMBAT_REPORT_PATTERNS) {
    if (!pattern.test(trimmed)) continue;
    const lines = defanceBrain.defanceReport(bot);
    for (const line of lines) bot.chat(line);
    return true;
  }

  for (const pattern of MINE_REPORT_PATTERNS) {
    if (!pattern.test(trimmed)) continue;
    const lines = mineBrain.mineReport(bot, _brainOptions);
    for (const line of lines) bot.chat(line);
    return true;
  }

  return false;
}

async function eatGeneral(bot) {
  const result = await eatBrain.eat(bot, { silent: false, force: false });
  if (!result.ate && bot.food >= 18) {
    bot.chat(`Not hungry enough to eat (${bot.food}/20).`);
  }
  return true;
}

async function eatSpecific(bot, foodName) {
  const normalized = foodName.replace(/\s+/g, '_').toLowerCase();
  const item = bot.inventory.items().find(i => i.name === normalized || i.name.includes(normalized) || normalized.includes(i.name));

  if (!item) {
    bot.chat(`Don't have ${foodName} in inventory.`);
    const best = eatBrain.pickBestFood(bot);
    if (best) {
      bot.chat(`Best available: ${best.item.name} x${best.item.count} (${best.reason})`);
    }
    return true;
  }

  const foodData = eatBrain.getFoodData(item.name);
  if (!foodData) {
    bot.chat(`${item.name} is not edible!`);
    return true;
  }

  if (foodData.harmful) {
    bot.chat(`${item.name} is harmful (${foodData.effect}) - eating anyway...`);
  }

  try {
    await bot.equip(item, 'hand');
    await bot.consume();
    bot.chat(`Ate ${item.name} (+${foodData.hunger} hunger, +${foodData.saturation} sat) | Food: ${bot.food}/20`);
  } catch (err) {
    bot.chat(`Couldn't eat ${item.name}: ${err.message}`);
  }

  return true;
}

async function handleCraft(bot, itemName, count) {
  const normalized = itemName.replace(/\s+/g, '_').toLowerCase();

  if (normalized.startsWith('best_') || normalized.startsWith('best ')) {
    const type = normalized.replace(/^best[_ ]/, '');
    await craftBrain.craftBestTiered(bot, type, count);
    return true;
  }

  await craftBrain.craft(bot, normalized, count);
  return true;
}

async function handleCraftPlanks(bot) {
  const ps = craftBrain.plankStatus(bot);
  if (ps.totalLogs === 0) {
    bot.chat('No logs to convert to planks!');
    return true;
  }

  bot.chat(`Converting ${ps.totalLogs} logs -> ${ps.totalLogs * 4} planks...`);
  const result = await craftBrain.craft(bot, 'planks', ps.totalLogs, { silent: true });
  if (result.success) {
    bot.chat(`Made ${ps.totalLogs * 4} planks!`);
  }
  return true;
}

async function handleCraftSticks(bot) {
  const plankCount = craftBrain.countAnyOf(bot, craftBrain.PLANK_TYPES);
  if (plankCount < 2) {
    const ps = craftBrain.plankStatus(bot);
    if (ps.totalLogs > 0) {
      await craftBrain.craft(bot, 'planks', Math.min(ps.totalLogs, 4), { silent: true });
    }
  }

  const available = craftBrain.countAnyOf(bot, craftBrain.PLANK_TYPES);
  if (available < 2) {
    bot.chat('No planks or logs to make sticks!');
    return true;
  }

  const batches = Math.floor(available / 2);
  const result = await craftBrain.craft(bot, 'stick', batches, { silent: true });
  if (result.success) {
    bot.chat(`Made ${batches * 4} sticks!`);
  }
  return true;
}

async function attackNearest(bot) {
  try {
    await craftBrain.ensureWeapon(bot);
  } catch {}

  const target = defanceBrain.findNearestThreat(bot, _brainOptions);
  if (!target) {
    bot.chat('No nearby threat found to attack.');
    return true;
  }

  const result = await attackBrain.startAttack(bot, target, _brainOptions);
  if (!result.started) {
    bot.chat(`Couldn't start combat: ${result.reason}`);
  }
  return true;
}

async function attackSpecific(bot, targetName) {
  try {
    await craftBrain.ensureWeapon(bot);
  } catch {}

  const normalized = targetName.trim().toLowerCase();
  const target = Object.values(bot.entities).find(entity => {
    const name = attackBrain.describeEntity(entity).toLowerCase();
    return name === normalized || name.includes(normalized) || normalized.includes(name);
  });

  if (!target) {
    bot.chat(`Can't find ${targetName} nearby.`);
    return true;
  }

  const result = await attackBrain.startAttack(bot, target, _brainOptions);
  if (!result.started) {
    bot.chat(`Couldn't attack ${targetName}: ${result.reason}`);
  }
  return true;
}

async function handleMineCommand(bot, rawCommand, capturedTarget) {
  const target = capturedTarget?.trim().toLowerCase();

  if (rawCommand === 'mine' || rawCommand === 'auto mine' || rawCommand === 'auto mining' || rawCommand === 'start mining' || rawCommand === 'start gathering') {
    mineBrain.setMiningMode(bot, 'mixed');
    const result = await mineBrain.runMineDecision(bot, _brainOptions);
    bot.chat(result.success ? `Mining brain active: ${result.reason}. Threat=${result.threat}.` : `Mining brain idle: ${result.reason}.`);
    return true;
  }

  if (rawCommand.includes('gather wood') || rawCommand.includes('chop tree') || rawCommand.includes('cut tree') || ['wood', 'tree', 'logs', 'log'].includes(target)) {
    mineBrain.setMiningMode(bot, 'wood');
    const result = await mineBrain.cutTreeSafely(bot, _brainOptions);
    if (!result.success) {
      bot.chat(`Couldn't cut tree: ${result.reason}`);
    } else {
      bot.chat(`Chopped ${result.chopped} logs safely.`);
      await mineBrain.ensureProgression(bot);
    }
    return true;
  }

  mineBrain.setMiningMode(bot, 'mixed');
  const result = await mineBrain.runMineDecision(bot, _brainOptions);
  bot.chat(result.success ? `Mining brain: ${result.reason}. Threat=${result.threat}.` : `Mining brain idle: ${result.reason}.`);
  return true;
}

// Old autonomyTick, startAutonomy, stopAutonomy removed.
// All autonomous behavior is now handled by the Cortex unified loop.

function init(bot, options = {}) {
  _brainBot = bot;
  _brainOptions = options;
  console.log('Brain initializing with Cortex unified loop...');

  bot.brainCoordinator = createBrainCoordinator(bot);
  bot.brainPriorities = BRAIN_PRIORITIES;
  bot.isStuckRecovering = false;
  bot._swimState = {
    active: false,
    target: null,
    startedAt: 0,
    emergency: false,
  };
  bot.on('stuckRecovered', reason => {
    bot.isStuckRecovering = false;
    console.log(`Brain:Stuck recovered from ${reason}`);
  });
  bot.on('stuckGiveUp', reason => {
    bot.isStuckRecovering = false;
    console.log(`Brain:Stuck gave up on ${reason}`);
  });

  // Event-driven defense (reacts to damage instantly — not a loop)
  defanceBrain.startAutoDefance(bot, options);

  // Stuck detection safety net (2s watchdog — independent for safety)
  stuckBrain.startMonitoring(bot, options.stuck || {});

  // ★ Cortex: the ONE unified brain loop that handles everything
  cortex.start(bot, options);

  console.log('Brain online — Cortex unified loop active');
  console.log('Subsystems: cortex (unified), defance (event-driven), stuck (safety-net)');
}

function shutdown() {
  // Stop cortex first
  cortex.stop();

  // Stop safety-net subsystems
  stuckBrain.stopMonitoring();
  if (_brainBot) {
    swimBrain.clearSwimState(_brainBot);
    defanceBrain.stopAutoDefance(_brainBot);
    _brainBot.isStuckRecovering = false;
    _brainBot.brainCoordinator?.release('stuck');
    _brainBot.brainCoordinator?.release('combat');
  }
  _brainBot = null;
  _brainOptions = {};
  console.log('Brain shutdown');
}

module.exports = {
  tryHandle,
  init,
  shutdown,
  eat: eatBrain,
  attack: attackBrain,
  defance: defanceBrain,
  craft: craftBrain,
  mine: mineBrain,
  survive: surviveBrain,
  chat: chatBrain,
  stuck: stuckBrain,
  swim: swimBrain,
  cortex,
};
