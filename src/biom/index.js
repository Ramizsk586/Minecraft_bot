// ─── Biome Plan Registry ──────────────────────────────────────────────────────
// Central dispatcher: detects the bot's current biome and returns the
// matching biome survival plan. Each plan defines log types, shelter blocks,
// food sources, survival steps, and safety flags (e.g. no beds in Nether/End).

'use strict';

const desert = require('./desert');
const forest  = require('./forest');
const cold    = require('./cold');
const nether  = require('./nether');
const ocean   = require('./ocean');
const end     = require('./end');
const cave    = require('./cave');

// Ordered by specificity — more specific biomes first
const BIOME_PLANS = [nether, end, desert, cold, ocean, cave, forest];
const DEFAULT_SURFACE_LOG_TYPES = forest.logTypes.slice();

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Get the raw biome name from the bot's position.
 * @param {object} bot
 * @returns {string}
 */
function getBiomeName(bot) {
  try {
    return bot.blockAt(bot.entity.position)?.biome?.name || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Find the right biome plan for a given biome name string.
 * Falls back to 'forest' (temperate) if nothing matches.
 * @param {string} biomeName
 * @returns {object} biome plan
 */
function getPlanForBiomeName(biomeName) {
  if (!biomeName || biomeName === 'unknown') return forest;
  const lower = biomeName.toLowerCase();
  for (const plan of BIOME_PLANS) {
    if (plan.keywords.some(kw => lower.includes(kw))) {
      return plan;
    }
  }
  return forest; // default temperate
}

/**
 * Detect and return the current biome plan for the bot's position.
 * @param {object} bot
 * @returns {object} biome plan
 */
function getCurrentBiomePlan(bot) {
  const biomeName = getBiomeName(bot);
  return getPlanForBiomeName(biomeName);
}

// ─── Convenience Helpers ──────────────────────────────────────────────────────

/**
 * Get log types appropriate for the bot's current biome.
 * @param {object} bot
 * @returns {string[]}
 */
function getLogTypes(bot) {
  const plan = getCurrentBiomePlan(bot);
  if (!plan.logTypes.length) return DEFAULT_SURFACE_LOG_TYPES;
  return plan.logTypes;
}

/**
 * Returns true if it is safe to sleep in a bed here.
 * @param {object} bot
 * @returns {boolean}
 */
function canSleepInBed(bot) {
  return getCurrentBiomePlan(bot).canSleepInBed;
}

/**
 * Get the best shelter block available in the bot's inventory for this biome.
 * Falls back gracefully through the plan's preference list.
 * @param {object} bot
 * @returns {string|null}
 */
function getShelterBlock(bot) {
  const plan = getCurrentBiomePlan(bot);
  for (const blockName of plan.shelterBlocks) {
    const count = bot.inventory.items()
      .filter(i => i.name === blockName)
      .reduce((sum, i) => sum + i.count, 0);
    if (count >= 8) return blockName;
  }

  // Universal fallback — any block with 8+ count
  const FALLBACK = [
    'cobblestone', 'stone', 'dirt', 'sandstone', 'netherrack',
    'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
    'acacia_planks', 'dark_oak_planks', 'crimson_planks', 'warped_planks',
    'blackstone', 'basalt', 'end_stone',
  ];
  for (const blockName of FALLBACK) {
    const count = bot.inventory.items()
      .filter(i => i.name === blockName)
      .reduce((sum, i) => sum + i.count, 0);
    if (count >= 8) return blockName;
  }
  return null;
}

/**
 * Get the survival tip message for the current biome.
 * @param {object} bot
 * @returns {string}
 */
function getSurvivalTip(bot) {
  return getCurrentBiomePlan(bot).survivalTip;
}

function getFallbackLogTypes(bot) {
  const plan = getCurrentBiomePlan(bot);
  if (plan.category === 'nether') return nether.logTypes;
  return DEFAULT_SURFACE_LOG_TYPES;
}

function needsSurfaceWood(bot) {
  const plan = getCurrentBiomePlan(bot);
  return plan.nativeWood === false;
}

function getProgressionBlocks(bot) {
  const plan = getCurrentBiomePlan(bot);
  const blocks = new Set([
    ...(plan.stoneEquivalents || []),
    ...(plan.commonBlocks || []),
  ]);

  if (plan.category === 'nether') {
    blocks.add('blackstone');
    blocks.add('netherrack');
    blocks.add('nether_quartz_ore');
    blocks.add('nether_gold_ore');
  } else if (plan.category === 'ocean') {
    blocks.add('sandstone');
    blocks.add('gravel');
    blocks.add('clay');
  } else if (plan.category === 'cave') {
    blocks.add('coal_ore');
    blocks.add('iron_ore');
    blocks.add('deepslate_iron_ore');
  } else if (plan.category === 'end') {
    blocks.add('end_stone');
  } else {
    blocks.add('stone');
    blocks.add('cobblestone');
  }

  return [...blocks];
}

function getEmergencyFoodTargets(bot) {
  const plan = getCurrentBiomePlan(bot);
  return (plan.foodSources || []).filter(Boolean);
}

function getRiskFlags(bot) {
  const plan = getCurrentBiomePlan(bot);
  return {
    avoidBeds: !plan.canSleepInBed,
    avoidWaterBuckets: plan.category === 'nether',
    needsShoreFirst: plan.category === 'ocean',
    needsSurfaceWood: plan.nativeWood === false,
    avoidPowderSnow: plan.category === 'cold',
    avoidVoid: plan.category === 'end',
    prioritizeTorches: plan.category === 'cave',
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  // Plans
  plans: { desert, forest, cold, nether, ocean, end, cave },

  // Detection
  getBiomeName,
  getPlanForBiomeName,
  getCurrentBiomePlan,

  // Convenience helpers used by cortex.js and mine.js
  getLogTypes,
  getFallbackLogTypes,
  canSleepInBed,
  getShelterBlock,
  getSurvivalTip,
  getProgressionBlocks,
  getEmergencyFoodTargets,
  getRiskFlags,
  needsSurfaceWood,
};
