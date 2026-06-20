const { sleep } = require('../utils');
const { Vec3 } = require('vec3');
const { placeBlockAt } = require('./building');
const libraryBuilds = require('../library/builds');

const LOG_TO_PLANK = {
  oak_log: 'oak_planks',
  spruce_log: 'spruce_planks',
  birch_log: 'birch_planks',
  jungle_log: 'jungle_planks',
  acacia_log: 'acacia_planks',
  dark_oak_log: 'dark_oak_planks',
  mangrove_log: 'mangrove_planks',
  cherry_log: 'cherry_planks',
};

const PLANK_TYPES = Object.values(LOG_TO_PLANK);
const LOG_TYPES = Object.keys(LOG_TO_PLANK);

const HOUSE_BLUEPRINTS = libraryBuilds.BLUEPRINTS;

function normalizeFacing(facing) {
  return ['north', 'south', 'east', 'west'].includes(facing) ? facing : 'south';
}

function transform(origin, facing, rx, ry, rz) {
  const dir = normalizeFacing(facing);

  if (dir === 'south') return new Vec3(origin.x + rx, origin.y + ry, origin.z + rz);
  if (dir === 'north') return new Vec3(origin.x - rx, origin.y + ry, origin.z - rz);
  if (dir === 'east') return new Vec3(origin.x + rz, origin.y + ry, origin.z - rx);
  return new Vec3(origin.x - rz, origin.y + ry, origin.z + rx);
}

function addStageBlock(stages, stageName, block, x, y, z, optional = false) {
  stages.push({ stageName, block, x, y, z, optional });
}

function addRect(stages, stageName, block, x1, x2, y, z1, z2, optional = false) {
  for (let x = x1; x <= x2; x++) {
    for (let z = z1; z <= z2; z++) {
      addStageBlock(stages, stageName, block, x, y, z, optional);
    }
  }
}

function expandPhaseBlocks(stages, phase) {
  for (const entry of phase.blocks || []) {
    if (entry.rect) {
      addRect(
        stages,
        phase.name,
        entry.block,
        entry.rect.x1,
        entry.rect.x2,
        entry.rect.y,
        entry.rect.z1,
        entry.rect.z2,
        !!entry.optional
      );
    } else {
      addStageBlock(stages, phase.name, entry.block, entry.x, entry.y, entry.z, !!entry.optional);
    }
  }
}

function buildPlanFromJson(blueprint, origin, facing) {
  const stages = [];
  for (const phase of blueprint.phases || []) {
    expandPhaseBlocks(stages, phase);
  }
  return stages.map(entry => ({ ...entry, world: transform(origin, facing, entry.x, entry.y, entry.z) }));
}

function getBlueprint(name = 'home') {
  return libraryBuilds.getBlueprint(name);
}

function generateBlueprintPlan(blueprint, origin, facing) {
  return buildPlanFromJson(blueprint, origin, facing);
}

function countInventory(bot, itemName) {
  return bot.inventory.items()
    .filter(item => item.name === itemName)
    .reduce((sum, item) => sum + item.count, 0);
}

function countAny(bot, names) {
  return bot.inventory.items()
    .filter(item => names.includes(item.name))
    .reduce((sum, item) => sum + item.count, 0);
}

function hasNearbyBlock(bot, blockName, maxDistance = 48) {
  const id = bot.registry.blocksByName[blockName]?.id;
  if (id == null) return null;
  return bot.findBlock({ matching: id, maxDistance });
}

function getMaterialStatus(bot, blueprint) {
  const required = [];
  const optional = [];

  for (const [itemName, needed] of Object.entries(blueprint.materials.required)) {
    const have = countInventory(bot, itemName);
    required.push({ itemName, needed, have, missing: Math.max(needed - have, 0) });
  }

  for (const [itemName, needed] of Object.entries(blueprint.materials.optional)) {
    const have = countInventory(bot, itemName);
    optional.push({ itemName, needed, have, missing: Math.max(needed - have, 0) });
  }

  return { required, optional };
}

function sitePositions(origin, facing, width, depth) {
  const positions = [];
  for (let rx = 0; rx < width; rx++) {
    for (let rz = 0; rz < depth; rz++) {
      positions.push(transform(origin, facing, rx, 0, rz));
    }
  }
  return positions;
}

function analyzeSite(bot, origin, facing, blueprint) {
  const positions = sitePositions(origin, facing, blueprint.footprint.width, blueprint.footprint.depth);
  let unsupported = 0;
  let blocked = 0;

  for (const pos of positions) {
    const below = bot.blockAt(pos.offset(0, -1, 0));
    const current = bot.blockAt(pos);

    if (!below || ['air', 'cave_air', 'void_air'].includes(below.name)) {
      unsupported++;
    }

    if (current && !['air', 'cave_air', 'void_air', 'grass', 'tall_grass', 'snow'].includes(current.name)) {
      blocked++;
    }
  }

  return { unsupported, blocked };
}

async function placeFoundationSupports(bot, goals, origin, facing, blueprint) {
  const positions = sitePositions(origin, facing, blueprint.footprint.width, blueprint.footprint.depth);
  let placed = 0;
  const initialTask = bot._currentTask;

  for (const pos of positions) {
    if (bot._currentTask !== initialTask) break;
    for (let depth = 1; depth <= 3; depth++) {
      const supportPos = pos.offset(0, -depth, 0);
      const block = bot.blockAt(supportPos);
      if (block && !['air', 'cave_air', 'void_air'].includes(block.name)) break;

      const success = await placeBlockAt(bot, goals, 'cobblestone', supportPos.x, supportPos.y, supportPos.z);
      if (success) {
        placed++;
      } else {
        break;
      }
      await sleep(100);
    }
  }

  return placed;
}

async function executeBuildPlan(bot, goals, plan) {
  let placed = 0;
  let failed = 0;
  let skippedOptional = 0;
  let currentStage = '';
  const initialTask = bot._currentTask;

  for (const step of plan) {
    if (bot._currentTask !== initialTask) {
      bot.chat('Build stopped.');
      return { placed, failed, skippedOptional, halted: true };
    }
    if (step.stageName !== currentStage) {
      currentStage = step.stageName;
      bot.chat(`Build stage: ${currentStage.replace(/_/g, ' ')}`);
      await sleep(200);
    }

    const haveCount = countInventory(bot, step.block);
    if (haveCount <= 0) {
      if (step.optional) {
        skippedOptional++;
        continue;
      }
      bot.chat(`Missing ${step.block}. Build paused after ${placed} blocks.`);
      return { placed, failed, skippedOptional, halted: true };
    }

    const existing = bot.blockAt(step.world);
    if (existing && existing.name === step.block) {
      continue;
    }

    const success = await placeBlockAt(bot, goals, step.block, step.world.x, step.world.y, step.world.z);
    if (success) {
      placed++;
    } else {
      failed++;
    }

    if (placed > 0 && placed % 12 === 0) {
      bot.chat(`Build progress: ${placed}/${plan.length} placements done.`);
    }
  }

  return { placed, failed, skippedOptional, halted: false };
}

async function gatherLogs(bot, count) {
  if (!bot.executeAction) return false;
  const currentLogs = countAny(bot, LOG_TYPES);
  const needed = Math.max(count - currentLogs, 0);
  if (needed <= 0) return true;

  const treeCount = Math.max(1, Math.ceil(needed / 5));
  await bot.executeAction({ action: 'gather_wood', count: treeCount, replant: false });
  return countAny(bot, LOG_TYPES) >= count;
}

async function gatherCobblestone(bot, count) {
  if (!bot.executeAction) return false;
  const current = countInventory(bot, 'cobblestone');
  const needed = Math.max(count - current, 0);
  if (needed <= 0) return true;

  await bot.executeAction({ action: 'mine', block: 'stone', count: needed });
  return countInventory(bot, 'cobblestone') >= count;
}

async function gatherSand(bot, count) {
  if (!bot.executeAction) return false;
  const current = countInventory(bot, 'sand');
  const needed = Math.max(count - current, 0);
  if (needed <= 0) return true;

  await bot.executeAction({ action: 'mine', block: 'sand', count: needed });
  return countInventory(bot, 'sand') >= count;
}

async function gatherCoal(bot, count) {
  if (!bot.executeAction) return false;
  const current = countInventory(bot, 'coal');
  const needed = Math.max(count - current, 0);
  if (needed <= 0) return true;

  await bot.executeAction({ action: 'mine', block: 'coal_ore', count: needed });
  return countInventory(bot, 'coal') >= count;
}

async function ensurePlanks(bot, needed) {
  const currentPlanks = countInventory(bot, 'oak_planks');
  if (currentPlanks >= needed) return true;

  const missingPlanks = needed - currentPlanks;
  const oakLogs = countInventory(bot, 'oak_log');
  if (oakLogs <= 0) return false;

  const batches = Math.ceil(missingPlanks / 4);
  const recipes = bot.recipesFor(bot.registry.itemsByName['oak_planks']?.id, null, 1, null);
  if (!recipes.length) return false;

  try {
    await bot.craft(recipes[0], Math.min(batches, oakLogs), null);
  } catch (err) {
    console.log(`builder ensurePlanks failed: ${err.message}`);
  }

  return countInventory(bot, 'oak_planks') >= needed;
}

async function ensureFenceAndGate(bot, blueprint) {
  const fenceNeed = blueprint.materials.required.oak_fence || 0;
  const gateNeed = blueprint.materials.optional.oak_fence_gate || 0;

  if (fenceNeed > 0 && countInventory(bot, 'oak_fence') < fenceNeed) {
    const recipes = bot.recipesFor(bot.registry.itemsByName['oak_fence']?.id, null, 1, null);
    if (recipes.length) {
      const missing = fenceNeed - countInventory(bot, 'oak_fence');
      const batches = Math.ceil(missing / 3);
      try {
        await bot.craft(recipes[0], batches, null);
      } catch (err) {
        console.log(`builder craft fence failed: ${err.message}`);
      }
    }
  }

  if (gateNeed > 0 && countInventory(bot, 'oak_fence_gate') < gateNeed) {
    const recipes = bot.recipesFor(bot.registry.itemsByName['oak_fence_gate']?.id, null, 1, null);
    if (recipes.length) {
      try {
        await bot.craft(recipes[0], gateNeed, null);
      } catch (err) {
        console.log(`builder craft fence gate failed: ${err.message}`);
      }
    }
  }
}

async function ensureLadders(bot, needed) {
  if (!needed || countInventory(bot, 'ladder') >= needed) return true;
  const recipes = bot.recipesFor(bot.registry.itemsByName['ladder']?.id, null, 1, null);
  if (!recipes.length) return false;
  const missing = needed - countInventory(bot, 'ladder');
  const batches = Math.ceil(missing / 3);
  try {
    await bot.craft(recipes[0], batches, null);
  } catch (err) {
    console.log(`builder craft ladder failed: ${err.message}`);
  }
  return countInventory(bot, 'ladder') >= needed;
}

async function ensureGlassPanes(bot, needed) {
  if (countInventory(bot, 'glass_pane') >= needed) return true;

  const missingPanes = needed - countInventory(bot, 'glass_pane');
  let glassBlocks = countInventory(bot, 'glass');

  if (glassBlocks < 2) {
    const sandNeeded = 6;
    if (countInventory(bot, 'sand') < sandNeeded) {
      await gatherSand(bot, sandNeeded);
    }
    if (countInventory(bot, 'coal') < 2) {
      await gatherCoal(bot, 2);
    }

    const furnaceNearby = hasNearbyBlock(bot, 'furnace', 12);
    const furnaceItem = bot.inventory.items().find(item => item.name === 'furnace');
    if (!furnaceNearby && !furnaceItem && countInventory(bot, 'cobblestone') >= 8) {
      const furnaceRecipes = bot.recipesFor(bot.registry.itemsByName['furnace']?.id, null, 1, null);
      if (furnaceRecipes.length) {
        try {
          await bot.craft(furnaceRecipes[0], 1, null);
        } catch {}
      }
    }

    const furnaceTarget = furnaceNearby || hasNearbyBlock(bot, 'furnace', 8);
    if (furnaceTarget) {
      try {
        const furnace = await bot.openFurnace(furnaceTarget);
        const sandItem = bot.inventory.items().find(item => item.name === 'sand');
        const coalItem = bot.inventory.items().find(item => item.name === 'coal');

        if (sandItem && coalItem) {
          await furnace.putInput(sandItem.type, sandItem.metadata, Math.min(sandItem.count, 6));
          await furnace.putFuel(coalItem.type, coalItem.metadata, Math.min(coalItem.count, 2));
          await sleep(8000);
          try {
            await furnace.takeOutput();
          } catch {}
        }
        furnace.close();
      } catch (err) {
        console.log(`builder smelt glass failed: ${err.message}`);
      }
    }

    glassBlocks = countInventory(bot, 'glass');
  }

  if (glassBlocks <= 0) return false;

  const paneId = bot.registry.itemsByName['glass_pane']?.id;
  const recipes = bot.recipesFor(paneId, null, 1, null);
  if (!recipes.length) return false;

  try {
    const batches = Math.max(1, Math.ceil(missingPanes / 16));
    await bot.craft(recipes[0], batches, null);
  } catch (err) {
    console.log(`builder craft panes failed: ${err.message}`);
  }

  return countInventory(bot, 'glass_pane') >= needed;
}

async function ensureOptionalInterior(bot) {
  const tableNearby = hasNearbyBlock(bot, 'crafting_table', 12);
  if (!tableNearby && countInventory(bot, 'crafting_table') === 0 && countAny(bot, PLANK_TYPES) >= 4) {
    const recipes = bot.recipesFor(bot.registry.itemsByName['crafting_table']?.id, null, 1, null);
    if (recipes.length) {
      try {
        await bot.craft(recipes[0], 1, null);
      } catch {}
    }
  }

  if (countInventory(bot, 'furnace') === 0 && countInventory(bot, 'cobblestone') >= 8) {
    const recipes = bot.recipesFor(bot.registry.itemsByName['furnace']?.id, null, 1, null);
    if (recipes.length) {
      try {
        await bot.craft(recipes[0], 1, null);
      } catch {}
    }
  }

  if (countInventory(bot, 'chest') === 0 && countAny(bot, PLANK_TYPES) >= 8) {
    const recipes = bot.recipesFor(bot.registry.itemsByName['chest']?.id, null, 1, null);
    if (recipes.length) {
      try {
        await bot.craft(recipes[0], 1, null);
      } catch {}
    }
  }
}

async function gatherMaterialsForBlueprint(bot, blueprint) {
  const tasks = [];
  const gatherPlan = blueprint.gatherPlan || {};

  if ((countInventory(bot, 'oak_log') + countInventory(bot, 'oak_planks')) < (gatherPlan.logs || 0)) {
    tasks.push('logs');
  }
  if (countInventory(bot, 'cobblestone') < (gatherPlan.cobblestone || 0)) {
    tasks.push('cobblestone');
  }
  if (countInventory(bot, 'glass_pane') < (blueprint.materials.required.glass_pane || 0)) {
    tasks.push('glass');
  }
  if (blueprint.materials.required.oak_fence && countInventory(bot, 'oak_fence') < blueprint.materials.required.oak_fence) {
    tasks.push('fence');
  }
  if (blueprint.materials.required.ladder && countInventory(bot, 'ladder') < blueprint.materials.required.ladder) {
    tasks.push('ladder');
  }

  if (tasks.length === 0) return true;

  bot.chat(`Missing build materials. Gathering: ${tasks.join(', ')}.`);
  await sleep(250);

  if (tasks.includes('logs')) {
    const ok = await gatherLogs(bot, gatherPlan.logs || 0);
    if (!ok) return false;
  }

  if (tasks.includes('cobblestone')) {
    const ok = await gatherCobblestone(bot, gatherPlan.cobblestone || 0);
    if (!ok) return false;
  }

  if (tasks.includes('glass')) {
    if (countInventory(bot, 'sand') < (gatherPlan.sand || 0)) {
      const ok = await gatherSand(bot, gatherPlan.sand || 0);
      if (!ok) return false;
    }
    if (countInventory(bot, 'coal') < (gatherPlan.coal || 0)) {
      const ok = await gatherCoal(bot, gatherPlan.coal || 0);
      if (!ok) return false;
    }
  }

  const planksOk = await ensurePlanks(bot, blueprint.materials.required.oak_planks || 0);
  const panesOk = blueprint.materials.required.glass_pane ? await ensureGlassPanes(bot, blueprint.materials.required.glass_pane) : true;
  await ensureFenceAndGate(bot, blueprint);
  await ensureLadders(bot, blueprint.materials.required.ladder || 0);
  await ensureOptionalInterior(bot);

  return planksOk && panesOk;
}

async function finalizeSpecialStructure(bot, blueprint, action, origin) {
  if (blueprint.kind === 'farm') {
    const crop = action.crop || 'wheat_seeds';
    await bot.executeAction({
      action: 'create_farm',
      x: origin.x,
      y: origin.y,
      z: origin.z,
      width: 9,
      length: 9,
      crop,
    });
    return;
  }

  if (blueprint.kind === 'cooking') {
    if (countInventory(bot, 'furnace') === 0 && countInventory(bot, 'cobblestone') >= 16) {
      const recipes = bot.recipesFor(bot.registry.itemsByName['furnace']?.id, null, 1, null);
      if (recipes.length) {
        try {
          await bot.craft(recipes[0], 2, null);
        } catch {}
      }
    }
    return;
  }

  if (blueprint.kind === 'breeding' && action.breedAnimal) {
    bot.chat(`Animal pen ready. Lure ${action.breedAnimal} inside with food to start breeding.`);
  }
}

function register(bot, goals) {
  return {
    handlers: {
      house_plan: async (action) => {
        const blueprint = getBlueprint(action.blueprint);
        const status = getMaterialStatus(bot, blueprint);

        bot.chat(`Plan: ${blueprint.name} | Type ${blueprint.kind} | Size ${blueprint.footprint.width}x${blueprint.footprint.depth} | Height ${blueprint.totalHeight}`);
        await sleep(250);

        const requiredLine = status.required
          .map(item => `${item.itemName} ${item.have}/${item.needed}`)
          .join(', ');
        bot.chat(`Required: ${requiredLine}`);
        await sleep(250);

        const optionalLine = status.optional
          .map(item => `${item.itemName} ${item.have}/${item.needed}`)
          .join(', ');
        bot.chat(`Optional: ${optionalLine}`);
        await sleep(250);

        for (const note of blueprint.notes) {
          bot.chat(`Note: ${note}`);
          await sleep(250);
        }
      },

      build_house: async (action) => {
        const blueprint = getBlueprint(action.blueprint);
        const origin = new Vec3(
          action.x ?? Math.floor(bot.entity.position.x),
          action.y ?? Math.floor(bot.entity.position.y),
          action.z ?? Math.floor(bot.entity.position.z)
        );
        const facing = normalizeFacing(action.facing || blueprint.recommendedFacing);

        bot.chat(`Building: ${blueprint.name} at ${origin.x}, ${origin.y}, ${origin.z} facing ${facing}`);
        await sleep(250);

        const gathered = await gatherMaterialsForBlueprint(bot, blueprint);
        if (!gathered) {
          bot.chat('Could not gather enough materials for this structure yet.');
          return;
        }

        const materialStatus = getMaterialStatus(bot, blueprint);
        const missingRequired = materialStatus.required.filter(item => item.missing > 0);
        if (missingRequired.length > 0) {
          const missingText = missingRequired.map(item => `${item.itemName} x${item.missing}`).join(', ');
          bot.chat(`Still missing required materials: ${missingText}`);
          return;
        }

        const site = analyzeSite(bot, origin, facing, blueprint);
        if (site.blocked > 12) {
          bot.chat(`Build area is too blocked (${site.blocked} obstructed tiles). Clear the site and try again.`);
          return;
        }

        if (site.unsupported > 0) {
          bot.chat(`Preparing supports for ${site.unsupported} unsupported floor tiles...`);
          await placeFoundationSupports(bot, goals, origin, facing, blueprint);
          await sleep(250);
        }

        const plan = generateBlueprintPlan(blueprint, origin, facing);
        const result = await executeBuildPlan(bot, goals, plan);

        if (result.halted) return;

        await finalizeSpecialStructure(bot, blueprint, action, origin);

        bot.chat(
          `${blueprint.name} complete! Placed ${result.placed} blocks` +
          `${result.failed > 0 ? `, ${result.failed} failed` : ''}` +
          `${result.skippedOptional > 0 ? `, ${result.skippedOptional} optional skipped` : ''}.`
        );
      },

      validate_build: async (action) => {
        const { getBlueprint } = require('./builder');
        const { validateStructure } = require('./builder_utils');
        const blueprint = getBlueprint(action.blueprint);
        if (!blueprint) {
          bot.chat(`Blueprint not found: ${action.blueprint}`);
          return;
        }
        const origin = new Vec3(action.x, action.y, action.z);
        const facing = action.facing || 'south';
        const report = validateStructure(bot, blueprint, origin, facing);
        bot.chat(`Structure Validation Score: ${report.score}%. Valid: ${report.valid}`);
        console.log(`[Validation Report]`, report);
      },

      repair_build: async (action) => {
        const { getBlueprint } = require('./builder');
        const { repairStructure } = require('./builder_utils');
        const blueprint = getBlueprint(action.blueprint);
        if (!blueprint) {
          bot.chat(`Blueprint not found: ${action.blueprint}`);
          return;
        }
        const origin = new Vec3(action.x, action.y, action.z);
        const facing = action.facing || 'south';
        const success = await repairStructure(bot, goals, blueprint, origin, facing);
        bot.chat(success ? 'Repairs completed successfully!' : 'Failed to complete repairs.');
      },

      capture_blueprint: async (action) => {
        const { captureWorldStructure } = require('./builder_utils');
        const startPos = new Vec3(action.startX, action.startY, action.startZ);
        const endPos = new Vec3(action.endX, action.endY, action.endZ);
        const blueprint = await captureWorldStructure(bot, startPos, endPos, action.name, action.id);
        const filepath = `./captured_${blueprint.id}.json`;
        const fs = require('fs');
        fs.writeFileSync(filepath, JSON.stringify(blueprint, null, 2), 'utf8');
        bot.chat(`Captured blueprint saved to ${filepath}`);
      },
    },
  };
}

module.exports = {
  HOUSE_BLUEPRINTS,
  getBlueprint,
  getMaterialStatus,
  generateBlueprintPlan,
  gatherMaterialsForBlueprint,
  register,
};
