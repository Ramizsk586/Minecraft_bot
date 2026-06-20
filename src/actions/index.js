// ─── Action Dispatcher ────────────────────────────────────────────────────────
// Central hub that imports all action modules and routes actions to handlers.

const { goals } = require('mineflayer-pathfinder');

const basicModule = require('./basic');
const buildingModule = require('./building');
const inventoryModule = require('./inventory');
const miningModule = require('./mining');
const farmingModule = require('./farming');

/**
 * Initialize all action modules and return a unified executeAction function.
 * @param {import('mineflayer').Bot} bot
 * @returns {Function} executeAction(action) — dispatches any action object
 */
function createExecutor(bot) {
  // Register all modules
  const basic = basicModule.register(bot, goals);
  const building = buildingModule.register(bot, goals);
  const inventory = inventoryModule.register(bot, goals);
  const mining = miningModule.register(bot, goals);
  const farming = farmingModule.register(bot, goals);

  // Merge all handlers into a single map
  const allHandlers = {
    ...basic.handlers,
    ...building.handlers,
    ...inventory.handlers,
    ...mining.handlers,
    ...farming.handlers,
  };

  // The unified executor
  async function executeAction(action) {
    console.log('🤖 Executing:', JSON.stringify(action));

    const handler = allHandlers[action.action];
    if (handler) {
      try {
        await handler(action);
      } catch (err) {
        console.error(`Action "${action.action}" failed:`, err);
        bot.chat(`Action failed: ${err.message}`);
      }
    } else {
      bot.chat(`Unknown action: ${action.action}`);
    }
  }

  // Wire up the sequence executor in basic module so it can call executeAction
  if (basic.setExecutor) {
    basic.setExecutor(executeAction);
  }

  return executeAction;
}

module.exports = { createExecutor };
