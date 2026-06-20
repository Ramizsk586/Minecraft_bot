// ─── Biome: Ocean, Beach & River ─────────────────────────────────────────────
// Covers all ocean, beach, and river biomes.
// No trees on water — must reach land first.
// Survival challenge: drowning, no food, navigating to shore

'use strict';

module.exports = {
  name: 'Ocean / Beach / River',
  category: 'ocean',

  keywords: [
    'ocean', 'deep_ocean', 'warm_ocean', 'lukewarm_ocean', 'cold_ocean', 'frozen_ocean',
    'deep_lukewarm_ocean', 'deep_cold_ocean', 'deep_frozen_ocean',
    'beach', 'snowy_beach', 'stony_shore',
    'river', 'frozen_river',
  ],

  // Any overworld log — need to reach land and find trees there
  logTypes: ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log'],

  nativeWood: false,

  plankTypes: ['oak_planks', 'birch_planks', 'spruce_planks'],

  // Nearest solid blocks that may be on shore
  shelterBlocks: ['cobblestone', 'stone', 'oak_planks', 'sand', 'dirt'],

  canSleepInBed: true,

  foodSources: ['cooked_cod', 'cooked_salmon', 'bread', 'cooked_beef'],

  commonBlocks: ['water', 'sand', 'gravel', 'sandstone', 'clay', 'seagrass', 'kelp', 'coral'],

  stoneEquivalents: ['cobblestone', 'stone'],

  usefulItems: ['bucket', 'fishing_rod', 'boat', 'sugar_cane'],

  hazards: ['drowning', 'guardian', 'drowned', 'no_native_wood', 'slow_movement'],

  resourceTargets: {
    immediate: ['shore', 'air', 'boat', 'kelp'],
    tools: ['shore_stone', 'cobblestone', 'sandstone'],
    food: ['cod', 'salmon', 'kelp', 'shipwreck_chest'],
    safety: ['boat', 'door', 'torch', 'sandstone'],
  },

  relocation: {
    enabled: true,
    trigger: 'in_water_or_no_shore',
    searchFor: ['shore', 'forest', 'plains', 'village', 'shipwreck'],
    maxLocalSearchRadius: 48,
    travelRadius: 256,
  },

  survivalPriorities: [
    { action: 'relocate', target: 'nearest_shore', urgency: 100, reason: 'drowning beats every other task' },
    { action: 'surface', target: 'air', urgency: 98, reason: 'keep air before pathing or mining' },
    { action: 'find_wood', target: 'shore_trees', urgency: 88, reason: 'ocean has no native early wood' },
    { action: 'craft', target: 'boat', urgency: 72, reason: 'fast water travel and escape' },
    { action: 'find_food', target: 'fish_or_kelp', urgency: 66, reason: 'food before long shoreline travel' },
    { action: 'mine', target: 'shore_stone', urgency: 54, reason: 'avoid underwater mining until geared' },
  ],

  survivalSteps: [
    '🌊 PRIORITY ONE: swim to the nearest shore immediately — avoid drowning',
    'Watch air bar — surface regularly to breathe',
    'Once on shore, find the nearest biome with trees (look for forests nearby)',
    'Fish using a fishing rod for easy early food',
    'Look for shipwrecks for treasure chests (food, maps, tools)',
    'Find buried treasure with a treasure map from shipwreck',
    'Collect sand and smelt to glass, or use for building',
    'Mine clay for bricks',
    'Build a sea-level shelter using stone/cobblestone from the ocean floor',
  ],

  survivalTip: '🌊 Ocean biome: swimming to shore first. Will fish for food and find nearby forest.',
};
