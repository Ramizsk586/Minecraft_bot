const skills = require('./skills');
const world = require('./world');
const data = require('./data');
const { resolveItemName } = require('./modules/itemNameResolver');

const SKILL_HANDLERS = {
  gatherLogs: async (bot) => {
    await skills.gatherLogs(bot);
    return true;
  },
  mineBlock: async (bot, params) => {
    const blockName = resolveItemName(params.blockName || params.block || '');
    if (!blockName) return false;
    await skills.mineBlock(bot, blockName, params.count || 8);
    return true;
  },
  craftItem: async (bot, params) => {
    const itemName = resolveItemName(params.itemName || params.item || '');
    if (!itemName) return false;
    const result = await skills.craftItem(bot, itemName, params.count || 1);
    return !!result?.success;
  },
  eatFood: async (bot) => {
    const eatResult = await skills.eatFood(bot);
    return !!eatResult?.ate;
  },
  getBlockDrop: async (_bot, params) => {
    const blockName = params.blockName || params.block || '';
    return data.getBlockDrop(blockName);
  },
  getMobInfo: async (_bot, params) => {
    const mobName = params.mobName || params.mob || '';
    return data.getMobInfo(mobName);
  },
  getRecipe: async (_bot, params) => {
    const itemName = params.itemName || params.item || '';
    return data.getRecipe(itemName);
  },
  getBuild: async (_bot, params) => {
    const buildName = params.buildName || params.blueprint || params.name || '';
    return data.getBuild(buildName);
  },
  getCookableFood: async (_bot, params) => {
    const itemName = params.itemName || params.item || '';
    return data.getCookableFood(itemName);
  },
  getSmeltableOre: async (_bot, params) => {
    const itemName = params.itemName || params.item || '';
    return data.getSmeltableOre(itemName);
  },
  cookBestFood: async (bot) => {
    const result = await skills.cookBestFood(bot);
    return !!result?.success;
  },
  smeltBestOre: async (bot) => {
    const result = await skills.smeltBestOre(bot);
    return !!result?.success;
  },
};

/**
 * Execute a skill by name with arguments.
 * Useful for LLM tool call bindings.
 * @param {import('mineflayer').Bot} bot - The bot instance
 * @param {string} skillName - Name of the skill to trigger
 * @param {any} params - Arguments
 * @returns {Promise<boolean>} execution outcome
 */
async function executeSkill(bot, skillName, params = {}) {
  console.log(`[Library Functions] Invoking: ${skillName} with parameters:`, params);

  const handler = SKILL_HANDLERS[skillName];
  if (!handler) {
    console.log(`[Library Functions] Skill not found: ${skillName}`);
    return false;
  }

  return handler(bot, params);
}

module.exports = {
  executeSkill,
  resolveItemName,
  world,
  data,
  availableSkills: Object.keys(SKILL_HANDLERS),
};
