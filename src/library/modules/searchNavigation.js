const { goals } = require('mineflayer-pathfinder');

/**
 * Navigate the bot near a block position.
 * @param {import('mineflayer').Bot} bot - The bot instance
 * @param {import('vec3').Vec3} position - The destination coordinate
 * @param {number} range - Range distance tolerance
 * @returns {Promise<boolean>} successfully reached target
 */
async function navigateToPosition(bot, position, range = 2) {
  if (!position) return false;
  const goal = new goals.GoalNear(position.x, position.y, position.z, range);
  try {
    await bot.pathfinder.goto(goal);
    return true;
  } catch (err) {
    console.log(`[SearchNavigation] Navigation failed: ${err.message}`);
    return false;
  }
}

/**
 * Look at a coordinate position with transition.
 * @param {import('mineflayer').Bot} bot - The bot instance
 * @param {import('vec3').Vec3} position - Target position
 */
async function lookAtPosition(bot, position) {
  if (!position) return;
  try {
    await bot.lookAt(position, true);
  } catch (err) {
    console.log(`[SearchNavigation] Look failed: ${err.message}`);
  }
}

module.exports = {
  navigateToPosition,
  lookAtPosition
};
