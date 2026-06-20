const blockDropMap = require('./modules/irems/blockDropMap.json');
const mobMap = require('./modules/irems/mobMap.json');
const craftRecipes = require('./modules/irems/craft.json');
const builds = require('./builds');
const cook = require('./cook');
const { resolveItemName } = require('./modules/itemNameResolver');

let currentBot = null;

function init(bot) {
  currentBot = bot;
}

function normalizeKey(name) {
  return resolveItemName(String(name || '').trim().toLowerCase());
}

function getBlockDrop(blockName) {
  if (currentBot && currentBot.registry) {
    const registry = currentBot.registry;
    const block = registry.blocksByName[blockName.toLowerCase()];
    if (block) {
      if (block.drops && block.drops.length > 0) {
        const dropId = block.drops[0];
        return registry.items[dropId]?.name || blockName;
      }
      return blockName;
    }
  }
  const normalized = normalizeKey(blockName);
  return blockDropMap[normalized] || normalized;
}

function getMobInfo(mobName) {
  const normalized = String(mobName || '').trim().toLowerCase();
  if (currentBot && currentBot.registry) {
    const registry = currentBot.registry;
    const entity = registry.entitiesByName[normalized];
    if (entity) {
      const isHostile = entity.type === 'hostile' || entity.type === 'monster' || entity.category === 'Hostile mobs';
      const type = isHostile ? 'hostile' : (entity.type === 'passive' || entity.category === 'Passive mobs' ? 'passive' : 'neutral');
      const staticInfo = mobMap[normalized];
      return {
        type,
        health: staticInfo ? staticInfo.health : 20,
        isAggressive: staticInfo ? staticInfo.isAggressive : (type === 'hostile'),
        drops: staticInfo ? staticInfo.drops : [],
        threat: staticInfo ? staticInfo.threat : (type === 'hostile' ? 3 : (type === 'neutral' ? 1 : 0))
      };
    }
  }
  return mobMap[normalized] || null;
}

function getRecipe(itemName) {
  const normalized = normalizeKey(itemName);
  if (currentBot && currentBot.registry) {
    const registry = currentBot.registry;
    const item = registry.itemsByName[normalized];
    if (item) {
      const recipes = registry.recipes[item.id];
      if (recipes && recipes.length > 0) {
        const r = recipes[0];
        const ingredientsMap = {};
        const ingredientList = r.ingredients || (r.inShape ? r.inShape.flat() : []);
        for (const ing of ingredientList) {
          if (ing === null || ing === -1) continue;
          const ingId = typeof ing === 'object' ? ing.id : ing;
          const ingCount = typeof ing === 'object' ? (ing.count || 1) : 1;
          const ingName = registry.items[ingId]?.name;
          if (ingName) {
            ingredientsMap[ingName] = (ingredientsMap[ingName] || 0) + ingCount;
          }
        }
        return {
          count: r.result.count,
          table: r.requiresTable || false,
          ingredients: Object.entries(ingredientsMap).map(([name, count]) => ({ item: name, count }))
        };
      }
    }
  }
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
  init,
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
