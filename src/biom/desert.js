// ─── Biome: Desert & Savanna ──────────────────────────────────────────────────
// Covers desert, badlands, and savanna biomes.
// Key trees: acacia (savanna), dead oak (desert villages)
// Survival challenge: scarce trees, no water, fast food drain

'use strict';

module.exports = {
  name: 'Desert / Savanna',
  category: 'desert',

  // Biome name keywords (lowercase match)
  keywords: ['desert', 'badlands', 'eroded_badlands', 'wooded_badlands', 'savanna', 'windswept_savanna'],

  // Trees naturally found here — search in this order
  logTypes: ['acacia_log', 'oak_log'],

  nativeWood: true,

  // Planks crafted from these logs
  plankTypes: ['acacia_planks', 'oak_planks'],

  // Best shelter blocks available in this biome (ordered by preference)
  shelterBlocks: ['sandstone', 'red_sandstone', 'smooth_sandstone', 'acacia_planks', 'cobblestone', 'stone'],

  // Can the bot safely sleep in a bed here?
  canSleepInBed: true,

  // Food sources to look for / craft in this biome
  foodSources: ['cooked_rabbit', 'bread', 'cooked_beef', 'apple', 'cactus'],

  // Blocks commonly used for mining (not trees)
  commonBlocks: ['sandstone', 'red_sandstone', 'sand', 'gravel', 'cactus', 'terracotta', 'red_terracotta'],

  // Blocks to prefer mining for cobblestone equivalent (for tools)
  stoneEquivalents: ['sandstone', 'stone', 'cobblestone'],

  // Items that are useful specifically in this biome
  usefulItems: ['water_bucket', 'cactus', 'sand', 'bone'],

  // Step-by-step survival priorities for this biome
  survivalSteps: [
    'Find and chop an acacia_log or oak_log (acacia preferred — more common in savanna)',
    'Craft planks → crafting table → wooden pickaxe',
    'Mine sandstone/cobblestone for stone tools',
    'Find water source or village for food',
    'Build sandstone shelter (avoid placing raw sand — it falls)',
    'Farm wheat or bread in village if found',
    'Collect cactus for XP/dye trading',
    'Watch for rabbit and cow spawns at night for food',
  ],

  // Chat tip shown when autonomous mode activates in this biome
  survivalTip: '🏜️ Desert survival: acacia trees ahead — gathering logs first. Using sandstone for shelter.',
};
