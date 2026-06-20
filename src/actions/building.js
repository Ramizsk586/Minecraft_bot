const { sleep } = require('../utils');
const { Vec3 } = require('vec3');
const { Movements } = require('mineflayer-pathfinder');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isAir(name) {
  return !name || name === 'air' || name === 'cave_air' || name === 'void_air';
}

/**
 * Count how many of a given block item the bot has in inventory.
 */
function countBlock(bot, blockName) {
  return bot.inventory.items()
    .filter(i => i.name === blockName)
    .reduce((sum, i) => sum + i.count, 0);
}

/**
 * Try to auto-craft blocks if the bot doesn't have enough.
 * Uses the brain/craft module for dependency-resolved crafting.
 * Returns true if the bot now has at least `needed` of the block.
 */
async function ensureBlocks(bot, blockName, needed) {
  const have = countBlock(bot, blockName);
  if (have >= needed) return true;

  // Attempt auto-craft via brain
  try {
    const brainCraft = require('../brain/craft');
    const deficit = needed - have;
    console.log(`[building] Need ${deficit} more ${blockName}, attempting auto-craft...`);
    const result = await brainCraft.craft(bot, blockName, deficit, { silent: false });
    if (result.success) {
      console.log(`[building] Auto-crafted ${deficit}x ${blockName}`);
      return countBlock(bot, blockName) >= needed;
    }
  } catch (err) {
    console.log(`[building] Auto-craft unavailable for ${blockName}: ${err.message}`);
  }

  return countBlock(bot, blockName) >= needed;
}

// ─── Improved placeBlockAt ────────────────────────────────────────────────────

// List of blocks that do not collide with the bot (safe to stand inside)
const DONT_MOVE_FOR = new Set([
  'torch', 'redstone_torch', 'redstone', 'lever', 'button', 
  'rail', 'detector_rail', 'powered_rail', 'activator_rail', 
  'tripwire_hook', 'tripwire', 'water_bucket', 'lava_bucket', 'string',
  'wheat_seeds', 'pumpkin_seeds', 'melon_seeds', 'beetroot_seeds',
  'air', 'cave_air'
]);

/**
 * Place a single block at (x, y, z) with safety and orientation logic.
 * Returns true on success, false on failure.
 */
async function placeBlockAt(bot, goals, blockName, x, y, z, options = {}) {
  try {
    // 1. Resolve target coordinates to integers
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const tz = Math.floor(z);
    const targetDest = new Vec3(tx, ty, tz);

    // 2. Skip if target position already has a non-air block
    const existing = bot.blockAt(targetDest);
    if (existing && !isAir(existing.name)) {
      return true; // Already occupied — treat as success
    }

    // 3. Find the block item in inventory by exact name
    const item = bot.inventory.items().find(i => i.name === blockName);
    if (!item) {
      console.log(`placeBlockAt: no ${blockName} in inventory`);
      return false;
    }

    // 4. Equip the item
    await bot.equip(item, 'hand');

    // 5. Distance Safety (GoalInvert): Move away if standing on/inside the target space
    const pos = bot.entity.position;
    const posAbove = pos.plus(new Vec3(0, 1, 0));
    const isTooClose = pos.distanceTo(targetDest) < 1.1 || posAbove.distanceTo(targetDest) < 1.1;

    if (!DONT_MOVE_FOR.has(blockName) && isTooClose) {
      console.log(`[Safety] Bot too close to solid placement site (${tx}, ${ty}, ${tz}). Backing away...`);
      const goalNear = new goals.GoalNear(tx, ty, tz, 2);
      const invertedGoal = new goals.GoalInvert(goalNear);
      
      const oldMovements = bot.pathfinder.movements;
      bot.pathfinder.setMovements(new Movements(bot));
      try {
        await bot.pathfinder.goto(invertedGoal);
      } catch (err) {
        console.log(`[Safety] Flee pathfinding failed/interrupted: ${err.message}`);
      } finally {
        bot.pathfinder.setMovements(oldMovements);
      }
    }

    // 6. Navigate near — try close first (GoalNear(3)), then wider (GoalNear(5))
    const distanceToTarget = bot.entity.position.distanceTo(targetDest);
    if (distanceToTarget > 4.5) {
      let reachedClose = false;
      try {
        await bot.pathfinder.goto(new goals.GoalNear(tx, ty, tz, 3));
        reachedClose = true;
      } catch (err) {
        console.log(`placeBlockAt: close pathfind failed, trying wider: ${err.message}`);
      }

      if (!reachedClose) {
        try {
          await bot.pathfinder.goto(new goals.GoalNear(tx, ty, tz, 5));
        } catch (err) {
          console.log(`placeBlockAt: wide pathfind also failed: ${err.message}`);
        }
      }
    }

    // 7. Find an adjacent solid block to place against
    const offsets = [
      new Vec3(0, -1, 0),  // below (places on top face)
      new Vec3(0, 0, -1),  // north
      new Vec3(0, 0, 1),   // south
      new Vec3(-1, 0, 0),  // west
      new Vec3(1, 0, 0),   // east
      new Vec3(0, 1, 0),   // above
    ];

    let referenceBlock = null;
    let faceVector = null;

    // Optional: Preferred placement face (e.g., 'top', 'bottom', 'north')
    if (options.placeOn && options.placeOn !== 'side') {
      const preferredOffsetMap = {
        'top': new Vec3(0, -1, 0),
        'bottom': new Vec3(0, 1, 0),
        'north': new Vec3(0, 0, 1),
        'south': new Vec3(0, 0, -1),
        'east': new Vec3(-1, 0, 0),
        'west': new Vec3(1, 0, 0)
      };
      const prefOffset = preferredOffsetMap[options.placeOn];
      if (prefOffset) {
        const refPos = targetDest.plus(prefOffset);
        const block = bot.blockAt(refPos);
        if (block && !isAir(block.name)) {
          referenceBlock = block;
          faceVector = new Vec3(-prefOffset.x, -prefOffset.y, -prefOffset.z);
        }
      }
    }

    // Fallback: Check all sides
    if (!referenceBlock) {
      for (const offset of offsets) {
        const refPos = targetDest.plus(offset);
        const block = bot.blockAt(refPos);
        if (block && !isAir(block.name)) {
          referenceBlock = block;
          faceVector = new Vec3(-offset.x, -offset.y, -offset.z);
          break;
        }
      }
    }

    if (!referenceBlock) {
      console.log(`placeBlockAt: no adjacent solid block at ${tx},${ty},${tz}`);
      return false;
    }

    // 8. Look at the face of the reference block
    const faceCenter = referenceBlock.position.offset(
      0.5 + faceVector.x * 0.5,
      0.5 + faceVector.y * 0.5,
      0.5 + faceVector.z * 0.5
    );
    await bot.lookAt(faceCenter, true);
    await sleep(100);

    // 9. Handle Orientation for Directional Blocks in Survival
    if (
      blockName.includes('stairs') || 
      blockName.includes('bed') || 
      blockName.includes('door') || 
      blockName.includes('repeater')
    ) {
      let yaw = bot.entity.yaw;
      if (options.direction) {
        const yawMap = { 
          'south': 0, 
          'west': Math.PI / 2, 
          'north': Math.PI, 
          'east': 3 * Math.PI / 2 
        };
        if (yawMap[options.direction] !== undefined) {
          yaw = yawMap[options.direction];
        }
      }
      // Force looking horizontally in the target direction so block places facing correctly
      await bot.look(yaw, 0, true);
      await sleep(100);
    }

    // 10. Place the block
    await bot.placeBlock(referenceBlock, faceVector);
    await sleep(250);

    // 11. Verify placement
    const placed = bot.blockAt(targetDest);
    if (placed && !isAir(placed.name)) {
      return true;
    } else {
      console.log(`placeBlockAt: verification failed at ${tx},${ty},${tz} — block is ${placed?.name}`);
      return false;
    }
  } catch (err) {
    console.log(`placeBlockAt: error placing ${blockName} at ${x},${y},${z}: ${err.message}`);
    return false;
  }
}

// ─── House Templates ──────────────────────────────────────────────────────────
// Each returns an array of { x, y, z, block } relative to origin (ox, oy, oz).

/**
 * Basic house: 5x4x5 cobblestone walls + oak_planks floor + oak_slab roof, door on one wall
 */
function templateBasic(ox, oy, oz) {
  const blocks = [];
  const W = 5, H = 4, D = 5;

  // Floor (oak_planks) at oy
  for (let dx = 0; dx < W; dx++) {
    for (let dz = 0; dz < D; dz++) {
      blocks.push({ x: ox + dx, y: oy, z: oz + dz, block: 'oak_planks' });
    }
  }

  // Walls (cobblestone) from oy+1 to oy+H-1
  for (let dy = 1; dy < H; dy++) {
    for (let dx = 0; dx < W; dx++) {
      for (let dz = 0; dz < D; dz++) {
        const onEdge = (dx === 0 || dx === W - 1 || dz === 0 || dz === D - 1);
        if (!onEdge) continue;

        // Leave door opening on front wall (z === 0), middle x, bottom 2 layers
        const isDoor = (dz === 0 && dx === Math.floor(W / 2) && dy <= 2);
        if (isDoor) continue;

        blocks.push({ x: ox + dx, y: oy + dy, z: oz + dz, block: 'cobblestone' });
      }
    }
  }

  // Roof (oak_slab) at oy+H
  for (let dx = 0; dx < W; dx++) {
    for (let dz = 0; dz < D; dz++) {
      blocks.push({ x: ox + dx, y: oy + H, z: oz + dz, block: 'oak_slab' });
    }
  }

  return blocks;
}

/**
 * Cottage: 7x5x7 oak_planks walls + cobblestone foundation, glass_pane windows, door
 */
function templateCottage(ox, oy, oz) {
  const blocks = [];
  const W = 7, H = 5, D = 7;

  // Foundation (cobblestone) at oy
  for (let dx = 0; dx < W; dx++) {
    for (let dz = 0; dz < D; dz++) {
      blocks.push({ x: ox + dx, y: oy, z: oz + dz, block: 'cobblestone' });
    }
  }

  // Walls (oak_planks) from oy+1 to oy+H-1
  for (let dy = 1; dy < H; dy++) {
    for (let dx = 0; dx < W; dx++) {
      for (let dz = 0; dz < D; dz++) {
        const onEdge = (dx === 0 || dx === W - 1 || dz === 0 || dz === D - 1);
        if (!onEdge) continue;

        // Door opening: front wall (z === 0), middle x, bottom 2 layers
        const isDoor = (dz === 0 && dx === Math.floor(W / 2) && dy <= 2);
        if (isDoor) continue;

        // Windows: on each wall, middle positions, at dy === 2
        const isWindow = dy === 2 && (
          (dz === 0 && (dx === 2 || dx === 4)) ||                          // front
          (dz === D - 1 && (dx === 2 || dx === 4)) ||                      // back
          (dx === 0 && (dz === 2 || dz === 4)) ||                          // left
          (dx === W - 1 && (dz === 2 || dz === 4))                         // right
        );

        if (isWindow) {
          blocks.push({ x: ox + dx, y: oy + dy, z: oz + dz, block: 'glass_pane' });
        } else {
          blocks.push({ x: ox + dx, y: oy + dy, z: oz + dz, block: 'oak_planks' });
        }
      }
    }
  }

  // Roof (oak_slab) at oy+H
  for (let dx = 0; dx < W; dx++) {
    for (let dz = 0; dz < D; dz++) {
      blocks.push({ x: ox + dx, y: oy + H, z: oz + dz, block: 'oak_slab' });
    }
  }

  return blocks;
}

/**
 * Bunker: 5x3x5 underground — dig down, line with cobblestone
 * Origin is surface level; bunker goes from oy-4 to oy-1 (floor at oy-4, ceiling at oy-1)
 */
function templateBunker(ox, oy, oz) {
  const blocks = [];
  const W = 5, H = 3, D = 5;
  const baseY = oy - H - 1; // floor level

  // Floor at baseY
  for (let dx = 0; dx < W; dx++) {
    for (let dz = 0; dz < D; dz++) {
      blocks.push({ x: ox + dx, y: baseY, z: oz + dz, block: 'cobblestone' });
    }
  }

  // Walls from baseY+1 to baseY+H
  for (let dy = 1; dy <= H; dy++) {
    for (let dx = 0; dx < W; dx++) {
      for (let dz = 0; dz < D; dz++) {
        const onEdge = (dx === 0 || dx === W - 1 || dz === 0 || dz === D - 1);
        if (!onEdge) continue;
        blocks.push({ x: ox + dx, y: baseY + dy, z: oz + dz, block: 'cobblestone' });
      }
    }
  }

  // Ceiling at baseY + H + 1
  for (let dx = 0; dx < W; dx++) {
    for (let dz = 0; dz < D; dz++) {
      blocks.push({ x: ox + dx, y: baseY + H + 1, z: oz + dz, block: 'cobblestone' });
    }
  }

  return blocks;
}

const HOUSE_TEMPLATES = {
  basic:   templateBasic,
  cottage: templateCottage,
  bunker:  templateBunker,
};

// ─── Build from Template ──────────────────────────────────────────────────────

/**
 * Build a list of { x, y, z, block } entries, sorted bottom-up.
 * Attempts auto-craft for missing blocks before starting.
 */
async function buildFromTemplate(bot, goals, templateBlocks) {
  // Sort bottom-up (lowest y first) so foundations are laid before walls
  const sorted = [...templateBlocks].sort((a, b) => a.y - b.y);

  // Tally blocks needed per type
  const needed = {};
  for (const b of sorted) {
    needed[b.block] = (needed[b.block] || 0) + 1;
  }

  // Attempt auto-craft for each block type
  for (const [blockName, count] of Object.entries(needed)) {
    const have = countBlock(bot, blockName);
    if (have < count) {
      bot.chat(`Need ${count}x ${blockName} (have ${have}), trying to craft...`);
      await ensureBlocks(bot, blockName, count);
    }
  }

  // Place blocks
  let placed = 0;
  let failed = 0;
  let skipped = 0;
  const initialTask = bot._currentTask;

  for (const b of sorted) {
    if (bot._currentTask !== initialTask) break;
    // Check if already occupied
    const existing = bot.blockAt(new Vec3(b.x, b.y, b.z));
    if (existing && !isAir(existing.name)) {
      skipped++;
      continue;
    }

    // Verify we still have the block
    const item = bot.inventory.items().find(i => i.name === b.block);
    if (!item) {
      bot.chat(`Out of ${b.block}! Placed ${placed} so far.`);
      failed++;
      continue;
    }

    const success = await placeBlockAt(bot, goals, b.block, b.x, b.y, b.z);
    if (success) {
      placed++;
    } else {
      failed++;
    }

    if (placed > 0 && placed % 15 === 0) {
      bot.chat(`Build progress: ${placed} blocks placed...`);
    }
  }

  return { placed, failed, skipped };
}

// ─── Action Handlers ──────────────────────────────────────────────────────────

function register(bot, goals) {

  // ── place ─────────────────────────────────────────────────────────────────
  async function place(action) {
    const blockName = action.block;
    const x = action.x;
    const y = action.y;
    const z = action.z;

    bot.chat(`Placing ${blockName} at ${x}, ${y}, ${z}...`);

    // Auto-craft if needed
    await ensureBlocks(bot, blockName, 1);

    const item = bot.inventory.items().find(i => i.name === blockName);
    if (!item) {
      bot.chat(`I don't have any ${blockName} and couldn't craft it.`);
      return;
    }

    const success = await placeBlockAt(bot, goals, blockName, x, y, z);
    if (success) {
      bot.chat(`Placed ${blockName} at ${x}, ${y}, ${z}.`);
    } else {
      bot.chat(`Failed to place ${blockName} at ${x}, ${y}, ${z}.`);
    }
  }

  // ── build ─────────────────────────────────────────────────────────────────
  async function build(action) {
    const blockName = action.block;
    const startX = action.x;
    const baseY = action.y;
    const startZ = action.z;
    const width = action.width;
    const height = action.height || 1;
    const depth = action.depth;
    const buildType = action.type || 'solid';

    bot.chat(`Building ${buildType} structure with ${blockName}: ${width}x${height}x${depth} at ${startX}, ${baseY}, ${startZ}`);

    // Estimate blocks needed and try auto-craft
    let estimate = 0;
    if (buildType === 'solid') {
      estimate = width * height * depth;
    } else if (buildType === 'floor') {
      estimate = width * depth;
    } else if (buildType === 'walls') {
      estimate = (2 * (width + depth) - 4) * height;
    } else if (buildType === 'shell') {
      estimate = 2 * (width * depth + width * height + depth * height)
               - 4 * (width + depth + height) + 8;
    }
    if (estimate > 0) {
      await ensureBlocks(bot, blockName, estimate);
    }

    let placed = 0;
    let failed = 0;
    const initialTask = bot._currentTask;

    for (let dy = 0; dy < height; dy++) {
      if (bot._currentTask !== initialTask) break;
      const y = baseY + dy;

      for (let dx = 0; dx < width; dx++) {
        if (bot._currentTask !== initialTask) break;
        const x = startX + dx;

        for (let dz = 0; dz < depth; dz++) {
          if (bot._currentTask !== initialTask) break;
          const z = startZ + dz;

          let shouldPlace = false;

          if (buildType === 'solid') {
            shouldPlace = true;
          } else if (buildType === 'floor') {
            shouldPlace = (dy === 0);
          } else if (buildType === 'walls') {
            const onPerimeter = (dx === 0 || dx === width - 1 || dz === 0 || dz === depth - 1);
            shouldPlace = onPerimeter;
          } else if (buildType === 'shell') {
            shouldPlace = (
              dx === 0 || dx === width - 1 ||
              dy === 0 || dy === height - 1 ||
              dz === 0 || dz === depth - 1
            );
          }

          if (!shouldPlace) continue;

          const item = bot.inventory.items().find(i => i.name === blockName);
          if (!item) {
            bot.chat(`Out of ${blockName}! Placed ${placed} blocks so far.`);
            return;
          }

          const success = await placeBlockAt(bot, goals, blockName, x, y, z);
          if (success) {
            placed++;
          } else {
            failed++;
          }

          if (placed > 0 && placed % 10 === 0) {
            bot.chat(`Building progress: ${placed} blocks placed...`);
          }
        }
      }
    }

    bot.chat(`Build complete! Placed ${placed} blocks. ${failed > 0 ? `(${failed} failed)` : ''}`);
  }

  // ── fill ──────────────────────────────────────────────────────────────────
  async function fill(action) {
    const blockName = action.block;

    const minX = Math.min(action.x1, action.x2);
    const maxX = Math.max(action.x1, action.x2);
    const minY = Math.min(action.y1, action.y2);
    const maxY = Math.max(action.y1, action.y2);
    const minZ = Math.min(action.z1, action.z2);
    const maxZ = Math.max(action.z1, action.z2);

    const totalVolume = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
    bot.chat(`Filling area (${minX},${minY},${minZ}) to (${maxX},${maxY},${maxZ}) with ${blockName} — up to ${totalVolume} blocks`);

    // Auto-craft if needed
    await ensureBlocks(bot, blockName, totalVolume);

    let placed = 0;
    let skipped = 0;
    let failed = 0;
    const initialTask = bot._currentTask;

    for (let y = minY; y <= maxY; y++) {
      if (bot._currentTask !== initialTask) break;
      for (let x = minX; x <= maxX; x++) {
        if (bot._currentTask !== initialTask) break;
        for (let z = minZ; z <= maxZ; z++) {
          if (bot._currentTask !== initialTask) break;
          const existingBlock = bot.blockAt(new Vec3(x, y, z));
          if (existingBlock && existingBlock.name === blockName) {
            skipped++;
            continue;
          }

          const item = bot.inventory.items().find(i => i.name === blockName);
          if (!item) {
            bot.chat(`Out of ${blockName}! Placed ${placed} blocks, skipped ${skipped} existing.`);
            return;
          }

          const success = await placeBlockAt(bot, goals, blockName, x, y, z);
          if (success) {
            placed++;
          } else {
            failed++;
          }

          if (placed > 0 && placed % 10 === 0) {
            bot.chat(`Fill progress: ${placed} blocks placed...`);
          }
        }
      }
    }

    bot.chat(`Fill complete! Placed ${placed} blocks, skipped ${skipped} existing. ${failed > 0 ? `(${failed} failed)` : ''}`);
  }

  // ── house ─────────────────────────────────────────────────────────────────
  async function house(action) {
    const style = (action.style || 'basic').toLowerCase();
    const ox = action.x ?? Math.floor(bot.entity.position.x);
    const oy = action.y ?? Math.floor(bot.entity.position.y);
    const oz = action.z ?? Math.floor(bot.entity.position.z);

    const templateFn = HOUSE_TEMPLATES[style];
    if (!templateFn) {
      bot.chat(`Unknown house style "${style}". Options: basic, cottage, bunker`);
      return;
    }

    bot.chat(`🏠 Building ${style} house at ${ox}, ${oy}, ${oz}...`);

    const templateBlocks = templateFn(ox, oy, oz);
    const { placed, failed, skipped } = await buildFromTemplate(bot, goals, templateBlocks);

    bot.chat(`🏠 House complete! Placed ${placed}, skipped ${skipped} existing. ${failed > 0 ? `(${failed} failed)` : ''}`);
  }

  // ── wall ──────────────────────────────────────────────────────────────────
  async function wall(action) {
    const blockName = action.block || 'cobblestone';
    const x1 = action.x1;
    const z1 = action.z1;
    const x2 = action.x2 ?? x1;
    const z2 = action.z2 ?? z1;
    const baseY = action.y ?? action.y1 ?? Math.floor(bot.entity.position.y);
    const height = action.height || 3;

    bot.chat(`🧱 Building wall from (${x1},${baseY},${z1}) to (${x2},${baseY},${z2}), height ${height}`);

    // Bresenham-style line: walk from (x1,z1) to (x2,z2)
    const dx = Math.abs(x2 - x1);
    const dz = Math.abs(z2 - z1);
    const sx = x1 < x2 ? 1 : -1;
    const sz = z1 < z2 ? 1 : -1;

    // Collect wall positions
    const positions = [];
    let cx = x1, cz = z1;
    let err = dx - dz;

    while (true) {
      for (let dy = 0; dy < height; dy++) {
        positions.push({ x: cx, y: baseY + dy, z: cz, block: blockName });
      }
      if (cx === x2 && cz === z2) break;
      const e2 = 2 * err;
      if (e2 > -dz) { err -= dz; cx += sx; }
      if (e2 < dx)  { err += dx; cz += sz; }
    }

    // Auto-craft
    await ensureBlocks(bot, blockName, positions.length);

    const { placed, failed, skipped } = await buildFromTemplate(bot, goals, positions);
    bot.chat(`🧱 Wall complete! Placed ${placed}, skipped ${skipped}. ${failed > 0 ? `(${failed} failed)` : ''}`);
  }

  // ── clear ─────────────────────────────────────────────────────────────────
  async function clear(action) {
    const minX = Math.min(action.x1, action.x2);
    const maxX = Math.max(action.x1, action.x2);
    const minY = Math.min(action.y1, action.y2);
    const maxY = Math.max(action.y1, action.y2);
    const minZ = Math.min(action.z1, action.z2);
    const maxZ = Math.max(action.z1, action.z2);

    const totalVolume = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
    bot.chat(`🧹 Clearing area (${minX},${minY},${minZ}) to (${maxX},${maxY},${maxZ}) — ${totalVolume} positions`);

    let mined = 0;
    let skipped = 0;
    let failed = 0;
    const initialTask = bot._currentTask;

    // Clear top-down so blocks above don't fall onto work area
    for (let y = maxY; y >= minY; y--) {
      if (bot._currentTask !== initialTask) break;
      for (let x = minX; x <= maxX; x++) {
        if (bot._currentTask !== initialTask) break;
        for (let z = minZ; z <= maxZ; z++) {
          if (bot._currentTask !== initialTask) break;
          const block = bot.blockAt(new Vec3(x, y, z));
          if (!block || isAir(block.name)) {
            skipped++;
            continue;
          }

          // Navigate near the block
          try {
            await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 3));
          } catch {
            try {
              await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 5));
            } catch {
              // Continue anyway
            }
          }

          try {
            const { digSafely } = require('../utils');
            const result = await digSafely(bot, block, { requireDrops: true });
            if (result.success) {
              mined++;
            } else {
              console.log(`clear: skipped unsafe mine for ${block.name} at ${x},${y},${z}: ${result.reason}`);
              failed++;
            }
            await sleep(100);
          } catch (err) {
            console.log(`clear: failed to mine ${block.name} at ${x},${y},${z}: ${err.message}`);
            failed++;
          }

          if (mined > 0 && mined % 10 === 0) {
            bot.chat(`Clear progress: ${mined} blocks mined...`);
          }
        }
      }
    }

    bot.chat(`🧹 Clear complete! Mined ${mined} blocks, skipped ${skipped} air. ${failed > 0 ? `(${failed} failed)` : ''}`);
  }

  const handlers = { place, build, fill, house, wall, clear };
  return { handlers };
}

module.exports = { register, placeBlockAt };
