// ─── Brain Controller ─────────────────────────────────────────────────────────
// The brain handles basic bot needs INSTANTLY without calling the LLM.
// It intercepts commands that match built-in behaviors and executes them
// directly — no network round-trip, no "thinking" delay.
//
// The brain is the first layer of command processing:
//   Player command → Brain (instant) → if not handled → LLM (slow)
//
// Autonomy loop: the brain periodically checks the bot's state and
// takes automatic actions (eat, craft gear, equip armor) without prompting.

const eatBrain = require('./eat');
const attackBrain = require('./attack');
const defanceBrain = require('./defance');
const craftBrain = require('./craft');
const surviveBrain = require('./survive');

let _brainBot = null;
let _brainOptions = {};
let _autonomyHandle = null;

// ─── Command Patterns ─────────────────────────────────────────────────────────
// Regex patterns that the brain can handle without AI

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

// ── Craft patterns ──
const CRAFT_PATTERNS = [
  /^craft\s+(\d+)?\s*(.+)$/i,                     // "craft 3 iron sword" or "craft diamond pickaxe"
  /^make\s+(\d+)?\s*(.+)$/i,                       // "make 5 bread"
  /^create\s+(\d+)?\s*(.+)$/i,                     // "create wooden sword"
  /^build\s+(a\s+)?(crafting[\s_]?table)$/i,        // "build a crafting table"
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

// ─── Brain Interceptor ───────────────────────────────────────────────────────

/**
 * Try to handle a command with built-in brain logic.
 * Returns true if handled (no need for LLM), false if the LLM should handle it.
 */
async function tryHandle(bot, command) {
  const trimmed = command.trim().toLowerCase();

  // ── Eat commands ──
  for (const pattern of EAT_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const specificFood = match[1];
      if (specificFood && !['something', 'food', 'now', 'anything', 'me', 'yourself', 'bot'].includes(specificFood)) {
        return await eatSpecific(bot, specificFood);
      }
      return await eatGeneral(bot);
    }
  }

  // ── Food report commands ──
  for (const pattern of FOOD_REPORT_PATTERNS) {
    if (pattern.test(trimmed)) {
      const lines = eatBrain.foodReport(bot);
      for (const line of lines) { bot.chat(line); }
      return true;
    }
  }

  // ── Gear up ──
  for (const pattern of GEAR_PATTERNS) {
    if (pattern.test(trimmed)) {
      await craftBrain.gearUp(bot);
      return true;
    }
  }

  // ── Planks conversion ──
  for (const pattern of PLANKS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return await handleCraftPlanks(bot);
    }
  }

  // ── Sticks crafting ──
  for (const pattern of STICKS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return await handleCraftSticks(bot);
    }
  }

  // ── Craft report ──
  for (const pattern of CRAFT_SPECIAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      const lines = craftBrain.craftReport(bot);
      for (const line of lines) { bot.chat(line); }
      return true;
    }
  }

  // ── Craft commands ──
  for (const pattern of CRAFT_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const count = parseInt(match[1]) || 1;
      let itemName = (match[2] || '').trim();
      // Handle "build a crafting table"
      if (!itemName && match[2]) itemName = match[2];
      if (itemName) {
        return await handleCraft(bot, itemName, count);
      }
    }
  }

  // ── Combat commands ──
  for (const pattern of ATTACK_PATTERNS) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    const targetName = match[1];
    if (targetName) {
      return await attackSpecific(bot, targetName);
    }
    return await attackNearest(bot);
  }

  // ── Combat report ──
  for (const pattern of COMBAT_REPORT_PATTERNS) {
    if (pattern.test(trimmed)) {
      const lines = defanceBrain.defanceReport(bot);
      for (const line of lines) { bot.chat(line); }
      return true;
    }
  }

  // Not a brain command — let the LLM handle it
  return false;
}

// ─── Eat Handlers ─────────────────────────────────────────────────────────────

async function eatGeneral(bot) {
  const result = await eatBrain.eat(bot, { silent: false, force: false });
  if (!result.ate && bot.food >= 18) {
    bot.chat(`Not hungry enough to eat (${bot.food}/20).`);
  }
  return true;
}

async function eatSpecific(bot, foodName) {
  const normalized = foodName.replace(/\s+/g, '_').toLowerCase();

  const item = bot.inventory.items().find(i => {
    return i.name === normalized ||
           i.name.includes(normalized) ||
           normalized.includes(i.name);
  });

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
    bot.chat(`⚠️ ${item.name} is harmful (${foodData.effect}) — eating anyway...`);
  }

  try {
    await bot.equip(item, 'hand');
    await bot.consume();
    bot.chat(
      `🍖 Ate ${item.name} (+${foodData.hunger} hunger, +${foodData.saturation} sat) ` +
      `| Food: ${bot.food}/20`
    );
  } catch (err) {
    bot.chat(`Couldn't eat ${item.name}: ${err.message}`);
  }

  return true;
}

// ─── Craft Handlers ───────────────────────────────────────────────────────────

async function handleCraft(bot, itemName, count) {
  const normalized = itemName.replace(/\s+/g, '_').toLowerCase();

  // Handle "best sword", "best pickaxe", etc.
  if (normalized.startsWith('best_') || normalized.startsWith('best ')) {
    const type = normalized.replace(/^best[_ ]/, '');
    const result = await craftBrain.craftBestTiered(bot, type, count);
    return true;
  }

  const result = await craftBrain.craft(bot, normalized, count);
  return true;
}

async function handleCraftPlanks(bot) {
  const ps = craftBrain.plankStatus(bot);
  if (ps.totalLogs === 0) {
    bot.chat('No logs to convert to planks!');
    return true;
  }
  bot.chat(`Converting ${ps.totalLogs} logs → ${ps.totalLogs * 4} planks...`);
  const result = await craftBrain.craft(bot, 'planks', ps.totalLogs, { silent: true });
  if (result.success) {
    bot.chat(`✅ Made ${ps.totalLogs * 4} planks!`);
  }
  return true;
}

async function handleCraftSticks(bot) {
  const plankCount = craftBrain.countAnyOf(bot, craftBrain.PLANK_TYPES);
  if (plankCount < 2) {
    // Try making planks first
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
    bot.chat(`✅ Made ${batches * 4} sticks!`);
  }
  return true;
}

// ─── Attack Handlers ──────────────────────────────────────────────────────────

async function attackNearest(bot) {
  // Auto-craft weapon before attacking
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
  // Auto-craft weapon before attacking
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

// ─── Autonomy Loop ────────────────────────────────────────────────────────────
// Periodically checks bot state and takes proactive actions without prompting.
// This is the "self-thinking" layer — the bot takes care of itself.

let _autonomyBusy = false;

async function autonomyTick(bot) {
  if (_autonomyBusy) return;
  _autonomyBusy = true;

  try {
    // 1. Auto-equip armor if we have any unequipped
    const armorSlots = [5, 6, 7, 8]; // head, chest, legs, feet
    const armorTypes = ['helmet', 'chestplate', 'leggings', 'boots'];
    const armorDests = ['head', 'torso', 'legs', 'feet'];

    for (let i = 0; i < armorSlots.length; i++) {
      const equipped = bot.inventory.slots[armorSlots[i]];
      if (equipped) continue;

      // Find best unequipped armor piece in inventory
      const tiers = ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'];
      for (const tier of tiers) {
        const name = `${tier}_${armorTypes[i]}`;
        const item = bot.inventory.items().find(it => it.name === name);
        if (item) {
          try {
            await bot.equip(item, armorDests[i]);
            console.log(`🧠 Autonomy: equipped ${name}`);
          } catch {}
          break;
        }
      }
    }

    // 2. If we have lots of wheat (>= 9) and no bread, craft bread
    const wheatCount = craftBrain.countItem(bot, 'wheat');
    const breadCount = craftBrain.countItem(bot, 'bread');
    if (wheatCount >= 9 && breadCount < 3) {
      const batches = Math.floor(wheatCount / 3);
      try {
        await craftBrain.craft(bot, 'bread', Math.min(batches, 5), { silent: true });
        console.log(`🧠 Autonomy: auto-crafted bread from ${wheatCount} wheat`);
      } catch {}
    }

    // 3. If we have logs but no planks and no crafting table, convert some logs
    const logCount = craftBrain.countAnyOf(bot, craftBrain.LOG_TYPES);
    const plankCount = craftBrain.countAnyOf(bot, craftBrain.PLANK_TYPES);
    const tableCount = craftBrain.countItem(bot, 'crafting_table');
    if (logCount >= 4 && plankCount === 0 && tableCount === 0) {
      try {
        await craftBrain.craft(bot, 'planks', 1, { silent: true });
        console.log('🧠 Autonomy: auto-converted logs to planks');
      } catch {}
    }

    // 4. If we have no weapon at all and have materials, craft one
    const bestWeapon = attackBrain.pickBestWeapon(bot);
    if (!bestWeapon && (logCount >= 2 || plankCount >= 2 || craftBrain.hasItem(bot, 'cobblestone', 2))) {
      try {
        await craftBrain.craftBestTiered(bot, 'sword', 1, { silent: true });
        console.log('🧠 Autonomy: auto-crafted a sword');
      } catch {}
    }

  } catch (err) {
    console.log(`🧠 Autonomy tick error: ${err.message}`);
  } finally {
    _autonomyBusy = false;
  }
}

function startAutonomy(bot) {
  stopAutonomy();
  // Run autonomy check every 45 seconds
  _autonomyHandle = setInterval(() => {
    autonomyTick(bot).catch(err => {
      console.log(`🧠 Autonomy error: ${err.message}`);
    });
  }, 45000);
  // First tick after 15s (let everything initialize)
  setTimeout(() => autonomyTick(bot).catch(() => {}), 15000);
  console.log('🧠 Autonomy loop started (45s interval)');
}

function stopAutonomy() {
  if (_autonomyHandle) {
    clearInterval(_autonomyHandle);
    _autonomyHandle = null;
  }
  _autonomyBusy = false;
}

// ─── Brain Lifecycle ──────────────────────────────────────────────────────────

function init(bot, options = {}) {
  _brainBot = bot;
  _brainOptions = options;
  console.log('🧠 Brain initializing...');

  // Start the auto-eat background monitor
  eatBrain.startAutoEat(bot);
  defanceBrain.startAutoDefance(bot, options);

  // Start autonomy loop (auto-equip armor, auto-craft essentials)
  startAutonomy(bot);

  // Start autonomous survival system
  surviveBrain.startAutonomy(bot, options);

  console.log('🧠 Brain online — handling: eat, craft, combat, defance, gear up, autonomous survival');
  console.log('🧠 Auto-eat monitor active (CRITICAL ≤6 | LOW ≤14 | FINE ≤17 | FULL >17)');
  console.log('🧠 Auto-defance monitor active (damage react → equip best weapon → counterattack)');
  console.log('🧠 Autonomy loop active (auto-equip armor, auto-craft essentials)');
  console.log('🧠 Autonomous survival system active (takes over on 30s idle)');
}

function shutdown() {
  eatBrain.stopAutoEat();
  stopAutonomy();
  surviveBrain.stopAutonomy();
  if (_brainBot) {
    defanceBrain.stopAutoDefance(_brainBot);
  }
  _brainBot = null;
  _brainOptions = {};
  console.log('🧠 Brain shutdown');
}

module.exports = {
  tryHandle,
  init,
  shutdown,
  eat: eatBrain,
  attack: attackBrain,
  defance: defanceBrain,
  craft: craftBrain,
  survive: surviveBrain,
};
