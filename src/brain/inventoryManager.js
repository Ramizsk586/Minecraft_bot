const SURVIVAL_KEEP = new Set([
  'crafting_table',
  'furnace',
  'shield',
  'water_bucket',
  'bucket',
  'bed',
  'torch',
  'coal',
  'charcoal',
  'bread',
  'wheat',
  'wheat_seeds',
  'stick',
  'cobblestone',
  'iron_ingot',
  'raw_iron',
  'diamond',
  'gold_ingot',
  'oak_planks',
  'spruce_planks',
  'birch_planks',
  'jungle_planks',
  'acacia_planks',
  'dark_oak_planks',
  'mangrove_planks',
  'cherry_planks',
  'crimson_planks',
  'warped_planks',
]);

const DISPOSABLE_BLOCKS = new Set([
  'dirt',
  'cobbled_deepslate',
  'netherrack',
  'granite',
  'diorite',
  'andesite',
  'sand',
  'gravel',
  'rotten_flesh',
]);

const TOOL_SUFFIXES = ['_pickaxe', '_axe', '_shovel', '_hoe', '_sword'];
const ARMOR_SUFFIXES = ['_helmet', '_chestplate', '_leggings', '_boots'];
const FOOD_NAMES = [
  'bread', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken',
  'cooked_cod', 'cooked_salmon', 'baked_potato', 'apple', 'golden_apple',
];

function sumItem(bot, name) {
  return bot.inventory.items()
    .filter(item => item.name === name)
    .reduce((sum, item) => sum + item.count, 0);
}

function countMatches(bot, predicate) {
  return bot.inventory.items()
    .filter(predicate)
    .reduce((sum, item) => sum + item.count, 0);
}

function getEmptySlotCount(bot) {
  const inventoryStart = 9;
  const inventoryEnd = 45;
  let empty = 0;
  for (let slot = inventoryStart; slot < inventoryEnd; slot++) {
    if (!bot.inventory.slots[slot]) empty++;
  }
  return empty;
}

function isTool(name = '') {
  return TOOL_SUFFIXES.some(suffix => name.endsWith(suffix));
}

function isArmor(name = '') {
  return ARMOR_SUFFIXES.some(suffix => name.endsWith(suffix)) || name === 'shield';
}

function isCriticalFood(name = '') {
  return FOOD_NAMES.includes(name) || name.startsWith('cooked_');
}

function getReservedAmount(name = '') {
  if (name === 'torch') return 16;
  if (name === 'stick') return 8;
  if (name === 'coal' || name === 'charcoal') return 8;
  if (name === 'cobblestone') return 32;
  if (name.endsWith('_planks')) return 16;
  if (name === 'bread') return 6;
  if (name === 'wheat') return 9;
  if (name === 'wheat_seeds') return 8;
  if (name === 'raw_iron' || name === 'iron_ingot') return 8;
  return SURVIVAL_KEEP.has(name) ? 1 : 0;
}

function shouldKeepItem(bot, item) {
  const name = item?.name || '';
  if (!name) return false;
  if (SURVIVAL_KEEP.has(name)) return true;
  if (name.endsWith('_bed')) return true;
  if (isTool(name) || isArmor(name)) return true;
  if (isCriticalFood(name)) return true;
  if (getReservedAmount(name) > 0) return true;
  return false;
}

function getDisposableItems(bot) {
  const all = bot.inventory.items();
  const disposable = [];

  for (const item of all) {
    const name = item.name;
    const total = sumItem(bot, name);
    const reserve = getReservedAmount(name);
    const extra = total - reserve;
    if (extra <= 0) continue;

    const lowValue = DISPOSABLE_BLOCKS.has(name) || name.includes('sapling') || name.includes('seeds');
    if (!lowValue && shouldKeepItem(bot, item)) continue;

    disposable.push({
      name,
      total,
      reserve,
      extra,
      lowValue,
    });
  }

  return disposable.sort((a, b) => b.extra - a.extra);
}

function getInventoryPressure(bot) {
  const emptySlots = getEmptySlotCount(bot);
  const foodUnits = countMatches(bot, item => isCriticalFood(item.name));
  const torchCount = sumItem(bot, 'torch');
  const hasShield = countMatches(bot, item => item.name === 'shield') > 0 || bot.inventory.slots[45]?.name === 'shield';
  const hasPickaxe = countMatches(bot, item => item.name.endsWith('_pickaxe')) > 0;
  const hasAxe = countMatches(bot, item => item.name.endsWith('_axe')) > 0;
  const disposable = getDisposableItems(bot);

  return {
    emptySlots,
    foodUnits,
    torchCount,
    hasShield,
    hasPickaxe,
    hasAxe,
    disposable,
    shouldCleanup: emptySlots <= 4 && disposable.length > 0,
    shouldPanicCleanup: emptySlots <= 2 && disposable.length > 0,
  };
}

function buildKeepList(bot) {
  const keep = new Set();
  for (const item of bot.inventory.items()) {
    if (shouldKeepItem(bot, item)) keep.add(item.name);
  }
  return [...keep];
}

module.exports = {
  SURVIVAL_KEEP,
  getEmptySlotCount,
  getInventoryPressure,
  getDisposableItems,
  buildKeepList,
  shouldKeepItem,
  getReservedAmount,
};
