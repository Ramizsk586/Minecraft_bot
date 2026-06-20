const { sleep } = require('../utils');
const { Vec3 } = require('vec3');
const { placeBlockAt } = require('./building');

const HOUSE_BLUEPRINTS = {
  starter_cottage: {
    id: 'starter_cottage',
    name: 'Starter Cottage',
    description: 'A compact survival house with a plank floor, log supports, cobblestone walls, windows, layered roof, and optional interior utility blocks.',
    footprint: { width: 7, depth: 5 },
    wallHeight: 3,
    totalHeight: 6,
    recommendedFacing: 'south',
    materials: {
      required: {
        oak_planks: 85,
        oak_log: 12,
        cobblestone: 43,
        glass_pane: 3,
      },
      optional: {
        chest: 1,
        crafting_table: 1,
        furnace: 1,
        torch: 2,
      },
    },
    notes: [
      'Front entrance is a 1x2 open doorway for reliable placement in survival.',
      'Build area should be mostly flat. Small gaps under the floor are auto-filled with cobblestone supports.',
      'Optional interior blocks are placed only if they are already in inventory.',
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

function generateStarterCottagePlan(origin, facing) {
  const stages = [];

  // 1. Floor
  for (let rx = 0; rx < 7; rx++) {
    for (let rz = 0; rz < 5; rz++) {
      addStageBlock(stages, 'floor', 'oak_planks', rx, 0, rz);
    }
  }

  // 2. Corner supports
  const corners = [
    [0, 1, 0], [0, 2, 0], [0, 3, 0],
    [6, 1, 0], [6, 2, 0], [6, 3, 0],
    [0, 1, 4], [0, 2, 4], [0, 3, 4],
    [6, 1, 4], [6, 2, 4], [6, 3, 4],
  ];
  for (const [x, y, z] of corners) {
    addStageBlock(stages, 'supports', 'oak_log', x, y, z);
  }

  // 3. Walls with doorway and windows carved out
  const windowSet = new Set(['0,2,2', '6,2,2', '3,2,4']);
  const doorwaySet = new Set(['3,1,0', '3,2,0']);
  const cornerSet = new Set(['0,1,0', '0,2,0', '0,3,0', '6,1,0', '6,2,0', '6,3,0', '0,1,4', '0,2,4', '0,3,4', '6,1,4', '6,2,4', '6,3,4']);

  for (let ry = 1; ry <= 3; ry++) {
    for (let rx = 0; rx < 7; rx++) {
      for (let rz = 0; rz < 5; rz++) {
        const onPerimeter = rx === 0 || rx === 6 || rz === 0 || rz === 4;
        if (!onPerimeter) continue;

        const key = `${rx},${ry},${rz}`;
        if (doorwaySet.has(key) || windowSet.has(key) || cornerSet.has(key)) continue;
        addStageBlock(stages, 'walls', 'cobblestone', rx, ry, rz);
      }
    }
  }

  // 4. Windows
  for (const key of windowSet) {
    const [x, y, z] = key.split(',').map(Number);
    addStageBlock(stages, 'windows', 'glass_pane', x, y, z);
  }

  // 5. Roof base
  for (let rx = 0; rx < 7; rx++) {
    for (let rz = 0; rz < 5; rz++) {
      addStageBlock(stages, 'roof_base', 'oak_planks', rx, 4, rz);
    }
  }

  // 6. Roof cap
  for (let rx = 1; rx <= 5; rx++) {
    for (let rz = 1; rz <= 3; rz++) {
      addStageBlock(stages, 'roof_cap', 'oak_planks', rx, 5, rz);
    }
  }

  // 7. Optional interior utility
  addStageBlock(stages, 'interior', 'chest', 1, 1, 1, true);
  addStageBlock(stages, 'interior', 'crafting_table', 2, 1, 1, true);
  addStageBlock(stages, 'interior', 'furnace', 5, 1, 1, true);
  addStageBlock(stages, 'interior', 'torch', 1, 2, 2, true);
  addStageBlock(stages, 'interior', 'torch', 5, 2, 2, true);

  return stages.map(entry => {
    const pos = transform(origin, facing, entry.x, entry.y, entry.z);
    return { ...entry, world: pos };
  });
}

function getBlueprint(name = 'starter_cottage') {
  return HOUSE_BLUEPRINTS[name] || HOUSE_BLUEPRINTS.starter_cottage;
}

function countInventory(bot, itemName) {
  return bot.inventory.items()
    .filter(item => item.name === itemName)
    .reduce((sum, item) => sum + item.count, 0);
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
      bot.chat(`House stage: ${currentStage.replace(/_/g, ' ')}`);
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

    if (placed > 0 && placed % 10 === 0) {
      bot.chat(`House progress: ${placed}/${plan.length} placements done.`);
    }
  }

  return { placed, failed, skippedOptional, halted: false };
}

function register(bot, goals) {
  return {
    handlers: {
      house_plan: async (action) => {
        const blueprint = getBlueprint(action.blueprint);
        const status = getMaterialStatus(bot, blueprint);

        bot.chat(`House plan: ${blueprint.name} | Size ${blueprint.footprint.width}x${blueprint.footprint.depth} | Height ${blueprint.totalHeight}`);
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
        const materialStatus = getMaterialStatus(bot, blueprint);
        const missingRequired = materialStatus.required.filter(item => item.missing > 0);

        bot.chat(`Building house: ${blueprint.name} at ${origin.x}, ${origin.y}, ${origin.z} facing ${facing}`);
        await sleep(250);

        if (missingRequired.length > 0) {
          const missingText = missingRequired
            .map(item => `${item.itemName} x${item.missing}`)
            .join(', ');
          bot.chat(`Missing required materials: ${missingText}`);
          return;
        }

        const site = analyzeSite(bot, origin, facing, blueprint);
        if (site.blocked > 6) {
          bot.chat(`Build area is too blocked (${site.blocked} obstructed tiles). Clear the site and try again.`);
          return;
        }

        if (site.unsupported > 0) {
          bot.chat(`Preparing foundation supports for ${site.unsupported} unsupported floor tiles...`);
          await placeFoundationSupports(bot, goals, origin, facing, blueprint);
          await sleep(250);
        }

        const plan = generateStarterCottagePlan(origin, facing);
        const result = await executeBuildPlan(bot, goals, plan);

        if (result.halted) return;

        bot.chat(
          `House complete! Placed ${result.placed} blocks` +
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
  register,
};
