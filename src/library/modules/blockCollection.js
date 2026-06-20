const { navigateToPosition, lookAtPosition } = require('./searchNavigation');
const { selectBestTool, isBlockSafe } = require('./blockCollectionHelpers');
const { collectDrops } = require('../../utils');
const config = require('./blockCollectionConfig');
const { goals } = require('mineflayer-pathfinder');

/**
 * Coordinate mining and collecting of a specific block type.
 * @param {import('mineflayer').Bot} bot - The bot instance
 * @param {string} blockName - The block name
 * @param {number} count - Target count to collect
 * @returns {Promise<boolean>} successfully mined at least one block
 */
async function findAndCollectBlock(bot, blockName, count = 1) {
  const blockId = bot.registry.blocksByName[blockName]?.id;
  if (blockId == null) {
    console.log(`[BlockCollection] Unknown block type: ${blockName}`);
    return false;
  }

  let minedCount = 0;
  for (let i = 0; i < count; i++) {
    const block = bot.findBlock({
      matching: blockId,
      maxDistance: config.maxScanDistance
    });

    if (!block) {
      console.log(`[BlockCollection] Out of nearby blocks for: ${blockName}`);
      break;
    }

    if (!isBlockSafe(bot, block)) {
      console.log(`[BlockCollection] Block at ${block.position} is unsafe (near lava). Skipping.`);
      continue;
    }

    // Move close
    const reached = await navigateToPosition(bot, block.position, 3);
    if (!reached) continue;

    // Equip best tool
    const tool = selectBestTool(bot, blockName);
    if (tool) {
      try {
        await bot.equip(tool, 'hand');
      } catch {}
    }

    // Break
    try {
      await lookAtPosition(bot, block.position.offset(0.5, 0.5, 0.5));
      await bot.dig(block);
      minedCount++;
    } catch (err) {
      console.log(`[BlockCollection] Dig failed: ${err.message}`);
    }

    // Collect item drops
    try {
      await collectDrops(bot, goals);
    } catch {}
  }

  return minedCount > 0;
}

module.exports = {
  findAndCollectBlock
};
