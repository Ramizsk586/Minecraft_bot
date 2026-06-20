// ─── Builder Utilities ────────────────────────────────────────────────────────
// Logic to validate, repair, and capture structures as blueprints.

const { Vec3 } = require('vec3');
const { generateBlueprintPlan } = require('./builder');
const { placeBlockAt } = require('./building');
const { sleep } = require('../utils');

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

function isAir(name) {
  return !name || name === 'air' || name === 'cave_air' || name === 'void_air';
}

/**
 * Validates a structure built by the bot against its blueprint.
 */
function validateStructure(bot, blueprint, origin, facing) {
  const plan = generateBlueprintPlan(blueprint, origin, facing);
  const planCoords = new Set();
  
  const matches = [];
  const missing = [];     // Expected block but found air
  const incorrect = [];   // Position occupied by the wrong block type
  const redundant = [];   // Position contains an obstacle block where air is expected

  // 1. Validate all planned blocks
  for (const step of plan) {
    const worldPos = new Vec3(step.world.x, step.world.y, step.world.z);
    planCoords.add(`${worldPos.x},${worldPos.y},${worldPos.z}`);
    
    const actualBlock = bot.blockAt(worldPos);
    const actualName = actualBlock ? actualBlock.name : 'air';
    const expectedName = step.block;

    if (actualName === expectedName) {
      matches.push(step);
    } else if (isAir(actualName)) {
      missing.push({ ...step, actual: actualName });
    } else {
      incorrect.push({ ...step, actual: actualName });
    }
  }

  // 2. Identify redundant blocks in the blueprint bounding box (footprint)
  const footprint = blueprint.footprint || { width: 5, depth: 5 };
  const height = blueprint.totalHeight || blueprint.height || 4;
  
  for (let rx = 0; rx < footprint.width; rx++) {
    for (let rz = 0; rz < footprint.depth; rz++) {
      for (let ry = 0; ry < height; ry++) {
        const worldPos = transform(origin, facing, rx, ry, rz);
        const coordKey = `${worldPos.x},${worldPos.y},${worldPos.z}`;
        
        if (!planCoords.has(coordKey)) {
          const block = bot.blockAt(worldPos);
          if (block && !isAir(block.name)) {
            redundant.push({
              world: worldPos,
              actual: block.name,
              expected: 'air'
            });
          }
        }
      }
    }
  }

  const totalPlanned = plan.length;
  const score = totalPlanned > 0 ? (matches.length / totalPlanned) * 100 : 100;

  return {
    valid: missing.length === 0 && incorrect.length === 0 && redundant.length === 0,
    score: Math.round(score * 100) / 100,
    matches,
    missing,
    incorrect,
    redundant
  };
}

/**
 * Automatically repairs a structure by mining redundant/incorrect blocks and placing missing blocks.
 */
async function repairStructure(bot, goals, blueprint, origin, facing) {
  bot.chat('Checking structure integrity for repairs...');
  const report = validateStructure(bot, blueprint, origin, facing);
  
  if (report.valid) {
    bot.chat('Structure integrity is at 100%. No repairs needed!');
    return true;
  }
  
  bot.chat(`Structure integrity is at ${report.score}%. Starting repairs...`);
  await sleep(1000);

  // Phase 1: Mine and clear incorrect/obstructing blocks
  const blocksToClear = [...report.redundant, ...report.incorrect];
  if (blocksToClear.length > 0) {
    bot.chat(`Clearing ${blocksToClear.length} incorrect/redundant blocks...`);
    for (const item of blocksToClear) {
      const block = bot.blockAt(item.world);
      if (block && !isAir(block.name)) {
        try {
          // Approach block to mine it
          await bot.pathfinder.goto(new goals.GoalNear(item.world.x, item.world.y, item.world.z, 3));
          await bot.dig(block);
          await sleep(200);
        } catch (err) {
          console.error(`Repair dig failed at ${item.world}: ${err.message}`);
        }
      }
    }
  }

  // Phase 2: Place missing/corrected blocks
  const blocksToPlace = [...report.incorrect, ...report.missing];
  if (blocksToPlace.length > 0) {
    bot.chat(`Placing ${blocksToPlace.length} missing/corrected blocks...`);
    for (const step of blocksToPlace) {
      // Find required block item in inventory
      const hasItem = bot.inventory.items().some(i => i.name === step.block);
      if (!hasItem) {
        // Try auto-crafting
        const craftBrain = require('../brain/craft');
        const craftResult = await craftBrain.craft(bot, step.block, 1, { silent: true });
        if (!craftResult || !craftResult.success) {
          bot.chat(`Missing item and cannot craft: ${step.block}`);
          return false;
        }
      }
      
      const success = await placeBlockAt(bot, goals, step.block, step.world.x, step.world.y, step.world.z);
      if (!success) {
        bot.chat(`Failed to place block: ${step.block}`);
        return false;
      }
      await sleep(100);
    }
  }

  bot.chat('Repairs complete. Re-validating...');
  const finalCheck = validateStructure(bot, blueprint, origin, facing);
  bot.chat(`Final structure integrity score: ${finalCheck.score}%`);
  return finalCheck.valid;
}

/**
 * Scans a 3D bounding box and compiles it into a blueprint object.
 */
async function captureWorldStructure(bot, startPos, endPos, blueprintName, blueprintId) {
  const minX = Math.min(startPos.x, endPos.x);
  const maxX = Math.max(startPos.x, endPos.x);
  const minY = Math.min(startPos.y, endPos.y);
  const maxY = Math.max(startPos.y, endPos.y);
  const minZ = Math.min(startPos.z, endPos.z);
  const maxZ = Math.max(startPos.z, endPos.z);

  const materials = {};
  const blocks = [];

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const pos = new Vec3(x, y, z);
        const block = bot.blockAt(pos);
        const name = block ? block.name : 'air';
        
        if (!isAir(name)) {
          materials[name] = (materials[name] || 0) + 1;
          blocks.push({
            block: name,
            x: x - minX,
            y: y - minY,
            z: z - minZ
          });
        }
      }
    }
  }

  return {
    id: blueprintId || `captured_${Date.now()}`,
    name: blueprintName || "Captured Structure",
    kind: "captured",
    footprint: {
      width: maxX - minX + 1,
      depth: maxZ - minZ + 1
    },
    totalHeight: maxY - minY + 1,
    materials: {
      required: materials,
      optional: {}
    },
    phases: [
      {
        name: "captured_layout",
        blocks: blocks
      }
    ]
  };
}

module.exports = {
  validateStructure,
  repairStructure,
  captureWorldStructure
};
