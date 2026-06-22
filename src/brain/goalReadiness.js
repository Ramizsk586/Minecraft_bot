const craftBrain = require('./craft');

function countItem(bot, itemName) {
  return bot.inventory.items()
    .filter(item => item.name === itemName)
    .reduce((sum, item) => sum + item.count, 0);
}

function compactMissing(list, limit = 8) {
  return list.slice(0, limit).map(entry => {
    if (typeof entry === 'string') return entry;
    return `${entry.itemName || entry.item || 'item'} x${entry.missing || entry.count || 0}`;
  });
}

function getCraftReadiness(bot, itemName, count = 1) {
  const normalized = craftBrain.normalizeCraftName
    ? craftBrain.normalizeCraftName(itemName)
    : String(itemName || '').trim().replace(/\s+/g, '_').toLowerCase();

  const currentCount = countItem(bot, normalized);
  if (currentCount >= count) {
    return {
      type: 'craft',
      target: normalized,
      ready: true,
      reason: 'already in inventory',
      currentCount,
      neededCount: count,
      missing: [],
    };
  }

  const steps = craftBrain.resolveDependencies(bot, normalized, count);
  if (steps) {
    return {
      type: 'craft',
      target: normalized,
      ready: true,
      reason: steps.length > 0 ? 'craftable from inventory/material chain' : 'already craftable',
      currentCount,
      neededCount: count,
      plannedSteps: steps.slice(0, 10).map(step => ({
        action: step.action,
        item: step.item,
        count: step.count,
      })),
      missing: [],
    };
  }

  const missing = [];
  let recipe = craftBrain.RECIPES?.[normalized] || null;
  let tierInfo = null;

  if (!recipe) {
    for (const type of craftBrain.TIERED_ITEMS || []) {
      for (const tier of (craftBrain.MATERIAL_TIERS || [])) {
        if (normalized === `${tier.tier}_${type}`) {
          recipe = craftBrain.RECIPES?.[`_${type}`] || null;
          tierInfo = tier;
          break;
        }
      }
      if (recipe) break;
    }
  }

  if (recipe?.cost) {
    for (const [key, amount] of Object.entries(recipe.cost)) {
      const needed = amount * count;
      let have = 0;
      let label = key;

      if (key === '_material' && tierInfo) {
        label = tierInfo.plankBased ? 'planks' : tierInfo.material;
        have = tierInfo.plankBased
          ? craftBrain.countAnyOf(bot, craftBrain.PLANK_TYPES)
          : countItem(bot, tierInfo.material);
      } else if (key === '_planks') {
        label = 'planks';
        have = craftBrain.countAnyOf(bot, craftBrain.PLANK_TYPES);
      } else if (key === '_sticks') {
        label = 'stick';
        have = countItem(bot, 'stick');
      } else if (key === '_logs') {
        label = 'logs';
        have = craftBrain.countAnyOf(bot, craftBrain.LOG_TYPES);
      } else if (key === 'coal') {
        label = 'coal/charcoal';
        have = countItem(bot, 'coal') + countItem(bot, 'charcoal');
      } else {
        have = countItem(bot, key);
      }

      if (have < needed) {
        missing.push({ itemName: label, missing: needed - have });
      }
    }
  }

  return {
    type: 'craft',
    target: normalized,
    ready: false,
    reason: 'missing crafting materials',
    currentCount,
    neededCount: count,
    missing,
  };
}

function getBuildReadiness(bot, blueprintName) {
  try {
    const builder = require('../actions/builder');
    const blueprint = builder.getBlueprint(blueprintName);
    if (!blueprint) {
      return {
        type: 'build',
        target: blueprintName,
        ready: false,
        reason: 'unknown blueprint',
        missing: [],
      };
    }

    const status = builder.getMaterialStatus(bot, blueprint);
    const missingRequired = status.required.filter(item => item.missing > 0);

    return {
      type: 'build',
      target: blueprintName,
      ready: missingRequired.length === 0,
      reason: missingRequired.length === 0 ? 'required materials already in inventory' : 'missing required build materials',
      missing: missingRequired,
      optionalMissing: status.optional.filter(item => item.missing > 0),
    };
  } catch (err) {
    return {
      type: 'build',
      target: blueprintName,
      ready: false,
      reason: `build readiness failed: ${err.message}`,
      missing: [],
    };
  }
}

function evaluateActionReadiness(bot, action = {}) {
  if (!action || !action.action) {
    return { ready: false, reason: 'invalid action', missing: [] };
  }

  if (action.action === 'craft' && action.item) {
    return getCraftReadiness(bot, action.item, action.count || 1);
  }

  if (action.action === 'build_house' && action.blueprint) {
    return getBuildReadiness(bot, action.blueprint);
  }

  if (action.action === 'mine' && action.block) {
    const hasPickaxe = bot.inventory.items().some(item => item.name.endsWith('_pickaxe'));
    return {
      type: 'mine',
      target: action.block,
      ready: hasPickaxe || action.block === 'sand' || action.block === 'dirt' || action.block === 'gravel',
      reason: hasPickaxe ? 'required mining tool available' : 'missing mining tool for this goal',
      missing: hasPickaxe ? [] : [{ itemName: 'pickaxe', missing: 1 }],
    };
  }

  return { type: action.action, target: action.item || action.block || action.blueprint || null, ready: true, reason: 'no preflight needed', missing: [] };
}

function buildAutonomyReadiness(bot) {
  const checks = [
    { key: 'craft_torch', action: { action: 'craft', item: 'torch', count: 1 } },
    { key: 'craft_shield', action: { action: 'craft', item: 'shield', count: 1 } },
    { key: 'craft_stone_pickaxe', action: { action: 'craft', item: 'stone_pickaxe', count: 1 } },
    { key: 'craft_iron_pickaxe', action: { action: 'craft', item: 'iron_pickaxe', count: 1 } },
    { key: 'craft_bread', action: { action: 'craft', item: 'bread', count: 1 } },
    { key: 'build_home', action: { action: 'build_house', blueprint: 'home' } },
    { key: 'build_cooking_shack', action: { action: 'build_house', blueprint: 'cooking_shack' } },
  ];

  const readiness = {};
  for (const check of checks) {
    const result = evaluateActionReadiness(bot, check.action);
    readiness[check.key] = {
      ready: result.ready,
      reason: result.reason,
      missing: compactMissing(result.missing || []),
    };
  }

  return {
    emptySlots: bot.inventory?.slots ? bot.inventory.slots.slice(9, 45).filter(slot => !slot).length : 0,
    inventoryStacks: bot.inventory.items().length,
    checks: readiness,
  };
}

module.exports = {
  getCraftReadiness,
  getBuildReadiness,
  evaluateActionReadiness,
  buildAutonomyReadiness,
};
