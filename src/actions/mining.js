// ─── Smart Mining & Wood Gathering ──────────────────────────────────────────

const { Vec3 } = require('vec3');
const { sleep, findBestTool, collectDrops, getSafeMiningCheck, digSafely } = require('../utils');
const miningRules = require('../brain/miningRules');
const craftBrain = require('../brain/craft');

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

async function equipToolItem(bot, toolItem) {
  if (!toolItem) return null;
  try {
    await bot.equip(toolItem, 'hand');
    return toolItem;
  } catch (err) {
    console.log(`Failed to equip ${toolItem.name}: ${err.message}`);
    return null;
  }
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
  const tool = findBestTool(bot, freshBlock.name);
  const check = getSafeMiningCheck(bot, freshBlock.name, tool, { requireDrops: true });
  if (!check.canMine || !check.willDrop) {
    console.log(`Skipping unsafe dig for ${freshBlock.name}: ${check.reason}`);
    return false;
  }

  try {
    await bot.lookAt(freshBlock.position.offset(0.5, 0.5, 0.5), true);
    await sleep(100);
    const result = await digSafely(bot, freshBlock, { requireDrops: true });
    return result.success;
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

  /**
   * Check if we can craft a better tool of the given type, and if so, craft and equip it.
   */
  async function tryUpgradeTool(toolType, currentTool) {
    const currentTier = currentTool ? currentTool.name.split('_')[0] : 'hand';
    const currentLevel = miningRules.getTierLevel(currentTier) || 0;

    // Check tiers from best to worst to find the highest upgrade we can craft
    for (const tier of miningRules.TIER_ORDER) {
      const level = miningRules.getTierLevel(tier) || 0;
      if (level <= currentLevel) continue; // Only upgrade
      if (tier === 'netherite') continue; // Cannot craft netherite directly

      const toolName = `${tier}_${toolType}`;

      // Check if we can craft it
      const steps = craftBrain.resolveDependencies(bot, toolName, 1);
      if (steps) {
        bot.chat(`🔧 Upgrading tool: crafting ${toolName} to speed up mining...`);
        const result = await craftBrain.craft(bot, toolName, 1, { silent: false });
        if (result && result.success) {
          const craftedTool = bot.inventory.items().find(i => i.name === toolName);
          const equipped = await equipToolItem(bot, craftedTool);
          if (equipped) return equipped;
        }
      }
    }
    return currentTool;
  }

  /**
   * Ensures the bot has the best possible tool equipped for mining `blockName`.
   * Also checks if we can craft/upgrade to a better tool.
   * Enforces that the block cannot be mined without meeting drop requirements.
   */
  async function ensureMiningTool(bot, blockName) {
    const blockReq = miningRules.getBlockRequirement(blockName);
    const toolType = blockReq ? blockReq.tool : getToolTypeForBlock(blockName);
    const handCheck = miningRules.checkToolForBlock(null, blockName);
    if (!handCheck.canMine) {
      bot.chat(`Cannot mine ${blockName}: ${handCheck.reason}.`);
      return null;
    }

    // Equip best tool in inventory
    let currentTool = await equipBestTool(bot, blockName);

    // Try upgrading/crafting a replacement/upgraded tool
    currentTool = await tryUpgradeTool(toolType, currentTool);

    // Enforce drop requirements
    const check = miningRules.checkToolForBlock(currentTool, blockName);
    if (!check.willDrop) {
      bot.chat(`Cannot mine ${blockName} safely (${check.reason}).`);
      return null;
    }

    return currentTool;
  }

  /**
   * Check if the light level is low at the bot's position and place a torch if we have one.
   * If we don't have a torch, try to craft some first!
   */
  async function placeTorchForLight(bot) {
    const pos = bot.entity.position.floored();
    const block = bot.blockAt(pos);
    if (!block) return;

    // Check light levels: Y < 60 or skyLight === 0, and total light < 5
    const isUnderground = pos.y < 60 || block.skyLight === 0;
    if (!isUnderground || block.light >= 5) return;

    // Check if we already have torches
    let torchItem = bot.inventory.items().find(i => i.name === 'torch');
    if (!torchItem) {
      // Try to craft torches (1 stick + 1 coal/charcoal -> 4 torches)
      const steps = craftBrain.resolveDependencies(bot, 'torch', 1);
      if (steps) {
        bot.chat('💡 It is dark underground. Crafting torches...');
        const craftResult = await craftBrain.craft(bot, 'torch', 1, { silent: true });
        if (craftResult && craftResult.success) {
          torchItem = bot.inventory.items().find(i => i.name === 'torch');
        }
      }
    }

    if (!torchItem) return;

    // Find a block to place the torch on. First try the ground block below us.
    const groundPos = pos.offset(0, -1, 0);
    const groundBlock = bot.blockAt(groundPos);
    if (groundBlock && groundBlock.name !== 'air' && groundBlock.name !== 'water' && groundBlock.name !== 'lava') {
      try {
        const feetBlock = bot.blockAt(pos);
        if (feetBlock && (feetBlock.name === 'air' || feetBlock.name === 'cave_air')) {
          await bot.equip(torchItem, 'hand');
          await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
          console.log(`[Mining] Placed torch at ${pos} for visibility`);
          return;
        }
      } catch (err) {
        console.log(`[Mining] Failed to place torch on ground: ${err.message}`);
      }
    }

    // Otherwise, try adjacent walls
    const directions = [
      new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1),
      new Vec3(0, 0, -1),
    ];
    for (const dir of directions) {
      const wallPos = pos.plus(dir);
      const wallBlock = bot.blockAt(wallPos);
      if (wallBlock && wallBlock.name !== 'air' && wallBlock.name !== 'water' && wallBlock.name !== 'lava') {
        try {
          await bot.equip(torchItem, 'hand');
          await bot.placeBlock(wallBlock, new Vec3(-dir.x, 0, -dir.z));
          console.log(`[Mining] Placed torch on wall at ${wallPos} for visibility`);
          return;
        } catch {
          // Try next direction
        }
      }
    }
  }

  // ── mine ────────────────────────────────────────────────────────────────
  async function mine(action) {
    const blockName = action.block;
    const target = action.count || 1;
    const id = blockId(bot, blockName);

    if (id == null) {
      bot.chat(`I don't know what "${blockName}" is.`);
      return;
    }

    // ── Pre-flight: check tool requirements and upgrades ──
    const currentTool = await ensureMiningTool(bot, blockName);
    if (miningRules.getBlockRequirement(blockName) && !currentTool) {
      bot.chat(`❌ Cannot mine ${blockName} for drops. Skipping.`);
      return;
    }

    bot.chat(`Mining ${target} ${blockName}...`);
    let mined = 0;

    while (mined < target) {
      const block = bot.findBlock({ matching: id, maxDistance: 64 });
      if (!block) {
        bot.chat(`Can't find any more ${blockName} nearby (mined ${mined}/${target}).`);
        break;
      }

      // Check and place torch if dark underground
      await placeTorchForLight(bot);

      // Ensure tool is equipped and check for upgrade before digging
      const activeTool = await ensureMiningTool(bot, blockName);
      if (miningRules.getBlockRequirement(blockName) && !activeTool) {
        bot.chat(`❌ Tool broke or insufficient to get drops from ${blockName}. Stopping.`);
        break;
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

  /**
   * Determine tool type for a block (when not in miningRules).
   */
  function getToolTypeForBlock(blockName) {
    if (blockName.includes('log') || blockName.includes('planks') || blockName.includes('wood')) return 'axe';
    if (['dirt', 'grass_block', 'sand', 'gravel', 'clay', 'mud'].includes(blockName)) return 'shovel';
    if (blockName.includes('leaves') || blockName.includes('vine') || blockName === 'cobweb') return 'shears';
    return 'pickaxe'; // Default
  }

  /**
   * Try to auto-craft the best possible tool of a given type.
   * Attempts from best tier down to the minimum required tier.
   * @param {string} toolType - 'pickaxe', 'axe', 'shovel', 'sword'
   * @param {string} minTier - Minimum acceptable tier: 'wooden', 'stone', 'iron', 'diamond'
   * @returns {boolean} - true if crafted successfully
   */
  async function tryAutoCraftTool(toolType, minTier) {
    const minLevel = miningRules.getTierLevel(minTier);

    // Try from best available to minimum required
    for (const tier of miningRules.TIER_ORDER) {
      const level = miningRules.getTierLevel(tier);
      if (level < minLevel) continue; // Skip tiers below minimum
      if (tier === 'netherite') continue; // Can't craft netherite tools directly

      const toolName = `${tier}_${toolType}`;

      // Check if we already have one
      if (bot.inventory.items().find(i => i.name === toolName)) {
        return true; // Already have it
      }

      // Try to craft it
      try {
        const result = await craftBrain.craft(bot, toolName, 1, { silent: true });
        if (result && result.success) {
          console.log(`[Mining] Auto-crafted ${toolName}`);
          return true;
        }
      } catch (err) {
        console.log(`[Mining] Couldn't craft ${toolName}: ${err.message}`);
      }
    }

    return false; // Couldn't craft any suitable tool
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

    // Ensure we have a pickaxe (handles upgrading/crafting)
    const preTool = await ensureMiningTool(bot, 'stone');
    if (!preTool) {
      bot.chat(`❌ Cannot start strip mining: no pickaxe available.`);
      return;
    }

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

      // Check and place torch if dark underground
      await placeTorchForLight(bot);

      // Dig feet level
      try {
        const feetBlock = bot.blockAt(feetPos);
        if (feetBlock && feetBlock.type !== 0) { // 0 = air
          const tool = await ensureMiningTool(bot, feetBlock.name);
          if (!tool && miningRules.getBlockRequirement(feetBlock.name)) {
            bot.chat(`❌ Cannot continue strip mining: no suitable tool for ${feetBlock.name}.`);
            break;
          }
          await holdDigBlock(bot, goals, feetBlock);
        }
      } catch (err) {
        console.log(`Dig feet error step ${step}: ${err.message}`);
      }

      // Dig head level
      try {
        const headBlock = bot.blockAt(headPos);
        if (headBlock && headBlock.type !== 0) {
          const tool = await ensureMiningTool(bot, headBlock.name);
          if (!tool && miningRules.getBlockRequirement(headBlock.name)) {
            bot.chat(`❌ Cannot continue strip mining: no suitable tool for ${headBlock.name}.`);
            break;
          }
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

              // Ensure tool for ore (handles upgrades/breakage/checks)
              const tool = await ensureMiningTool(bot, oreName);
              if (!tool) {
                bot.chat(`⚠️ Skipping ${oreName} — no suitable tool.`);
                continue;
              }

              bot.chat(`Found ${oreName}!`);

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
          await ensureMiningTool(bot, 'stone');
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

    // Equip best axe (and upgrade if possible)
    await ensureMiningTool(bot, logType);

    let chopped = 0;

    // Chop from bottom to top
    for (const logBlock of treeLogs) {
      try {
        const fresh = bot.blockAt(logBlock.position);
        if (fresh && logIdSet.has(fresh.type)) {
          // Ensure axe is equipped and check for upgrade before digging each log
          await ensureMiningTool(bot, logType);
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
