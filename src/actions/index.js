// ─── Action Dispatcher ────────────────────────────────────────────────────────
// Central hub that imports all action modules and routes actions to handlers.

const { goals } = require('mineflayer-pathfinder');

const basicModule = require('./basic');
const buildingModule = require('./building');
const builderModule = require('./builder');
const inventoryModule = require('./inventory');
const miningModule = require('./mining');
const farmingModule = require('./farming');
const tradingModule = require('./trading');

/**
 * Extract handlers from a module's register() result.
 * Supports both { handlers: {...} } and raw { actionName: fn } return styles.
 */
function extractHandlers(registered) {
  if (registered && registered.handlers && typeof registered.handlers === 'object') {
    return registered.handlers;
  }
  // Filter out non-function properties (like setExecutor)
  const handlers = {};
  for (const [key, val] of Object.entries(registered)) {
    if (typeof val === 'function') {
      handlers[key] = val;
    }
  }
  return handlers;
}

/**
 * Initialize all action modules and return a unified executeAction function.
 * @param {import('mineflayer').Bot} bot
 * @returns {Function} executeAction(action) — dispatches any action object
 */
function createExecutor(bot) {
  // Register all modules
  const basic = basicModule.register(bot, goals);
  const building = buildingModule.register(bot, goals);
  const builder = builderModule.register(bot, goals);
  const inventory = inventoryModule.register(bot, goals);
  const mining = miningModule.register(bot, goals);
  const farming = farmingModule.register(bot, goals);
  const trading = tradingModule.register(bot, goals);

  // Merge all handlers into a single map (handles both return patterns)
  const allHandlers = {
    ...extractHandlers(basic),
    ...extractHandlers(building),
    ...extractHandlers(builder),
    ...extractHandlers(inventory),
    ...extractHandlers(mining),
    ...extractHandlers(farming),
    ...extractHandlers(trading),
  };

  console.log(`📋 Action dispatcher loaded ${Object.keys(allHandlers).length} actions: ${Object.keys(allHandlers).join(', ')}`);

  // The unified executor
  async function executeAction(action) {
    if (!action || typeof action !== 'object' || !action.action) {
      bot.chat('Invalid action plan.');
      return;
    }

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
