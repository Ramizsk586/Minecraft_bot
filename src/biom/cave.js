// ─── Biome: Cave / Underground ────────────────────────────────────────────────
// Detected when the bot is underground (lush cave, deep dark, dripstone, etc.)
// No trees underground — must surface first.
// Survival challenge: darkness, mob density, no food underground

'use strict';

module.exports = {
  name: 'Cave / Underground',
  category: 'cave',

  keywords: ['lush_caves', 'dripstone_caves', 'deep_dark', 'underground'],

  // No trees underground — any overworld log after surfacing
  logTypes: ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log'],

  nativeWood: false,

  plankTypes: ['oak_planks', 'birch_planks', 'spruce_planks'],

  shelterBlocks: ['cobblestone', 'stone', 'dirt', 'gravel'],

  canSleepInBed: true,

  foodSources: ['bread', 'cooked_beef', 'cooked_porkchop', 'cave_spider_eye'],

  commonBlocks: [
    'stone', 'deepslate', 'cobblestone', 'gravel', 'tuff', 'calcite',
    'iron_ore', 'coal_ore', 'gold_ore', 'diamond_ore', 'copper_ore',
    'deepslate_iron_ore', 'deepslate_diamond_ore', 'sculk', 'sculk_sensor',
    'amethyst_block', 'pointed_dripstone', 'glow_lichen',
  ],

  stoneEquivalents: ['cobblestone', 'stone', 'deepslate', 'tuff'],

  usefulItems: ['torch', 'lantern', 'iron_pickaxe', 'shield'],

  survivalSteps: [
    'Place torches immediately — darkness causes mob spawns near you',
    'Priority: surface first if no tools, then return to cave',
    'Mine coal and iron ore as top priority underground',
    'Craft iron pickaxe before mining deeper',
    'Avoid the Deep Dark — Warden is extremely dangerous without full iron armor',
    'Watch for cave spiders — poison can kill at low health',
    'Dig straight up carefully (check for lava above first)',
    'Mark the path back with torches on the left wall (always on left going in)',
    'Collect iron for armor before going deeper than Y=30',
  ],

  survivalTip: '⛏️ Cave biome: placing torches, mining iron. Will surface for wood if needed.',
};
