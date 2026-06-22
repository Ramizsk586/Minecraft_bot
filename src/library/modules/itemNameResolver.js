/**
 * Resolve arbitrary user-provided item/block names and aliases to official Minecraft names.
 * @param {string} name - Input query
 * @returns {string} resolved standard Minecraft name
 */
let currentBot = null;

function init(bot) {
  currentBot = bot;
}

function resolveItemName(name) {
  if (!name) return '';
  const clean = name.trim().toLowerCase().replace(/\s+/g, '_');
  
  const aliases = {
    // Blocks
    'wood': 'oak_log',
    'log': 'oak_log',
    'logs': 'oak_log',
    'plank': 'oak_planks',
    'planks': 'oak_planks',
    'table': 'crafting_table',
    'workbench': 'crafting_table',
    'crafting': 'crafting_table',
    'chest': 'chest',
    'furnace': 'furnace',
    'cobble': 'cobblestone',
    'stone': 'stone',
    'dirt': 'dirt',
    'grass': 'grass_block',
    'sand': 'sand',
    'wool': 'white_wool',
    
    // Tools
    'sword': 'iron_sword',
    'pickaxe': 'iron_pickaxe',
    'axe': 'iron_axe',
    'shovel': 'iron_shovel',
    'hoe': 'iron_hoe',
    
    // Items / Materials
    'coal': 'coal',
    'iron': 'iron_ingot',
    'gold': 'gold_ingot',
    'diamond': 'diamond',
    'diamonds': 'diamond',
    'raw_iron': 'raw_iron',
    'raw_gold': 'raw_gold',
    
    // Foods
    'beef': 'cooked_beef',
    'steak': 'cooked_beef',
    'meat': 'cooked_beef',
    'pork': 'cooked_porkchop',
    'porkchop': 'cooked_porkchop',
    'mutton': 'cooked_mutton',
    'chicken': 'cooked_chicken',
    'cod': 'cooked_cod',
    'fish': 'cooked_cod',
    'salmon': 'cooked_salmon',
    'bread': 'bread',
    'carrot': 'carrot',
    'potato': 'potato',
    'apple': 'apple'
  };

  // 1. Check static aliases first
  if (aliases[clean]) return aliases[clean];

  // 2. Query registry if available
  if (currentBot && currentBot.registry) {
    const registry = currentBot.registry;
    if (registry.itemsByName[clean] || registry.blocksByName[clean]) {
      return clean;
    }

    // Exact match with alphanumeric and underscores only
    const replaced = clean.replace(/[^a-z0-9_]/g, '');
    if (registry.itemsByName[replaced] || registry.blocksByName[replaced]) {
      return replaced;
    }

    // Singular/plural adjustment
    if (clean.endsWith('s')) {
      const singular = clean.slice(0, -1);
      if (registry.itemsByName[singular] || registry.blocksByName[singular]) {
        return singular;
      }
    }

    // Fuzzy matching / word overlap
    const allNames = [...Object.keys(registry.itemsByName), ...Object.keys(registry.blocksByName)];
    const parts = clean.split('_');
    let bestMatch = null;
    let maxOverlap = 0;
    
    for (const regName of allNames) {
      let score = 0;
      for (const part of parts) {
        if (regName.includes(part)) score++;
      }
      if (score > maxOverlap) {
        maxOverlap = score;
        bestMatch = regName;
      }
    }

    if (maxOverlap >= parts.length * 0.7 && bestMatch) {
      return bestMatch;
    }
  }

  return clean;
}

module.exports = {
  init,
  resolveItemName
};
