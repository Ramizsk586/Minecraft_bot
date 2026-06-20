// ─── Smart Mining & Wood Gathering ──────────────────────────────────────────

const { Vec3 } = require('vec3');
const { sleep, findBestTool, collectDrops } = require('../utils');

// All log types for tree detection
const LOG_TYPES = [
  'oak_log', 'spruce_log', 'birch_log', 'jungle_log',
  'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
];

// Ore blocks to scan for in strip mine walls
const ORE_BLOCKS = [
  'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore',
  'emerald_ore', 'lapis_ore', 'redstone_ore', 'copper_ore',
  'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_gold_ore',
  'deepslate_diamond_ore', 'deepslate_emerald_ore', 'deepslate_lapis_ore',
  'deepslate_redstone_ore', 'deepslate_copper_ore',
];

// Direction name → Vec3 offset
const DIRECTION_OFFSETS = {
  north: new Vec3(0, 0, -1),
  south: new Vec3(0, 0, 1),
  east:  new Vec3(1, 0, 0),
  west:  new Vec3(-1, 0, 0),
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Resolve a block name to its numeric ID, or null if unknown. */
function blockId(bot, name) {
  return bot.registry.blocksByName[name]?.id ?? null;
}

/** Build an array of numeric IDs from an array of block names (skips unknowns). */
function blockIds(bot, names) {
  const ids = [];
  for (const n of names) {
    const id = blockId(bot, n);
    if (id != null) ids.push(id);
  }
  return ids;
}

/** Check whether a block's name is in the given set. */
function isOneOf(block, nameSet) {
  return block && nameSet.has(block.name);
}

/** Equip the best tool for `blockName`, returns the item or null. */
async function equipBestTool(bot, blockName) {
  const tool = findBestTool(bot, blockName);
  if (tool) {
    try {
      await bot.equip(tool, 'hand');
    } catch (err) {
      console.log(`Failed to equip ${tool.name}: ${err.message}`);
    }
  }
  return tool;
}

async function moveIntoDigRange(bot, goals, block) {
  if (!block) return false;

  const distance = bot.entity.position.distanceTo(block.position.offset(0.5, 0.5, 0.5));
  if (distance <= 4.5 && bot.canDigBlock(block)) {
    return true;
  }

  try {
    await bot.pathfinder.goto(
      new goals.GoalNear(block.position.x, block.position.y, block.position.z, 3)
    );
  } catch {}

  const refreshed = bot.blockAt(block.position);
  return !!refreshed && bot.canDigBlock(refreshed);
}

async function holdDigBlock(bot, goals, block) {
  if (!block) return false;

  const reachable = await moveIntoDigRange(bot, goals, block);
  if (!reachable) return false;

  const freshBlock = bot.blockAt(block.position);
  if (!freshBlock || freshBlock.name === 'air') return false;

  try {
    await bot.lookAt(freshBlock.position.offset(0.5, 0.5, 0.5), true);
    await sleep(100);
    await bot.dig(freshBlock, true);
    return true;
  } catch (err) {
    if (/goal was changed|digging aborted/i.test(err.message || '')) {
      return false;
    }
    console.log(`holdDigBlock failed for ${freshBlock.name}: ${err.message}`);
    return false;
  }
}

/**
 * Find all connected logs of the same type going upward from `basePos`.
 * Returns an ordered array of Block references from bottom to top.
 */
function findTreeTrunk(bot, basePos, logIdSet) {
  const trunk = [];
  let pos = basePos.clone();
  while (true) {
    const blk = bot.blockAt(pos);
    if (!blk || !logIdSet.has(blk.type)) break;
    trunk.push(blk);
    pos = pos.offset(0, 1, 0);
  }
  return trunk;
}

function findWholeTree(bot, rootBlock) {
  if (!rootBlock) return [];

  const rootName = rootBlock.name;
  const visited = new Set();
  const queue = [rootBlock.position.clone()];
  const found = [];

  while (queue.length > 0 && found.length < 96) {
    const pos = queue.shift();
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const block = bot.blockAt(pos);
    if (!block || block.name !== rootName) continue;
    found.push(block);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 2) continue;
          queue.push(pos.offset(dx, dy, dz));
        }
      }
    }
  }

  return found.sort((a, b) => {
    if (a.position.y !== b.position.y) return a.position.y - b.position.y;
    const da = a.position.distanceTo(rootBlock.position);
    const db = b.position.distanceTo(rootBlock.position);
    return da - db;
  });
}

// ─── Module Registration ────────────────────────────────────────────────────

function register(bot, goals) {

  // ── mine ────────────────────────────────────────────────────────────────
  async function mine(action) {
    const blockName = action.block;
    const target = action.count || 1;
    const id = blockId(bot, blockName);

    if (id == null) {
      bot.chat(`I don't know what "${blockName}" is.`);
      return;
    }

    bot.chat(`Mining ${target} ${blockName}...`);

    // Equip best tool up-front
    let currentTool = await equipBestTool(bot, blockName);
    let mined = 0;

    while (mined < target) {
      const block = bot.findBlock({ matching: id, maxDistance: 64 });
      if (!block) {
        bot.chat(`Can't find any more ${blockName} nearby (mined ${mined}/${target}).`);
        break;
      }

      // Re-check tool — it may have broken
      if (currentTool && (!bot.heldItem || bot.heldItem.name !== currentTool.name)) {
        console.log('Tool appears to have changed, re-equipping...');
        currentTool = await equipBestTool(bot, blockName);
        if (!currentTool) {
          bot.chat('My tool broke and I have no replacement!');
        }
      }

      const dug = await holdDigBlock(bot, goals, block);
      if (dug) {
        mined++;
      } else {
        console.log(`Dig error: could not break ${blockName} at ${block.position}`);
        await sleep(300);
        if (bot._currentTask && bot._currentTask !== `autonomy:mining_${blockName}` && String(bot._currentTask).startsWith('autonomy:')) {
          break;
        }
        continue;
      }

      // Collect drops after each dig
      await collectDrops(bot, goals);

      // Progress report every 5 blocks
      if (mined > 0 && mined % 5 === 0 && mined < target) {
        bot.chat(`Progress: mined ${mined}/${target} ${blockName}.`);
      }
    }

    if (mined > 0) {
      bot.chat(`Done! Mined ${mined} ${blockName}.`);
    } else {
      bot.chat(`Couldn't mine ${blockName} right now.`);
    }
  }

  // ── strip_mine ──────────────────────────────────────────────────────────
  async function stripMine(action) {
    const direction = (action.direction || 'north').toLowerCase();
    const length = action.length || 50;
    const yLevel = action.y || 11;

    const offset = DIRECTION_OFFSETS[direction];
    if (!offset) {
      bot.chat(`Unknown direction "${direction}". Use north/south/east/west.`);
      return;
    }

    // Perpendicular directions for checking walls
    const perp = direction === 'north' || direction === 'south'
      ? [new Vec3(1, 0, 0), new Vec3(-1, 0, 0)]
      : [new Vec3(0, 0, 1), new Vec3(0, 0, -1)];

    // Pre-compute ore ID set
    const oreIdSet = new Set(blockIds(bot, ORE_BLOCKS));

    // Equip best pickaxe
    await equipBestTool(bot, 'stone'); // 'stone' maps to pickaxe in TOOL_FOR_BLOCK

    const startPos = bot.entity.position.floored();
    const startX = startPos.x;
    const startZ = startPos.z;

    const oresFound = {};
    let torchesPlaced = 0;
    const torchId = blockId(bot, 'torch') ?? blockId(bot, 'wall_torch');

    bot.chat(`Strip mining ${direction} for ${length} blocks at y=${yLevel}...`);

    for (let step = 0; step < length; step++) {
      const baseX = startX + offset.x * step;
      const baseZ = startZ + offset.z * step;
      const feetPos = new Vec3(baseX, yLevel, baseZ);
      const headPos = new Vec3(baseX, yLevel + 1, baseZ);

      // Navigate to this position
      try {
        await bot.pathfinder.goto(
          new goals.GoalNear(feetPos.x, feetPos.y, feetPos.z, 2)
        );
      } catch (err) {
        console.log(`Pathfinder error at step ${step}: ${err.message}`);
        // Try to continue anyway
      }

      // Dig feet level
      try {
        const feetBlock = bot.blockAt(feetPos);
        if (feetBlock && feetBlock.type !== 0) { // 0 = air
          await equipBestTool(bot, feetBlock.name);
          await holdDigBlock(bot, goals, feetBlock);
        }
      } catch (err) {
        console.log(`Dig feet error step ${step}: ${err.message}`);
      }

      // Dig head level
      try {
        const headBlock = bot.blockAt(headPos);
        if (headBlock && headBlock.type !== 0) {
          await equipBestTool(bot, headBlock.name);
          await holdDigBlock(bot, goals, headBlock);
        }
      } catch (err) {
        console.log(`Dig head error step ${step}: ${err.message}`);
      }

      // Check walls (left & right, 1 block deep) at both y levels
      for (const p of perp) {
        for (let dy = 0; dy <= 1; dy++) {
          const wallPos = feetPos.offset(p.x, dy, p.z);
          try {
            const wallBlock = bot.blockAt(wallPos);
            if (wallBlock && oreIdSet.has(wallBlock.type)) {
              const oreName = wallBlock.name;
              bot.chat(`Found ${oreName}!`);
              await equipBestTool(bot, oreName);

              // Navigate closer if needed
              try {
                await bot.pathfinder.goto(
                  new goals.GoalNear(wallPos.x, wallPos.y, wallPos.z, 2)
                );
              } catch { /* best effort */ }

              try {
                const freshOre = bot.blockAt(wallPos);
                if (freshOre && oreIdSet.has(freshOre.type)) {
                  await holdDigBlock(bot, goals, freshOre);
                  oresFound[oreName] = (oresFound[oreName] || 0) + 1;
                }
              } catch (err) {
                console.log(`Dig ore error: ${err.message}`);
              }
            }
          } catch (err) {
            console.log(`Wall check error: ${err.message}`);
          }
        }
      }

      // Place torch every 8 blocks
      if (step > 0 && step % 8 === 0) {
        const torchItem = bot.inventory.items().find(i => i.name === 'torch');
        if (torchItem) {
          try {
            await bot.equip(torchItem, 'hand');
            // Place on a wall block (try perpendicular directions)
            for (const p of perp) {
              const wallPos = feetPos.offset(p.x, 1, p.z);
              const wallBlock = bot.blockAt(wallPos);
              if (wallBlock && wallBlock.type !== 0) {
                // Place against the wall block, facing inward
                const faceVec = new Vec3(-p.x, 0, -p.z);
                try {
                  await bot.placeBlock(wallBlock, faceVec);
                  torchesPlaced++;
                  break;
                } catch {
                  // Try the other wall
                }
              }
            }
          } catch (err) {
            console.log(`Torch placement error: ${err.message}`);
          }
          // Re-equip pickaxe
          await equipBestTool(bot, 'stone');
        }
      }

      // Collect drops periodically (every 10 steps)
      if (step > 0 && step % 10 === 0) {
        await collectDrops(bot, goals);
      }
    }

    // Final drop collection
    await collectDrops(bot, goals);

    // Report results
    const oreReport = Object.entries(oresFound)
      .map(([name, count]) => `${name}: ${count}`)
      .join(', ');
    bot.chat(`Strip mine complete! Dug ${length} blocks ${direction}.`);
    if (oreReport) {
      bot.chat(`Ores found: ${oreReport}`);
    } else {
      bot.chat('No ores found in the walls.');
    }
    if (torchesPlaced > 0) {
      bot.chat(`Placed ${torchesPlaced} torches.`);
    }
  }

  // ── chop_tree ───────────────────────────────────────────────────────────
  async function chopTree(action) {
    const logIdArray = blockIds(bot, LOG_TYPES);
    if (logIdArray.length === 0) {
      bot.chat("I don't recognize any log types in this version.");
      return;
    }

    const logIdSet = new Set(logIdArray);

    bot.chat('Looking for a tree to chop...');

    // Find nearest log
    const nearestLog = bot.findBlock({
      matching: logIdArray,
      maxDistance: 64,
    });

    if (!nearestLog) {
      bot.chat("Can't find any trees nearby.");
      return;
    }

    // Walk down to find the base of the trunk
    let basePos = nearestLog.position.clone();
    while (true) {
      const below = bot.blockAt(basePos.offset(0, -1, 0));
      if (below && logIdSet.has(below.type)) {
        basePos = basePos.offset(0, -1, 0);
      } else {
        break;
      }
    }

    const rootBlock = bot.blockAt(basePos);
    const treeLogs = findWholeTree(bot, rootBlock);
    if (treeLogs.length === 0) {
      bot.chat("Couldn't identify the full tree.");
      return;
    }

    const logType = treeLogs[0].name;
    bot.chat(`Found a ${logType.replace('_log', '')} tree (${treeLogs.length} logs). Chopping it completely...`);

    // Navigate to base
    try {
      await bot.pathfinder.goto(
        new goals.GoalNear(basePos.x, basePos.y, basePos.z, 2)
      );
    } catch (err) {
      console.log(`Pathfinder error to tree base: ${err.message}`);
    }

    // Equip best axe
    await equipBestTool(bot, logType);

    let chopped = 0;

    // Chop from bottom to top
    for (const logBlock of treeLogs) {
      try {
        const fresh = bot.blockAt(logBlock.position);
        if (fresh && logIdSet.has(fresh.type)) {
          const dug = await holdDigBlock(bot, goals, fresh);
          if (!dug) continue;
          chopped++;
          await collectDrops(bot, goals, 250, { maxDistance: 14, maxItems: 8, passes: 1 });
        }
      } catch (err) {
        console.log(`Chop error: ${err.message}`);
      }
    }

    // Collect all drops (logs, saplings, apples)
    await collectDrops(bot, goals, 500, { maxDistance: 18, maxItems: 20, passes: 3 });

    bot.chat(`Chopped ${chopped} ${logType} from the tree.`);

    return { basePos, logType, chopped, positions: treeLogs.map(block => block.position.clone()) };
  }

  // ── gather_wood ─────────────────────────────────────────────────────────
  async function gatherWood(action) {
    const treeCount = action.count || 3;
    const replant = action.replant !== undefined ? action.replant : false;

    bot.chat(`Gathering wood from ${treeCount} trees${replant ? ' (replanting)' : ''}...`);

    let totalWood = 0;
    let treesChopped = 0;

    for (let i = 0; i < treeCount; i++) {
      const result = await chopTree({});

      if (!result) {
        bot.chat(`Could only find ${treesChopped} trees.`);
        break;
      }

      treesChopped++;
      totalWood += result.chopped;

      // Replant if requested
      if (replant && result.basePos) {
        // Determine sapling name from log type
        const saplingName = result.logType.replace('_log', '_sapling');
        const saplingItem = bot.inventory.items().find(i => i.name === saplingName);

        if (saplingItem) {
          try {
            // Navigate back to base position
            await bot.pathfinder.goto(
              new goals.GoalNear(result.basePos.x, result.basePos.y, result.basePos.z, 2)
            );

            // We need to place on the block below the base position
            const groundPos = result.basePos.offset(0, -1, 0);
            const groundBlock = bot.blockAt(groundPos);

            if (groundBlock) {
              await bot.equip(saplingItem, 'hand');
              await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
              bot.chat(`Replanted a ${saplingName}.`);
            }
          } catch (err) {
            console.log(`Replant error: ${err.message}`);
            bot.chat(`Couldn't replant ${saplingName}.`);
          }
        } else {
          bot.chat(`No ${saplingName} to replant.`);
        }
      }

      // Collect remaining drops between trees
      await collectDrops(bot, goals, 500, { maxDistance: 18, maxItems: 20, passes: 3 });

      // Small delay between trees
      await sleep(500);
    }

    bot.chat(`Wood gathering complete! Chopped ${treesChopped} trees, got ${totalWood} logs total.`);
  }

  // ── Return action handlers ──────────────────────────────────────────────
  return {
    mine:       async (action) => mine(action),
    strip_mine: async (action) => stripMine(action),
    chop_tree:  async (action) => chopTree(action),
    gather_wood: async (action) => gatherWood(action),
  };
}

module.exports = { register };
