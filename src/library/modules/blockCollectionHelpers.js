const { findBestTool } = require('../../utils');

/**
 * Select and return the best tool in inventory for a block.
 * @param {import('mineflayer').Bot} bot - The bot instance
 * @param {string} blockName - The block name
 * @returns {any|null} The best tool item or null
 */
function selectBestTool(bot, blockName) {
  return findBestTool(bot, blockName);
}

/**
 * Check if the block is accessible (not blocked by dangerous liquids or blocks).
 * @param {import('mineflayer').Bot} bot - The bot instance
 * @param {import('prismarine-block').Block} block - The block reference
 * @returns {boolean} accessible
 */
function isBlockSafe(bot, block) {
  if (!block) return false;
  // Make sure block is not surrounded by lava
  const adjacent = [
    block.position.offset(1, 0, 0),
    block.position.offset(-1, 0, 0),
    block.position.offset(0, 1, 0),
    block.position.offset(0, -1, 0),
    block.position.offset(0, 0, 1),
    block.position.offset(0, 0, -1)
  ];
  for (const pos of adjacent) {
    const adjBlock = bot.blockAt(pos);
    if (adjBlock && adjBlock.name === 'lava') {
      return false; // dangerous block
    }
  }
  return true;
}

module.exports = {
  selectBestTool,
  isBlockSafe
};
