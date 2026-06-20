// ─── Biome: Forest, Plains & Jungle ──────────────────────────────────────────
// Covers temperate and tropical overworld biomes.
// Key trees: oak, birch, jungle, dark oak, mangrove
// Survival challenge: mobs at night, easiest overall

'use strict';

module.exports = {
  name: 'Forest / Plains / Jungle',
  category: 'forest',

  keywords: [
    'forest', 'birch_forest', 'old_growth_birch', 'dark_forest',
    'plains', 'sunflower_plains', 'meadow', 'flower_forest',
    'jungle', 'sparse_jungle', 'bamboo_jungle',
    'windswept_forest', 'windswept_hills', 'windswept_gravelly_hills',
    'mushroom_fields',
  ],

  // Trees naturally found here — search in this order
  logTypes: ['oak_log', 'birch_log', 'jungle_log', 'dark_oak_log', 'mangrove_log'],

  nativeWood: true,

  // Planks crafted from these logs
  plankTypes: ['oak_planks', 'birch_planks', 'jungle_planks', 'dark_oak_planks', 'mangrove_planks'],

  // Best shelter blocks
  shelterBlocks: ['cobblestone', 'stone', 'oak_planks', 'birch_planks', 'dirt'],

  canSleepInBed: true,

  foodSources: ['bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'apple', 'cooked_mutton'],

  commonBlocks: ['dirt', 'grass_block', 'stone', 'gravel', 'oak_log', 'birch_log'],

  stoneEquivalents: ['cobblestone', 'stone'],

  usefulItems: ['apple', 'stick', 'wheat_seeds', 'bone_meal'],

  survivalSteps: [
    'Chop nearby oak or birch trees for logs',
    'Craft planks → crafting table → wooden pickaxe',
    'Mine cobblestone/stone for stone tools',
    'Build a dirt or cobblestone shelter before night',
    'Collect wheat seeds from tall grass for farming',
    'Find and kill animals for food (cow, pig, chicken, sheep)',
    'Sleep in bed to skip night and avoid mob spawns',
    'Mine iron ore for iron tools and armor',
  ],

  survivalTip: '🌲 Forest survival: chopping oak/birch. Standard stone-tool progression.',
};
