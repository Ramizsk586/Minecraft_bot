// ─── Farming & Food Automation ───────────────────────────────────────────────

const { Vec3 } = require('vec3');
const { sleep, findBestFood, collectDrops, digSafely } = require('../utils');

// ─── Constants ───────────────────────────────────────────────────────────────

const HOE_NAMES = [
  'netherite_hoe', 'diamond_hoe', 'iron_hoe', 'golden_hoe', 'stone_hoe', 'wooden_hoe',
];

const CROP_MATURITY = {
  wheat: 7,
  carrots: 7,
  potatoes: 7,
  beetroots: 3,
};

// Maps a crop name (as used in harvest action) to the seed/item to replant
const CROP_TO_SEED = {
  wheat: 'wheat_seeds',
  carrots: 'carrot',
  potatoes: 'potato',
  beetroots: 'beetroot_seeds',
};

// Maps a seed item name to the crop block name (for planting context)
const SEED_TO_CROP = {
  wheat_seeds: 'wheat',
  carrot: 'carrots',
  potato: 'potatoes',
  beetroot_seeds: 'beetroots',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findHoe(bot) {
  const items = bot.inventory.items();
  for (const hoeName of HOE_NAMES) {
    const found = items.find(i => i.name === hoeName);
    if (found) return found;
  }
  return null;
}

function findItemByName(bot, name) {
  return bot.inventory.items().find(i => i.name === name) || null;
}

function countItemByName(bot, name) {
  return bot.inventory.items()
    .filter(i => i.name === name)
    .reduce((sum, i) => sum + i.count, 0);
}

async function navigateNear(bot, goals, pos, range = 3) {
  try {
    await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, range));
  } catch (err) {
    console.log(`[farming] Navigation warning: ${err.message}`);
  }
}

// ─── Action Handlers ─────────────────────────────────────────────────────────

function register(bot, goals) {

  // ── 1. create_farm ───────────────────────────────────────────────────────

  async function createFarm(action) {
    const startX = action.x ?? Math.floor(bot.entity.position.x);
    const startY = action.y ?? Math.floor(bot.entity.position.y);
    const startZ = action.z ?? Math.floor(bot.entity.position.z);
    const width  = action.width  || 9;
    const length = action.length || 9;
    const crop   = action.crop   || null;

    bot.chat(`Creating a ${width}x${length} farm at ${startX}, ${startY}, ${startZ}...`);

    // Navigate to the farm area
    await navigateNear(bot, goals, new Vec3(startX, startY, startZ), 4);

    // Find and equip a hoe
    const hoe = findHoe(bot);
    if (!hoe) {
      bot.chat('I don\'t have a hoe to till the soil!');
      return;
    }
    await bot.equip(hoe, 'hand');

    let tilledCount = 0;

    // Till the soil
    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < length; dz++) {
        const blockPos = new Vec3(startX + dx, startY - 1, startZ + dz);
        const block = bot.blockAt(blockPos);
        if (!block) continue;

        if (block.name === 'dirt' || block.name === 'grass_block') {
          try {
            await navigateNear(bot, goals, blockPos, 3);
            // Re-equip hoe in case something changed
            const currentHoe = findHoe(bot);
            if (currentHoe) await bot.equip(currentHoe, 'hand');
            const freshBlock = bot.blockAt(blockPos);
            if (freshBlock && (freshBlock.name === 'dirt' || freshBlock.name === 'grass_block')) {
              await bot.activateBlock(freshBlock);
              tilledCount++;
              await sleep(200);
            }
          } catch (err) {
            console.log(`[farming] Till error at ${blockPos}: ${err.message}`);
          }
        }
      }
    }

    // Water placement — dig holes every 4 blocks in the center and place water
    const waterBucket = findItemByName(bot, 'water_bucket');
    if (waterBucket) {
      const centerX = startX + Math.floor(width / 2);
      const centerZ = startZ + Math.floor(length / 2);
      // Place water at center positions every 4 blocks
      for (let dx = 0; dx < width; dx += 4) {
        for (let dz = 0; dz < length; dz += 4) {
          const waterPos = new Vec3(startX + dx, startY - 1, startZ + dz);
          try {
            await navigateNear(bot, goals, waterPos, 3);
            const waterBlock = bot.blockAt(waterPos);
            if (waterBlock && waterBlock.name !== 'air') {
              const digResult = await digSafely(bot, waterBlock, { requireDrops: true });
              if (!digResult.success) {
                console.log(`[Farming] Skipped unsafe water-channel dig for ${waterBlock.name}: ${digResult.reason}`);
                continue;
              }
              await sleep(200);
              // Place water
              const bucket = findItemByName(bot, 'water_bucket');
              if (bucket) {
                await bot.equip(bucket, 'hand');
                const belowBlock = bot.blockAt(new Vec3(waterPos.x, waterPos.y - 1, waterPos.z));
                if (belowBlock) {
                  await bot.placeBlock(belowBlock, new Vec3(0, 1, 0));
                  await sleep(200);
                }
              }
            }
          } catch (err) {
            console.log(`[farming] Water placement error: ${err.message}`);
          }
        }
      }
    }

    // Plant crops if specified
    let plantedCount = 0;
    if (crop) {
      const seedItem = findItemByName(bot, crop);
      if (seedItem) {
        for (let dx = 0; dx < width; dx++) {
          for (let dz = 0; dz < length; dz++) {
            const blockPos = new Vec3(startX + dx, startY - 1, startZ + dz);
            const block = bot.blockAt(blockPos);
            if (!block || block.name !== 'farmland') continue;

            // Check if the block above is air (nothing planted yet)
            const aboveBlock = bot.blockAt(new Vec3(blockPos.x, blockPos.y + 1, blockPos.z));
            if (aboveBlock && aboveBlock.name !== 'air') continue;

            try {
              await navigateNear(bot, goals, blockPos, 3);
              const seeds = findItemByName(bot, crop);
              if (!seeds) {
                bot.chat('Ran out of seeds!');
                break;
              }
              await bot.equip(seeds, 'hand');
              const farmlandBlock = bot.blockAt(blockPos);
              if (farmlandBlock && farmlandBlock.name === 'farmland') {
                await bot.placeBlock(farmlandBlock, new Vec3(0, 1, 0));
                plantedCount++;
                await sleep(200);
              }
            } catch (err) {
              console.log(`[farming] Planting error at ${blockPos}: ${err.message}`);
            }
          }
        }
      } else {
        bot.chat(`I don't have any ${crop} to plant.`);
      }
    }

    bot.chat(`Created ${width}x${length} farm, tilled ${tilledCount} blocks, planted ${plantedCount} crops.`);
  }

  // ── 2. plant ─────────────────────────────────────────────────────────────

  async function plant(action) {
    const crop = action.crop || 'wheat_seeds';
    bot.chat(`Planting ${crop} on nearby farmland...`);

    const farmlandId = bot.registry.blocksByName['farmland']?.id;
    if (farmlandId == null) {
      bot.chat('Could not find farmland block type in registry.');
      return;
    }

    const farmlandPositions = bot.findBlocks({
      matching: farmlandId,
      maxDistance: 32,
      count: 100,
    });

    if (farmlandPositions.length === 0) {
      bot.chat('No farmland found nearby!');
      return;
    }

    let planted = 0;

    for (const pos of farmlandPositions) {
      // Check if the block above is air
      const abovePos = pos.offset(0, 1, 0);
      const aboveBlock = bot.blockAt(abovePos);
      if (!aboveBlock || aboveBlock.name !== 'air') continue;

      const seeds = findItemByName(bot, crop);
      if (!seeds) {
        bot.chat(`Ran out of ${crop}!`);
        break;
      }

      try {
        await navigateNear(bot, goals, pos, 3);
        await bot.equip(seeds, 'hand');
        const farmlandBlock = bot.blockAt(pos);
        if (farmlandBlock && farmlandBlock.name === 'farmland') {
          await bot.placeBlock(farmlandBlock, new Vec3(0, 1, 0));
          planted++;
          await sleep(200);
        }
      } catch (err) {
        console.log(`[farming] Plant error at ${pos}: ${err.message}`);
      }
    }

    bot.chat(`Planted ${planted} ${crop}.`);
  }

  // ── 3. harvest ───────────────────────────────────────────────────────────

  async function harvest(action) {
    const cropName = action.crop || 'wheat';
    const replant  = action.replant !== undefined ? action.replant : true;

    const maxAge = CROP_MATURITY[cropName];
    if (maxAge == null) {
      bot.chat(`Unknown crop: ${cropName}. Supported: wheat, carrots, potatoes, beetroots.`);
      return;
    }

    const cropBlockEntry = bot.registry.blocksByName[cropName];
    if (!cropBlockEntry) {
      bot.chat(`Could not find block type for "${cropName}" in registry.`);
      return;
    }

    bot.chat(`Harvesting mature ${cropName}...`);

    const cropPositions = bot.findBlocks({
      matching: cropBlockEntry.id,
      maxDistance: 32,
      count: 100,
    });

    if (cropPositions.length === 0) {
      bot.chat(`No ${cropName} found nearby.`);
      return;
    }

    let harvested = 0;
    let replanted = 0;
    const seedName = CROP_TO_SEED[cropName];

    for (const pos of cropPositions) {
      const block = bot.blockAt(pos);
      if (!block) continue;

      // Check maturity via metadata (block state value)
      const age = block.metadata;
      if (age < maxAge) continue;

      try {
        await navigateNear(bot, goals, pos, 3);
        const freshBlock = bot.blockAt(pos);
        if (!freshBlock || freshBlock.name !== cropName) continue;

        await bot.dig(freshBlock);
        harvested++;
        await collectDrops(bot, goals, 400);

        // Replant if requested
        if (replant && seedName) {
          const seeds = findItemByName(bot, seedName);
          if (seeds) {
            // The farmland block should be at pos.y - 1 (or at pos.y if the crop was at pos.y)
            // After harvesting, the crop block is gone, farmland should be below
            const farmlandPos = new Vec3(pos.x, pos.y - 1, pos.z);
            const farmlandBlock = bot.blockAt(farmlandPos);
            if (farmlandBlock && farmlandBlock.name === 'farmland') {
              await bot.equip(seeds, 'hand');
              await bot.placeBlock(farmlandBlock, new Vec3(0, 1, 0));
              replanted++;
              await sleep(200);
            }
          }
        }
      } catch (err) {
        console.log(`[farming] Harvest error at ${pos}: ${err.message}`);
      }
    }

    bot.chat(`Harvested ${harvested} ${cropName}${replant ? `, replanted ${replanted}` : ''}.`);
  }

  // ── 4. farm_cycle ────────────────────────────────────────────────────────

  async function farmCycle(action) {
    bot.chat('Starting farm cycle...');
    const summary = [];

    // Step 1: Harvest all mature crops with replant
    for (const cropName of Object.keys(CROP_MATURITY)) {
      const cropBlockEntry = bot.registry.blocksByName[cropName];
      if (!cropBlockEntry) continue;

      const positions = bot.findBlocks({
        matching: cropBlockEntry.id,
        maxDistance: 32,
        count: 100,
      });

      if (positions.length > 0) {
        await harvest({ crop: cropName, replant: true });
        summary.push(`Processed ${cropName}`);
      }
    }

    // Step 2: Plant seeds on any empty farmland
    // Try planting any seeds we have
    const seedTypes = ['wheat_seeds', 'carrot', 'potato', 'beetroot_seeds'];
    for (const seedName of seedTypes) {
      const seedItem = findItemByName(bot, seedName);
      if (seedItem) {
        const farmlandId = bot.registry.blocksByName['farmland']?.id;
        if (farmlandId != null) {
          const emptyFarmland = bot.findBlocks({
            matching: farmlandId,
            maxDistance: 32,
            count: 100,
          }).filter(pos => {
            const above = bot.blockAt(pos.offset(0, 1, 0));
            return above && above.name === 'air';
          });

          if (emptyFarmland.length > 0) {
            await plant({ crop: seedName });
            summary.push(`Planted ${seedName}`);
            break; // Only plant one type of seed per cycle to avoid confusion
          }
        }
      }
    }

    // Step 3: Check food level and eat if needed
    if (bot.food < 14) {
      const food = findBestFood(bot);
      if (food) {
        try {
          await bot.equip(food, 'hand');
          await bot.consume();
          summary.push(`Ate ${food.name} (food level: ${bot.food})`);
        } catch (err) {
          console.log(`[farming] Eat error: ${err.message}`);
        }
      }
    }

    // Step 4: If we have >= 3 wheat, try to craft bread
    const wheatCount = countItemByName(bot, 'wheat');
    if (wheatCount >= 3) {
      try {
        const breadId = bot.registry.itemsByName['bread']?.id;
        if (breadId) {
          // Find a crafting table nearby
          const craftingTableId = bot.registry.blocksByName['crafting_table']?.id;
          if (craftingTableId != null) {
            const tablePositions = bot.findBlocks({
              matching: craftingTableId,
              maxDistance: 32,
              count: 1,
            });

            if (tablePositions.length > 0) {
              await navigateNear(bot, goals, tablePositions[0], 3);
              const tableBlock = bot.blockAt(tablePositions[0]);
              if (tableBlock) {
                const breadCount = Math.floor(wheatCount / 3);
                const recipes = bot.recipesFor(breadId, null, 1, tableBlock);
                if (recipes.length > 0) {
                  await bot.craft(recipes[0], breadCount, tableBlock);
                  summary.push(`Crafted ${breadCount} bread`);
                }
              }
            }
          }
        }
      } catch (err) {
        console.log(`[farming] Craft bread error: ${err.message}`);
      }
    }

    bot.chat(`Farm cycle complete: ${summary.length > 0 ? summary.join(', ') : 'nothing to do'}.`);
  }

  // ── 5. auto_eat ──────────────────────────────────────────────────────────

  async function autoEat(action) {
    const food = findBestFood(bot);
    if (!food) {
      bot.chat('No food in inventory!');
      return;
    }

    try {
      await bot.equip(food, 'hand');
      await bot.consume();
      bot.chat(`Ate ${food.name}. Food level: ${bot.food}/20.`);
    } catch (err) {
      bot.chat(`Failed to eat: ${err.message}`);
      console.log(`[farming] auto_eat error: ${err.message}`);
    }
  }

  // ── 6. craft_food ────────────────────────────────────────────────────────

  async function craftFood(action) {
    const item  = action.item  || 'bread';
    const count = action.count || 1;

    bot.chat(`Crafting ${count}x ${item}...`);

    const itemEntry = bot.registry.itemsByName[item];
    if (!itemEntry) {
      bot.chat(`Unknown item: ${item}`);
      return;
    }

    // Check if this is a smeltable item (cooked_*)
    const smeltableItems = [
      'cooked_beef', 'cooked_porkchop', 'cooked_mutton',
      'cooked_chicken', 'cooked_rabbit', 'cooked_salmon',
      'cooked_cod', 'baked_potato', 'dried_kelp',
    ];

    if (smeltableItems.includes(item)) {
      // Try furnace approach
      const furnaceId = bot.registry.blocksByName['furnace']?.id;
      if (furnaceId != null) {
        const furnacePositions = bot.findBlocks({
          matching: furnaceId,
          maxDistance: 32,
          count: 1,
        });

        if (furnacePositions.length > 0) {
          try {
            await navigateNear(bot, goals, furnacePositions[0], 3);
            const furnaceBlock = bot.blockAt(furnacePositions[0]);
            if (furnaceBlock) {
              const furnaceWindow = await bot.openContainer(furnaceBlock);

              // Determine raw item name
              const rawMapping = {
                cooked_beef: 'beef',
                cooked_porkchop: 'porkchop',
                cooked_mutton: 'mutton',
                cooked_chicken: 'chicken',
                cooked_rabbit: 'rabbit',
                cooked_salmon: 'salmon',
                cooked_cod: 'cod',
                baked_potato: 'potato',
                dried_kelp: 'kelp',
              };

              const rawName = rawMapping[item];
              const rawItem = findItemByName(bot, rawName);

              if (rawItem) {
                // Slot 0 is input in furnace
                await furnaceWindow.deposit(rawItem.type, null, Math.min(rawItem.count, count));
                // Try to add fuel
                const fuelNames = ['coal', 'charcoal', 'oak_planks', 'spruce_planks', 'birch_planks'];
                for (const fuelName of fuelNames) {
                  const fuel = findItemByName(bot, fuelName);
                  if (fuel) {
                    await furnaceWindow.deposit(fuel.type, null, Math.min(fuel.count, Math.ceil(count / 8) + 1), 1);
                    break;
                  }
                }
                bot.chat(`Placed items in furnace. Smelting will take time — check back later.`);
              } else {
                bot.chat(`I don't have any raw ${rawName} to smelt.`);
              }

              furnaceWindow.close();
            }
          } catch (err) {
            bot.chat(`Furnace interaction failed: ${err.message}. You may need to smelt manually.`);
            console.log(`[farming] Furnace error: ${err.message}`);
          }
        } else {
          bot.chat('No furnace found nearby. Please place a furnace or smelt manually.');
        }
      }
      return;
    }

    // Craftable items (bread, etc.)
    // Find a crafting table
    const craftingTableId = bot.registry.blocksByName['crafting_table']?.id;
    if (craftingTableId == null) {
      bot.chat('Crafting table not found in block registry.');
      return;
    }

    const tablePositions = bot.findBlocks({
      matching: craftingTableId,
      maxDistance: 32,
      count: 1,
    });

    if (tablePositions.length === 0) {
      bot.chat('No crafting table found nearby!');
      return;
    }

    try {
      await navigateNear(bot, goals, tablePositions[0], 3);
      const tableBlock = bot.blockAt(tablePositions[0]);
      if (!tableBlock) {
        bot.chat('Could not access crafting table.');
        return;
      }

      const recipes = bot.recipesFor(itemEntry.id, null, 1, tableBlock);
      if (recipes.length === 0) {
        bot.chat(`No recipe found for ${item}, or missing ingredients.`);
        return;
      }

      await bot.craft(recipes[0], count, tableBlock);
      bot.chat(`Crafted ${count}x ${item}.`);
    } catch (err) {
      bot.chat(`Failed to craft ${item}: ${err.message}`);
      console.log(`[farming] craft_food error: ${err.message}`);
    }
  }

  // ── Return action map ────────────────────────────────────────────────────

  return {
    create_farm: async (action) => await createFarm(action),
    plant:       async (action) => await plant(action),
    harvest:     async (action) => await harvest(action),
    farm_cycle:  async (action) => await farmCycle(action),
    auto_eat:    async (action) => await autoEat(action),
    craft_food:  async (action) => await craftFood(action),
  };
}

module.exports = { register };
