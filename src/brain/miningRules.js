// ─── Mining Tool Intelligence ───────────────────────────────────────────────
// Knows which blocks require which tool + minimum tier to drop items.
// Used by the mining action to prevent wasting time breaking blocks bare-handed,
// and to auto-craft replacements when tools break mid-mining.

'use strict';

// ─── Tool tier hierarchy (higher level = better) ────────────────────────────
// Must match craft.js MATERIAL_TIERS levels
const TIER_LEVELS = {
  hand:      0,
  wooden:    1,
  golden:    1, // Golden has same mining level as wooden
  stone:     2,
  iron:      3,
  diamond:   4,
  netherite: 5,
};

// Tiers ordered from best to worst (for upgrade checks)
const TIER_ORDER = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'];

const NEVER_HARVEST_BLOCKS = new Set([
  'air', 'cave_air', 'void_air', 'water', 'lava',
  'bedrock', 'barrier', 'command_block', 'chain_command_block', 'repeating_command_block',
  'end_portal', 'end_portal_frame', 'nether_portal', 'structure_block', 'jigsaw',
]);

const SILK_TOUCH_REQUIRED_BLOCKS = new Set([
  'glass', 'glass_pane', 'tinted_glass',
  'ice', 'packed_ice', 'blue_ice', 'frosted_ice',
  'grass_block', 'mycelium', 'podzol',
  'bookshelf', 'ender_chest',
]);

const SHEARS_REQUIRED_BLOCKS = new Set([
  'vine', 'glow_lichen', 'cobweb',
  'oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves',
  'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves',
]);

// ─── Block → Required Tool + Minimum Tier ───────────────────────────────────
// If a block is NOT in this table, it can be mined by anything (dirt, wood, etc.)
// Format: { tool: 'pickaxe'|'axe'|'shovel'|'hoe'|'shears', minTier: 'wooden'|'stone'|'iron'|'diamond' }
//
// Minecraft rules:
//   - Blocks with a required tool will NOT drop anything if broken by hand or wrong tool
//   - Blocks with a minTier will NOT drop anything if the tool tier is lower
//   - Breaking still happens, just no drops (wasted time!)

const BLOCK_TOOL_REQUIREMENTS = {
  // ═══════════════════════════════════════════════════════════════════════════
  // PICKAXE REQUIRED — wooden+ tier minimum
  // ═══════════════════════════════════════════════════════════════════════════
  stone:              { tool: 'pickaxe', minTier: 'wooden' },
  cobblestone:        { tool: 'pickaxe', minTier: 'wooden' },
  cobblestone_slab:   { tool: 'pickaxe', minTier: 'wooden' },
  cobblestone_stairs: { tool: 'pickaxe', minTier: 'wooden' },
  cobblestone_wall:   { tool: 'pickaxe', minTier: 'wooden' },
  mossy_cobblestone:  { tool: 'pickaxe', minTier: 'wooden' },
  smooth_stone:       { tool: 'pickaxe', minTier: 'wooden' },
  stone_bricks:       { tool: 'pickaxe', minTier: 'wooden' },
  mossy_stone_bricks: { tool: 'pickaxe', minTier: 'wooden' },
  cracked_stone_bricks: { tool: 'pickaxe', minTier: 'wooden' },
  chiseled_stone_bricks: { tool: 'pickaxe', minTier: 'wooden' },
  bricks:             { tool: 'pickaxe', minTier: 'wooden' },
  sandstone:          { tool: 'pickaxe', minTier: 'wooden' },
  red_sandstone:      { tool: 'pickaxe', minTier: 'wooden' },
  netherrack:         { tool: 'pickaxe', minTier: 'wooden' },
  basalt:             { tool: 'pickaxe', minTier: 'wooden' },
  polished_basalt:    { tool: 'pickaxe', minTier: 'wooden' },
  smooth_basalt:      { tool: 'pickaxe', minTier: 'wooden' },
  blackstone:         { tool: 'pickaxe', minTier: 'wooden' },
  end_stone:          { tool: 'pickaxe', minTier: 'wooden' },
  end_stone_bricks:   { tool: 'pickaxe', minTier: 'wooden' },
  purpur_block:       { tool: 'pickaxe', minTier: 'wooden' },
  purpur_pillar:      { tool: 'pickaxe', minTier: 'wooden' },
  prismarine:         { tool: 'pickaxe', minTier: 'wooden' },
  dark_prismarine:    { tool: 'pickaxe', minTier: 'wooden' },
  terracotta:         { tool: 'pickaxe', minTier: 'wooden' },
  nether_bricks:      { tool: 'pickaxe', minTier: 'wooden' },
  red_nether_bricks:  { tool: 'pickaxe', minTier: 'wooden' },
  furnace:            { tool: 'pickaxe', minTier: 'wooden' },
  blast_furnace:      { tool: 'pickaxe', minTier: 'wooden' },
  smoker:             { tool: 'pickaxe', minTier: 'wooden' },
  stonecutter:        { tool: 'pickaxe', minTier: 'wooden' },
  grindstone:         { tool: 'pickaxe', minTier: 'wooden' },
  brewing_stand:      { tool: 'pickaxe', minTier: 'wooden' },
  cauldron:           { tool: 'pickaxe', minTier: 'wooden' },
  hopper:             { tool: 'pickaxe', minTier: 'wooden' },
  rail:               { tool: 'pickaxe', minTier: 'wooden' },
  powered_rail:       { tool: 'pickaxe', minTier: 'wooden' },
  detector_rail:      { tool: 'pickaxe', minTier: 'wooden' },
  activator_rail:     { tool: 'pickaxe', minTier: 'wooden' },
  lantern:            { tool: 'pickaxe', minTier: 'wooden' },
  soul_lantern:       { tool: 'pickaxe', minTier: 'wooden' },
  chain:              { tool: 'pickaxe', minTier: 'wooden' },
  iron_bars:          { tool: 'pickaxe', minTier: 'wooden' },
  deepslate:          { tool: 'pickaxe', minTier: 'wooden' },
  cobbled_deepslate:  { tool: 'pickaxe', minTier: 'wooden' },
  polished_deepslate: { tool: 'pickaxe', minTier: 'wooden' },
  deepslate_bricks:   { tool: 'pickaxe', minTier: 'wooden' },
  deepslate_tiles:    { tool: 'pickaxe', minTier: 'wooden' },
  tuff:               { tool: 'pickaxe', minTier: 'wooden' },
  calcite:            { tool: 'pickaxe', minTier: 'wooden' },
  dripstone_block:    { tool: 'pickaxe', minTier: 'wooden' },
  pointed_dripstone:  { tool: 'pickaxe', minTier: 'wooden' },
  copper_block:       { tool: 'pickaxe', minTier: 'wooden' },  // dropped by stone+, but breaks with any pickaxe
  cut_copper:         { tool: 'pickaxe', minTier: 'wooden' },

  // Ores — wooden pickaxe tier
  coal_ore:           { tool: 'pickaxe', minTier: 'wooden' },
  deepslate_coal_ore: { tool: 'pickaxe', minTier: 'wooden' },
  nether_quartz_ore:  { tool: 'pickaxe', minTier: 'wooden' },
  nether_gold_ore:    { tool: 'pickaxe', minTier: 'wooden' },

  // ═══════════════════════════════════════════════════════════════════════════
  // PICKAXE REQUIRED — stone+ tier minimum
  // ═══════════════════════════════════════════════════════════════════════════
  iron_ore:               { tool: 'pickaxe', minTier: 'stone' },
  deepslate_iron_ore:     { tool: 'pickaxe', minTier: 'stone' },
  copper_ore:             { tool: 'pickaxe', minTier: 'stone' },
  deepslate_copper_ore:   { tool: 'pickaxe', minTier: 'stone' },
  lapis_ore:              { tool: 'pickaxe', minTier: 'stone' },
  deepslate_lapis_ore:    { tool: 'pickaxe', minTier: 'stone' },
  raw_iron_block:         { tool: 'pickaxe', minTier: 'stone' },
  raw_copper_block:       { tool: 'pickaxe', minTier: 'stone' },
  iron_block:             { tool: 'pickaxe', minTier: 'stone' },
  lapis_block:            { tool: 'pickaxe', minTier: 'stone' },
  lightning_rod:          { tool: 'pickaxe', minTier: 'stone' },

  // ═══════════════════════════════════════════════════════════════════════════
  // PICKAXE REQUIRED — iron+ tier minimum
  // ═══════════════════════════════════════════════════════════════════════════
  gold_ore:               { tool: 'pickaxe', minTier: 'iron' },
  deepslate_gold_ore:     { tool: 'pickaxe', minTier: 'iron' },
  redstone_ore:           { tool: 'pickaxe', minTier: 'iron' },
  deepslate_redstone_ore: { tool: 'pickaxe', minTier: 'iron' },
  diamond_ore:            { tool: 'pickaxe', minTier: 'iron' },
  deepslate_diamond_ore:  { tool: 'pickaxe', minTier: 'iron' },
  emerald_ore:            { tool: 'pickaxe', minTier: 'iron' },
  deepslate_emerald_ore:  { tool: 'pickaxe', minTier: 'iron' },
  gold_block:             { tool: 'pickaxe', minTier: 'iron' },
  raw_gold_block:         { tool: 'pickaxe', minTier: 'iron' },
  diamond_block:          { tool: 'pickaxe', minTier: 'iron' },
  emerald_block:          { tool: 'pickaxe', minTier: 'iron' },
  redstone_block:         { tool: 'pickaxe', minTier: 'iron' },

  // ═══════════════════════════════════════════════════════════════════════════
  // PICKAXE REQUIRED — diamond+ tier minimum
  // ═══════════════════════════════════════════════════════════════════════════
  obsidian:               { tool: 'pickaxe', minTier: 'diamond' },
  crying_obsidian:        { tool: 'pickaxe', minTier: 'diamond' },
  respawn_anchor:         { tool: 'pickaxe', minTier: 'diamond' },
  netherite_block:        { tool: 'pickaxe', minTier: 'diamond' },
  ancient_debris:         { tool: 'pickaxe', minTier: 'diamond' },

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEARS REQUIRED
  // ═══════════════════════════════════════════════════════════════════════════
  cobweb:                 { tool: 'shears', minTier: 'wooden' },

  // ═══════════════════════════════════════════════════════════════════════════
  // AXE speeds it up but hand works too — NO drop restriction
  // These are NOT required, just recommended. Omitted from this table.
  // ═══════════════════════════════════════════════════════════════════════════
};

// Also add terracotta color variants dynamically
const TERRACOTTA_COLORS = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink',
  'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
];
for (const color of TERRACOTTA_COLORS) {
  BLOCK_TOOL_REQUIREMENTS[`${color}_terracotta`] = { tool: 'pickaxe', minTier: 'wooden' };
  BLOCK_TOOL_REQUIREMENTS[`${color}_glazed_terracotta`] = { tool: 'pickaxe', minTier: 'wooden' };
  BLOCK_TOOL_REQUIREMENTS[`${color}_concrete`] = { tool: 'pickaxe', minTier: 'wooden' };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get the tool requirement for a block.
 * @param {string} blockName - The block name (e.g., 'iron_ore')
 * @returns {{ tool: string, minTier: string } | null} - Requirements, or null if no tool needed
 */
function getBlockRequirement(blockName) {
  return BLOCK_TOOL_REQUIREMENTS[blockName] || null;
}

/**
 * Get the tier level number for a tool tier name.
 * @param {string} tier - e.g., 'wooden', 'stone', 'iron'
 * @returns {number} - 0 for hand, 1 for wooden, 2 for stone, etc.
 */
function getTierLevel(tier) {
  if (!tier) return 0;
  // Extract tier from tool name like 'stone_pickaxe' → 'stone'
  const tierName = tier.split('_')[0];
  return TIER_LEVELS[tierName] || 0;
}

/**
 * Check if a tool item meets the minimum tier requirement for a block.
 * @param {object|null} toolItem - The inventory item (mineflayer item), or null for hand
 * @param {string} blockName - The block name to mine
 * @returns {{ canMine: boolean, willDrop: boolean, reason: string }}
 */
function checkToolForBlock(toolItem, blockName) {
  if (NEVER_HARVEST_BLOCKS.has(blockName)) {
    return {
      canMine: false,
      willDrop: false,
      reason: `${blockName} should not be mined`,
    };
  }

  if (SILK_TOUCH_REQUIRED_BLOCKS.has(blockName)) {
    return {
      canMine: true,
      willDrop: false,
      reason: `${blockName} needs Silk Touch to drop itself`,
    };
  }

  if (SHEARS_REQUIRED_BLOCKS.has(blockName) && toolItem?.name !== 'shears') {
    return {
      canMine: true,
      willDrop: false,
      reason: `${blockName} needs shears to drop safely`,
    };
  }

  const req = BLOCK_TOOL_REQUIREMENTS[blockName];

  // No requirement → can mine with anything and items will drop
  if (!req) {
    return { canMine: true, willDrop: true, reason: 'no tool required' };
  }

  // No tool equipped
  if (!toolItem) {
    return {
      canMine: true,  // Can break block (slowly)
      willDrop: false, // But NO drops
      reason: `${blockName} requires a ${req.minTier}+ ${req.tool} to drop items`,
    };
  }

  const toolName = toolItem.name;

  // Check tool type match
  const isCorrectTool = toolName.endsWith(`_${req.tool}`);
  if (!isCorrectTool) {
    return {
      canMine: true,
      willDrop: false,
      reason: `${blockName} requires a ${req.tool}, not ${toolName}`,
    };
  }

  // Check tier level
  const tierName = toolName.replace(`_${req.tool}`, '');
  const toolLevel = TIER_LEVELS[tierName] || 0;
  const reqLevel = TIER_LEVELS[req.minTier] || 0;

  if (toolLevel < reqLevel) {
    return {
      canMine: true,
      willDrop: false,
      reason: `${blockName} requires ${req.minTier}+ ${req.tool}, but ${toolName} is too weak`,
    };
  }

  return {
    canMine: true,
    willDrop: true,
    reason: `${toolName} is sufficient for ${blockName}`,
  };
}

/**
 * Determine the best tool type needed for a block (pickaxe/axe/shovel).
 * @param {string} blockName
 * @returns {string|null} - Tool type name, or null if none required
 */
function getRequiredToolType(blockName) {
  const req = BLOCK_TOOL_REQUIREMENTS[blockName];
  return req ? req.tool : null;
}

/**
 * Determine the minimum tier name needed for a block.
 * @param {string} blockName
 * @returns {string|null} - Tier name (e.g., 'stone'), or null if none required
 */
function getMinimumTier(blockName) {
  const req = BLOCK_TOOL_REQUIREMENTS[blockName];
  return req ? req.minTier : null;
}

/**
 * Given a held tool (or null), determine the best tool to craft for mining a specific block.
 * Returns null if current tool is sufficient or if no upgrade is possible.
 * @param {object} bot - mineflayer bot
 * @param {string} blockName - Block being mined
 * @param {object|null} currentTool - Currently held tool item
 * @returns {{ toolType: string, reason: string } | null}
 */
function getNeededToolCraft(bot, blockName, currentTool) {
  const req = BLOCK_TOOL_REQUIREMENTS[blockName];

  // Figure out what tool type is needed
  let toolType;
  if (req) {
    toolType = req.tool;
  } else {
    // For non-required blocks, check TOOL_FOR_BLOCK style mapping
    if (blockName.includes('log') || blockName.includes('planks') || blockName.includes('wood')) {
      toolType = 'axe';
    } else if (['dirt', 'grass_block', 'sand', 'gravel', 'clay', 'mud', 'soul_sand', 'soul_soil'].includes(blockName)) {
      toolType = 'shovel';
    } else if (blockName.includes('ore') || blockName.includes('stone') || blockName.includes('deepslate')) {
      toolType = 'pickaxe';
    } else {
      return null; // No specific tool needed
    }
  }

  // Can't craft shears through tiered system
  if (toolType === 'shears' || toolType === 'hoe') return null;

  // Check if current tool is the right type
  if (currentTool && currentTool.name.endsWith(`_${toolType}`)) {
    return null; // Already have the right tool type
  }

  return {
    toolType,
    reason: currentTool
      ? `${currentTool.name} broke or is wrong type — need ${toolType}`
      : `no tool equipped — need ${toolType} for ${blockName}`,
  };
}

module.exports = {
  TIER_LEVELS,
  TIER_ORDER,
  NEVER_HARVEST_BLOCKS,
  SILK_TOUCH_REQUIRED_BLOCKS,
  SHEARS_REQUIRED_BLOCKS,
  BLOCK_TOOL_REQUIREMENTS,
  getBlockRequirement,
  getTierLevel,
  checkToolForBlock,
  getRequiredToolType,
  getMinimumTier,
  getNeededToolCraft,
};
