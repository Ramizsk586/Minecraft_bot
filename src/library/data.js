const blockDropMap = require('./modules/irems/blockDropMap.json');
const mobMap = require('./modules/irems/mobMap.json');
const craftRecipes = require('./modules/irems/craft.json');
const builds = require('./builds');
const cook = require('./cook');
const { resolveItemName } = require('./modules/itemNameResolver');

function normalizeKey(name) {
  return resolveItemName(String(name || '').trim().toLowerCase());
}

function getBlockDrop(blockName) {
  const normalized = normalizeKey(blockName);
  return blockDropMap[normalized] || normalized;
}

function getMobInfo(mobName) {
  const normalized = String(mobName || '').trim().toLowerCase();
  return mobMap[normalized] || null;
}

function getRecipe(itemName) {
  const normalized = normalizeKey(itemName);
  return craftRecipes[normalized] || null;
}

function isHostileMob(mobName) {
  return getMobInfo(mobName)?.type === 'hostile';
}

function getMobThreat(mobName, fallback = 1) {
  return getMobInfo(mobName)?.threat ?? fallback;
}

function listKnownBlocks() {
  return Object.keys(blockDropMap);
}

function listKnownMobs() {
  return Object.keys(mobMap);
}

function listKnownRecipes() {
  return Object.keys(craftRecipes);
}

function getBuild(name) {
  return builds.getBlueprint(name);
}

function listKnownBuilds() {
  return builds.listBlueprints();
}

function getCookableFood(name) {
  return cook.getCookableFoodInfo(name);
}

function getSmeltableOre(name) {
  return cook.getOreCookingInfo(name);
}

module.exports = {
  blockDropMap,
  mobMap,
  craftRecipes,
  builds: builds.BLUEPRINTS,
  cook,
  getBlockDrop,
  getMobInfo,
  getRecipe,
  getBuild,
  getCookableFood,
  getSmeltableOre,
  isHostileMob,
  getMobThreat,
  listKnownBlocks,
  listKnownMobs,
  listKnownRecipes,
  listKnownBuilds,
};
