// ─── Biome: Nether ────────────────────────────────────────────────────────────
// Covers all Nether sub-biomes.
// Key "wood": crimson stems (Crimson Forest), warped stems (Warped Forest)
// ⚠️ CRITICAL: BEDS EXPLODE in the Nether — NEVER place or sleep in a bed here!
// Survival challenge: fire, lava, ghasts, piglins, no water

'use strict';

module.exports = {
  name: 'Nether',
  category: 'nether',

  keywords: [
    'nether', 'nether_wastes', 'crimson_forest', 'warped_forest',
    'soul_sand_valley', 'basalt_deltas',
  ],

  // No overworld trees — use fungal stems instead
  logTypes: ['crimson_stem', 'warped_stem'],

  nativeWood: true,

  plankTypes: ['crimson_planks', 'warped_planks'],

  // Non-flammable blocks preferred (no wood planks near fire/lava!)
  shelterBlocks: ['netherrack', 'blackstone', 'basalt', 'nether_bricks', 'cobblestone'],

  // ⚠️ BEDS EXPLODE IN THE NETHER — always false
  canSleepInBed: false,

  foodSources: ['cooked_porkchop', 'golden_apple', 'bread', 'cooked_beef'],

  commonBlocks: [
    'netherrack', 'soul_sand', 'soul_soil', 'basalt', 'blackstone',
    'nether_quartz_ore', 'nether_gold_ore', 'glowstone',
    'magma_block', 'crimson_nylium', 'warped_nylium',
  ],

  stoneEquivalents: ['blackstone', 'netherrack', 'cobblestone'],

  usefulItems: ['fire_resistance_potion', 'gold_ingot', 'ender_pearl', 'water_bucket'],

  hazards: ['bed_explosion', 'lava', 'ghast', 'piglin', 'hoglin', 'no_water', 'fire'],

  resourceTargets: {
    immediate: ['safe_platform', 'crimson_stem', 'warped_stem', 'blackstone'],
    tools: ['blackstone', 'netherrack', 'nether_quartz_ore'],
    food: ['hoglin', 'mushroom_stew', 'stored_food'],
    safety: ['golden_boots', 'fire_resistance_potion', 'cobblestone', 'blackstone'],
  },

  relocation: {
    enabled: true,
    trigger: 'basalt_delta_or_lava_lake',
    searchFor: ['crimson_forest', 'warped_forest', 'nether_wastes', 'portal'],
    maxLocalSearchRadius: 48,
    travelRadius: 160,
  },

  survivalPriorities: [
    { action: 'avoid', target: 'bed_use', urgency: 100, reason: 'beds explode in the Nether' },
    { action: 'avoid', target: 'lava', urgency: 98, reason: 'water cannot save the bot here' },
    { action: 'find_wood', target: 'crimson_or_warped_stem', urgency: 90, reason: 'fungal stems replace overworld trees' },
    { action: 'mine', target: 'blackstone', urgency: 82, reason: 'stone-tool equivalent and safer shelter block' },
    { action: 'equip', target: 'gold_armor', urgency: 72, reason: 'reduces piglin aggression' },
    { action: 'relocate', target: 'safer_forest_or_portal', urgency: 66, reason: 'basalt deltas and lava lakes are poor starts' },
  ],

  survivalSteps: [
    '⚠️ DO NOT place or sleep in a bed — beds EXPLODE in the Nether!',
    'Find a Crimson Forest for crimson_stem or Warped Forest for warped_stem',
    'Craft stems → crimson/warped planks → crafting table → tools',
    'Avoid lava lakes — always watch your footing',
    'Wear gold armor to prevent Piglin aggression',
    'Build blackstone or netherrack shelter as a safe room',
    'Mine nether quartz and nether gold ore for resources',
    'Avoid soul sand valleys (skeletons + ghasts)',
    'Collect glowstone for lighting your shelter',
    'Build a nether fortress route for blaze rods + wither skeleton skulls',
  ],

  survivalTip: '🔥 Nether survival: finding crimson/warped stems. NO BEDS — they explode! Using blackstone shelter.',
};
