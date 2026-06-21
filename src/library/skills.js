/**
 * High-level skill routines wrapping the bot's direct actions.
 */

const craftBrain = require('../brain/craft');
const eatBrain = require('../brain/eat');
const data = require('./data');
const cookController = require('../cook');

/**
 * Gather wood logs by chopping trees.
 */
async function gatherLogs(bot) {
  return await bot.executeAction({ action: 'chop_tree' });
}

/**
 * Mine a specific block type.
 */
async function mineBlock(bot, blockName, count = 8) {
  return await bot.executeAction({ action: 'mine', block: blockName, count });
}

/**
 * Craft an item (handling log/plank dependencies if needed).
 */
async function craftItem(bot, itemName, count = 1) {
  return await craftBrain.craft(bot, itemName, count, { silent: true });
}

/**
 * Consume the best available food.
 */
async function eatFood(bot) {
  return await eatBrain.eat(bot, { silent: false, force: false });
}

function getRecipe(itemName) {
  return data.getRecipe(itemName);
}

function getBlockDrop(blockName) {
  return data.getBlockDrop(blockName);
}

function getMobInfo(mobName) {
  return data.getMobInfo(mobName);
}

function getBuild(buildName) {
  return data.getBuild(buildName);
}

function getCookableFood(itemName) {
  return data.getCookableFood(itemName);
}

function getSmeltableOre(itemName) {
  return data.getSmeltableOre(itemName);
}

async function cookBestFood(bot) {
  return cookController.cookBestFood(bot);
}

async function smeltBestOre(bot) {
  return cookController.smeltBestOre(bot);
}

function makeItem(itemName, count = 1) {
  return data.makeItem(itemName, count);
}

module.exports = {
  gatherLogs,
  mineBlock,
  craftItem,
  eatFood,
  getRecipe,
  getBlockDrop,
  getMobInfo,
  getBuild,
  getCookableFood,
  getSmeltableOre,
  cookBestFood,
  smeltBestOre,
  makeItem,
};
