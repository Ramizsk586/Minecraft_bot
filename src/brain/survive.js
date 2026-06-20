// ─── Brain: Autonomous Survival Module ─────────────────────────────────────────
// Controls the bot autonomously when the player is idle (no commands for 30s).
// Real-player simulation: gathers wood, crafts tools, mines cobble/ores,
// builds emergency shelters or sleeps at night, cooks food/smelts iron,
// and shows human-like idle behaviors (wandering, looking around, crouching).

const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { sleep } = require('../utils');
const { placeBlockAt } = require('../actions/building');

// Brain dependencies
const eatBrain = require('./eat');
const craftBrain = require('./craft');
const attackBrain = require('./attack');
const defanceBrain = require('./defance');
const mineBrain = require('./mine');
const cookController = require('../cook');

// Library dependencies
const world = require('../library/world');
const skills = require('../library/skills');

let _surviveBot = null;
let _surviveOptions = {};
let _surviveHandle = null;
let _surviveActive = false;
let _surviveBusy = false;

const surviveState = {
  shelterPos: null,
  isSleeping: false,
  lastWanderTime: 0,
  lastLookTime: 0,
  lastJumpTime: 0,
  lastSneakTime: 0,
  furnacePos: null,
  smeltingActive: false,
  lastFurnaceCheck: 0,
};

const LOG_TYPES = [
  'oak_log', 'spruce_log', 'birch_log', 'jungle_log',
  'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
];

function getBestToolInInventory(bot, type) {
  const tools = bot.inventory.items().filter(item => item.name.endsWith(`_${type}`));
  if (tools.length === 0) return null;
  const tiers = ['netherite', 'diamond', 'iron', 'stone', 'wooden', 'golden'];
  for (const tier of tiers) {
    const found = tools.find(t => t.name === `${tier}_${type}`);
    if (found) return found;
  }
  return tools[0];
}

async function runAutonomyAction(bot, name, actionOrFn) {
  _surviveBusy = true;
  bot._currentTask = `autonomy:${name}`;
  console.log(`[Autonomy] Starting action: ${name}`);
  try {
    if (typeof actionOrFn === 'function') {
      await actionOrFn();
    } else {
      await bot.executeAction(actionOrFn);
    }
  } catch (err) {
    console.error(`[Autonomy] Action ${name} failed:`, err);
  } finally {
    if (bot._currentTask === `autonomy:${name}`) {
      bot._currentTask = null;
    }
    _surviveBusy = false;
  }
}

/**
 * Scan for a safe solid block to place things on
 */
function findPlacementBlock(bot) {
  return world.getNearestBlock(bot, block => ['grass_block', 'dirt', 'stone', 'cobblestone', 'sand', 'oak_planks', 'spruce_planks', 'birch_planks'].includes(block.name), 4);
}

/**
 * Main autonomous survival tick
 */
async function surviveTick(bot) {
  if (_surviveBusy) return;

  // 1. Check if we should abort autonomy (user interaction or thinking)
  const timeSinceLastInteraction = Date.now() - bot.lastInteractionTime;
  const isPlayerBusy = bot._currentTask && !bot._currentTask.startsWith('autonomy:');
  const isThinking = bot.isThinking;

  if (timeSinceLastInteraction < 30000 || isPlayerBusy || isThinking) {
    if (_surviveActive) {
      console.log(`[Autonomy] User activity detected. Deactivating survival mode.`);
      abort(bot);
    }
    return;
  }

  // 2. Activate autonomy if not active
  if (!_surviveActive) {
    _surviveActive = true;
    bot.chat("💤 Player is idle. Initiating autonomous survival mode...");
    console.log(`[Autonomy] Activated autonomous survival mode.`);
  }

  // 3. Skip if bot is in combat or dead
  if (bot._combatState?.target || bot.health <= 0) return;

  try {
    const threatReport = mineBrain.scanThreatLevel(bot, _surviveOptions);

    // ══════════════════════ PRIORITY 1: HEAL / HUNGER ══════════════════════
    if (bot.food < 13 || bot.health < 10) {
      const result = await eatBrain.eat(bot, {
        silent: false,
        force: false,
        threatLevel: threatReport.level,
        preferCooking: threatReport.level === 'none' && bot.food >= 8 && bot.health >= 12,
      });
      if (result.ate) {
        await sleep(1000);
        return;
      }
    }

    // ══════════════════════ PRIORITY 2: THREAT ENGAGEMENT ══════════════════════
    if (threatReport.level !== 'none' && threatReport.primaryThreat) {
      console.log(`[Autonomy] Threat detected (${threatReport.level}). Initiating defense.`);
      if (threatReport.level === 'high') {
        await mineBrain.runMineDecision(bot, _surviveOptions);
      } else {
        try {
          await craftBrain.ensureWeapon(bot);
        } catch {}
        await attackBrain.startAttack(bot, threatReport.primaryThreat, _surviveOptions);
      }
      return;
    }

    // ══════════════════════ PRIORITY 3: NIGHTTIME SAFETY ══════════════════════
    const timeOfDay = bot.time.timeOfDay;
    const isNight = timeOfDay >= 13000 && timeOfDay < 23000;

    if (isNight) {
      if (bot.isSleeping) return;

      // A. Try to find a nearby bed block to sleep
      const bedBlock = world.getNearestBlock(bot, block => block.name.endsWith('_bed'), 24);

      if (bedBlock) {
        const dist = bot.entity.position.distanceTo(bedBlock.position);
        if (dist > 3) {
          bot._currentTask = 'autonomy:goto_bed';
          _surviveBusy = true;
          try {
            await bot.pathfinder.goto(new goals.GoalNear(bedBlock.position.x, bedBlock.position.y, bedBlock.position.z, 2.5));
          } catch {}
          _surviveBusy = false;
          bot._currentTask = null;
        } else {
          try {
            bot.chat("🛌 Going to sleep...");
            await bot.sleep(bedBlock);
            surviveState.isSleeping = true;
          } catch (err) {
            console.log('[Autonomy] Sleep failed:', err.message);
          }
        }
        return;
      }

      // B. If we have a bed item in inventory, place it!
      const bedItem = bot.inventory.items().find(i => i.name.endsWith('_bed'));
      if (bedItem) {
        const ref = findPlacementBlock(bot);
        if (ref) {
          bot.chat("🛌 Placing bed to sleep...");
          bot._currentTask = 'autonomy:placing_bed';
          _surviveBusy = true;
          try {
            await bot.equip(bedItem, 'hand');
            await bot.placeBlock(ref, new Vec3(0, 1, 0));
          } catch (err) {
            console.log('[Autonomy] Placing bed failed:', err.message);
          }
          _surviveBusy = false;
          bot._currentTask = null;
          return;
        }
      }

      // C. Hiding inside shelter
      if (surviveState.shelterPos) {
        const dist = bot.entity.position.distanceTo(surviveState.shelterPos);
        if (dist > 2) {
          bot._currentTask = 'autonomy:going_to_shelter';
          _surviveBusy = true;
          try {
            await bot.pathfinder.goto(new goals.GoalNear(surviveState.shelterPos.x, surviveState.shelterPos.y, surviveState.shelterPos.z, 1));
          } catch {}
          _surviveBusy = false;
          bot._currentTask = null;
        } else {
          // Inside shelter, look around player-like or crouch occasionally
          if (Date.now() - surviveState.lastSneakTime > 12000) {
            surviveState.lastSneakTime = Date.now();
            bot.setControlState('sneak', true);
            await sleep(1500);
            bot.setControlState('sneak', false);
          }
        }
        return;
      }

      // D. Build emergency shelter box
      const cobblestoneCount = craftBrain.countItem(bot, 'cobblestone');
      const dirtCount = craftBrain.countItem(bot, 'dirt');
      const stoneCount = craftBrain.countItem(bot, 'stone');
      const woodPlanksCount = craftBrain.countAnyOf(bot, craftBrain.PLANK_TYPES);
      const totalBlocks = cobblestoneCount + dirtCount + stoneCount + woodPlanksCount;

      if (totalBlocks >= 15) {
        let blockToUse = 'dirt';
        if (cobblestoneCount >= 15) blockToUse = 'cobblestone';
        else if (stoneCount >= 15) blockToUse = 'stone';
        else if (woodPlanksCount >= 15) blockToUse = craftBrain.PLANK_TYPES.find(p => craftBrain.countItem(bot, p) >= 15) || 'oak_planks';
        else if (dirtCount >= 15) blockToUse = 'dirt';
        else {
          // fallback to whatever is most abundant
          const counts = { dirt: dirtCount, cobblestone: cobblestoneCount, stone: stoneCount };
          blockToUse = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
        }

        const pos = bot.entity.position.floored();
        bot.chat(`🛡️ Building quick emergency shelter using ${blockToUse}...`);
        _surviveBusy = true;
        bot._currentTask = 'autonomy:building_shelter';

        const x = pos.x;
        const y = pos.y;
        const z = pos.z;

        const wallCoords = [
          // Lower walls
          {x: x-1, y: y, z: z-1}, {x: x, y: y, z: z-1}, {x: x+1, y: y, z: z-1},
          {x: x-1, y: y, z: z},                         {x: x+1, y: y, z: z},
          {x: x-1, y: y, z: z+1}, {x: x, y: y, z: z+1}, {x: x+1, y: y, z: z+1},
          // Upper walls
          {x: x-1, y: y+1, z: z-1}, {x: x, y: y+1, z: z-1}, {x: x+1, y: y+1, z: z-1},
          {x: x-1, y: y+1, z: z},                           {x: x+1, y: y+1, z: z},
          {x: x-1, y: y+1, z: z+1}, {x: x, y: y+1, z: z+1}, {x: x+1, y: y+1, z: z+1},
        ];

        for (const c of wallCoords) {
          const block = bot.blockAt(new Vec3(c.x, c.y, c.z));
          if (!block || block.name === 'air' || block.name === 'cave_air') {
            try {
              await placeBlockAt(bot, goals, blockToUse, c.x, c.y, c.z);
            } catch {}
          }
        }

        // Ceiling block
        try {
          await placeBlockAt(bot, goals, blockToUse, x, y+2, z);
        } catch {}

        surviveState.shelterPos = pos.clone();
        bot.chat("🛡️ Shelter complete. Staying inside until dawn.");
        _surviveBusy = false;
        bot._currentTask = null;
        return;
      }

      // E. Out of options, mine dirt to survive
      if (dirtCount < 15) {
        bot.chat("Mining some dirt for night shelter...");
        await runAutonomyAction(bot, 'gathering_dirt', () => skills.mineBlock(bot, 'dirt', 15));
        return;
      }
    }

    // ══════════════════════ PRIORITY 4: DAYTIME OPERATIONS ══════════════════════
    if (!isNight) {
      // A. Leave shelter built last night
      if (surviveState.shelterPos) {
        bot.chat("☀️ Morning is here! Leaving shelter...");
        _surviveBusy = true;
        bot._currentTask = 'autonomy:exiting_shelter';
        const pos = surviveState.shelterPos;

        // Dig ceiling and front block
        const ceilingBlock = bot.blockAt(pos.offset(0, 2, 0));
        if (ceilingBlock && ceilingBlock.name !== 'air') {
          try { await bot.dig(ceilingBlock); } catch {}
        }
        const wallBlock = bot.blockAt(pos.offset(0, 1, -1));
        if (wallBlock && wallBlock.name !== 'air') {
          try { await bot.dig(wallBlock); } catch {}
        }

        surviveState.shelterPos = null;
        _surviveBusy = false;
        bot._currentTask = null;
        bot.chat("Out and ready for the day!");
        return;
      }

      // B. Collect placed bed
      const nearbyBed = world.getNearestBlock(bot, block => block.name.endsWith('_bed'), 8);
      if (nearbyBed) {
        bot.chat("Picking up my bed...");
        _surviveBusy = true;
        bot._currentTask = 'autonomy:picking_bed';
        try {
          await bot.dig(nearbyBed);
        } catch {}
        _surviveBusy = false;
        bot._currentTask = null;
        return;
      }

      // C. Retrieve Smelted items & collect furnace
      if (surviveState.furnacePos) {
        const furnaceBlock = bot.blockAt(surviveState.furnacePos);
        if (furnaceBlock && furnaceBlock.name === 'furnace') {
          // If smelting is complete, check it
          const timeSinceFurnace = Date.now() - surviveState.lastFurnaceCheck;
          if (timeSinceFurnace > 15000) {
            surviveState.lastFurnaceCheck = Date.now();
            bot._currentTask = 'autonomy:checking_furnace';
            _surviveBusy = true;
            try {
              await bot.pathfinder.goto(new goals.GoalNear(surviveState.furnacePos.x, surviveState.furnacePos.y, surviveState.furnacePos.z, 2.5));
              const container = await bot.openContainer(furnaceBlock);
              
              // Result slot is 2
              const resultSlot = container.slots[2];
              if (resultSlot && resultSlot.count > 0) {
                bot.chat(`Claiming smelted: ${resultSlot.name} x${resultSlot.count}`);
                await container.withdraw(resultSlot.type, null, resultSlot.count);
              }

              // Check if smelting is completely finished
              const inputSlot = container.slots[0];
              const fuelSlot = container.slots[1];
              const isSmeltingDone = (!inputSlot || inputSlot.count === 0) && (!resultSlot || resultSlot.count === 0);

              container.close();

              if (isSmeltingDone) {
                bot.chat("Smelting complete. Digging furnace...");
                await bot.dig(furnaceBlock);
                surviveState.furnacePos = null;
                surviveState.smeltingActive = false;
              }
            } catch (err) {
              console.log('Furnace retrieval failed:', err.message);
            }
            _surviveBusy = false;
            bot._currentTask = null;
            return;
          }
        } else {
          // Furnace is gone
          surviveState.furnacePos = null;
          surviveState.smeltingActive = false;
        }
      }

      // D. Tool Progression & Materials
      const logs = craftBrain.countAnyOf(bot, LOG_TYPES);
      const planks = craftBrain.countAnyOf(bot, craftBrain.PLANK_TYPES);
      const sticks = craftBrain.countItem(bot, 'stick');
      const table = craftBrain.countItem(bot, 'crafting_table');
      const cobble = craftBrain.countItem(bot, 'cobblestone');
      const rawIron = craftBrain.countItem(bot, 'raw_iron') + craftBrain.countItem(bot, 'iron_ore');
      const ironIngots = craftBrain.countItem(bot, 'iron_ingot');

      const pickaxe = getBestToolInInventory(bot, 'pickaxe');
      const axe = getBestToolInInventory(bot, 'axe');
      const sword = getBestToolInInventory(bot, 'sword');

      // Step 1: Wood Gathering (if no tools or wood supplies low)
      if (!pickaxe && logs < 4 && planks < 4) {
        bot.chat("No pickaxe or wood. Gathering logs...");
        const result = await mineBrain.cutTreeSafely(bot, _surviveOptions);
        if (result.success) {
          await mineBrain.ensureProgression(bot);
        }
        return;
      }

      // Step 2: Planks & Sticks conversions
      if (logs > 0 && planks < 4) {
        bot.chat("Converting logs to planks...");
        await mineBrain.ensureProgression(bot);
        return;
      }
      if (planks >= 2 && sticks < 4) {
        bot.chat("Making sticks...");
        await mineBrain.ensureProgression(bot);
        return;
      }

      // Step 3: Craft Crafting Table
      const tableBlockNear = world.getNearestBlock(bot, 'crafting_table', 16);
      if (!table && !tableBlockNear && planks >= 4) {
        bot.chat("Crafting table needed. Making one...");
        await mineBrain.ensureProgression(bot);
        return;
      }

      // Step 4: Craft Wooden Pickaxe
      if (!pickaxe && planks >= 3 && sticks >= 2) {
        bot.chat("Crafting a wooden pickaxe...");
        await mineBrain.ensureProgression(bot);
        return;
      }

      // Step 5: Mine Cobblestone
      if (pickaxe && pickaxe.name === 'wooden_pickaxe' && cobble < 12) {
        bot.chat("Mining cobblestone to upgrade tools...");
        await runAutonomyAction(bot, 'mining_cobble', () => skills.mineBlock(bot, 'stone', 8));
        return;
      }

      // Step 6: Craft Stone Tools & Furnace
      if (pickaxe && pickaxe.name === 'wooden_pickaxe' && cobble >= 11) {
        bot.chat("Upgrading to stone gear!");
        await skills.craftItem(bot, 'stone_pickaxe', 1);
        await skills.craftItem(bot, 'stone_sword', 1);
        await skills.craftItem(bot, 'stone_axe', 1);
        await skills.craftItem(bot, 'furnace', 1);
        return;
      }

      // Step 7: Mine Coal & Iron Ore
      if (pickaxe && pickaxe.name === 'stone_pickaxe' && rawIron < 5 && ironIngots < 3) {
        // Mine coal first if we have none (needed for smelting)
        const coalCount = craftBrain.countItem(bot, 'coal');
        if (coalCount < 3) {
          bot.chat("Searching for coal...");
          await runAutonomyAction(bot, 'mining_coal', () => skills.mineBlock(bot, 'coal_ore', 4));
        } else {
          bot.chat("Searching for iron ore...");
          await runAutonomyAction(bot, 'mining_iron', () => skills.mineBlock(bot, 'iron_ore', 4));
        }
        return;
      }

      // Step 8: Smelt Iron Ore
      if (rawIron >= 3 && ironIngots < 3 && !surviveState.smeltingActive) {
        bot.chat("Smelting best available ore...");
        _surviveBusy = true;
        bot._currentTask = 'autonomy:smelting_setup';
        try {
          const smeltResult = await cookController.smeltBestOre(bot);
          if (smeltResult.success) {
            const station = cookController.findNearbyCookingBlock(bot);
            if (station) {
              surviveState.furnacePos = station.position.clone();
              surviveState.smeltingActive = true;
              surviveState.lastFurnaceCheck = Date.now();
              bot.chat("Cooking brain started the smelting cycle.");
            }
          }
        } catch (err) {
          console.log('Smelting setup failed:', err.message);
        }
        _surviveBusy = false;
        bot._currentTask = null;
        return;
      }

      // Step 9: Craft Iron Pickaxe & Weapon
      if (ironIngots >= 3 && (!pickaxe || pickaxe.name !== 'iron_pickaxe')) {
        bot.chat("Upgrading to iron pickaxe!");
        await skills.craftItem(bot, 'iron_pickaxe', 1);
        return;
      }
      if (ironIngots >= 2 && (!sword || sword.name !== 'iron_sword')) {
        bot.chat("Upgrading to iron sword!");
        await skills.craftItem(bot, 'iron_sword', 1);
        return;
      }

      // E. Gathering general resources when stocks are low
      if (logs < 10) {
        bot.chat("Gathering some more wood...");
        const result = await mineBrain.cutTreeSafely(bot, _surviveOptions);
        if (result.success) {
          await mineBrain.ensureProgression(bot);
        }
        return;
      }

      // F. Farmer/crops maintenance if seeds exist
      const wheatSeeds = craftBrain.countItem(bot, 'wheat_seeds');
      if (wheatSeeds > 5) {
        const waterBlock = world.getNearestBlock(bot, 'water', 16);
        if (waterBlock) {
          bot.chat("Running a farming cycle...");
          await runAutonomyAction(bot, 'farming_cycle', { action: 'farm_cycle' });
          return;
        }
      }

      if (bot.food >= 10 && bot.health >= 14 && threatReport.level === 'none') {
        const cooked = await cookController.cookBestFood(bot);
        if (cooked.success) {
          bot.chat("Started cooking better food for later.");
          return;
        }
      }

      // G. Player-like idle animations and movement (micro-behaviors)
      const now = Date.now();

      // Look at nearby player if any
      const nearbyPlayers = world.getNearbyEntities(bot, 'player', 8);
      let nearbyPlayer = null;
      if (nearbyPlayers.length > 0) {
        nearbyPlayer = nearbyPlayers.reduce((closest, current) => {
          const distClosest = bot.entity.position.distanceTo(closest.position);
          const distCurrent = bot.entity.position.distanceTo(current.position);
          return distCurrent < distClosest ? current : closest;
        });
      }
      if (nearbyPlayer) {
        if (now - surviveState.lastLookTime > 3000) {
          surviveState.lastLookTime = now;
          await bot.lookAt(nearbyPlayer.position.offset(0, 1.6, 0));
          
          // Crouch greet 25% of the time
          if (Math.random() < 0.25) {
            bot.setControlState('sneak', true);
            await sleep(350);
            bot.setControlState('sneak', false);
            await sleep(150);
            bot.setControlState('sneak', true);
            await sleep(350);
            bot.setControlState('sneak', false);
          }
        }
      } else {
        // Look around randomly
        if (now - surviveState.lastLookTime > 7000) {
          surviveState.lastLookTime = now;
          const yaw = Math.random() * Math.PI * 2;
          const pitch = (Math.random() - 0.5) * Math.PI * 0.25;
          await bot.look(yaw, pitch);
        }
      }

      // Random jump animation
      if (now - surviveState.lastJumpTime > 25000 && Math.random() < 0.3) {
        surviveState.lastJumpTime = now;
        bot.setControlState('jump', true);
        await sleep(150);
        bot.setControlState('jump', false);
      }

      // Wander around randomly
      if (now - surviveState.lastWanderTime > 20000 && Math.random() < 0.4) {
        surviveState.lastWanderTime = now;
        const angle = Math.random() * Math.PI * 2;
        const dist = 3 + Math.random() * 5;
        const targetPos = bot.entity.position.offset(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
        
        bot._currentTask = 'autonomy:wandering';
        _surviveBusy = true;
        try {
          // Sprint to location 20% of the time
          const sprint = Math.random() < 0.2;
          if (sprint) bot.setControlState('sprint', true);
          await bot.pathfinder.goto(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 2));
          if (sprint) bot.setControlState('sprint', false);
        } catch {}
        _surviveBusy = false;
        bot._currentTask = null;
      }
    }
  } catch (err) {
    console.log(`[Autonomy] Tick error: ${err.message}`);
  }
}

function startAutonomy(bot, options = {}) {
  stopAutonomy();
  _surviveBot = bot;
  _surviveOptions = options;
  _surviveActive = false;
  _surviveBusy = false;

  // Run autonomous survive tick every 5 seconds
  _surviveHandle = setInterval(() => {
    surviveTick(bot).catch(err => {
      console.log(`[Autonomy] Loop error: ${err.message}`);
    });
  }, 5000);

  console.log('[Autonomy] Survival system online (checks every 5s, activates on 30s idle)');
}

function stopAutonomy() {
  if (_surviveHandle) {
    clearInterval(_surviveHandle);
    _surviveHandle = null;
  }
  _surviveActive = false;
  _surviveBusy = false;
}

function abort(bot) {
  // Clear any active autonomy goal and reset task
  if (bot._currentTask && bot._currentTask.startsWith('autonomy:')) {
    bot.pathfinder.setGoal(null);
    bot._currentTask = null;
  }
  bot.setControlState('jump', false);
  bot.setControlState('sneak', false);
  bot.setControlState('sprint', false);

  _surviveActive = false;
  _surviveBusy = false;
  console.log('[Autonomy] Aborted current survival actions.');
}

function isActive() {
  return _surviveActive;
}

module.exports = {
  startAutonomy,
  stopAutonomy,
  abort,
  isActive,
};
