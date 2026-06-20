// ─── Shared Utilities ─────────────────────────────────────────────────────────

const miningRules = require('./brain/miningRules');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeMinecraftVersion(version) {
  const value = (version || '').trim();
  if (!value || value.toLowerCase() === 'auto') return false;
  return value;
}

function extractJson(raw) {
  const clean = raw.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(clean);
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object found in model response');
    return JSON.parse(match[0]);
  }
}

// ─── Tool Selection Helpers ───────────────────────────────────────────────────

function compactChatMessage(message, maxLength = 96) {
  let text = String(message ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();

  const replacements = [
    [/Something went wrong with my brain\. Try again!/i, 'Brain error. Try again.'],
    [/My AI brain returned an empty plan\..*/i, 'AI returned no plan.'],
    [/AI autonomy enabled\..*/i, 'AI autonomy: ON'],
    [/AI autonomy disabled\..*/i, 'AI autonomy: OFF'],
    [/Player is idle\. Cortex engaging autonomous survival mode\./i, 'Idle: survival ON.'],
    [/AI supervisor is choosing a safe autonomous goal\./i, 'AI choosing goal.'],
    [/Collecting dropped items nearby \((\d+) found\)\./i, 'Collecting drops: $1'],
    [/No useful trees nearby here\. Relocating toward a better biome\./i, 'No trees. Relocating.'],
    [/Enough starter materials collected\. Beginning base setup\./i, 'Starter base setup.'],
    [/Critical health \((\d+)\/20\)! Fleeing!/i, 'HP $1/20: fleeing.'],
    [/Crafting and managing armor upgrades\./i, 'Armor upgrade.'],
    [/Crafting a shield for safer combat\./i, 'Crafting shield.'],
    [/Gathering ([^ ]+) for this biome\.\.\./i, 'Gathering $1.'],
    [/No ([^ ]+) nearby.*searching\.\.\./i, 'No $1 nearby. Searching.'],
    [/Started cooking food\./i, 'Cooking food.'],
    [/Running a farming cycle\.\.\./i, 'Farming.'],
    [/Going to sleep\.\.\./i, 'Sleeping.'],
    [/Shelter complete\. Staying inside until dawn\./i, 'Shelter ready.'],
    [/Mining some ([^ ]+) for emergency shelter\.\.\./i, 'Mining $1 for shelter.'],
    [/No pickaxe.*going to chop ([^ ]+)\./i, 'Need pickaxe. Chopping $1.'],
    [/Mining ([^ ]+) to upgrade tools\.\.\./i, 'Mining $1 for tools.'],
    [/Upgrading to (.+)!/i, 'Upgrade: $1.'],
    [/Searching for (coal|iron ore)\.\.\./i, 'Searching: $1.'],
    [/Smelting complete\. Picking up furnace\.\.\./i, 'Smelting done.'],
    [/Morning! Leaving shelter\.\.\./i, 'Morning. Leaving shelter.'],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function installCompactChat(bot, options = {}) {
  if (!bot || bot._compactChatInstalled || typeof bot.chat !== 'function') return;

  const maxLength = Number.isFinite(options.maxLength) ? options.maxLength : 96;
  const originalChat = bot.chat.bind(bot);

  bot._compactChatInstalled = true;
  bot.chat = (message) => {
    const compact = compactChatMessage(message, maxLength);
    if (!compact) return undefined;
    return originalChat(compact);
  };
}

const TOOL_FOR_BLOCK = {
  // Pickaxe blocks
  stone: 'pickaxe', cobblestone: 'pickaxe', deepslate: 'pickaxe',
  granite: 'pickaxe', diorite: 'pickaxe', andesite: 'pickaxe',
  coal_ore: 'pickaxe', iron_ore: 'pickaxe', gold_ore: 'pickaxe',
  diamond_ore: 'pickaxe', emerald_ore: 'pickaxe', lapis_ore: 'pickaxe',
  redstone_ore: 'pickaxe', copper_ore: 'pickaxe', nether_quartz_ore: 'pickaxe',
  deepslate_coal_ore: 'pickaxe', deepslate_iron_ore: 'pickaxe',
  deepslate_gold_ore: 'pickaxe', deepslate_diamond_ore: 'pickaxe',
  deepslate_emerald_ore: 'pickaxe', deepslate_lapis_ore: 'pickaxe',
  deepslate_redstone_ore: 'pickaxe', deepslate_copper_ore: 'pickaxe',
  obsidian: 'pickaxe', netherrack: 'pickaxe', basalt: 'pickaxe',
  sandstone: 'pickaxe', red_sandstone: 'pickaxe',
  bricks: 'pickaxe', nether_bricks: 'pickaxe',
  end_stone: 'pickaxe', purpur_block: 'pickaxe',
  terracotta: 'pickaxe', prismarine: 'pickaxe',
  furnace: 'pickaxe', blast_furnace: 'pickaxe', smoker: 'pickaxe',
  // Axe blocks
  oak_log: 'axe', spruce_log: 'axe', birch_log: 'axe',
  jungle_log: 'axe', acacia_log: 'axe', dark_oak_log: 'axe',
  mangrove_log: 'axe', cherry_log: 'axe',
  oak_planks: 'axe', spruce_planks: 'axe', birch_planks: 'axe',
  jungle_planks: 'axe', acacia_planks: 'axe', dark_oak_planks: 'axe',
  crafting_table: 'axe', chest: 'axe', barrel: 'axe',
  bookshelf: 'axe',
  // Shovel blocks
  dirt: 'shovel', grass_block: 'shovel', sand: 'shovel',
  gravel: 'shovel', clay: 'shovel', soul_sand: 'shovel',
  soul_soil: 'shovel', red_sand: 'shovel', podzol: 'shovel',
  mycelium: 'shovel', mud: 'shovel', snow: 'shovel',
  snow_block: 'shovel', farmland: 'shovel',
  // Hoe blocks
  hay_block: 'hoe', dried_kelp_block: 'hoe',
  target: 'hoe', shroomlight: 'hoe',
  // Shears
  cobweb: 'shears',
};

const TOOL_TIERS = ['netherite', 'diamond', 'iron', 'golden', 'stone', 'wooden'];

function inferPreferredToolType(blockName = '') {
  if (TOOL_FOR_BLOCK[blockName]) return TOOL_FOR_BLOCK[blockName];
  if (blockName.includes('log') || blockName.includes('wood') || blockName.includes('planks')) return 'axe';
  if (blockName.includes('leaves') || blockName.includes('wool')) return 'shears';
  if (['dirt', 'grass_block', 'sand', 'gravel', 'clay', 'mud', 'snow', 'snow_block'].includes(blockName)) return 'shovel';
  if (blockName.includes('ore') || blockName.includes('stone') || blockName.includes('deepslate') || blockName.includes('brick')) return 'pickaxe';
  return null;
}

/**
 * Find the best tool in inventory for a given block name.
 * Returns the inventory item or null.
 */
function findBestTool(bot, blockName) {
  const requirement = miningRules.getBlockRequirement(blockName);
  const toolType = requirement?.tool || inferPreferredToolType(blockName);
  if (!toolType) return null;

  const items = bot.inventory.items();
  if (toolType === 'shears') {
    const shears = items.find(i => i.name === 'shears');
    if (!shears) return null;
    const check = miningRules.checkToolForBlock(shears, blockName);
    return check.willDrop ? shears : null;
  }

  for (const tier of TOOL_TIERS) {
    const toolName = `${tier}_${toolType}`;
    const found = items.find(i => i.name === toolName);
    if (!found) continue;

    if (requirement) {
      const check = miningRules.checkToolForBlock(found, blockName);
      if (!check.willDrop) continue;
    }

    return found;
  }
  return null;
}

function getSafeMiningCheck(bot, blockName, tool = null, options = {}) {
  const { requireDrops = true } = options;
  const check = miningRules.checkToolForBlock(tool, blockName);
  if (!check.canMine) return check;
  if (requireDrops && !check.willDrop) return check;
  return { ...check, canMine: true };
}

async function equipSafeToolForBlock(bot, blockName, options = {}) {
  const tool = findBestTool(bot, blockName);
  const check = getSafeMiningCheck(bot, blockName, tool, options);
  if (!check.canMine || (options.requireDrops !== false && !check.willDrop)) {
    return { tool: null, check };
  }

  if (tool) {
    try {
      await bot.equip(tool, 'hand');
    } catch (err) {
      return {
        tool: null,
        check: { canMine: false, willDrop: false, reason: `failed to equip ${tool.name}: ${err.message}` },
      };
    }
  }

  return { tool, check };
}

async function digSafely(bot, block, options = {}) {
  if (!block || block.name === 'air' || block.name === 'cave_air') {
    return { success: false, reason: 'no block to dig' };
  }

  const { tool, check } = await equipSafeToolForBlock(bot, block.name, { requireDrops: true, ...options });
  if (!check.canMine || (options.requireDrops !== false && !check.willDrop)) {
    return { success: false, reason: check.reason, tool };
  }

  if (!bot.canDigBlock(block)) {
    return { success: false, reason: `${block.name} is not diggable from here`, tool };
  }

  await bot.dig(block, true);
  return { success: true, reason: check.reason, tool };
}

// ─── Food Priority ────────────────────────────────────────────────────────────

const FOOD_PRIORITY = [
  'enchanted_golden_apple', 'golden_apple', 'golden_carrot', 'cooked_sniffer_egg',
  'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_salmon',
  'cooked_cod', 'cooked_chicken', 'cooked_rabbit',
  'cooked_carrot', 'baked_apple', 'cooked_rotten_flesh',
  'roasted_pumpkin', 'roasted_poisonous_potato', 'cooked_turtle_egg',
  'roasted_brown_mushroom', 'roasted_red_mushroom',
  'bread', 'baked_potato', 'beetroot_soup', 'mushroom_stew',
  'pumpkin_pie', 'cake', 'cookie', 'melon_slice',
  'fried_egg', 'cooked_sweet_berries', 'cooked_tropical_fish',
  'cooked_spider_eye', 'cooked_beetroot', 'cooked_pufferfish',
  'cooked_glow_berries', 'roasted_melon_slice',
  'sweet_berries', 'apple', 'carrot', 'potato',
  'dried_kelp', 'beetroot',
  'raw_beef', 'raw_porkchop', 'raw_mutton', 'raw_chicken',
  'raw_cod', 'raw_salmon', 'raw_rabbit', 'tropical_fish',
  'rotten_flesh', 'spider_eye', 'egg', 'turtle_egg', 'sniffer_egg',
  'brown_mushroom', 'red_mushroom', 'pumpkin',
];

/**
 * Find the best food item in inventory.
 */
function findBestFood(bot) {
  const items = bot.inventory.items();
  for (const foodName of FOOD_PRIORITY) {
    const found = items.find(i => i.name === foodName);
    if (found) return found;
  }
  return null;
}

/**
 * Wait briefly then collect nearby dropped items by walking to them.
 */
async function collectDrops(bot, goals, waitMs = 600, options = {}) {
  const {
    maxDistance = 12,
    maxItems = 16,
    passes = 2,
  } = options;

  await sleep(waitMs);

  for (let pass = 0; pass < passes; pass++) {
    const nearby = Object.values(bot.entities)
      .filter(e => e.name === 'item' && e.position.distanceTo(bot.entity.position) < maxDistance)
      .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));

    if (nearby.length === 0) break;

    for (const item of nearby.slice(0, maxItems)) {
      try {
        await bot.pathfinder.goto(new goals.GoalNear(
          item.position.x, item.position.y, item.position.z, 1
        ));
      } catch {
        // item may have been picked up already
      }
      await sleep(200);
    }
  }
}

module.exports = {
  sleep,
  normalizeMinecraftVersion,
  extractJson,
  compactChatMessage,
  installCompactChat,
  findBestTool,
  getSafeMiningCheck,
  equipSafeToolForBlock,
  digSafely,
  findBestFood,
  collectDrops,
  TOOL_FOR_BLOCK,
  TOOL_TIERS,
  inferPreferredToolType,
  FOOD_PRIORITY,
};
