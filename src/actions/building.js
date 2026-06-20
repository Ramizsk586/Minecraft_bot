const { sleep } = require('../utils');
const { Vec3 } = require('vec3');

/**
 * Helper: place a single block at (x, y, z).
 * Returns true on success, false on failure.
 */
async function placeBlockAt(bot, goals, blockName, x, y, z) {
  try {
    // 1. Find the block item in inventory by name
    const item = bot.inventory.items().find(i => i.name.includes(blockName));
    if (!item) {
      console.log(`placeBlockAt: no ${blockName} in inventory`);
      return false;
    }

    // 2. Equip it
    await bot.equip(item, 'hand');

    // 3. Navigate near
    try {
      await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 4));
    } catch (err) {
      console.log(`placeBlockAt: pathfinder error navigating to ${x},${y},${z}: ${err.message}`);
      // Continue anyway — we might already be close enough
    }

    // 4. Find an adjacent solid block to place against
    //    Try below first (y-1), then sides, then above
    const offsets = [
      new Vec3(0, -1, 0),  // below
      new Vec3(-1, 0, 0),  // west
      new Vec3(1, 0, 0),   // east
      new Vec3(0, 0, -1),  // north
      new Vec3(0, 0, 1),   // south
      new Vec3(0, 1, 0),   // above
    ];

    let referenceBlock = null;
    let faceVector = null;

    for (const offset of offsets) {
      const refPos = new Vec3(x + offset.x, y + offset.y, z + offset.z);
      const block = bot.blockAt(refPos);
      if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
        referenceBlock = block;
        // Face vector points FROM reference TO target
        faceVector = new Vec3(-offset.x, -offset.y, -offset.z);
        break;
      }
    }

    if (!referenceBlock) {
      console.log(`placeBlockAt: no adjacent solid block at ${x},${y},${z}`);
      return false;
    }

    // 6. Place the block
    await bot.placeBlock(referenceBlock, faceVector);
    await sleep(250);
    return true;
  } catch (err) {
    console.log(`placeBlockAt: error placing ${blockName} at ${x},${y},${z}: ${err.message}`);
    return false;
  }
}

function register(bot, goals) {
  return {
    /**
     * place — Single block placement
     * Action: {"action": "place", "block": "cobblestone", "x": 10, "y": 64, "z": 20}
     */
    place: async (action) => {
      const blockName = action.block;
      const x = action.x;
      const y = action.y;
      const z = action.z;

      bot.chat(`Placing ${blockName} at ${x}, ${y}, ${z}...`);

      // Check inventory
      const item = bot.inventory.items().find(i => i.name.includes(blockName));
      if (!item) {
        bot.chat(`I don't have any ${blockName} in my inventory.`);
        return;
      }

      // Equip
      await bot.equip(item, 'hand');

      // Navigate close
      try {
        await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 4));
      } catch (err) {
        console.log(`place: pathfinder error: ${err.message}`);
      }

      // Find reference block — try below first
      let referenceBlock = null;
      let faceVector = null;

      const belowBlock = bot.blockAt(new Vec3(x, y - 1, z));
      if (belowBlock && belowBlock.name !== 'air' && belowBlock.name !== 'cave_air' && belowBlock.name !== 'void_air') {
        referenceBlock = belowBlock;
        faceVector = new Vec3(0, 1, 0);
      } else {
        // Try adjacent blocks at same y level
        const sideOffsets = [
          { pos: new Vec3(x - 1, y, z), face: new Vec3(1, 0, 0) },
          { pos: new Vec3(x + 1, y, z), face: new Vec3(-1, 0, 0) },
          { pos: new Vec3(x, y, z - 1), face: new Vec3(0, 0, 1) },
          { pos: new Vec3(x, y, z + 1), face: new Vec3(0, 0, -1) },
        ];

        for (const side of sideOffsets) {
          const block = bot.blockAt(side.pos);
          if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
            referenceBlock = block;
            faceVector = side.face;
            break;
          }
        }
      }

      if (!referenceBlock) {
        bot.chat(`Cannot place ${blockName}: no adjacent block to place against.`);
        return;
      }

      try {
        await bot.placeBlock(referenceBlock, faceVector);
        bot.chat(`Placed ${blockName} at ${x}, ${y}, ${z}.`);
      } catch (err) {
        bot.chat(`Failed to place ${blockName}: ${err.message}`);
        console.log(`place: error: ${err.message}`);
      }
    },

    /**
     * build — Structure building
     * Action: {"action": "build", "block": "oak_planks", "x": 0, "y": 64, "z": 0,
     *          "width": 5, "height": 4, "depth": 5, "type": "walls"}
     */
    build: async (action) => {
      const blockName = action.block;
      const startX = action.x;
      const baseY = action.y;
      const startZ = action.z;
      const width = action.width;
      const height = action.height || 1;
      const depth = action.depth;
      const buildType = action.type || 'solid';

      bot.chat(`Building ${buildType} structure with ${blockName}: ${width}x${height}x${depth} at ${startX}, ${baseY}, ${startZ}`);

      let placed = 0;
      let failed = 0;

      for (let dy = 0; dy < height; dy++) {
        const y = baseY + dy;

        for (let dx = 0; dx < width; dx++) {
          const x = startX + dx;

          for (let dz = 0; dz < depth; dz++) {
            const z = startZ + dz;

            // Determine whether to place a block at this position based on build type
            let shouldPlace = false;

            if (buildType === 'solid') {
              shouldPlace = true;
            } else if (buildType === 'floor') {
              // Single layer — only place at the base y
              shouldPlace = (dy === 0);
            } else if (buildType === 'walls') {
              // Hollow box with no roof/floor — only perimeter, all heights
              const onPerimeter = (dx === 0 || dx === width - 1 || dz === 0 || dz === depth - 1);
              shouldPlace = onPerimeter;
            } else if (buildType === 'shell') {
              // Hollow box — place on any face, skip interior
              const onFace = (
                dx === 0 || dx === width - 1 ||
                dy === 0 || dy === height - 1 ||
                dz === 0 || dz === depth - 1
              );
              shouldPlace = onFace;
            }

            if (!shouldPlace) continue;

            // Check inventory
            const item = bot.inventory.items().find(i => i.name.includes(blockName));
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

            // Report progress every 10 blocks
            if (placed > 0 && placed % 10 === 0) {
              bot.chat(`Building progress: ${placed} blocks placed...`);
            }
          }
        }
      }

      bot.chat(`Build complete! Placed ${placed} blocks. ${failed > 0 ? `(${failed} failed)` : ''}`);
    },

    /**
     * fill — Area fill
     * Action: {"action": "fill", "block": "stone", "x1": 0, "y1": 64, "z1": 0, "x2": 5, "y2": 64, "z2": 5}
     */
    fill: async (action) => {
      const blockName = action.block;

      // Normalize coordinates so min <= max
      const minX = Math.min(action.x1, action.x2);
      const maxX = Math.max(action.x1, action.x2);
      const minY = Math.min(action.y1, action.y2);
      const maxY = Math.max(action.y1, action.y2);
      const minZ = Math.min(action.z1, action.z2);
      const maxZ = Math.max(action.z1, action.z2);

      const totalVolume = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
      bot.chat(`Filling area (${minX},${minY},${minZ}) to (${maxX},${maxY},${maxZ}) with ${blockName} — up to ${totalVolume} blocks`);

      let placed = 0;
      let skipped = 0;
      let failed = 0;

      // Iterate layer by layer (bottom up), row by row
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          for (let z = minZ; z <= maxZ; z++) {
            // Skip positions that already have the target block
            const existingBlock = bot.blockAt(new Vec3(x, y, z));
            if (existingBlock && existingBlock.name.includes(blockName)) {
              skipped++;
              continue;
            }

            // Check inventory
            const item = bot.inventory.items().find(i => i.name.includes(blockName));
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

            // Report progress every 10 blocks
            if (placed > 0 && placed % 10 === 0) {
              bot.chat(`Fill progress: ${placed} blocks placed...`);
            }
          }
        }
      }

      bot.chat(`Fill complete! Placed ${placed} blocks, skipped ${skipped} existing. ${failed > 0 ? `(${failed} failed)` : ''}`);
    },
  };
}

module.exports = { register };
