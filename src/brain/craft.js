// ─── Brain: Craft Module ──────────────────────────────────────────────────────
// Instant, LLM-free crafting intelligence. Knows every recipe for tools,
// weapons, armor, and essentials. Auto-resolves dependency chains
// (log → planks → sticks → sword). Picks best material tier available.
// Integrates with eat.js (craft bread when hungry) and attack.js/defance.js
// (craft weapon/armor before combat).

const { collectDrops, digSafely } = require('../utils');

const SMELT_RECIPES = {
  iron_ingot: { input: 'raw_iron', output: 1 },
  gold_ingot: { input: 'raw_gold', output: 1 },
  copper_ingot: { input: 'raw_copper', output: 1 },
  charcoal: { input: '_logs', output: 1 },
};

// ─── Material Tiers ───────────────────────────────────────────────────────────
// Ordered best → worst. The brain tries the best tier first and falls back.

const MATERIAL_TIERS = [
  { tier: 'netherite', material: 'netherite_ingot', plankBased: false, level: 6 },
  { tier: 'diamond',   material: 'diamond',         plankBased: false, level: 5 },
  { tier: 'iron',      material: 'iron_ingot',      plankBased: false, level: 4 },
  { tier: 'stone',     material: 'cobblestone',     plankBased: false, level: 2 },
  { tier: 'chainmail', material: null,              plankBased: false, level: 2 },
  { tier: 'golden',    material: 'gold_ingot',      plankBased: false, level: 1 },
  { tier: 'leather',   material: 'leather',         plankBased: false, level: 1 },
  { tier: 'wooden',    material: null,               plankBased: true,  level: 1 },
];

const ARMOR_TYPES = ['helmet', 'chestplate', 'leggings', 'boots'];
const TOOL_TYPES = ['sword', 'axe', 'pickaxe', 'shovel', 'hoe'];

function getValidTiersForItem(itemType) {
  if (ARMOR_TYPES.includes(itemType)) {
    return [
      { tier: 'netherite', material: 'netherite_ingot', plankBased: false, level: 6 },
      { tier: 'diamond',   material: 'diamond',         plankBased: false, level: 5 },
      { tier: 'iron',      material: 'iron_ingot',      plankBased: false, level: 4 },
      { tier: 'chainmail', material: null,              plankBased: false, level: 3 },
      { tier: 'golden',    material: 'gold_ingot',      plankBased: false, level: 2 },
      { tier: 'leather',   material: 'leather',         plankBased: false, level: 1 },
    ];
  } else if (TOOL_TYPES.includes(itemType)) {
    return [
      { tier: 'netherite', material: 'netherite_ingot', plankBased: false, level: 6 },
      { tier: 'diamond',   material: 'diamond',         plankBased: false, level: 5 },
      { tier: 'iron',      material: 'iron_ingot',      plankBased: false, level: 4 },
      { tier: 'stone',     material: 'cobblestone',     plankBased: false, level: 2 },
      { tier: 'golden',    material: 'gold_ingot',      plankBased: false, level: 1 },
      { tier: 'wooden',    material: null,               plankBased: true,  level: 1 },
    ];
  }
  return [];
}

const CRAFT_ALIASES = {
  wood_sword: 'wooden_sword',
  wood_axe: 'wooden_axe',
  wood_pickaxe: 'wooden_pickaxe',
  wood_shovel: 'wooden_shovel',
  wood_hoe: 'wooden_hoe',
  gold_sword: 'golden_sword',
  gold_axe: 'golden_axe',
  gold_pickaxe: 'golden_pickaxe',
  gold_shovel: 'golden_shovel',
  gold_hoe: 'golden_hoe',
  table: 'crafting_table',
  workbench: 'crafting_table',
  craftingtable: 'crafting_table',
  sticks: 'stick',
  planks: 'planks',
};

// All log types that can be converted to planks
const LOG_TYPES = [
  'oak_log', 'spruce_log', 'birch_log', 'jungle_log',
  'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
  'crimson_stem', 'warped_stem',
  'stripped_oak_log', 'stripped_spruce_log', 'stripped_birch_log',
  'stripped_jungle_log', 'stripped_acacia_log', 'stripped_dark_oak_log',
];

// Log → Plank mapping (log name → plank name)
const LOG_TO_PLANK = {
  oak_log: 'oak_planks',           stripped_oak_log: 'oak_planks',
  spruce_log: 'spruce_planks',     stripped_spruce_log: 'spruce_planks',
  birch_log: 'birch_planks',       stripped_birch_log: 'birch_planks',
  jungle_log: 'jungle_planks',     stripped_jungle_log: 'jungle_planks',
  acacia_log: 'acacia_planks',     stripped_acacia_log: 'acacia_planks',
  dark_oak_log: 'dark_oak_planks', stripped_dark_oak_log: 'dark_oak_planks',
  mangrove_log: 'mangrove_planks',
  cherry_log: 'cherry_planks',
  crimson_stem: 'crimson_planks',
  warped_stem: 'warped_planks',
};

const PLANK_TYPES = [
  'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
  'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
  'crimson_planks', 'warped_planks',
];

// ─── Built-in Recipe Database ─────────────────────────────────────────────────
// Recipes the brain knows without needing the game registry.
// cost: { material: count } where "material" is resolved per tier
// Special keys: _planks = any plank type, _sticks = sticks, _logs = any log

const RECIPES = {
  // ── Basic conversions ──
  planks:         { category: 'basic',   cost: { _logs: 1 },     output: 4,  needsTable: false, description: 'Logs → Planks' },
  stick:          { category: 'basic',   cost: { _planks: 2 },   output: 4,  needsTable: false, description: 'Planks → Sticks' },
  crafting_table: { category: 'basic',   cost: { _planks: 4 },   output: 1,  needsTable: false, description: '4 Planks → Crafting Table' },
  furnace:        { category: 'basic',   cost: { cobblestone: 8 }, output: 1, needsTable: true,  description: '8 Cobblestone → Furnace' },
  chest:          { category: 'basic',   cost: { _planks: 8 },   output: 1,  needsTable: true,  description: '8 Planks → Chest' },
  torch:          { category: 'basic',   cost: { _sticks: 1, coal: 1 }, output: 4, needsTable: false, description: 'Stick + Coal → 4 Torches' },

  // ── Weapons (tiered) ──
  _sword:     { category: 'weapon',  cost: { _material: 2, _sticks: 1 }, output: 1, needsTable: true, description: '2 Material + Stick → Sword' },
  _axe:       { category: 'weapon',  cost: { _material: 3, _sticks: 2 }, output: 1, needsTable: true, description: '3 Material + 2 Sticks → Axe' },

  // ── Tools (tiered) ──
  _pickaxe:   { category: 'tool',    cost: { _material: 3, _sticks: 2 }, output: 1, needsTable: true, description: '3 Material + 2 Sticks → Pickaxe' },
  _shovel:    { category: 'tool',    cost: { _material: 1, _sticks: 2 }, output: 1, needsTable: true, description: '1 Material + 2 Sticks → Shovel' },
  _hoe:       { category: 'tool',    cost: { _material: 2, _sticks: 2 }, output: 1, needsTable: true, description: '2 Material + 2 Sticks → Hoe' },

  // ── Armor (tiered) ──
  _helmet:     { category: 'armor',  cost: { _material: 5 }, output: 1, needsTable: true, description: '5 Material → Helmet' },
  _chestplate: { category: 'armor',  cost: { _material: 8 }, output: 1, needsTable: true, description: '8 Material → Chestplate' },
  _leggings:   { category: 'armor',  cost: { _material: 7 }, output: 1, needsTable: true, description: '7 Material → Leggings' },
  _boots:      { category: 'armor',  cost: { _material: 4 }, output: 1, needsTable: true, description: '4 Material → Boots' },

  // ── Defense ──
  shield:     { category: 'defense', cost: { iron_ingot: 1, _planks: 6 }, output: 1, needsTable: true, description: 'Iron + 6 Planks → Shield' },

  // ── Food ──
  bread:      { category: 'food',    cost: { wheat: 3 },     output: 1, needsTable: true,  description: '3 Wheat → Bread' },
  cake:       { category: 'food',    cost: { wheat: 3, sugar: 2, egg: 1 }, output: 1, needsTable: true, description: 'Wheat + Sugar + Egg → Cake' },
  cookie:     { category: 'food',    cost: { wheat: 2, cocoa_beans: 1 }, output: 8, needsTable: true, description: '2 Wheat + Cocoa → 8 Cookies' },
  pumpkin_pie:{ category: 'food',    cost: { pumpkin: 1, sugar: 1, egg: 1 }, output: 1, needsTable: false, description: 'Pumpkin + Sugar + Egg → Pie' },
  golden_apple:{ category: 'food',   cost: { gold_ingot: 8, apple: 1 },  output: 1, needsTable: true, description: '8 Gold + Apple → Golden Apple' },
  golden_carrot:{ category: 'food',  cost: { gold_nugget: 8, carrot: 1 }, output: 1, needsTable: true, description: '8 Nuggets + Carrot → Golden Carrot' },

  // ── Misc ──
  bucket:     { category: 'tool',    cost: { iron_ingot: 3 }, output: 1, needsTable: true, description: '3 Iron → Bucket' },
  bowl:       { category: 'basic',   cost: { _planks: 3 },    output: 4, needsTable: true, description: '3 Planks → 4 Bowls' },
  
  // ── Newly Added Recipes ──
  white_wool: { category: 'basic',   cost: { string: 4 },    output: 1, needsTable: true, description: '4 String → White Wool' },
  bed:        { category: 'basic',   cost: { _planks: 3, white_wool: 3 }, output: 1, needsTable: true, description: '3 Planks + 3 Wool → Bed' },
  shears:     { category: 'tool',    cost: { iron_ingot: 2 }, output: 1, needsTable: true, description: '2 Iron Ingot → Shears' },
  bow:        { category: 'weapon',  cost: { stick: 3, string: 3 }, output: 1, needsTable: true, description: '3 Sticks + 3 Strings → Bow' },
  arrow:      { category: 'basic',   cost: { flint: 1, stick: 1, feather: 1 }, output: 4, needsTable: true, description: 'Flint + Stick + Feather → 4 Arrows' },
  oak_door:   { category: 'basic',   cost: { _planks: 6 },    output: 3, needsTable: true, description: '6 Planks → 3 Doors' },
  ladder:     { category: 'basic',   cost: { stick: 7 },      output: 3, needsTable: true, description: '7 Sticks → 3 Ladders' },
  hay_block:  { category: 'basic',   cost: { wheat: 9 },      output: 1, needsTable: true, description: '9 Wheat → Hay Block' },
  iron_block: { category: 'basic',   cost: { iron_ingot: 9 }, output: 1, needsTable: true, description: '9 Iron Ingot → Iron Block' },
  gold_block: { category: 'basic',   cost: { gold_ingot: 9 }, output: 1, needsTable: true, description: '9 Gold Ingot → Gold Block' },
  diamond_block:{ category: 'basic',  cost: { diamond: 9 },   output: 1, needsTable: true, description: '9 Diamond → Diamond Block' },
  sandstone:  { category: 'basic',   cost: { sand: 4 },       output: 1, needsTable: false, description: '4 Sand → Sandstone' },
};

// Tiered item types that get prefixed with a material tier
const TIERED_ITEMS = ['sword', 'axe', 'pickaxe', 'shovel', 'hoe', 'helmet', 'chestplate', 'leggings', 'boots'];

// ─── Inventory Helpers ────────────────────────────────────────────────────────

function countItem(bot, name) {
  return bot.inventory.items()
    .filter(i => i.name === name)
    .reduce((sum, i) => sum + i.count, 0);
}

function countAnyOf(bot, names) {
  return bot.inventory.items()
    .filter(i => names.includes(i.name))
    .reduce((sum, i) => sum + i.count, 0);
}

function findItemSlot(bot, name) {
  return bot.inventory.items().find(i => i.name === name) || null;
}

function findAnyOf(bot, names) {
  for (const name of names) {
    const item = findItemSlot(bot, name);
    if (item) return item;
  }
  return null;
}

function hasItem(bot, name, count = 1) {
  return countItem(bot, name) >= count;
}

function normalizeCraftName(itemName = '') {
  const normalized = String(itemName).trim().replace(/\s+/g, '_').toLowerCase();
  return CRAFT_ALIASES[normalized] || normalized;
}

function canSmeltItem(itemName) {
  return !!SMELT_RECIPES[itemName];
}

function getInventoryCountForRequirement(bot, itemName) {
  if (itemName === '_planks') return countAnyOf(bot, PLANK_TYPES);
  if (itemName === '_logs') return countAnyOf(bot, LOG_TYPES);
  if (itemName === 'coal') return countItem(bot, 'coal') + countItem(bot, 'charcoal');
  return countItem(bot, itemName);
}

function isItemSatisfied(bot, itemName, count = 1) {
  return getInventoryCountForRequirement(bot, itemName) >= count;
}

function getTierInfoByName(name = '') {
  return MATERIAL_TIERS.find(t => name.startsWith(`${t.tier}_`)) || null;
}

function getOwnedTieredItem(bot, itemType) {
  const tiers = getValidTiersForItem(itemType);
  for (const t of tiers) {
    if (t.tier === 'netherite') continue;
    const fullName = `${t.tier}_${itemType}`;
    const item = findItemSlot(bot, fullName);
    if (item) return { tier: t, item };
  }
  return null;
}

function getEquippedArmorTier(bot, armorType) {
  const slotMap = { helmet: 5, chestplate: 6, leggings: 7, boots: 8 };
  const equipped = bot.inventory.slots[slotMap[armorType]];
  if (!equipped) return null;
  return getTierInfoByName(equipped.name);
}

function getBestCraftableTier(bot, itemType, count = 1) {
  const tiers = getValidTiersForItem(itemType);
  for (const t of tiers) {
    if (t.tier === 'netherite') continue;
    if (t.tier === 'chainmail') continue;
    const fullName = `${t.tier}_${itemType}`;
    const steps = resolveDependencies(bot, fullName, count);
    if (steps) return { tier: t, fullName, steps };
  }
  return null;
}

function getBestOwnedTieredItem(bot, itemType) {
  let best = null;
  const tiers = getValidTiersForItem(itemType);
  for (const t of tiers) {
    if (t.tier === 'netherite') continue;
    const fullName = `${t.tier}_${itemType}`;
    const item = findItemSlot(bot, fullName);
    if (!item) continue;
    if (!best || t.level > best.tier.level) {
      best = { tier: t, item, fullName };
    }
  }
  return best;
}

function trackTemporaryStation(bot, kind, position) {
  if (!position) return;
  if (!bot._temporaryStations) bot._temporaryStations = {};
  bot._temporaryStations[kind] = position.clone ? position.clone() : position;
}

async function cleanupTemporaryStation(bot, kind, goals, options = {}) {
  const position = bot._temporaryStations?.[kind];
  if (!position) return false;

  const block = bot.blockAt(position);
  if (!block || block.name !== kind) {
    delete bot._temporaryStations[kind];
    return false;
  }

  try {
    const { GoalNear } = goals || require('mineflayer-pathfinder').goals;
    await bot.pathfinder.goto(new GoalNear(position.x, position.y, position.z, 3));
  } catch {}

  try {
    const digResult = await digSafely(bot, block, { requireDrops: true });
    if (!digResult.success) {
      if (!options.silent) console.log(`Temporary ${kind} cleanup skipped: ${digResult.reason}`);
      return false;
    }
    await collectDrops(bot, goals || require('mineflayer-pathfinder').goals, 250, { maxDistance: 10, maxItems: 8, passes: 2 });
    delete bot._temporaryStations[kind];
    return true;
  } catch (err) {
    if (!options.silent) console.log(`Temporary ${kind} cleanup failed: ${err.message}`);
    return false;
  }
}

// ─── Dependency Resolver ──────────────────────────────────────────────────────
// Figures out what intermediate crafts are needed before the target craft.

/**
 * Calculate how many planks the bot has and can make.
 * @returns {{ have: number, canMake: number, totalLogs: number }}
 */
function plankStatus(bot) {
  const have = countAnyOf(bot, PLANK_TYPES);
  const totalLogs = countAnyOf(bot, LOG_TYPES);
  return { have, canMake: totalLogs * 4, totalLogs };
}

function isAirLikeBlock(block) {
  if (!block) return true;
  return ['air', 'cave_air', 'void_air'].includes(block.name);
}

function isReplaceablePlacementBlock(block) {
  if (!block) return true;
  return isAirLikeBlock(block) || [
    'water', 'lava', 'short_grass', 'tall_grass', 'fern', 'large_fern',
    'dead_bush', 'snow', 'vine', 'seagrass', 'tall_seagrass'
  ].includes(block.name);
}

function findNearbyPlacementSpot(bot) {
  const base = bot.entity.position.floored();
  const offsets = [
    [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1],
    [1, 1, 1], [1, 1, -1], [-1, 1, 1], [-1, 1, -1],
  ];

  for (const [dx, dy, dz] of offsets) {
    const targetPos = base.offset(dx, dy, dz);
    const supportPos = targetPos.offset(0, -1, 0);
    const targetBlock = bot.blockAt(targetPos);
    const supportBlock = bot.blockAt(supportPos);

    if (!supportBlock || isAirLikeBlock(supportBlock) || supportBlock.boundingBox === 'empty') continue;
    if (!isReplaceablePlacementBlock(targetBlock)) continue;

    return { targetPos, targetBlock, supportBlock };
  }

  return null;
}

/**
 * Calculate how many sticks the bot has and can make.
 */
function stickStatus(bot) {
  const have = countItem(bot, 'stick');
  const ps = plankStatus(bot);
  const availablePlanks = ps.have + ps.canMake;
  return { have, canMake: Math.floor(availablePlanks / 2) * 4, availablePlanks };
}

/**
 * Find the best material tier the bot can use for a tiered recipe.
 * Returns { tier, material, count } or null.
 */
function findBestTier(bot, recipe, itemType) {
  const materialNeeded = recipe.cost._material || 0;
  if (materialNeeded === 0) return null;

  const tiers = itemType ? getValidTiersForItem(itemType) : MATERIAL_TIERS;
  for (const t of tiers) {
    if (t.tier === 'netherite') continue; // netherite needs smithing, skip auto-craft
    if (t.tier === 'chainmail') continue; // chainmail is not craftable

    if (t.plankBased) {
      // Wooden tier: uses planks as material
      const ps = plankStatus(bot);
      if (ps.have + ps.canMake >= materialNeeded) {
        return { tier: t.tier, material: '_planks', count: ps.have + ps.canMake, level: t.level };
      }
    } else if (t.material) {
      const have = countItem(bot, t.material);
      if (have >= materialNeeded) {
        return { tier: t.tier, material: t.material, count: have, level: t.level };
      }
    }
  }
  return null;
}

/**
 * Build the full dependency chain to craft an item.
 * Returns array of { action, item, count, reason } steps, or null if impossible.
 */
function resolveDependencies(bot, targetItem, count = 1) {
  const steps = [];
  const visited = new Set();

  // Initialize virtual inventory
  const virtualInventory = {};
  for (const item of bot.inventory.items()) {
    virtualInventory[item.name] = (virtualInventory[item.name] || 0) + item.count;
  }

  function findAnyOfVirtual(names) {
    for (const name of names) {
      if ((virtualInventory[name] || 0) > 0) return name;
    }
    return null;
  }

  // Helper to resolve specific items recursively
  function resolve(item, qty) {
    if (qty <= 0) return true;

    // 1. Check coal/charcoal fallback
    if (item === 'coal') {
      const coalQty = virtualInventory['coal'] || 0;
      if (coalQty >= qty) {
        virtualInventory['coal'] -= qty;
        return true;
      } else {
        const remaining = qty - coalQty;
        const charcoalQty = virtualInventory['charcoal'] || 0;
        if (charcoalQty >= remaining) {
          virtualInventory['coal'] = 0;
          virtualInventory['charcoal'] -= remaining;
          return true;
        }
      }
    }

    // 2. Check if we already have enough of the exact item
    let have = virtualInventory[item] || 0;
    if (have >= qty) {
      virtualInventory[item] -= qty;
      return true;
    }

    // Handle wood/plank/stick placeholders
    if (item === '_planks') {
      let needed = qty;
      for (const pType of PLANK_TYPES) {
        const pQty = virtualInventory[pType] || 0;
        if (pQty > 0) {
          const consume = Math.min(needed, pQty);
          virtualInventory[pType] -= consume;
          needed -= consume;
          if (needed === 0) break;
        }
      }
      if (needed === 0) return true;

      // If still need more planks, we must craft them
      let logName = findAnyOfVirtual(LOG_TYPES);
      let plankName = logName ? (LOG_TO_PLANK[logName] || 'oak_planks') : 'oak_planks';
      
      const ok = resolve(plankName, needed);
      if (!ok) return false;
      
      virtualInventory[plankName] -= needed;
      return true;
    }

    if (item === '_logs') {
      let needed = qty;
      for (const lType of LOG_TYPES) {
        const lQty = virtualInventory[lType] || 0;
        if (lQty > 0) {
          const consume = Math.min(needed, lQty);
          virtualInventory[lType] -= consume;
          needed -= consume;
          if (needed === 0) break;
        }
      }
      return needed === 0;
    }

    if (item === 'charcoal') {
      const charcoalQty = virtualInventory.charcoal || 0;
      if (charcoalQty >= qty) {
        virtualInventory.charcoal -= qty;
        return true;
      }
    }

    if (item === '_sticks') {
      return resolve('stick', qty);
    }

    // 3. Not enough in inventory. We must craft it.
    if (visited.has(item)) return false; // Loop detected
    visited.add(item);

    let recipe = null;
    let recipeItemName = item;
    const libraryData = require('../library/data');
    
    // Check if it is a tiered item (e.g. iron_sword)
    let tier = null;
    let resolvedMaterial = null;
    if (RECIPES[item]) {
      recipe = RECIPES[item];
    } else {
      for (const itemType of TIERED_ITEMS) {
        const tiers = getValidTiersForItem(itemType);
        for (const t of tiers) {
          if (item === `${t.tier}_${itemType}`) {
            recipe = RECIPES[`_${itemType}`];
            tier = t;
            resolvedMaterial = t.plankBased ? '_planks' : t.material;
            break;
          }
        }
        if (recipe) break;
      }
    }

    let recipeInfo = null;
    if (recipe) {
      const ingredients = [];
      for (const [key, amount] of Object.entries(recipe.cost)) {
        if (key === '_material') {
          ingredients.push({ item: resolvedMaterial, count: amount });
        } else {
          ingredients.push({ item: key, count: amount });
        }
      }
      recipeInfo = {
        count: recipe.output || 1,
        ingredients
      };
    } else if (canSmeltItem(item)) {
      const smeltRecipe = SMELT_RECIPES[item];
      recipeInfo = {
        count: smeltRecipe.output || 1,
        ingredients: [{ item: smeltRecipe.input, count: 1 }],
        smelt: true,
      };
    } else {
      const registryRecipe = libraryData.getRecipe(item);
      if (registryRecipe) {
        recipeInfo = registryRecipe;
      }
    }

    if (!recipeInfo) {
      visited.delete(item);
      return false; // Cannot craft this item (no recipe)
    }

    const deficit = qty - have;
    const batches = Math.ceil(deficit / recipeInfo.count);

    // Resolve ingredients first
    for (const ing of recipeInfo.ingredients) {
      const ingNeeded = ing.count * batches;
      const ok = resolve(ing.item, ingNeeded);
      if (!ok) {
        visited.delete(item);
        return false;
      }
    }

    // Add step to list
    const outputName = tier ? `${tier.tier}_${item.split('_').slice(1).join('_')}` : item;
    const finalItemName = PLANK_TYPES.includes(outputName) ? 'planks' : outputName;
    steps.push({
      action: recipeInfo.smelt ? 'smelt' : 'craft',
      item: finalItemName,
      count: batches,
      input: recipeInfo.smelt ? recipeInfo.ingredients[0]?.item : undefined,
      reason: `need ${qty} ${item}`
    });

    // Update virtual inventory: add the output of this craft and consume the requested quantity
    const totalOutput = batches * recipeInfo.count;
    virtualInventory[item] = (virtualInventory[item] || 0) + totalOutput - qty;

    visited.delete(item);
    return true;
  }

  const success = resolve(targetItem, count);
  return success ? steps : null;
}

// ─── Crafting Executor ────────────────────────────────────────────────────────

/**
 * Craft planks from any available log type.
 */
async function craftPlanks(bot, batches) {
  const log = findAnyOf(bot, LOG_TYPES);
  if (!log) {
    bot.chat('No logs to make planks!');
    return false;
  }

  const plankName = LOG_TO_PLANK[log.name] || 'oak_planks';
  const plankId = bot.registry.itemsByName[plankName]?.id;
  if (!plankId) {
    bot.chat(`Unknown plank type: ${plankName}`);
    return false;
  }

  // Planks don't need crafting table
  const recipes = bot.recipesFor(plankId, null, 1, null);
  if (!recipes.length) {
    bot.chat(`Can't find recipe for ${plankName}.`);
    return false;
  }

  try {
    await bot.craft(recipes[0], batches, null);
    console.log(`🧠 Brain:Craft → ${batches * 4} ${plankName} from ${log.name}`);
    return true;
  } catch (err) {
    console.log(`🧠 Brain:Craft planks failed: ${err.message}`);
    return false;
  }
}

/**
 * Craft sticks from planks.
 */
async function craftSticks(bot, batches) {
  const stickId = bot.registry.itemsByName['stick']?.id;
  if (!stickId) return false;

  const recipes = bot.recipesFor(stickId, null, 1, null);
  if (!recipes.length) {
    bot.chat('Can\'t find recipe for sticks.');
    return false;
  }

  try {
    await bot.craft(recipes[0], batches, null);
    console.log(`🧠 Brain:Craft → ${batches * 4} sticks`);
    return true;
  } catch (err) {
    console.log(`🧠 Brain:Craft sticks failed: ${err.message}`);
    return false;
  }
}

/**
 * Find or place a crafting table, navigate to it, return the block.
 */
async function ensureCraftingTable(bot, goals) {
  // First check if nearby
  const tableId = bot.registry.blocksByName['crafting_table']?.id;
  let table = bot.findBlock({ matching: tableId, maxDistance: 32 });
  let placedTemporary = false;

  if (!table) {
    // Try to craft one if we have planks
    const ps = plankStatus(bot);
    if (ps.have < 4 && ps.canMake >= 4) {
      await craftPlanks(bot, 1);
    }

    const tableItemId = bot.registry.itemsByName['crafting_table']?.id;
    if (tableItemId) {
      const tableRecipes = bot.recipesFor(tableItemId, null, 1, null);
      if (tableRecipes.length && countAnyOf(bot, PLANK_TYPES) >= 4) {
        try {
          await bot.craft(tableRecipes[0], 1, null);
          bot.chat('🔨 Crafted a crafting table!');
        } catch (err) {
          bot.chat(`Couldn't craft table: ${err.message}`);
          return null;
        }
      }
    }

    // Place it down
    const tableItem = findItemSlot(bot, 'crafting_table');
    if (tableItem) {
      try {
        const placement = findNearbyPlacementSpot(bot);
        if (!placement) {
          console.log('[Crafting] No nearby empty spot to place crafting table.');
          return null;
        }
        const { targetPos, targetBlock, supportBlock } = placement;

        if (targetBlock && !isAirLikeBlock(targetBlock) && targetBlock.boundingBox !== 'empty') {
          console.log(`[Crafting] Clearing ${targetBlock.name} at ${targetPos} before placing crafting table...`);
          const { sleep } = require('../utils');
          const digResult = await digSafely(bot, targetBlock, { requireDrops: false });
          if (!digResult.success) {
            console.log(`[Crafting] Refusing unsafe dig for ${targetBlock.name}: ${digResult.reason}`);
            return null;
          }
          await sleep(500);
        }

        if (supportBlock && !isAirLikeBlock(supportBlock)) {
          await bot.equip(tableItem, 'hand');
          const { Vec3 } = require('vec3');
          await bot.placeBlock(supportBlock, new Vec3(0, 1, 0));
          bot.chat('📦 Placed crafting table.');
          // Re-find it
          table = bot.findBlock({ matching: tableId, maxDistance: 8 });
          placedTemporary = !!table;
        }
      } catch (err) {
        console.log(`Couldn't place crafting table: ${err.message}`);
      }
    }
  }

  if (!table) {
    bot.chat('No crafting table nearby and couldn\'t make one!');
    return null;
  }

  // Navigate near it
  try {
    const { GoalNear } = goals || require('mineflayer-pathfinder').goals;
    await bot.pathfinder.goto(new GoalNear(
      table.position.x, table.position.y, table.position.z, 3
    ));
  } catch (err) {
    console.log(`Couldn't reach crafting table: ${err.message}`);
  }

  if (table && placedTemporary) {
    table._temporaryStation = true;
    trackTemporaryStation(bot, 'crafting_table', table.position);
  }

  return table;
}

/**
 * Execute a single craft step using mineflayer's recipe system.
 */
async function executeCraftStep(bot, step, table) {
  if (step.item === 'planks') {
    return await craftPlanks(bot, step.count);
  }
  if (step.item === 'stick') {
    return await craftSticks(bot, step.count);
  }
  if (step.action === 'smelt') {
    const cookBrain = require('../cook');
    const inputName = step.input === '_logs'
      ? (findAnyOf(bot, LOG_TYPES)?.name || null)
      : step.input;
    if (!inputName) {
      bot.chat(`Missing smelt input for ${step.item}.`);
      return false;
    }
    const result = await cookBrain.smeltItem(bot, inputName, step.count);
    return !!result?.success;
  }

  const itemId = bot.registry.itemsByName[step.item]?.id;
  if (!itemId) {
    bot.chat(`Unknown item: ${step.item}`);
    return false;
  }

  const useTable = RECIPES[step.item]?.needsTable !== false;
  const craftTable = useTable ? table : null;

  const recipes = bot.recipesFor(itemId, null, 1, craftTable);
  if (!recipes.length) {
    bot.chat(`No recipe for ${step.item} (missing materials or crafting table).`);
    return false;
  }

  try {
    await bot.craft(recipes[0], step.count, craftTable);
    return true;
  } catch (err) {
    bot.chat(`Craft failed for ${step.item}: ${err.message}`);
    return false;
  }
}

// ─── Main Craft Function ─────────────────────────────────────────────────────

/**
 * Smart craft: resolves dependencies, crafts intermediates, and produces the target.
 * Completely LLM-free.
 *
 * @param {import('mineflayer').Bot} bot
 * @param {string} itemName - What to craft (e.g., "diamond_sword", "bread", "planks")
 * @param {number} [count=1]
 * @param {object} [options]
 * @param {boolean} [options.silent=false]
 * @returns {Promise<{success: boolean, crafted: string|null, steps: number, reason: string}>}
 */
async function craft(bot, itemName, count = 1, options = {}) {
  const { silent = false } = options;
  const normalized = normalizeCraftName(itemName);

  // Special: "best sword", "best pickaxe", etc.
  if (normalized.startsWith('best_')) {
    const type = normalized.replace('best_', '');
    return await craftBestTiered(bot, type, count, options);
  }

  // Resolve the full dependency chain
  const steps = resolveDependencies(bot, normalized, count);
  if (!steps) {
    if (!silent) bot.chat(`Can't craft ${itemName} — missing materials or unknown recipe.`);
    // Show what we'd need
    if (!silent) showMissingMaterials(bot, normalized, count);
    return { success: false, crafted: null, steps: 0, reason: 'missing materials' };
  }

  if (steps.length === 0 && isItemSatisfied(bot, normalized, count)) {
    return { success: true, crafted: normalized, steps: 0, reason: 'already owned' };
  }

  if (!silent) bot.chat(`🔨 Crafting ${count}x ${itemName} (${steps.length} step${steps.length > 1 ? 's' : ''})...`);

  // Get crafting table if any step needs it
    const needsTable = steps.some(s => {
      if (s.action === 'smelt') return false;
      const r = RECIPES[s.item];
      return r ? r.needsTable : true; // default assume table needed
    });

  let table = null;
  let temporaryTableUsed = false;
  try {
    if (needsTable) {
      const { goals } = require('mineflayer-pathfinder');
      table = await ensureCraftingTable(bot, goals);
      if (!table && needsTable) {
        if (!silent) bot.chat('Need a crafting table but can\'t find or make one!');
        return { success: false, crafted: null, steps: 0, reason: 'no crafting table' };
      }
      temporaryTableUsed = !!table?._temporaryStation;
    }

    // Execute each step
    let completed = 0;
    for (const step of steps) {
      const ok = await executeCraftStep(bot, step, table);
      if (!ok) {
        if (!silent) bot.chat(`Craft chain failed at step: ${step.item} (${step.reason})`);
        return { success: false, crafted: step.item, steps: completed, reason: `failed at ${step.item}` };
      }

      if (!isItemSatisfied(bot, step.item, 1)) {
        const { sleep } = require('../utils');
        await sleep(500);
        if (!isItemSatisfied(bot, step.item, 1)) {
          if (step.action !== 'smelt') {
            const { goals } = require('mineflayer-pathfinder');
            await collectDrops(bot, goals, 250, { maxDistance: 10, maxItems: 8, passes: 2 }).catch(() => {});
          }
          if (!isItemSatisfied(bot, step.item, 1)) {
            if (!silent) bot.chat(`Craft verification failed for ${step.item}.`);
            return { success: false, crafted: step.item, steps: completed, reason: `verification failed at ${step.item}` };
          }
        }
      }

      completed++;
      console.log(`🧠 Brain:Craft step ${completed}/${steps.length}: ${step.item} x${step.count} ✓`);
    }

    const finalItem = steps.length > 0 ? steps[steps.length - 1].item : normalized;
    if (!isItemSatisfied(bot, finalItem, count)) {
      return { success: false, crafted: finalItem, steps: completed, reason: `missing final item ${finalItem}` };
    }
    if (!silent) bot.chat(`✅ Crafted ${count}x ${finalItem}!`);
    console.log(`🧠 Brain:Craft complete → ${count}x ${finalItem}`);

    if (/_(sword|axe)$/.test(finalItem)) {
      const attackBrain = require('./attack');
      await attackBrain.equipBestWeapon(bot).catch(() => {});
    } else if (/_(helmet|chestplate|leggings|boots)$/.test(finalItem)) {
      const item = findItemSlot(bot, finalItem);
      if (item) {
        const armorType = finalItem.split('_').slice(1).join('_');
        const dest = armorType === 'helmet' ? 'head'
          : armorType === 'chestplate' ? 'torso'
          : armorType === 'leggings' ? 'legs'
          : armorType === 'boots' ? 'feet'
          : null;
        if (dest) await bot.equip(item, dest).catch(() => {});
      }
    }

    return { success: true, crafted: finalItem, steps: completed, reason: 'success' };
  } finally {
    if (temporaryTableUsed) {
      const { goals } = require('mineflayer-pathfinder');
      await cleanupTemporaryStation(bot, 'crafting_table', goals, { silent: true });
    }
  }
}

/**
 * Craft the best possible tier of a tool/weapon/armor type.
 * E.g., craftBestTiered(bot, "sword") → tries diamond_sword, then iron, then stone, then wooden.
 */
async function craftBestTiered(bot, itemType, count = 1, options = {}) {
  const { silent = false } = options;

  if (!TIERED_ITEMS.includes(itemType)) {
    if (!silent) bot.chat(`${itemType} is not a tiered item.`);
    return { success: false, crafted: null, steps: 0, reason: 'not tiered' };
  }

  const owned = getBestOwnedTieredItem(bot, itemType);
  const craftable = getBestCraftableTier(bot, itemType, count);
  if (owned && (!craftable || owned.tier.level >= craftable.tier.level)) {
    if (!silent) bot.chat(`Already have ${owned.fullName}!`);
    return { success: true, crafted: owned.fullName, steps: 0, reason: 'already owned best' };
  }

  if (craftable) {
    if (!silent) bot.chat(`Best available: ${craftable.fullName}`);
    return await craft(bot, craftable.fullName, count, options);
  }

  // Try to craft from best tier downward
  const tiers = getValidTiersForItem(itemType);
  for (const t of tiers) {
    if (t.tier === 'netherite') continue;
    if (t.tier === 'chainmail') continue;
    const fullName = `${t.tier}_${itemType}`;
    const steps = resolveDependencies(bot, fullName, count);
    if (steps) {
      if (!silent) bot.chat(`Best available: ${fullName}`);
      return await craft(bot, fullName, count, options);
    }
  }

  if (owned) {
    if (!silent) bot.chat(`Using existing ${owned.fullName}.`);
    return { success: true, crafted: owned.fullName, steps: 0, reason: 'owned fallback' };
  }

  if (!silent) bot.chat(`Can't craft any ${itemType} - no materials available!`);
  return { success: false, crafted: null, steps: 0, reason: 'no materials for any tier' };
}

// ─── Integration: Gear Up ─────────────────────────────────────────────────────

/**
 * Full gear-up: craft best weapon + best tool set + armor if possible.
 * Called by combat/defense brain or player command.
 */
async function gearUp(bot, options = {}) {
  const { silent = false } = options;
  const results = [];

  if (!silent) bot.chat('⚔️ Gearing up...');

  // 1. Best sword (weapon)
  const sword = await craftBestTiered(bot, 'sword', 1, { silent: true });
  if (sword.success) results.push(sword.crafted);

  // 2. Best pickaxe (essential tool)
  const pickaxe = await craftBestTiered(bot, 'pickaxe', 1, { silent: true });
  if (pickaxe.success) results.push(pickaxe.crafted);

  // 3. Shield
  if (!hasItem(bot, 'shield')) {
    const r = await craft(bot, 'shield', 1, { silent: true });
    if (r.success) results.push('shield');
  }

  // 4. Armor (try chestplate first — most protection)
  for (const piece of ['chestplate', 'helmet', 'leggings', 'boots']) {
    const r = await craftBestTiered(bot, piece, 1, { silent: true });
    if (r.success) results.push(r.crafted);
  }

  if (results.length > 0) {
    if (!silent) bot.chat(`✅ Geared up: ${results.join(', ')}`);
  } else {
    if (!silent) bot.chat('Already geared up or no materials!');
  }

  return results;
}

// ─── Integration: Eat Brain Connection ────────────────────────────────────────

/**
 * Try to craft food when hungry. Called by eat brain when no food available.
 * Tries: bread (3 wheat), cookies (2 wheat + cocoa), pumpkin pie, etc.
 */
async function ensureCombatKit(bot, options = {}) {
  const results = [];
  const weapon = await ensureWeapon(bot);
  if (weapon?.item?.name) results.push(weapon.item.name);

  if (!hasItem(bot, 'shield')) {
    const shield = await craft(bot, 'shield', 1, { silent: true });
    if (shield.success) results.push('shield');
  }

  const armor = await ensureArmor(bot);
  results.push(...armor);

  const attackBrain = require('./attack');
  await attackBrain.prepareCombatWeapon(bot);

  const unique = [...new Set(results.filter(Boolean))];
  if (!options.silent && unique.length > 0) {
    bot.chat(`Combat kit ready: ${unique.join(', ')}`);
  }

  return unique;
}

async function craftFoodIfPossible(bot, options = {}) {
  const { silent = true } = options;

  // Priority list of food to try crafting
  const foodAttempts = [
    { item: 'bread',       needs: { wheat: 3 } },
    { item: 'cookie',      needs: { wheat: 2, cocoa_beans: 1 } },
    { item: 'pumpkin_pie', needs: { pumpkin: 1, sugar: 1, egg: 1 } },
  ];

  for (const attempt of foodAttempts) {
    let canCraft = true;
    for (const [mat, needed] of Object.entries(attempt.needs)) {
      if (countItem(bot, mat) < needed) {
        canCraft = false;
        break;
      }
    }
    if (canCraft) {
      // Craft as many as we can
      let maxBatches = Infinity;
      for (const [mat, needed] of Object.entries(attempt.needs)) {
        maxBatches = Math.min(maxBatches, Math.floor(countItem(bot, mat) / needed));
      }
      maxBatches = Math.min(maxBatches, 10); // cap at 10

      const result = await craft(bot, attempt.item, maxBatches, { silent });
      if (result.success) {
        if (!silent) bot.chat(`🍞 Auto-crafted ${maxBatches}x ${attempt.item}`);
        return result;
      }
    }
  }

  return { success: false, crafted: null, steps: 0, reason: 'no food ingredients' };
}

// ─── Integration: Combat Prep ─────────────────────────────────────────────────

/**
 * Ensure bot has a weapon before combat. Called by attack/defense brain.
 * Tries to craft the best available weapon if none equipped.
 */
async function ensureWeapon(bot) {
  const attackBrain = require('./attack');
  const best = attackBrain.pickBestWeapon(bot);
  const craftableSword = getBestCraftableTier(bot, 'sword', 1);
  const craftableAxe = getBestCraftableTier(bot, 'axe', 1);
  const craftableWeapon = [craftableSword, craftableAxe]
    .filter(Boolean)
    .sort((a, b) => b.tier.level - a.tier.level)[0] || null;
  const currentTier = getTierInfoByName(best?.item?.name || '');
  if (best && best.score > 5 && (!craftableWeapon || (currentTier && currentTier.level >= craftableWeapon.tier.level))) {
    return await attackBrain.equipBestWeapon(bot);
  }

  const result = craftableWeapon
    ? await craft(bot, craftableWeapon.fullName, 1, { silent: true })
    : await craftBestTiered(bot, 'sword', 1, { silent: true });
  if (result.success) {
    console.log('Brain:Craft auto-crafted ' + result.crafted + ' for combat');
    return await attackBrain.equipBestWeapon(bot);
  }

  return best ? await attackBrain.equipBestWeapon(bot) : null;
}

/**
 * Ensure bot has armor. Called by defense brain.
 */
async function ensureArmor(bot) {
  const armorTypes = ['helmet', 'chestplate', 'leggings', 'boots'];
  const crafted = [];

  for (const armorType of armorTypes) {
    const equippedTier = getEquippedArmorTier(bot, armorType);
    const owned = getOwnedTieredItem(bot, armorType);
    const craftable = getBestCraftableTier(bot, armorType, 1);
    const ownedLevel = Math.max(owned?.tier?.level || 0, equippedTier?.level || 0);
    const targetLevel = craftable?.tier?.level || 0;

    if (owned && ownedLevel >= targetLevel) {
      try {
        const dest = armorType === 'helmet' ? 'head' :
                     armorType === 'chestplate' ? 'torso' :
                     armorType === 'leggings' ? 'legs' : 'feet';
        await bot.equip(owned.item, dest);
      } catch {}
      continue;
    }

    const result = craftable
      ? await craft(bot, craftable.fullName, 1, { silent: true })
      : await craftBestTiered(bot, armorType, 1, { silent: true });
    if (result.success) {
      if (!owned || owned.item.name !== result.crafted) {
        crafted.push(result.crafted);
      }
      const item = findItemSlot(bot, result.crafted);
      if (item) {
        try {
          const dest = armorType === 'helmet' ? 'head' :
                       armorType === 'chestplate' ? 'torso' :
                       armorType === 'leggings' ? 'legs' : 'feet';
          await bot.equip(item, dest);
        } catch {}
      }
    }
  }

  return crafted;
}

// ─── Status / Report ──────────────────────────────────────────────────────────

/**
 * Show what materials are missing for a recipe.
 */
function showMissingMaterials(bot, itemName, count = 1) {
  let recipe = RECIPES[itemName];
  let tier = null;

  if (!recipe) {
    for (const type of TIERED_ITEMS) {
      const tiers = getValidTiersForItem(type);
      for (const t of tiers) {
        if (itemName === `${t.tier}_${type}`) {
          recipe = RECIPES[`_${type}`];
          tier = t;
          break;
        }
      }
      if (recipe) break;
    }
  }

  if (!recipe) {
    bot.chat(`Unknown recipe: ${itemName}`);
    return;
  }

  const missing = [];
  for (const [key, amount] of Object.entries(recipe.cost)) {
    const needed = amount * count;
    let have = 0;
    let displayName = key;

    if (key === '_material' && tier) {
      displayName = tier.plankBased ? 'planks' : tier.material;
      have = tier.plankBased ? countAnyOf(bot, PLANK_TYPES) : countItem(bot, tier.material);
    } else if (key === '_planks') {
      displayName = 'planks';
      have = countAnyOf(bot, PLANK_TYPES);
    } else if (key === '_sticks') {
      displayName = 'sticks';
      have = countItem(bot, 'stick');
    } else if (key === '_logs') {
      displayName = 'logs';
      have = countAnyOf(bot, LOG_TYPES);
    } else if (key === 'coal') {
      displayName = 'coal/charcoal';
      have = countItem(bot, 'coal') + countItem(bot, 'charcoal');
    } else {
      have = countItem(bot, key);
    }

    if (have < needed) {
      missing.push(`${displayName}: have ${have}, need ${needed}`);
    }
  }

  if (missing.length > 0) {
    bot.chat(`Missing: ${missing.join(' | ')}`);
  }
}

/**
 * Full crafting report: what can we craft, what materials do we have.
 */
function craftReport(bot) {
  const lines = [];
  lines.push('🔨 Craft Report');

  // Materials summary
  const ps = plankStatus(bot);
  const ss = stickStatus(bot);
  lines.push(`Materials: ${ps.totalLogs} logs, ${ps.have} planks, ${ss.have} sticks`);

  // Key materials
  const keyMaterials = ['cobblestone', 'iron_ingot', 'gold_ingot', 'diamond', 'coal', 'wheat'];
  const matLine = keyMaterials
    .map(m => { const c = countItem(bot, m); return c > 0 ? `${m.replace('_', ' ')} x${c}` : null; })
    .filter(Boolean)
    .join(', ');
  if (matLine) lines.push(`Resources: ${matLine}`);

  // What can we craft
  const canCraft = [];
  for (const type of TIERED_ITEMS) {
    const best = findBestTier(bot, RECIPES[`_${type}`], type);
    if (best) {
      canCraft.push(`${best.tier}_${type}`);
    }
  }
  // Non-tiered craftables
  if (hasItem(bot, 'wheat', 3)) canCraft.push('bread');
  if (countAnyOf(bot, PLANK_TYPES) >= 4 || countAnyOf(bot, LOG_TYPES) >= 1) canCraft.push('crafting_table');

  if (canCraft.length > 0) {
    lines.push(`Can craft: ${canCraft.join(', ')}`);
  } else {
    lines.push('Can craft: nothing (gather more materials!)');
  }

  return lines;
}

module.exports = {
  RECIPES,
  MATERIAL_TIERS,
  LOG_TYPES,
  PLANK_TYPES,
  LOG_TO_PLANK,
  TIERED_ITEMS,
  // Core
  craft,
  craftBestTiered,
  resolveDependencies,
  // Integration
  gearUp,
  ensureCombatKit,
  craftFoodIfPossible,
  ensureWeapon,
  ensureArmor,
  // Helpers
  countItem,
  countAnyOf,
  hasItem,
  findItemSlot,
  findAnyOf,
  plankStatus,
  stickStatus,
  findBestTier,
  getBestCraftableTier,
  getBestOwnedTieredItem,
  getOwnedTieredItem,
  getEquippedArmorTier,
  ensureCraftingTable,
  cleanupTemporaryStation,
  trackTemporaryStation,
  findNearbyPlacementSpot,
  // Reports
  craftReport,
  showMissingMaterials,
};
