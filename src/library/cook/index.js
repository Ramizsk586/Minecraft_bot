const oreSmelting = require('./ores/ore_smelting.json');
const cookableFoods = require('./food/cookable_foods.json');

function getOreCookingInfo(itemName) {
  return oreSmelting[itemName] || null;
}

function getCookableFoodInfo(itemName) {
  return cookableFoods[itemName] || null;
}

function listCookableOres() {
  return Object.keys(oreSmelting);
}

function listCookableFoods() {
  return Object.keys(cookableFoods);
}

function getBestCookableFood(bot) {
  const items = bot.inventory.items();
  const candidates = items
    .map(item => ({
      item,
      info: cookableFoods[item.name] || null,
    }))
    .filter(entry => entry.info && entry.item.count > 0)
    .sort((a, b) => b.info.priority - a.info.priority);

  return candidates[0] || null;
}

function getBestCookableOre(bot) {
  const items = bot.inventory.items();
  const candidates = items
    .map(item => ({
      item,
      info: oreSmelting[item.name] || null,
    }))
    .filter(entry => entry.info && entry.item.count > 0)
    .sort((a, b) => b.info.priority - a.info.priority);

  return candidates[0] || null;
}

module.exports = {
  oreSmelting,
  cookableFoods,
  getOreCookingInfo,
  getCookableFoodInfo,
  listCookableOres,
  listCookableFoods,
  getBestCookableFood,
  getBestCookableOre,
};
