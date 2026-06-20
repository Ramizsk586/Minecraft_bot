/**
 * Resolve arbitrary user-provided item/block names and aliases to official Minecraft names.
 * @param {string} name - Input query
 * @returns {string} resolved standard Minecraft name
 */
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

  return aliases[clean] || clean;
}

module.exports = {
  resolveItemName
};
