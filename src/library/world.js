/**
 * Find nearby blocks of a specific type or matching a predicate.
 * @param {import('mineflayer').Bot} bot - The bot instance
 * @param {string|function|number|number[]} blockNameOrPredicate - Target block name, ID, list of IDs, or matching predicate function
 * @param {number} maxDistance - Maximum search radius
 * @param {number} count - Maximum count of blocks to find
 * @returns {import('vec3').Vec3[]} array of block positions
 */
function getNearbyBlocks(bot, blockNameOrPredicate, maxDistance = 32, count = 10) {
  let matching;
  if (typeof blockNameOrPredicate === 'function') {
    matching = blockNameOrPredicate;
  } else if (Array.isArray(blockNameOrPredicate)) {
    matching = blockNameOrPredicate.map(name => typeof name === 'string' ? bot.registry.blocksByName[name]?.id : name).filter(id => id != null);
  } else if (typeof blockNameOrPredicate === 'string') {
    matching = bot.registry.blocksByName[blockNameOrPredicate]?.id;
  } else {
    matching = blockNameOrPredicate;
  }
  if (matching == null || (Array.isArray(matching) && matching.length === 0)) return [];

  return bot.findBlocks({
    matching: matching,
    maxDistance: maxDistance,
    count: count
  });
}

/**
 * Find the nearest threat to the bot.
 * @param {import('mineflayer').Bot} bot - The bot instance
 * @param {number} maxDistance - Threat search radius
 * @returns {any|null} nearest threat entity reference
 */
function getNearestThreat(bot, maxDistance = 16) {
  const attackBrain = require('../brain/attack');
  return attackBrain.findNearbyHostile(bot, maxDistance);
}

/**
 * Find nearby entities (mobs or players) within range.
 * @param {import('mineflayer').Bot} bot - The bot instance
 * @param {string} type - 'player' or 'mob'
 * @param {number} maxDistance - Search radius
 * @returns {any[]} list of matching entities
 */
function getNearbyEntities(bot, type = 'mob', maxDistance = 32) {
  return Object.values(bot.entities).filter(entity => {
    if (!entity || !entity.isValid || entity.id === bot.entity.id) return false;
    
    // Check range
    const dist = bot.entity.position.distanceTo(entity.position);
    if (dist > maxDistance) return false;
    
    if (type === 'player') return entity.type === 'player';
    if (type === 'mob') return entity.type === 'mob';
    return true;
  });
}

/**
 * Find the nearest single block of a specific type or matching a predicate.
 * @param {import('mineflayer').Bot} bot - The bot instance
 * @param {string|function|number|number[]} blockNameOrPredicate - Target block name, ID, list of IDs, or matching predicate function
 * @param {number} maxDistance - Maximum search radius
 * @returns {any|null} nearest block reference or null
 */
function getNearestBlock(bot, blockNameOrPredicate, maxDistance = 32) {
  let matching;
  if (typeof blockNameOrPredicate === 'function') {
    matching = blockNameOrPredicate;
  } else if (Array.isArray(blockNameOrPredicate)) {
    matching = blockNameOrPredicate.map(name => typeof name === 'string' ? bot.registry.blocksByName[name]?.id : name).filter(id => id != null);
  } else if (typeof blockNameOrPredicate === 'string') {
    matching = bot.registry.blocksByName[blockNameOrPredicate]?.id;
  } else {
    matching = blockNameOrPredicate;
  }
  if (matching == null || (Array.isArray(matching) && matching.length === 0)) return null;

  return bot.findBlock({
    matching: matching,
    maxDistance: maxDistance
  });
}

module.exports = {
  getNearbyBlocks,
  getNearestThreat,
  getNearbyEntities,
  getNearestBlock
};
