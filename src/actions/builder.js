const { sleep } = require('../utils');
const { Vec3 } = require('vec3');
const { placeBlockAt } = require('./building');

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

const HOUSE_BLUEPRINTS = {
  starter_cottage: {
    id: 'starter_cottage',
    name: 'Starter Cottage MkII',
    kind: 'house',
    description: 'A sturdier survival cottage with a framed doorway, plank deck, cobblestone walls, raised roof, rear windows, front porch, and practical starter interior.',
    footprint: { width: 9, depth: 7 },
    wallHeight: 4,
    totalHeight: 7,
    recommendedFacing: 'south',
    gatherPlan: {
      logs: 28,
      cobblestone: 72,
      sand: 6,
      coal: 2,
    },
    materials: {
      required: {
        oak_planks: 126,
        oak_log: 20,
        cobblestone: 72,
        glass_pane: 6,
      },
      optional: {
        crafting_table: 1,
        furnace: 1,
        chest: 1,
        torch: 4,
      },
    },
    notes: [
      'The cottage includes a front porch, centered entrance, interior workspace, and a thicker roof profile.',
      'If required materials are missing, the bot now attempts to gather logs, cobblestone, sand, and fuel before building.',
      'Optional furnishings are placed only if the bot has them or can craft them from current inventory.',
    ],
  },
  crop_farm_plot: {
    id: 'crop_farm_plot',
    name: 'Crop Farm Plot',
    kind: 'farm',
    description: 'A compact starter farm plot with plank border, central water lane, and room for wheat, carrots, potatoes, or beetroot.',
    footprint: { width: 9, depth: 9 },
    wallHeight: 1,
    totalHeight: 2,
    recommendedFacing: 'south',
    gatherPlan: {
      logs: 10,
      cobblestone: 0,
      sand: 0,
      coal: 0,
    },
    materials: {
      required: {
        oak_planks: 36,
      },
      optional: {
        water_bucket: 1,
        torch: 4,
        wheat_seeds: 16,
      },
    },
    notes: [
      'The farm plot builds a border and work area; after building, use create_farm or plant to finish the crop setup.',
      'Best placed on flat ground near water or with a water bucket available.',
    ],
  },
  animal_pen: {
    id: 'animal_pen',
    name: 'Animal Breeding Pen',
    kind: 'breeding',
    description: 'A fenced breeding yard with gate opening, feeding lane, and a tiny covered corner for animal management.',
    footprint: { width: 9, depth: 9 },
    wallHeight: 2,
    totalHeight: 4,
    recommendedFacing: 'south',
    gatherPlan: {
      logs: 20,
      cobblestone: 12,
      sand: 0,
      coal: 0,
    },
    materials: {
      required: {
        oak_fence: 24,
        oak_planks: 28,
        cobblestone: 12,
      },
      optional: {
        oak_fence_gate: 1,
        torch: 4,
        chest: 1,
      },
    },
    notes: [
      'Use this for cows, sheep, pigs, or chickens once animals are lured inside.',
      'If no fence gate is available, the pen still works with a simple fenced opening.',
    ],
  },
  cooking_shack: {
    id: 'cooking_shack',
    name: 'Cooking Shack',
    kind: 'cooking',
    description: 'A compact outdoor kitchen with furnace wall, prep counter, fuel chest spot, and covered roof for food processing.',
    footprint: { width: 7, depth: 5 },
    wallHeight: 3,
    totalHeight: 5,
    recommendedFacing: 'south',
    gatherPlan: {
      logs: 14,
      cobblestone: 24,
      sand: 0,
      coal: 0,
    },
    materials: {
      required: {
        oak_planks: 42,
        oak_log: 8,
        cobblestone: 24,
      },
      optional: {
        furnace: 2,
        chest: 1,
        torch: 2,
        crafting_table: 1,
      },
    },
    notes: [
      'The shack is meant for smelting food and basic kitchen staging.',
      'Optional furnaces and storage are inserted automatically if available.',
    ],
  },
};

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

function generateStarterCottagePlan(origin, facing) {
  const stages = [];

  addRect(stages, 'foundation_floor', 'oak_planks', 0, 8, 0, 0, 6);
  addRect(stages, 'front_porch', 'oak_planks', 2, 6, 0, -1, -1);

  const supportColumns = [
    [0, 1, 0], [0, 2, 0], [0, 3, 0], [0, 4, 0],
    [8, 1, 0], [8, 2, 0], [8, 3, 0], [8, 4, 0],
    [0, 1, 6], [0, 2, 6], [0, 3, 6], [0, 4, 6],
    [8, 1, 6], [8, 2, 6], [8, 3, 6], [8, 4, 6],
    [3, 1, 0], [3, 2, 0], [5, 1, 0], [5, 2, 0],
  ];
  for (const [x, y, z] of supportColumns) {
    addStageBlock(stages, 'frame', 'oak_log', x, y, z);
  }

  const doorway = new Set(['4,1,0', '4,2,0']);
  const windows = new Set(['0,2,2', '0,2,4', '8,2,2', '8,2,4', '3,2,6', '5,2,6']);
  const woodTrim = new Set(['4,3,0', '4,4,0', '3,3,6', '4,3,6', '5,3,6']);
  const supportKeys = new Set(supportColumns.map(([x, y, z]) => `${x},${y},${z}`));

  for (let y = 1; y <= 4; y++) {
    for (let x = 0; x <= 8; x++) {
      for (let z = 0; z <= 6; z++) {
        const onPerimeter = x === 0 || x === 8 || z === 0 || z === 6;
        if (!onPerimeter) continue;

        const key = `${x},${y},${z}`;
        if (doorway.has(key) || windows.has(key) || supportKeys.has(key)) continue;

        const block = woodTrim.has(key) ? 'oak_log' : 'cobblestone';
        addStageBlock(stages, 'walls', block, x, y, z);
      }
    }
  }

  for (const key of windows) {
    const [x, y, z] = key.split(',').map(Number);
    addStageBlock(stages, 'windows', 'glass_pane', x, y, z);
  }

  addRect(stages, 'ceiling_ring', 'oak_planks', 0, 8, 5, 0, 6);
  addRect(stages, 'roof_mid', 'oak_planks', 1, 7, 6, 1, 5);
  addRect(stages, 'roof_peak', 'oak_planks', 2, 6, 7, 2, 4);

  addStageBlock(stages, 'interior', 'crafting_table', 1, 1, 1, true);
  addStageBlock(stages, 'interior', 'furnace', 2, 1, 1, true);
  addStageBlock(stages, 'interior', 'chest', 7, 1, 1, true);
  addStageBlock(stages, 'interior', 'torch', 2, 3, 2, true);
  addStageBlock(stages, 'interior', 'torch', 6, 3, 2, true);
  addStageBlock(stages, 'interior', 'torch', 2, 3, 5, true);
  addStageBlock(stages, 'interior', 'torch', 6, 3, 5, true);

  return stages.map(entry => ({ ...entry, world: transform(origin, facing, entry.x, entry.y, entry.z) }));
}

function generateCropFarmPlotPlan(origin, facing) {
  const stages = [];

  for (let x = 0; x < 9; x++) {
    for (let z = 0; z < 9; z++) {
      const edge = x === 0 || x === 8 || z === 0 || z === 8;
      if (edge) {
        addStageBlock(stages, 'border', 'oak_planks', x, 0, z);
      }
    }
  }

  for (let z = 1; z <= 7; z++) {
    addStageBlock(stages, 'walkway', 'oak_planks', 4, 0, z);
  }

  addStageBlock(stages, 'lighting', 'torch', 1, 1, 1, true);
  addStageBlock(stages, 'lighting', 'torch', 7, 1, 1, true);
  addStageBlock(stages, 'lighting', 'torch', 1, 1, 7, true);
  addStageBlock(stages, 'lighting', 'torch', 7, 1, 7, true);

  return stages.map(entry => ({ ...entry, world: transform(origin, facing, entry.x, entry.y, entry.z) }));
}

function generateAnimalPenPlan(origin, facing) {
  const stages = [];

  addRect(stages, 'floor_ring', 'oak_planks', 0, 8, 0, 0, 8);

  const corners = [
    [0, 1, 0], [0, 2, 0], [8, 1, 0], [8, 2, 0],
    [0, 1, 8], [0, 2, 8], [8, 1, 8], [8, 2, 8],
  ];
  for (const [x, y, z] of corners) {
    addStageBlock(stages, 'posts', 'oak_log', x, y, z);
  }

  for (let x = 1; x <= 7; x++) {
    if (x !== 4) addStageBlock(stages, 'fence_wall', 'oak_fence', x, 1, 0);
    addStageBlock(stages, 'fence_wall', 'oak_fence', x, 1, 8);
  }
  for (let z = 1; z <= 7; z++) {
    addStageBlock(stages, 'fence_wall', 'oak_fence', 0, 1, z);
    addStageBlock(stages, 'fence_wall', 'oak_fence', 8, 1, z);
  }

  addStageBlock(stages, 'gate', 'oak_fence_gate', 4, 1, 0, true);
  addRect(stages, 'shelter_base', 'cobblestone', 1, 3, 1, 6, 8);
  addRect(stages, 'shelter_roof', 'oak_planks', 1, 3, 3, 6, 8);
  addStageBlock(stages, 'interior', 'chest', 2, 1, 7, true);
  addStageBlock(stages, 'lighting', 'torch', 1, 2, 1, true);
  addStageBlock(stages, 'lighting', 'torch', 7, 2, 1, true);
  addStageBlock(stages, 'lighting', 'torch', 1, 2, 7, true);
  addStageBlock(stages, 'lighting', 'torch', 7, 2, 7, true);

  return stages.map(entry => ({ ...entry, world: transform(origin, facing, entry.x, entry.y, entry.z) }));
}

function generateCookingShackPlan(origin, facing) {
  const stages = [];

  addRect(stages, 'floor', 'oak_planks', 0, 6, 0, 0, 4);

  const supports = [
    [0, 1, 0], [0, 2, 0], [6, 1, 0], [6, 2, 0],
    [0, 1, 4], [0, 2, 4], [6, 1, 4], [6, 2, 4],
  ];
  for (const [x, y, z] of supports) {
    addStageBlock(stages, 'frame', 'oak_log', x, y, z);
  }

  for (let x = 1; x <= 5; x++) {
    addStageBlock(stages, 'back_wall', 'cobblestone', x, 1, 4);
    addStageBlock(stages, 'back_wall', 'cobblestone', x, 2, 4);
  }

  addRect(stages, 'roof', 'oak_planks', 0, 6, 3, 0, 4);
  addStageBlock(stages, 'kitchen', 'furnace', 1, 1, 3, true);
  addStageBlock(stages, 'kitchen', 'furnace', 2, 1, 3, true);
  addStageBlock(stages, 'kitchen', 'crafting_table', 4, 1, 3, true);
  addStageBlock(stages, 'kitchen', 'chest', 5, 1, 3, true);
  addStageBlock(stages, 'lighting', 'torch', 1, 2, 1, true);
  addStageBlock(stages, 'lighting', 'torch', 5, 2, 1, true);

  return stages.map(entry => ({ ...entry, world: transform(origin, facing, entry.x, entry.y, entry.z) }));
}

function getBlueprint(name = 'starter_cottage') {
  return HOUSE_BLUEPRINTS[name] || HOUSE_BLUEPRINTS.starter_cottage;
}

function generateBlueprintPlan(blueprint, origin, facing) {
  if (blueprint.id === 'crop_farm_plot') return generateCropFarmPlotPlan(origin, facing);
  if (blueprint.id === 'animal_pen') return generateAnimalPenPlan(origin, facing);
  if (blueprint.id === 'cooking_shack') return generateCookingShackPlan(origin, facing);
  return generateStarterCottagePlan(origin, facing);
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

  for (const pos of positions) {
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

  for (const step of plan) {
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
    },
  };
}

module.exports = {
  HOUSE_BLUEPRINTS,
  getBlueprint,
  getMaterialStatus,
  generateStarterCottagePlan,
  generateBlueprintPlan,
  gatherMaterialsForBlueprint,
  register,
};
