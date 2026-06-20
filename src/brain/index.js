// Brain Controller
// Handles fast local behaviors before falling back to the LLM.

const eatBrain = require('./eat');
const attackBrain = require('./attack');
const defanceBrain = require('./defance');
const craftBrain = require('./craft');
const mineBrain = require('./mine');
const surviveBrain = require('./survive');
const chatBrain = require('./chat');
const stuckBrain = require('./stuck');
const swimBrain = require('./swim');

let _brainBot = null;
let _brainOptions = {};
let _autonomyHandle = null;
let _autonomyBusy = false;

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

async function autonomyTick(bot) {
  if (_autonomyBusy) return;
  _autonomyBusy = true;

  try {
    const armorSlots = [5, 6, 7, 8];
    const armorTypes = ['helmet', 'chestplate', 'leggings', 'boots'];
    const armorDests = ['head', 'torso', 'legs', 'feet'];

    for (let i = 0; i < armorSlots.length; i++) {
      const equipped = bot.inventory.slots[armorSlots[i]];
      if (equipped) continue;

      const tiers = ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'];
      for (const tier of tiers) {
        const name = `${tier}_${armorTypes[i]}`;
        const item = bot.inventory.items().find(it => it.name === name);
        if (!item) continue;
        try {
          await bot.equip(item, armorDests[i]);
          console.log(`Brain:Autonomy equipped ${name}`);
        } catch {}
        break;
      }
    }

    const wheatCount = craftBrain.countItem(bot, 'wheat');
    const breadCount = craftBrain.countItem(bot, 'bread');
    if (wheatCount >= 9 && breadCount < 3) {
      const batches = Math.floor(wheatCount / 3);
      try {
        await craftBrain.craft(bot, 'bread', Math.min(batches, 5), { silent: true });
      } catch {}
    }

    const logCount = craftBrain.countAnyOf(bot, craftBrain.LOG_TYPES);
    const plankCount = craftBrain.countAnyOf(bot, craftBrain.PLANK_TYPES);
    const tableCount = craftBrain.countItem(bot, 'crafting_table');
    if (logCount >= 4 && plankCount === 0 && tableCount === 0) {
      try {
        await craftBrain.craft(bot, 'planks', 1, { silent: true });
      } catch {}
    }

    const bestWeapon = attackBrain.pickBestWeapon(bot);
    if (!bestWeapon && (logCount >= 2 || plankCount >= 2 || craftBrain.hasItem(bot, 'cobblestone', 2))) {
      try {
        await craftBrain.craftBestTiered(bot, 'sword', 1, { silent: true });
      } catch {}
    }
  } catch (err) {
    console.log(`Brain:Autonomy tick error: ${err.message}`);
  } finally {
    _autonomyBusy = false;
  }
}

function startAutonomy(bot) {
  stopAutonomy();
  _autonomyHandle = setInterval(() => {
    autonomyTick(bot).catch(err => {
      console.log(`Brain:Autonomy error: ${err.message}`);
    });
  }, 45000);
  setTimeout(() => autonomyTick(bot).catch(() => {}), 15000);
  console.log('Brain:Autonomy loop started (45s interval)');
}

function stopAutonomy() {
  if (_autonomyHandle) {
    clearInterval(_autonomyHandle);
    _autonomyHandle = null;
  }
  _autonomyBusy = false;
}

function init(bot, options = {}) {
  _brainBot = bot;
  _brainOptions = options;
  console.log('Brain initializing...');

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

  eatBrain.startAutoEat(bot);
  defanceBrain.startAutoDefance(bot, options);
  startAutonomy(bot);
  mineBrain.startAutoMine(bot, options);
  surviveBrain.startAutonomy(bot, options);
  stuckBrain.startMonitoring(bot, options.stuck || {});

  console.log('Brain online - handling: eat, craft, combat, defance, mining, gear up, autonomous survival, stuck recovery');
  console.log('Auto-eat monitor active');
  console.log('Auto-defance monitor active');
  console.log('Auto-mine monitor active');
  console.log('Autonomy loop active');
  console.log('Autonomous survival system active');
  console.log('Stuck recovery monitor active');
}

function shutdown() {
  eatBrain.stopAutoEat();
  stopAutonomy();
  mineBrain.stopAutoMine();
  surviveBrain.stopAutonomy();
  stuckBrain.stopMonitoring();
  if (_brainBot) {
    swimBrain.clearSwimState(_brainBot);
  }
  if (_brainBot) {
    defanceBrain.stopAutoDefance(_brainBot);
    _brainBot.isStuckRecovering = false;
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
};
