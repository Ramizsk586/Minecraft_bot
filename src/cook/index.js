const { Vec3 } = require('vec3');
const cookData = require('../library/cook');
const { sleep, collectDrops } = require('../utils');

function findNearbyCookingBlock(bot) {
  const names = ['smoker', 'blast_furnace', 'furnace'];
  for (const name of names) {
    const block = bot.findBlock({
      matching: bot.registry.blocksByName[name]?.id,
      maxDistance: 16,
    });
    if (block) return block;
  }
  return null;
}

function pickFuel(bot) {
  const fuelNames = ['coal', 'charcoal', 'coal_block', 'oak_planks', 'stick'];
  return bot.inventory.items().find(item => fuelNames.includes(item.name)) || null;
}

async function ensureFurnacePlaced(bot) {
  const nearby = findNearbyCookingBlock(bot);
  if (nearby) return nearby;

  let furnaceItem = bot.inventory.items().find(item => item.name === 'furnace');
  if (!furnaceItem) {
    // Try to craft a furnace (8 cobblestone)
    const craftBrain = require('../brain/craft');
    const steps = craftBrain.resolveDependencies(bot, 'furnace', 1);
    if (steps) {
      bot.chat('🔧 Furnace not found in inventory. Auto-crafting a furnace...');
      const craftResult = await craftBrain.craft(bot, 'furnace', 1, { silent: true });
      if (craftResult && craftResult.success) {
        furnaceItem = bot.inventory.items().find(item => item.name === 'furnace');
      }
    }
  }

  if (!furnaceItem) return null;

  const pos = bot.entity.position.floored();
  const targetPos = pos.offset(1, 0, 0);
  const targetBlock = bot.blockAt(targetPos);

  try {
    // If there's a block in the way, dig it!
    if (targetBlock && targetBlock.name !== 'air' && targetBlock.name !== 'cave_air' && targetBlock.name !== 'water' && targetBlock.name !== 'lava') {
      console.log(`[Cooking] Target place block ${targetBlock.name} at ${targetPos} is solid. Digging it first...`);
      const { digSafely } = require('../utils');
      const digResult = await digSafely(bot, targetBlock, { requireDrops: true });
      if (!digResult.success) {
        console.log(`[Cooking] Refusing unsafe dig for ${targetBlock.name}: ${digResult.reason}`);
        return null;
      }
      await sleep(500);
    }

    const placeOn = bot.blockAt(targetPos.offset(0, -1, 0));
    if (placeOn && placeOn.name !== 'air') {
      await bot.equip(furnaceItem, 'hand');
      await bot.placeBlock(placeOn, new Vec3(0, 1, 0));
      await sleep(400);
      const placed = bot.blockAt(targetPos);
      if (placed) {
        bot._temporaryCookingFurnace = placed.position.clone();
      }
      return placed;
    }
  } catch (err) {
    console.log(`[Cooking] Place furnace failed: ${err.message}`);
  }
  return null;
}

async function collectTemporaryFurnace(bot) {
  if (!bot._temporaryCookingFurnace) return false;

  const furnacePos = bot._temporaryCookingFurnace;
  const furnaceBlock = bot.blockAt(furnacePos);
  if (!furnaceBlock || furnaceBlock.name !== 'furnace') {
    bot._temporaryCookingFurnace = null;
    return false;
  }

  try {
    const { goals } = require('mineflayer-pathfinder');
    await bot.pathfinder.goto(new goals.GoalNear(furnacePos.x, furnacePos.y, furnacePos.z, 3));
  } catch {}

  try {
    const { digSafely } = require('../utils');
    const digResult = await digSafely(bot, furnaceBlock, { requireDrops: true });
    if (!digResult.success) {
      console.log(`[Cooking] Refusing unsafe furnace pickup: ${digResult.reason}`);
      return false;
    }
    const { goals } = require('mineflayer-pathfinder');
    await collectDrops(bot, goals, 250, { maxDistance: 10, maxItems: 8, passes: 2 });
  } catch (err) {
    console.log(`[Cooking] Failed to collect temporary furnace: ${err.message}`);
    return false;
  }

  bot._temporaryCookingFurnace = null;
  return true;
}

async function ensureFuel(bot) {
  let fuel = pickFuel(bot);
  if (fuel) return fuel;

  // No fuel available. Let's try to craft planks from logs!
  const craftBrain = require('../brain/craft');
  const logs = craftBrain.countAnyOf(bot, craftBrain.LOG_TYPES);
  if (logs > 0) {
    bot.chat('🔧 No furnace fuel. Crafting planks from logs...');
    const result = await craftBrain.craft(bot, 'planks', 1, { silent: true });
    if (result && result.success) {
      fuel = pickFuel(bot);
    }
  }
  return fuel;
}

async function smeltItem(bot, inputName, count = 1) {
  const input = bot.inventory.items().find(item => item.name === inputName);
  if (!input || input.count <= 0) {
    return { success: false, reason: 'missing input' };
  }

  const fuel = await ensureFuel(bot);
  if (!fuel) {
    return { success: false, reason: 'missing fuel' };
  }

  const station = await ensureFurnacePlaced(bot);
  if (!station) {
    return { success: false, reason: 'no furnace available' };
  }

  try {
    const furnace = await bot.openFurnace(station);
    const amountToSmelt = Math.min(input.count, count);
    await furnace.putInput(input.type, input.metadata, amountToSmelt);
    await furnace.putFuel(fuel.type, fuel.metadata, Math.max(1, Math.ceil(amountToSmelt / 8)));
    
    // Wait for smelting to complete
    const startTime = Date.now();
    const timeoutMs = amountToSmelt * 10000 + 5000; // 10s per item + 5s buffer
    
    while ((Date.now() - startTime) < timeoutMs) {
      await sleep(1000);
      const outputSlot = furnace.slots[2];
      const inputSlot = furnace.slots[0];
      
      if (outputSlot && outputSlot.count >= amountToSmelt) {
        break;
      }
      if (!inputSlot && outputSlot && outputSlot.count > 0) {
        break;
      }
    }

    await furnace.takeOutput().catch(() => {});
    furnace.close();
    await collectTemporaryFurnace(bot).catch(() => {});
    return { success: true, reason: 'smelting completed', station: station.name };
  } catch (err) {
    return { success: false, reason: err.message };
  }
}

async function cookBestFood(bot) {
  let best = null;
  if (bot.taskManager) {
    const targets = bot.taskManager.getTargets();
    const rawFood = bot.inventory.items().find(item => {
      const info = cookData.getCookableFoodInfo(item.name);
      return info && targets.includes(info.result);
    });
    if (rawFood) {
      best = {
        item: rawFood,
        info: cookData.getCookableFoodInfo(rawFood.name)
      };
    }
  }

  if (!best) {
    best = cookData.getBestCookableFood(bot);
  }

  if (!best) return { success: false, reason: 'no cookable food' };
  return smeltItem(bot, best.item.name, Math.min(best.item.count, best.info.batchGoal || best.item.count));
}

async function smeltBestOre(bot) {
  let best = null;
  if (bot.taskManager) {
    const targets = bot.taskManager.getTargets();
    const rawOre = bot.inventory.items().find(item => {
      const info = cookData.getOreCookingInfo(item.name);
      return info && targets.includes(info.result);
    });
    if (rawOre) {
      best = {
        item: rawOre,
        info: cookData.getOreCookingInfo(rawOre.name)
      };
    }
  }

  if (!best) {
    best = cookData.getBestCookableOre(bot);
  }

  if (!best) return { success: false, reason: 'no smeltable ore' };
  return smeltItem(bot, best.item.name, Math.min(best.item.count, best.info.batchGoal || best.item.count));
}

function cookingReport(bot) {
  const bestFood = cookData.getBestCookableFood(bot);
  const bestOre = cookData.getBestCookableOre(bot);
  const lines = [];

  lines.push('Cook Report');
  lines.push(bestFood ? `Best cookable food: ${bestFood.item.name} -> ${bestFood.info.result}` : 'Best cookable food: none');
  lines.push(bestOre ? `Best smeltable ore: ${bestOre.item.name} -> ${bestOre.info.result}` : 'Best smeltable ore: none');

  return lines;
}

module.exports = {
  findNearbyCookingBlock,
  ensureFurnacePlaced,
  collectTemporaryFurnace,
  smeltItem,
  cookBestFood,
  smeltBestOre,
  cookingReport,
};
