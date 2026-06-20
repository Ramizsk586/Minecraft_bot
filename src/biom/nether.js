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
