// ─── Biome: The End ───────────────────────────────────────────────────────────
// Covers all End dimension biomes.
// ⚠️ CRITICAL: BEDS EXPLODE in The End — NEVER use a bed!
// Survival challenge: Ender Dragon, Endermen, no food, no water, void below

'use strict';

module.exports = {
  name: 'The End',
  category: 'end',

  keywords: ['end', 'the_end', 'end_highlands', 'end_midlands', 'end_barrens', 'end_islands', 'small_end_islands'],

  // No trees in The End — no wood available natively
  logTypes: [],

  nativeWood: false,

  plankTypes: [],

  // End stone is the only block available
  shelterBlocks: ['end_stone', 'cobblestone', 'stone', 'obsidian'],

  // ⚠️ BEDS EXPLODE IN THE END — always false
  canSleepInBed: false,

  foodSources: ['chorus_fruit', 'golden_apple', 'cooked_beef', 'bread'],

  commonBlocks: ['end_stone', 'obsidian', 'purpur_block', 'end_rod', 'chorus_plant', 'chorus_flower'],

  stoneEquivalents: ['end_stone', 'obsidian'],

  usefulItems: ['ender_pearl', 'golden_apple', 'chorus_fruit', 'slow_falling_potion'],

  survivalSteps: [
    '⚠️ DO NOT place or sleep in a bed — beds EXPLODE in The End!',
    'Stay away from the void — falling is instant death',
    'Defeat the Ender Dragon to fully unlock The End',
    'Eat chorus fruit for teleportation — great for escaping Endermen',
    'Do NOT look at Endermen unless prepared to fight',
    'Mine end stone for building shelter and bridges',
    'Find End Cities (after defeating the dragon) for Elytra and shulker boxes',
    'Collect purpur blocks and end rods for building',
    'Build a small end stone shelter to hide from Endermen at night',
    'Use snowballs or arrows to shoot out End Crystals before fighting the dragon',
  ],

  survivalTip: '🌌 End survival: NO BEDS — they explode! Eating chorus fruit. Building end stone shelter.',
};
