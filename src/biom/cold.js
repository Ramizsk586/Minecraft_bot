// ─── Biome: Cold, Snowy & Mountain ───────────────────────────────────────────
// Covers taiga, snowy plains, frozen ocean edges, and mountain tops.
// Key trees: spruce, cherry (rare pink flowers)
// Survival challenge: cold damage (in powder snow), limited food

'use strict';

module.exports = {
  name: 'Cold / Snowy / Mountain',
  category: 'cold',

  keywords: [
    'taiga', 'snowy_taiga', 'old_growth_pine_taiga', 'old_growth_spruce_taiga',
    'snowy_plains', 'snowy_slopes', 'snowy_beach',
    'frozen_ocean', 'frozen_river', 'frozen_peaks',
    'grove', 'jagged_peaks', 'stony_peaks',
    'ice_spikes', 'dripstone_caves', 'cherry_grove',
  ],

  // Spruce is dominant in cold biomes
  logTypes: ['spruce_log', 'oak_log', 'cherry_log'],

  nativeWood: true,

  plankTypes: ['spruce_planks', 'oak_planks', 'cherry_planks'],

  // Avoid snow blocks for shelter — they melt or are too soft
  shelterBlocks: ['cobblestone', 'stone', 'spruce_planks', 'dirt'],

  canSleepInBed: true,

  foodSources: ['cooked_salmon', 'cooked_cod', 'bread', 'cooked_beef', 'sweet_berries', 'cooked_rabbit'],

  commonBlocks: ['snow', 'snow_block', 'ice', 'stone', 'gravel', 'spruce_log', 'powder_snow'],

  stoneEquivalents: ['cobblestone', 'stone'],

  usefulItems: ['leather_boots', 'torch', 'sweet_berries', 'fishing_rod'],

  hazards: ['powder_snow', 'stray', 'freezing', 'thin_food_supply', 'ice_water'],

  resourceTargets: {
    immediate: ['spruce_log', 'sweet_berries', 'stone'],
    tools: ['cobblestone', 'coal_ore', 'iron_ore'],
    food: ['sweet_berries', 'salmon', 'cod', 'rabbit', 'cow'],
    safety: ['leather_boots', 'torch', 'spruce_planks', 'cobblestone'],
  },

  relocation: {
    enabled: true,
    trigger: 'powder_snow_or_no_spruce',
    searchFor: ['taiga', 'river', 'plains', 'village'],
    maxLocalSearchRadius: 72,
    travelRadius: 160,
  },

  survivalPriorities: [
    { action: 'avoid', target: 'powder_snow', urgency: 100, reason: 'freezing can kill early bots quickly' },
    { action: 'find_wood', target: 'spruce_log', urgency: 94, reason: 'cold biomes usually provide spruce' },
    { action: 'craft', target: 'wooden_pickaxe', urgency: 86, reason: 'start wooden-first progression' },
    { action: 'find_food', target: 'sweet_berries_or_fish', urgency: 76, reason: 'passive mobs are less reliable' },
    { action: 'craft', target: 'leather_boots', urgency: 62, reason: 'safe movement over powder snow' },
    { action: 'mine', target: 'coal_ore', urgency: 58, reason: 'torches prevent snow/cave threat spirals' },
  ],

  survivalSteps: [
    'Chop nearby spruce trees (most common tree in taiga/snowy biomes)',
    'Craft planks → crafting table → wooden pickaxe',
    'AVOID stepping in powder snow — causes freezing damage',
    'Equip leather boots to walk on powder snow safely',
    'Mine cobblestone/stone for stone tools',
    'Build cobblestone or spruce-plank shelter (keeps out cold mobs)',
    'Collect sweet berries from berry bushes for emergency food',
    'Fish in rivers or oceans for salmon — great cold-biome food',
    'Place torches inside shelter for warmth and light',
    'Find and tame a wolf for protection against wolves',
  ],

  survivalTip: '🌨️ Cold biome: chopping spruce trees. Avoid powder snow! Build cobblestone shelter.',
};
