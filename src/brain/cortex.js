// ─── Brain: Cortex — Unified Loop Orchestrator ─────────────────────────────────
// Replaces all independent brain loops (eat, survive, mine, autonomy) with a
// single intelligent tick that evaluates the full situation and picks ONE action.
//
// Like a human brain:
//   1. Assess danger → survival probability score (0–100)
//   2. Identify what's dragging the score down most
//   3. Execute ONE corrective action exclusively (no overlap)
//   4. Tick faster when danger is high, slower when safe

'use strict';

const { sleep } = require('../utils');

// ─── Brain Dependencies ──────────────────────────────────────────────────────

const eatBrain       = require('./eat');
const attackBrain    = require('./attack');
const defanceBrain   = require('./defance');
const craftBrain     = require('./craft');
const mineBrain      = require('./mine');
const swimBrain      = require('./swim');
const cookController = require('../cook');

const world  = require('../library/world');
const skills = require('../library/skills');

// ─── Constants ───────────────────────────────────────────────────────────────

// Action priorities — higher number = more urgent, wins the lock
const PRIORITIES = {
  idle:           10,
  farm:           15,
  cook:           20,
  gather:         25,
  upgrade:        30,
  craft_tools:    35,
  night_safety:   50,
  eat_normal:     40,
  eat_urgent:     60,
  combat:         75,
  flee:           85,
  swim:           90,
  stuck_recovery: 100,
};

// Dynamic tick intervals based on survival score
const TICK_SPEEDS = [
  { maxScore: 20,  intervalMs: 1500  },  // CRITICAL — tick every 1.5s
  { maxScore: 40,  intervalMs: 3000  },  // DANGER
  { maxScore: 60,  intervalMs: 5000  },  // ALERT
  { maxScore: 80,  intervalMs: 8000  },  // NORMAL
  { maxScore: 101, intervalMs: 12000 },  // SAFE
];

// Scoring weights for survival probability
const WEIGHTS = {
  health:      30,
  hunger:      20,
  armor:       10,
  weapon:      10,
  threat:      25,
  environment: 5,
};

// Armor point values by tier
const ARMOR_POINTS = {
  leather: 1, golden: 2, chainmail: 3, iron: 3, diamond: 4, netherite: 4,
};
const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots'];

// ─── Module State ────────────────────────────────────────────────────────────

let _bot          = null;
let _options      = {};
let _tickHandle   = null;
let _running      = false;

// Action lock — only ONE action at a time
const _lock = {
  owner:    null,    // string name of current action
  priority: 0,       // priority of current action
  startedAt: 0,      // when the action started
  maxDurationMs: 0,  // max allowed duration before force-release
};

// State tracking
const _state = {
  lastTickAt:       0,
  lastSurvivalScore: 100,
  lastAction:       null,
  lastActionAt:     0,
  tickCount:        0,
  announcements:    {},     // cooldown map for chat messages
  shelterPos:       null,
  furnacePos:       null,
  smeltingActive:   false,
  lastFurnaceCheck: 0,
  deathRecovery:    null,
  surviveActive:    false,  // whether autonomous mode is engaged
};

// ─── Logging ─────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`[Cortex] ${msg}`); }
function warn(msg) { console.warn(`[Cortex] ⚠ ${msg}`); }

function announce(key, message, cooldownMs = 12000) {
  const now = Date.now();
  if (now - (_state.announcements[key] || 0) < cooldownMs) return false;
  _state.announcements[key] = now;
  _bot.chat(message);
  return true;
}

// ─── Action Lock ─────────────────────────────────────────────────────────────
// Mutex-style lock preventing action overlap with priority-based preemption.

function isLocked() {
  if (!_lock.owner) return false;
  // Check if current action has expired
  if (_lock.maxDurationMs > 0 && Date.now() - _lock.startedAt > _lock.maxDurationMs) {
    log(`Lock expired: ${_lock.owner} (ran ${((Date.now() - _lock.startedAt) / 1000).toFixed(1)}s)`);
    releaseLock(_lock.owner);
    return false;
  }
  return true;
}

function acquireLock(actionName, priority, maxDurationMs = 15000) {
  if (isLocked()) {
    // Can we preempt?
    if (priority > _lock.priority) {
      log(`Preempting ${_lock.owner} (pri=${_lock.priority}) with ${actionName} (pri=${priority})`);
      releaseLock(_lock.owner);
    } else {
      return false; // Current action has equal or higher priority
    }
  }
  _lock.owner = actionName;
  _lock.priority = priority;
  _lock.startedAt = Date.now();
  _lock.maxDurationMs = maxDurationMs;
  return true;
}

function releaseLock(actionName) {
  if (_lock.owner === actionName || actionName === undefined) {
    _lock.owner = null;
    _lock.priority = 0;
    _lock.startedAt = 0;
    _lock.maxDurationMs = 0;
  }
}

function currentLock() {
  if (isLocked()) return { owner: _lock.owner, priority: _lock.priority };
  return null;
}

// ─── Situation Assessor ──────────────────────────────────────────────────────
// Evaluates the bot's full state and produces a 0–100 survival score.

function getArmorScore() {
  let total = 0;
  const slots = [5, 6, 7, 8]; // head, torso, legs, feet
  for (const slot of slots) {
    const item = _bot.inventory.slots[slot];
    if (!item) continue;
    for (const [tier, points] of Object.entries(ARMOR_POINTS)) {
      if (item.name.startsWith(tier)) {
        total += points;
        break;
      }
    }
  }
  return Math.min(total / 20, 1); // Normalize to 0–1 (20 = full diamond)
}

function getWeaponScore() {
  const weapon = attackBrain.pickBestWeapon(_bot);
  if (!weapon) return 0.3; // Fists
  const name = weapon.item?.name || weapon.name || '';
  if (!name) return 0.3;
  if (name.includes('netherite') || name.includes('diamond')) return 1.0;
  if (name.includes('iron')) return 0.8;
  if (name.includes('stone')) return 0.6;
  if (name.includes('wooden') || name.includes('golden')) return 0.5;
  return 0.4;
}

function getEnvironmentScore() {
  let score = 0;
  // Daytime is safer
  const timeOfDay = _bot.time?.timeOfDay || 0;
  const isDaytime = timeOfDay < 13000 || timeOfDay >= 23000;
  if (isDaytime) score += 0.4;
  // Not underwater
  if (!swimBrain.isWaterlogged(_bot)) score += 0.3;
  // Skylight level > 7 = safe-ish
  try {
    const block = _bot.blockAt(_bot.entity.position);
    if (block && block.skyLight > 7) score += 0.3;
  } catch {
    score += 0.15; // Unknown, assume half-safe
  }
  return Math.min(score, 1);
}

function assessSituation() {
  const health = _bot.health || 20;
  const food   = _bot.food   || 20;

  const threatReport = mineBrain.scanThreatLevel(_bot, _options);
  const threatMax = 20; // Normalizing factor
  const threatNorm = Math.min(threatReport.totalScore / threatMax, 1);

  const healthFactor      = (health / 20);
  const hungerFactor      = (food / 20);
  const armorFactor       = getArmorScore();
  const weaponFactor      = getWeaponScore();
  const threatFactor      = 1 - threatNorm;
  const environmentFactor = getEnvironmentScore();

  const survivalScore = Math.round(
    healthFactor      * WEIGHTS.health +
    hungerFactor      * WEIGHTS.hunger +
    armorFactor       * WEIGHTS.armor +
    weaponFactor      * WEIGHTS.weapon +
    threatFactor      * WEIGHTS.threat +
    environmentFactor * WEIGHTS.environment
  );

  return {
    survivalScore: Math.max(0, Math.min(100, survivalScore)),
    health, food,
    healthFactor, hungerFactor, armorFactor, weaponFactor, threatFactor, environmentFactor,
    threatReport,
    isDaytime: (_bot.time?.timeOfDay || 0) < 13000 || (_bot.time?.timeOfDay || 0) >= 23000,
    isUnderwater: swimBrain.isWaterlogged(_bot),
    isDrowning: swimBrain.isDrowningRisk(_bot),
    hasPickaxe: _bot.inventory.items().some(i => i.name.endsWith('_pickaxe')),
    hasAxe: _bot.inventory.items().some(i => i.name.endsWith('_axe')),
    hasSword: _bot.inventory.items().some(i => i.name.endsWith('_sword')),
    hasWeapon: !!attackBrain.pickBestWeapon(_bot),
    hasFood: !!eatBrain.pickBestFood(_bot),
    inCombat: !!_bot._combatState?.target?.isValid,
    isNight: (_bot.time?.timeOfDay || 0) >= 13000 && (_bot.time?.timeOfDay || 0) < 23000,
  };
}

// ─── Action Selector ─────────────────────────────────────────────────────────
// Returns the action descriptor with highest priority based on current situation.
// Each action: { name, priority, maxDuration, execute: async fn }

function selectAction(situation) {
  const actions = [];
  const {
    survivalScore, health, food,
    threatReport, isDaytime, isUnderwater, isDrowning, isNight,
    hasPickaxe, hasAxe, hasSword, hasWeapon, hasFood, inCombat,
  } = situation;

  // ── 1. Drowning / Swimming emergency ──
  if (isDrowning || isUnderwater) {
    actions.push({
      name: 'swim_safety',
      priority: PRIORITIES.swim,
      maxDuration: 10000,
      execute: async () => {
        const result = await swimBrain.swimToSafety(_bot, _options);
        log(`Swim: ${result.reason}`);
      },
    });
  }

  // ── 2. Flee — health critical AND hostile mob close ──
  if (health <= 4 && threatReport.closeThreats > 0) {
    actions.push({
      name: 'flee_and_eat',
      priority: PRIORITIES.flee,
      maxDuration: 8000,
      execute: async () => {
        announce('flee', `⚠️ Critical health (${health}/20)! Fleeing!`, 8000);
        await mineBrain.retreatFromThreats(_bot, _options);
        if (hasFood) {
          await eatBrain.eat(_bot, { silent: true, force: true });
        }
      },
    });
  }

  // ── 3. Counter-attack — hostile mob is attacking us ──
  if (threatReport.level !== 'none' && threatReport.primaryThreat && health > 4) {
    const combatPriority = threatReport.level === 'high'
      ? PRIORITIES.combat + 10
      : PRIORITIES.combat;

    actions.push({
      name: 'combat',
      priority: combatPriority,
      maxDuration: 15000,
      execute: async () => {
        try { await craftBrain.ensureWeapon(_bot); } catch {}
        if (threatReport.level === 'high' && health <= 8) {
          // High threat + low health: fight-or-flight
          await mineBrain.runMineDecision(_bot, _options);
        } else {
          await attackBrain.startAttack(_bot, threatReport.primaryThreat, _options);
        }
      },
    });
  }

  // ── 4. Emergency eat — health low, have food ──
  if (health <= 8 && hasFood) {
    actions.push({
      name: 'eat_emergency',
      priority: PRIORITIES.eat_urgent,
      maxDuration: 5000,
      execute: async () => {
        const result = await eatBrain.eat(_bot, { silent: false, force: true });
        if (result.ate) log(`Emergency ate: ${result.item}`);
      },
    });
  }

  // ── 5. Critical hunger ──
  if (food <= 6) {
    actions.push({
      name: 'eat_critical',
      priority: PRIORITIES.eat_urgent,
      maxDuration: 5000,
      execute: async () => {
        const result = await eatBrain.eat(_bot, { silent: false, force: true });
        if (!result.ate) {
          // Try cooking or crafting
          try { await cookController.cookBestFood(_bot); } catch {}
          try {
            await craftBrain.craftFoodIfPossible(_bot, { silent: true });
          } catch {}
          await eatBrain.eat(_bot, { silent: false, force: true });
        }
      },
    });
  }

  // ── 5a. Night Off-Hand Torch ──
  const offHandItem = _bot.inventory.slots[45];
  const holdingTorch = offHandItem && offHandItem.name === 'torch';
  if (isNight && !holdingTorch && !inCombat) {
    actions.push({
      name: 'equip_torch_night',
      priority: PRIORITIES.night_safety + 5,
      maxDuration: 5000,
      execute: async () => {
        let torchItem = _bot.inventory.items().find(i => i.name === 'torch');
        if (!torchItem) {
          // Try to craft torches (using coal/charcoal)
          const steps = craftBrain.resolveDependencies(_bot, 'torch', 1);
          if (steps) {
            announce('craft_torch', '💡 Crafting torches for night visibility...', 15000);
            const craftResult = await craftBrain.craft(_bot, 'torch', 1, { silent: true });
            if (craftResult && craftResult.success) {
              torchItem = _bot.inventory.items().find(i => i.name === 'torch');
            }
          }
        }
        if (torchItem) {
          announce('equip_torch', '💡 Equipping torch in off-hand for light.', 15000);
          try {
            await _bot.equip(torchItem, 'off-hand');
          } catch (err) {
            log(`Failed to equip torch in off-hand: ${err.message}`);
          }
        }
      },
    });
  }

  // ── 6. Night safety ──
  if (isNight && !inCombat) {
    actions.push({
      name: 'night_safety',
      priority: PRIORITIES.night_safety,
      maxDuration: 30000,
      execute: async () => {
        await handleNightSafety();
      },
    });
  }

  // ── 7. Normal hunger ──
  if (food <= 14 && hasFood) {
    actions.push({
      name: 'eat_normal',
      priority: PRIORITIES.eat_normal,
      maxDuration: 5000,
      execute: async () => {
        await eatBrain.eat(_bot, { silent: true, force: false });
      },
    });
  }

  // ── 8. No tools — need to gather and craft ──
  if (!hasPickaxe && isDaytime && threatReport.level === 'none') {
    actions.push({
      name: 'craft_tools',
      priority: PRIORITIES.craft_tools,
      maxDuration: 20000,
      execute: async () => {
        await handleToolProgression();
      },
    });
  }

  // ── 9. Tool upgrade (stone → iron) ──
  if (hasPickaxe && isDaytime && threatReport.level === 'none') {
    const canUpgrade = canUpgradeTools();
    if (canUpgrade) {
      actions.push({
        name: 'upgrade_tools',
        priority: PRIORITIES.upgrade,
        maxDuration: 30000,
        execute: async () => {
          await handleToolUpgrade();
        },
      });
    }
  }

  // ── 10. Low resources ──
  const logCount = craftBrain.countAnyOf(_bot, mineBrain.LOG_TYPES);
  if (logCount < 10 && isDaytime && threatReport.level === 'none' && !isNight) {
    actions.push({
      name: 'gather_resources',
      priority: PRIORITIES.gather,
      maxDuration: 20000,
      execute: async () => {
        announce('gather', 'Gathering some more wood...', 20000);
        const result = await mineBrain.cutTreeSafely(_bot, _options);
        if (result.success) {
          await mineBrain.ensureProgression(_bot);
        }
      },
    });
  }

  // ── 11. Cook / smelt ──
  if (food >= 10 && health >= 14 && threatReport.level === 'none' && isDaytime) {
    const bestCookable = require('../library/cook').getBestCookableFood(_bot);
    if (bestCookable) {
      actions.push({
        name: 'cook_food',
        priority: PRIORITIES.cook,
        maxDuration: 15000,
        execute: async () => {
          const result = await cookController.cookBestFood(_bot);
          if (result.success) announce('cook', 'Started cooking food.', 15000);
        },
      });
    }
  }

  // ── 12. Farming ──
  if (isDaytime && threatReport.level === 'none' && food > 14 && health > 14) {
    const wheatSeeds = craftBrain.countItem(_bot, 'wheat_seeds');
    if (wheatSeeds > 5) {
      const waterBlock = world.getNearestBlock(_bot, 'water', 16);
      if (waterBlock) {
        actions.push({
          name: 'farm',
          priority: PRIORITIES.farm,
          maxDuration: 20000,
          execute: async () => {
            announce('farm', 'Running a farming cycle...', 20000);
            await _bot.executeAction({ action: 'farm_cycle' });
          },
        });
      }
    }
  }

  // ── 13. Auto-equip armor (quick, non-blocking) ──
  {
    const armorSlots = [5, 6, 7, 8];
    const armorTypes = ['helmet', 'chestplate', 'leggings', 'boots'];
    const armorDests = ['head', 'torso', 'legs', 'feet'];
    let needsArmor = false;
    for (let i = 0; i < armorSlots.length; i++) {
      if (!_bot.inventory.slots[armorSlots[i]]) {
        const tiers = ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'];
        for (const tier of tiers) {
          if (_bot.inventory.items().find(it => it.name === `${tier}_${armorTypes[i]}`)) {
            needsArmor = true;
            break;
          }
        }
      }
      if (needsArmor) break;
    }

    if (needsArmor) {
      actions.push({
        name: 'equip_armor',
        priority: PRIORITIES.gather, // Low priority, quick action
        maxDuration: 5000,
        execute: async () => {
          for (let i = 0; i < armorSlots.length; i++) {
            if (_bot.inventory.slots[armorSlots[i]]) continue;
            const tiers = ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'];
            for (const tier of tiers) {
              const name = `${tier}_${armorTypes[i]}`;
              const item = _bot.inventory.items().find(it => it.name === name);
              if (item) {
                try { await _bot.equip(item, armorDests[i]); } catch {}
                break;
              }
            }
          }
        },
      });
    }
  }

  // ── 14. Auto-craft bread when lots of wheat ──
  {
    const wheatCount = craftBrain.countItem(_bot, 'wheat');
    const breadCount = craftBrain.countItem(_bot, 'bread');
    if (wheatCount >= 9 && breadCount < 3 && threatReport.level === 'none') {
      actions.push({
        name: 'craft_bread',
        priority: PRIORITIES.cook,
        maxDuration: 8000,
        execute: async () => {
          const batches = Math.floor(wheatCount / 3);
          try { await craftBrain.craft(_bot, 'bread', Math.min(batches, 5), { silent: true }); } catch {}
        },
      });
    }
  }

  // ── 15. Idle — nothing urgent ──
  if (actions.length === 0 || survivalScore > 80) {
    actions.push({
      name: 'idle',
      priority: PRIORITIES.idle,
      maxDuration: 5000,
      execute: async () => {
        await handleIdleBehaviors();
      },
    });
  }

  // Sort by priority descending and pick the highest
  actions.sort((a, b) => b.priority - a.priority);
  return actions[0];
}

// ─── Sub-actions (extracted from survive.js) ─────────────────────────────────

async function handleNightSafety() {
  const { goals } = require('mineflayer-pathfinder');
  const { Vec3 } = require('vec3');
  const { placeBlockAt } = require('../actions/building');

  if (_bot.isSleeping) return;

  // A. Try to find a nearby bed block to sleep
  const bedBlock = world.getNearestBlock(_bot, block => block.name.endsWith('_bed'), 24);
  if (bedBlock) {
    const dist = _bot.entity.position.distanceTo(bedBlock.position);
    if (dist > 3) {
      try {
        await _bot.pathfinder.goto(new goals.GoalNear(bedBlock.position.x, bedBlock.position.y, bedBlock.position.z, 2.5));
      } catch {}
    } else {
      try {
        _bot.chat("🛌 Going to sleep...");
        await _bot.sleep(bedBlock);
      } catch (err) {
        log(`Sleep failed: ${err.message}`);
      }
    }
    return;
  }

  // B. Place a bed if we have one
  const bedItem = _bot.inventory.items().find(i => i.name.endsWith('_bed'));
  if (bedItem) {
    const ref = world.getNearestBlock(_bot, block =>
      ['grass_block', 'dirt', 'stone', 'cobblestone', 'oak_planks', 'spruce_planks', 'birch_planks'].includes(block.name), 4);
    if (ref) {
      _bot.chat("🛌 Placing bed to sleep...");
      try {
        await _bot.equip(bedItem, 'hand');
        await _bot.placeBlock(ref, new Vec3(0, 1, 0));
      } catch (err) {
        log(`Placing bed failed: ${err.message}`);
      }
      return;
    }
  }

  // C. Go to existing shelter
  if (_state.shelterPos) {
    const dist = _bot.entity.position.distanceTo(_state.shelterPos);
    if (dist > 2) {
      try {
        await _bot.pathfinder.goto(new goals.GoalNear(_state.shelterPos.x, _state.shelterPos.y, _state.shelterPos.z, 1));
      } catch {}
    } else {
      // Inside shelter — crouch occasionally
      _bot.setControlState('sneak', true);
      await sleep(1500);
      _bot.setControlState('sneak', false);
    }
    return;
  }

  // D. Build emergency shelter
  const cobble = craftBrain.countItem(_bot, 'cobblestone');
  const dirt   = craftBrain.countItem(_bot, 'dirt');
  const stone  = craftBrain.countItem(_bot, 'stone');
  const planks = craftBrain.countAnyOf(_bot, craftBrain.PLANK_TYPES);
  const total  = cobble + dirt + stone + planks;

  if (total >= 15) {
    let blockToUse = 'dirt';
    if (cobble >= 15) blockToUse = 'cobblestone';
    else if (stone >= 15) blockToUse = 'stone';
    else if (planks >= 15) blockToUse = craftBrain.PLANK_TYPES.find(p => craftBrain.countItem(_bot, p) >= 15) || 'oak_planks';

    const pos = _bot.entity.position.floored();
    _bot.chat(`🛡️ Building emergency shelter using ${blockToUse}...`);

    const x = pos.x, y = pos.y, z = pos.z;
    const wallCoords = [
      {x: x-1, y, z: z-1}, {x, y, z: z-1}, {x: x+1, y, z: z-1},
      {x: x-1, y, z},                        {x: x+1, y, z},
      {x: x-1, y, z: z+1}, {x, y, z: z+1}, {x: x+1, y, z: z+1},
      {x: x-1, y: y+1, z: z-1}, {x, y: y+1, z: z-1}, {x: x+1, y: y+1, z: z-1},
      {x: x-1, y: y+1, z},                             {x: x+1, y: y+1, z},
      {x: x-1, y: y+1, z: z+1}, {x, y: y+1, z: z+1}, {x: x+1, y: y+1, z: z+1},
    ];

    for (const c of wallCoords) {
      const block = _bot.blockAt(new Vec3(c.x, c.y, c.z));
      if (!block || block.name === 'air' || block.name === 'cave_air') {
        try { await placeBlockAt(_bot, goals, blockToUse, c.x, c.y, c.z); } catch {}
      }
    }
    try { await placeBlockAt(_bot, goals, blockToUse, x, y + 2, z); } catch {}

    _state.shelterPos = pos.clone();
    _bot.chat("🛡️ Shelter complete. Staying inside until dawn.");
    return;
  }

  // E. Mine dirt for shelter
  if (dirt < 15) {
    _bot.chat("Mining some dirt for night shelter...");
    await skills.mineBlock(_bot, 'dirt', 15);
  }
}

async function handleToolProgression() {
  const logCount  = craftBrain.countAnyOf(_bot, mineBrain.LOG_TYPES);
  const planks    = craftBrain.countAnyOf(_bot, craftBrain.PLANK_TYPES);
  const sticks    = craftBrain.countItem(_bot, 'stick');
  const table     = craftBrain.countItem(_bot, 'crafting_table');
  const cobble    = craftBrain.countItem(_bot, 'cobblestone');
  const hasPickaxe = _bot.inventory.items().some(i => i.name.endsWith('_pickaxe'));

  // Step 1: Gather wood if needed
  if (!hasPickaxe && logCount < 4 && planks < 4) {
    announce('tools', 'No pickaxe, gathering logs first.', 20000);
    const result = await mineBrain.cutTreeSafely(_bot, _options);
    if (result.success) await mineBrain.ensureProgression(_bot);
    return;
  }

  // Step 2: Convert logs → planks → sticks
  if (logCount > 0 && planks < 4) {
    await mineBrain.ensureProgression(_bot);
    return;
  }
  if (planks >= 2 && sticks < 4) {
    await mineBrain.ensureProgression(_bot);
    return;
  }

  // Step 3: Crafting table
  const tableNear = world.getNearestBlock(_bot, 'crafting_table', 16);
  if (!table && !tableNear && planks >= 4) {
    await mineBrain.ensureProgression(_bot);
    return;
  }

  // Step 4: Wooden pickaxe
  if (!hasPickaxe && planks >= 3 && sticks >= 2) {
    await mineBrain.ensureProgression(_bot);
    return;
  }

  // Step 5: Mine cobblestone
  const pickaxe = _bot.inventory.items().find(i => i.name === 'wooden_pickaxe');
  if (pickaxe && cobble < 12) {
    announce('tools', 'Mining cobblestone to upgrade tools...', 20000);
    await skills.mineBlock(_bot, 'stone', 8);
    return;
  }

  // Step 6: Craft stone tools
  if (pickaxe && cobble >= 11) {
    announce('tools', 'Upgrading to stone gear!', 15000);
    await skills.craftItem(_bot, 'stone_pickaxe', 1);
    await skills.craftItem(_bot, 'stone_sword', 1);
    await skills.craftItem(_bot, 'stone_axe', 1);
    await skills.craftItem(_bot, 'furnace', 1);
  }
}

function canUpgradeTools() {
  const pickaxe = _bot.inventory.items().find(i => i?.name?.endsWith('_pickaxe'));
  if (!pickaxe) return false;
  const name = pickaxe.name || '';
  if (!name) return false;

  // Already at iron or better
  if (name.includes('iron') || name.includes('diamond') || name.includes('netherite')) return false;

  const cobble   = craftBrain.countItem(_bot, 'cobblestone');
  const rawIron  = craftBrain.countItem(_bot, 'raw_iron') + craftBrain.countItem(_bot, 'iron_ore');
  const ironIngots = craftBrain.countItem(_bot, 'iron_ingot');

  // Stone pickaxe but no iron yet → mine for it
  if (name === 'stone_pickaxe' && rawIron < 5 && ironIngots < 3) return true;
  // Have raw iron → smelt it
  if (rawIron >= 3 && ironIngots < 3 && !_state.smeltingActive) return true;
  // Have iron ingots → craft iron tools
  if (ironIngots >= 3) return true;

  return false;
}

async function handleToolUpgrade() {
  const pickaxeName = _bot.inventory.items().find(i => i.name.endsWith('_pickaxe'))?.name;
  const rawIron     = craftBrain.countItem(_bot, 'raw_iron') + craftBrain.countItem(_bot, 'iron_ore');
  const ironIngots  = craftBrain.countItem(_bot, 'iron_ingot');
  const coalCount   = craftBrain.countItem(_bot, 'coal');

  // Mine coal/iron
  if (pickaxeName === 'stone_pickaxe' && rawIron < 5 && ironIngots < 3) {
    if (coalCount < 3) {
      announce('upgrade', 'Searching for coal...', 20000);
      await skills.mineBlock(_bot, 'coal_ore', 4);
    } else {
      announce('upgrade', 'Searching for iron ore...', 20000);
      await skills.mineBlock(_bot, 'iron_ore', 4);
    }
    return;
  }

  // Smelt iron
  if (rawIron >= 3 && ironIngots < 3 && !_state.smeltingActive) {
    announce('upgrade', 'Smelting iron...', 15000);
    try {
      const result = await cookController.smeltBestOre(_bot);
      if (result.success) {
        const station = cookController.findNearbyCookingBlock(_bot);
        if (station) {
          _state.furnacePos = station.position.clone();
          _state.smeltingActive = true;
          _state.lastFurnaceCheck = Date.now();
        }
      }
    } catch (err) {
      log(`Smelting failed: ${err.message}`);
    }
    return;
  }

  // Craft iron tools
  if (ironIngots >= 3) {
    announce('upgrade', 'Upgrading to iron pickaxe!', 15000);
    await skills.craftItem(_bot, 'iron_pickaxe', 1);
    if (ironIngots >= 5) {
      await skills.craftItem(_bot, 'iron_sword', 1);
    }
  }
}

async function handleIdleBehaviors() {
  const now = Date.now();

  // Leave shelter in morning
  if (_state.shelterPos) {
    const timeOfDay = _bot.time?.timeOfDay || 0;
    const isDaytime = timeOfDay < 13000 || timeOfDay >= 23000;
    if (isDaytime) {
      _bot.chat("☀️ Morning! Leaving shelter...");
      const pos = _state.shelterPos;
      const ceilingBlock = _bot.blockAt(pos.offset(0, 2, 0));
      if (ceilingBlock && ceilingBlock.name !== 'air') {
        try { await _bot.dig(ceilingBlock); } catch {}
      }
      const wallBlock = _bot.blockAt(pos.offset(0, 1, -1));
      if (wallBlock && wallBlock.name !== 'air') {
        try { await _bot.dig(wallBlock); } catch {}
      }
      _state.shelterPos = null;
      return;
    }
  }

  // Check furnace
  if (_state.furnacePos && _state.smeltingActive) {
    const timeSince = now - _state.lastFurnaceCheck;
    if (timeSince > 15000) {
      _state.lastFurnaceCheck = now;
      const furnaceBlock = _bot.blockAt(_state.furnacePos);
      if (furnaceBlock && furnaceBlock.name === 'furnace') {
        const { goals } = require('mineflayer-pathfinder');
        try {
          await _bot.pathfinder.goto(new goals.GoalNear(_state.furnacePos.x, _state.furnacePos.y, _state.furnacePos.z, 2.5));
          const container = await _bot.openContainer(furnaceBlock);
          const resultSlot = container.slots[2];
          if (resultSlot && resultSlot.count > 0) {
            _bot.chat(`Claiming smelted: ${resultSlot.name} x${resultSlot.count}`);
            await container.withdraw(resultSlot.type, null, resultSlot.count);
          }
          const inputSlot = container.slots[0];
          const isDone = (!inputSlot || inputSlot.count === 0) && (!resultSlot || resultSlot.count === 0);
          container.close();
          if (isDone) {
            _bot.chat("Smelting complete. Picking up furnace...");
            await _bot.dig(furnaceBlock);
            _state.furnacePos = null;
            _state.smeltingActive = false;
          }
        } catch (err) {
          log(`Furnace check failed: ${err.message}`);
        }
      } else {
        _state.furnacePos = null;
        _state.smeltingActive = false;
      }
      return;
    }
  }

  // Look at nearby player
  const nearbyPlayers = world.getNearbyEntities(_bot, 'player', 8);
  if (nearbyPlayers.length > 0) {
    const closest = nearbyPlayers.reduce((a, b) =>
      _bot.entity.position.distanceTo(a.position) < _bot.entity.position.distanceTo(b.position) ? a : b
    );
    if (now - (_state._lastLookTime || 0) > 3000) {
      _state._lastLookTime = now;
      await _bot.lookAt(closest.position.offset(0, 1.6, 0));
      // Crouch greet occasionally
      if (Math.random() < 0.25) {
        _bot.setControlState('sneak', true);
        await sleep(350);
        _bot.setControlState('sneak', false);
        await sleep(150);
        _bot.setControlState('sneak', true);
        await sleep(350);
        _bot.setControlState('sneak', false);
      }
    }
    return;
  }

  // Random look around
  if (now - (_state._lastLookTime || 0) > 7000) {
    _state._lastLookTime = now;
    const yaw = Math.random() * Math.PI * 2;
    const pitch = (Math.random() - 0.5) * Math.PI * 0.25;
    await _bot.look(yaw, pitch);
  }

  // Random jump
  if (now - (_state._lastJumpTime || 0) > 25000 && Math.random() < 0.3) {
    _state._lastJumpTime = now;
    _bot.setControlState('jump', true);
    await sleep(150);
    _bot.setControlState('jump', false);
  }

  // Random wander
  if (now - (_state._lastWanderTime || 0) > 20000 && Math.random() < 0.4) {
    _state._lastWanderTime = now;
    const { goals } = require('mineflayer-pathfinder');
    const angle = Math.random() * Math.PI * 2;
    const dist = 3 + Math.random() * 5;
    const targetPos = _bot.entity.position.offset(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
    const sprint = Math.random() < 0.2;
    if (sprint) _bot.setControlState('sprint', true);
    try {
      await _bot.pathfinder.goto(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 2));
    } catch {}
    if (sprint) _bot.setControlState('sprint', false);
  }
}

// ─── Main Cortex Tick ────────────────────────────────────────────────────────

async function cortexTick() {
  if (!_running || !_bot) return;

  // Skip if user is actively interacting or LLM is thinking
  const timeSinceInteraction = Date.now() - (_bot.lastInteractionTime || 0);
  const isPlayerBusy = _bot._currentTask && !_bot._currentTask.startsWith('cortex:');
  const isThinking = _bot.isThinking;

  if (timeSinceInteraction < 30000 || isPlayerBusy || isThinking) {
    if (_state.surviveActive) {
      log('User activity detected. Deactivating autonomous mode.');
      _state.surviveActive = false;
      _bot.pathfinder?.setGoal(null);
      _bot.setControlState('jump', false);
      _bot.setControlState('sneak', false);
      _bot.setControlState('sprint', false);
      releaseLock();
    }
    return;
  }

  // Activate autonomous mode if not already
  if (!_state.surviveActive) {
    _state.surviveActive = true;
    _bot.chat("💤 Player is idle. Cortex engaging autonomous survival mode...");
    log('Autonomous mode activated.');
  }

  // If lock is held by a running action, skip this tick
  if (isLocked()) {
    return;
  }

  // Skip if bot is dead
  if (_bot.health <= 0) return;

  _state.tickCount++;

  try {
    // 1. Assess the situation
    const situation = assessSituation();
    _state.lastSurvivalScore = situation.survivalScore;

    // 2. Select the best action
    const action = selectAction(situation);
    if (!action) return;

    // 3. Log decision
    const scoreLabel = situation.survivalScore < 20 ? 'CRITICAL'
      : situation.survivalScore < 40 ? 'DANGER'
      : situation.survivalScore < 60 ? 'ALERT'
      : situation.survivalScore < 80 ? 'NORMAL' : 'SAFE';

    log(`Tick #${_state.tickCount} | Score: ${situation.survivalScore}/100 [${scoreLabel}] | ` +
        `HP:${situation.health} Food:${situation.food} Threat:${situation.threatReport.level} | ` +
        `Action: ${action.name} (pri=${action.priority})`);

    // 4. Acquire lock and execute
    if (!acquireLock(action.name, action.priority, action.maxDuration)) {
      log(`Cannot acquire lock for ${action.name} — ${_lock.owner} holds it.`);
      return;
    }

    _state.lastAction = action.name;
    _state.lastActionAt = Date.now();
    _bot._currentTask = `cortex:${action.name}`;

    try {
      await action.execute();
    } catch (err) {
      log(`Action ${action.name} failed: ${err.message}`);
    } finally {
      releaseLock(action.name);
      if (_bot._currentTask === `cortex:${action.name}`) {
        _bot._currentTask = null;
      }
    }
  } catch (err) {
    warn(`Tick error: ${err.message}`);
  }
}

// ─── Tick Controller ─────────────────────────────────────────────────────────
// Dynamically adjusts tick interval based on survival score.

function getTickInterval() {
  const score = _state.lastSurvivalScore;
  for (const tier of TICK_SPEEDS) {
    if (score < tier.maxScore) return tier.intervalMs;
  }
  return 12000;
}

function scheduleNextTick() {
  if (!_running) return;
  const interval = getTickInterval();
  _tickHandle = setTimeout(async () => {
    try {
      await cortexTick();
    } catch (err) {
      warn(`Tick loop error: ${err.message}`);
    }
    scheduleNextTick();
  }, interval);
}

// ─── Public API ──────────────────────────────────────────────────────────────

function start(bot, options = {}) {
  stop();
  _bot = bot;
  _options = options;
  _running = true;

  // Reset state
  _state.lastTickAt = Date.now();
  _state.lastSurvivalScore = 100;
  _state.lastAction = null;
  _state.tickCount = 0;
  _state.surviveActive = false;
  _state.shelterPos = null;
  _state.furnacePos = null;
  _state.smeltingActive = false;
  _state.announcements = {};

  // Death snapshot listener
  _state._onDeath = () => {
    log('Bot died. Recording death snapshot.');
    // Could add death recovery logic here
  };
  bot.on('death', _state._onDeath);

  // Start the tick loop
  scheduleNextTick();
  log('Cortex started — unified brain loop active.');
}

function stop() {
  _running = false;
  if (_tickHandle) {
    clearTimeout(_tickHandle);
    _tickHandle = null;
  }
  if (_bot && _state._onDeath) {
    _bot.off('death', _state._onDeath);
  }
  releaseLock();
  _state.surviveActive = false;
  log('Cortex stopped.');
}

/**
 * Signal the cortex from external systems (e.g., defense reaction).
 * Allows event-driven systems to inform the cortex they are acting.
 */
function signalExternalAction(actionName, priority, maxDurationMs = 10000) {
  return acquireLock(actionName, priority, maxDurationMs);
}

function releaseExternalAction(actionName) {
  releaseLock(actionName);
}

function getStatus() {
  return {
    running: _running,
    surviveActive: _state.surviveActive,
    survivalScore: _state.lastSurvivalScore,
    lastAction: _state.lastAction,
    tickCount: _state.tickCount,
    currentLock: currentLock(),
    tickInterval: getTickInterval(),
  };
}

module.exports = {
  start,
  stop,
  signalExternalAction,
  releaseExternalAction,
  getStatus,
  assessSituation,
  // Expose for testing/reports
  PRIORITIES,
};
