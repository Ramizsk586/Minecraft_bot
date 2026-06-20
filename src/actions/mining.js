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

      // Navigate close to the block
      try {
        await bot.pathfinder.goto(
          new goals.GoalNear(block.position.x, block.position.y, block.position.z, 4)
        );
      } catch (err) {
        console.log(`Pathfinder error going to ${blockName}: ${err.message}`);
        bot.chat(`Can't reach a ${blockName}, skipping...`);
        await sleep(500);
        continue;
      }

      // Re-check tool — it may have broken
      if (currentTool && (!bot.heldItem || bot.heldItem.name !== currentTool.name)) {
        console.log('Tool appears to have changed, re-equipping...');
        currentTool = await equipBestTool(bot, blockName);
        if (!currentTool) {
          bot.chat('My tool broke and I have no replacement!');
        }
      }

      // Dig
      try {
        // Re-fetch the block at the position in case it changed
        const freshBlock = bot.blockAt(block.position);
        if (freshBlock && freshBlock.type === id) {
          await bot.dig(freshBlock);
          mined++;
        }
      } catch (err) {
        console.log(`Dig error: ${err.message}`);
        await sleep(300);
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
          await bot.dig(feetBlock);
        }
      } catch (err) {
        console.log(`Dig feet error step ${step}: ${err.message}`);
      }

      // Dig head level
      try {
        const headBlock = bot.blockAt(headPos);
        if (headBlock && headBlock.type !== 0) {
          await equipBestTool(bot, headBlock.name);
          await bot.dig(headBlock);
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
                  await bot.dig(freshOre);
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

    // Find full trunk going upward
    const trunk = findTreeTrunk(bot, basePos, logIdSet);
    if (trunk.length === 0) {
      bot.chat("Couldn't identify the tree trunk.");
      return;
    }

    const logType = trunk[0].name;
    bot.chat(`Found a ${logType.replace('_log', '')} tree (${trunk.length} logs). Chopping...`);

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
    for (const logBlock of trunk) {
      try {
        const fresh = bot.blockAt(logBlock.position);
        if (fresh && logIdSet.has(fresh.type)) {
          await bot.dig(fresh);
          chopped++;
        }
      } catch (err) {
        console.log(`Chop error: ${err.message}`);
      }
    }

    // Collect all drops (logs, saplings, apples)
    await collectDrops(bot, goals);

    bot.chat(`Chopped ${chopped} ${logType} from the tree.`);

    return { basePos, logType, chopped };
  }

  // ── gather_wood ─────────────────────────────────────────────────────────
  async function gatherWood(action) {
    const treeCount = action.count || 3;
    const replant = action.replant !== undefined ? action.replant : false;

    bot.chat(`Gathering wood from ${treeCount} trees${replant ? ' (replanting)' : ''}...`);

    let totalWood = 0;
    let treesChopped = 0;

    for (let i = 0; i < treeCount; i++) {
      // Reuse chopTree logic
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
      await collectDrops(bot, goals);

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
