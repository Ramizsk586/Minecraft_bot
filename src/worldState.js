// ─── Enhanced World State ─────────────────────────────────────────────────────

/**
 * Gather comprehensive world state for the AI decision engine.
 */
function getWorldState(bot) {
  const pos = bot.entity.position;
  const health = bot.health;
  const food = bot.food;

  // Inventory summary
  const inventory = bot.inventory.items().map(i => `${i.name} x${i.count}`);

  // Equipped items
  const heldItem = bot.heldItem ? `${bot.heldItem.name} x${bot.heldItem.count}` : 'nothing';

  // Armor check
  const armorSlots = [5, 6, 7, 8]; // head, chest, legs, feet
  const armorNames = ['Helmet', 'Chestplate', 'Leggings', 'Boots'];
  const armor = armorSlots.map((slot, idx) => {
    const item = bot.inventory.slots[slot];
    return item ? `${armorNames[idx]}: ${item.name}` : null;
  }).filter(Boolean);

  // Time
  const timeOfDay = bot.time.timeOfDay;
  const isDay = timeOfDay < 12000;

  // Biome
  const biome = bot.blockAt(pos)?.biome?.name || 'unknown';

  // Nearby entities
  const nearbyEntities = Object.values(bot.entities)
    .filter(e => e !== bot.entity && e.position.distanceTo(pos) < 30)
    .slice(0, 15)
    .map(e => `${e.name || e.username || 'unknown'} (${Math.round(e.position.distanceTo(pos))}m)`);

  // Nearby notable blocks (ores, chests, crafting tables, water, crops, furnaces)
  const notableBlocks = [];
  const scannedTypes = new Set();
  const notableNames = [
    'chest', 'crafting_table', 'furnace', 'blast_furnace', 'smoker',
    'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'emerald_ore',
    'lapis_ore', 'redstone_ore', 'copper_ore',
    'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_gold_ore',
    'deepslate_diamond_ore', 'deepslate_emerald_ore',
    'deepslate_lapis_ore', 'deepslate_redstone_ore', 'deepslate_copper_ore',
    'wheat', 'carrots', 'potatoes', 'beetroots', 'melon', 'pumpkin',
    'sugar_cane', 'bamboo',
    'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
  ];

  for (const name of notableNames) {
    const blockType = bot.registry.blocksByName[name];
    if (!blockType) continue;
    const found = bot.findBlocks({
      matching: blockType.id,
      maxDistance: 32,
      count: 5,
    });
    if (found.length > 0) {
      const nearest = found[0];
      notableBlocks.push(`${name} x${found.length} (nearest at ${nearest.x},${nearest.y},${nearest.z})`);
    }
  }

  return `
=== WORLD STATE ===
Position: x=${Math.round(pos.x)}, y=${Math.round(pos.y)}, z=${Math.round(pos.z)}
Health: ${Math.round(health)}/20 | Food: ${Math.round(food)}/20
Held item: ${heldItem}
Armor: ${armor.length > 0 ? armor.join(', ') : 'none'}
Time: ${isDay ? 'Day' : 'Night'} (${timeOfDay})
Biome: ${biome}
Inventory (${inventory.length} stacks): ${inventory.slice(0, 20).join(', ') || 'empty'}
Nearby entities: ${nearbyEntities.join(', ') || 'none'}
Notable blocks nearby: ${notableBlocks.join(' | ') || 'none detected'}
Current task: ${bot._currentTask || 'idle'}
`.trim();
}

module.exports = { getWorldState };
