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
const rlEngine = require('./rlEngine');
const rlCritic = require('./rlCritic');

// ─── Brain Dependencies ──────────────────────────────────────────────────────

const eatBrain       = require('./eat');
const attackBrain    = require('./attack');
const defanceBrain   = require('./defance');
const craftBrain     = require('./craft');
const mineBrain      = require('./mine');
const swimBrain      = require('./swim');
const cookController = require('../cook');
const biom           = require('../biom/index');  // biome-specific survival plans

const world  = require('../library/world');
const skills = require('../library/skills');
const { goals } = require('mineflayer-pathfinder');
const { digSafely } = require('../utils');
const { collectDrops } = require('../utils');

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

const ACTION_COOLDOWNS = {
  collect_dropped_items: 15000,
  death_recovery: 10000,
  reach_shore: 6000,
  night_safety: 12000,
  gather_resources: 12000,
  relocate_biome: 20000,
  craft_tools: 8000,
  upgrade_tools: 12000,
  craft_armor: 20000,
  craft_shield: 30000,
  starter_build: 60000,
  cook_food: 20000,
  farm: 30000,
  ai_supervisor: 45000,
  craft_bread: 20000,
  equip_torch_night: 20000,
  equip_armor: 10000,
  idle: 2500,
};

const ACTION_FAILURE_BACKOFF_MS = 15000;
const MAX_ACTION_FAILURES = 3;
const AUTONOMY_BLOCK_THRESHOLD = 2;
const AUTONOMY_BLOCK_REROUTE_COOLDOWN_MS = 30000;

// Dynamic tick intervals based on survival score
const TICK_SPEEDS = [
  { maxScore: 20,  intervalMs: 1000 },
  { maxScore: 40,  intervalMs: 1500 },
  { maxScore: 60,  intervalMs: 2000 },
  { maxScore: 80,  intervalMs: 2500 },
  { maxScore: 101, intervalMs: 3000 },
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
  persistentGoal:   null,
  persistentSince:  0,
  announcements:    {},     // cooldown map for chat messages
  actionCooldowns:   {},
  actionFailures:    {},
  shelterPos:       null,
  furnacePos:       null,
  smeltingActive:   false,
  lastFurnaceCheck: 0,
  deathRecovery:    null,
  surviveActive:    false,  // whether autonomous mode is engaged
  autonomyBlocks:   {},
  rlStats: {
    epsilon: rlEngine.DEFAULT_EPSILON,
    totalSteps: 0,
    totalReward: 0,
    lastReward: 0,
    lastAdvice: null,
    lastState: null,
  },
};

const DEATH_RECOVERY_MAX_DISTANCE = 96;
const DEATH_RECOVERY_EXPIRY_MS = 180000;

// ─── Logging ─────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`[Cortex] ${msg}`); }
function warn(msg) { console.warn(`[Cortex] ⚠ ${msg}`); }

function announce(key, message, cooldownMs = 12000) {
  if (!message) return false;
  const now = Date.now();
  if (now - (_state.announcements[key] || 0) < cooldownMs) return false;
  if (_state.lastAnnouncedMessage === message && now - (_state.lastAnnouncedAt || 0) < cooldownMs) return false;
  _state.announcements[key] = now;
  _state.lastAnnouncedMessage = message;
  _state.lastAnnouncedAt = now;
  _bot.chat(message);
  return true;
}

function snapshotInventory(bot) {
  return bot.inventory.items().map(item => ({
    name: item.name,
    count: item.count,
  }));
}

function scoreRecoveryItem(bot, entry) {
  const name = entry.name;
  const count = entry.count || 1;

  if (/_pickaxe$|_axe$|_sword$|_shovel$|_hoe$/.test(name)) return 20;
  if (/_helmet$|_chestplate$|_leggings$|_boots$/.test(name)) return 16;
  if (['shield', 'crafting_table', 'furnace', 'water_bucket', 'bucket'].includes(name) || name.endsWith('_bed')) return 12;
  if (['bread', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken', 'cooked_cod', 'cooked_salmon'].includes(name)) return bot.food < 14 ? count * 3 : count;
  if (['iron_ingot', 'raw_iron', 'coal', 'diamond', 'gold_ingot', 'torch'].includes(name)) return count;
  return 0;
}

function shouldAttemptDeathRecovery(bot, recovery) {
  if (!recovery || recovery.done) return false;
  if (Date.now() - recovery.createdAt > DEATH_RECOVERY_EXPIRY_MS) return false;
  if (bot.entity.position.distanceTo(recovery.position) > DEATH_RECOVERY_MAX_DISTANCE) return false;

  const totalScore = recovery.lostItems.reduce((sum, entry) => sum + scoreRecoveryItem(bot, entry), 0);
  const essentialLost = recovery.lostItems.some(entry =>
    /_pickaxe$|_axe$|_sword$|_helmet$|_chestplate$|_leggings$|_boots$/.test(entry.name) ||
    ['shield', 'crafting_table', 'furnace'].includes(entry.name)
  );

  return essentialLost || totalScore >= 16;
}

function hasStarterBuildMaterials() {
  const planks = craftBrain.countAnyOf(_bot, craftBrain.PLANK_TYPES);
  const logs = craftBrain.countAnyOf(_bot, craftBrain.LOG_TYPES);
  const cobble = craftBrain.countItem(_bot, 'cobblestone') + craftBrain.countItem(_bot, 'stone') + craftBrain.countItem(_bot, 'sandstone');
  const torches = craftBrain.countItem(_bot, 'torch');
  const table = craftBrain.countItem(_bot, 'crafting_table');
  const furnace = craftBrain.countItem(_bot, 'furnace');

  return {
    ready: (planks >= 48 && logs >= 8 && cobble >= 24) || (planks >= 64 && cobble >= 16),
    planks,
    logs,
    cobble,
    torches,
    table,
    furnace,
  };
}

function getArmorManagementState() {
  const armorTypes = ['helmet', 'chestplate', 'leggings', 'boots'];
  const slotMap = { helmet: 5, chestplate: 6, leggings: 7, boots: 8 };
  const tierScore = { leather: 1, golden: 2, chainmail: 3, iron: 4, diamond: 5, netherite: 6 };

  let missingPieces = 0;
  let upgradeAvailable = false;
  let equippedScore = 0;

  for (const type of armorTypes) {
    const equipped = _bot.inventory.slots[slotMap[type]];
    const equippedTier = equipped ? (Object.keys(tierScore).find(t => equipped.name.startsWith(`${t}_`)) || '') : '';
    const equippedPieceScore = tierScore[equippedTier] || 0;
    equippedScore += equippedPieceScore;
    if (!equipped) missingPieces++;

    const betterOwned = _bot.inventory.items().some(item => {
      if (!item.name.endsWith(`_${type}`)) return false;
      const itemTier = Object.keys(tierScore).find(t => item.name.startsWith(`${t}_`)) || '';
      return (tierScore[itemTier] || 0) > equippedPieceScore;
    });
    if (betterOwned) upgradeAvailable = true;
  }

  const ironIngots = craftBrain.countItem(_bot, 'iron_ingot');
  const diamondCount = craftBrain.countItem(_bot, 'diamond');
  const shieldCount = craftBrain.countItem(_bot, 'shield');
  const hasShieldEquipped = !!_bot.inventory.slots[45] && _bot.inventory.slots[45].name === 'shield';
  const hasShieldInInventory = shieldCount > 0;

  const canCraftArmor = !!craftBrain.getBestCraftableTier?.(_bot, 'helmet', 1)
    || !!craftBrain.getBestCraftableTier?.(_bot, 'chestplate', 1)
    || !!craftBrain.getBestCraftableTier?.(_bot, 'leggings', 1)
    || !!craftBrain.getBestCraftableTier?.(_bot, 'boots', 1);

  return {
    missingPieces,
    upgradeAvailable,
    equippedScore,
    ironIngots,
    diamondCount,
    hasShieldEquipped,
    hasShieldInInventory,
    shouldCraftArmor: canCraftArmor && (missingPieces > 0 || equippedScore < 8 || upgradeAvailable),
    shouldCraftShield: !hasShieldEquipped && !hasShieldInInventory && ironIngots >= 1 && craftBrain.countAnyOf(_bot, craftBrain.PLANK_TYPES) >= 6,
  };
}

async function relocateToBetterBiomeForWood() {
  announce('relocate_biome', 'No useful trees nearby here. Relocating toward a better biome.', 30000);
  const preferredLogs = biom.getFallbackLogTypes(_bot);
  const result = await mineBrain.wanderToTree(_bot, _options, preferredLogs);
  if (result.success) {
    announce('relocate_found', 'Found a better area with wood. Switching back to gathering.', 25000);
    return true;
  }

  const { GoalNear } = require('mineflayer-pathfinder').goals;
  const angle = Math.random() * Math.PI * 2;
  const distance = 80 + Math.random() * 80;
  const target = _bot.entity.position.offset(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);
  try {
    await _bot.pathfinder.goto(new GoalNear(target.x, _bot.entity.position.y, target.z, 6));
    return true;
  } catch (err) {
    log(`Biome relocation failed: ${err.message}`);
    return false;
  }
}

async function handleStarterBuildOrCraft() {
  const stock = hasStarterBuildMaterials();
  if (!stock.ready) return false;

  if (stock.table < 1) {
    await skills.craftItem(_bot, 'crafting_table', 1);
    return true;
  }
  if (stock.furnace < 1 && stock.cobble >= 8) {
    await skills.craftItem(_bot, 'furnace', 1);
    return true;
  }
  if (stock.torches < 4) {
    try { await skills.craftItem(_bot, 'torch', 1); } catch {}
  }

  announce('starter_build', 'Enough starter materials collected. Beginning base setup.', 30000);
  const pos = _bot.entity.position.floored();
  await _bot.executeAction({
    action: 'build_house',
    blueprint: 'home',
    x: pos.x + 2,
    y: pos.y,
    z: pos.z + 2,
    facing: 'south',
  });
  return true;
}

function findRecoverableDrops(maxDistance = 50) {
  return Object.values(_bot.entities || {})
    .filter(entity => {
      if (!entity || !entity.isValid || entity.name !== 'item') return false;
      return entity.position.distanceTo(_bot.entity.position) <= maxDistance;
    })
    .sort((a, b) => a.position.distanceTo(_bot.entity.position) - b.position.distanceTo(_bot.entity.position));
}

async function collectNearbyDropsWithinRadius(maxDistance = 50) {
  const nearbyDrops = findRecoverableDrops(maxDistance);
  if (nearbyDrops.length === 0) return false;

  announce('collect_drops', `Collecting dropped items nearby (${nearbyDrops.length} found).`, 20000);

  for (const item of nearbyDrops.slice(0, 12)) {
    if (!item?.isValid) continue;
    try {
      await _bot.pathfinder.goto(new goals.GoalNear(item.position.x, item.position.y, item.position.z, 1));
      await sleep(150);
    } catch {
      // item may despawn or become unreachable
    }
  }

  await collectDrops(_bot, goals, 150, { maxDistance, maxItems: 24, passes: 2 });
  return true;
}

async function handleDeathRecovery() {
  const recovery = _state.deathRecovery;
  if (!recovery || recovery.done) return false;
  if (!shouldAttemptDeathRecovery(_bot, recovery)) {
    recovery.done = true;
    return false;
  }

  const threatReport = mineBrain.scanThreatLevel(_bot, _options);
  if (threatReport.level === 'high' || _bot.health <= 7) {
    announce('death_recovery_wait', 'Dropped gear detected, but the area is too dangerous to recover it right now.', 20000);
    return true;
  }

  const nearbyDrops = Object.values(_bot.entities).filter(entity => {
    if (!entity || !entity.isValid || entity.name !== 'item') return false;
    return entity.position.distanceTo(recovery.position) <= 12;
  });

  if (nearbyDrops.length === 0 && recovery.attempts > 0) {
    recovery.done = true;
    return false;
  }

  recovery.attempts += 1;
  announce('death_recovery', 'Recovering my dropped items.', 15000);

  try {
    await _bot.pathfinder.goto(new goals.GoalNear(recovery.position.x, recovery.position.y, recovery.position.z, 2));
    await collectDrops(_bot, goals, 250, { maxDistance: 14, maxItems: 20, passes: 3 });
    await craftBrain.ensureArmor(_bot).catch(() => {});
  } catch (err) {
    log(`Death recovery failed: ${err.message}`);
  }

  if (recovery.attempts >= 3) {
    recovery.done = true;
  }
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

function getActionCooldownMs(actionName) {
  return ACTION_COOLDOWNS[actionName] || 0;
}

function canRunAction(action) {
  if (!action) return false;
  if (action.priority >= PRIORITIES.flee) return true;

  const now = Date.now();
  const cooldownUntil = _state.actionCooldowns[action.name] || 0;
  if (now < cooldownUntil) return false;

  const failure = _state.actionFailures[action.name];
  if (failure && failure.count >= MAX_ACTION_FAILURES && now < failure.nextTryAt) {
    return false;
  }

  return true;
}

function markActionFinished(action, failed = false) {
  if (!action) return;
  const now = Date.now();
  const cooldownMs = getActionCooldownMs(action.name);
  if (cooldownMs > 0 && action.priority < PRIORITIES.flee) {
    _state.actionCooldowns[action.name] = now + cooldownMs;
  }

  if (failed) {
    const previous = _state.actionFailures[action.name] || { count: 0, nextTryAt: 0 };
    const count = previous.count + 1;
    _state.actionFailures[action.name] = {
      count,
      nextTryAt: now + Math.min(ACTION_FAILURE_BACKOFF_MS * count, 60000),
    };
  } else {
    delete _state.actionFailures[action.name];
  }
}

function clearAutonomyBlock(key) {
  if (!key) return;
  delete _state.autonomyBlocks[key];
}

function shouldEscalateToLLM(reason = '', situation = null) {
  const text = String(reason || '').toLowerCase();
  if (!text) return false;
  if (/missing|unknown|no crafting table|no pickaxe|no tool|cannot|can't|blocked|stuck|unavailable|failed/.test(text)) {
    return true;
  }
  if (situation && situation.survivalScore >= 60 && situation.threatReport?.level === 'none') {
    return /idle|nothing|insufficient|no target/.test(text);
  }
  return false;
}

async function maybeAskCoreLLMForDirection(trigger, detail = {}, situation = null) {
  if (!_bot?.runAIAutonomy || !_bot?.aiAutonomy?.enabled) return false;
  const result = await _bot.runAIAutonomy({
    force: true,
    trigger,
    detail,
    survivalScore: situation?.survivalScore ?? _state.lastSurvivalScore,
    biomeCategory: situation?.biomeCategory,
    biomeRisk: situation?.biomeRisk,
    topPriorities: situation?.biomeStrategy?.priorities?.slice(0, 4) || [],
    lastAction: _state.lastAction,
    persistentGoal: _state.persistentGoal,
    rlAdvice: _state.rlStats.lastAdvice,
  });
  if (!result.success) {
    log(`Core LLM fallback skipped: ${result.reason || 'unknown reason'}`);
    return false;
  }
  return true;
}

function chooseActionWithRL(actions, situation) {
  const selected = chooseBestAction(actions);
  if (!selected) return null;

  const advice = rlEngine.getActionAdvice(_bot, _state.rlStats.epsilon);
  _state.rlStats.lastAdvice = advice;
  _state.rlStats.lastState = advice.state;

  const mapped = advice.mappedCortexActions || [];
  if (mapped.length === 0) return selected;

  const preferred = actions
    .filter(action => mapped.includes(action.name))
    .sort((a, b) => b.priority - a.priority)[0];

  if (!preferred) return selected;

  const selectedPriority = selected.priority || 0;
  const preferredPriority = preferred.priority || 0;
  const safeToBias = Math.abs(preferredPriority - selectedPriority) <= 10
    && situation.threatReport?.level !== 'high'
    && situation.survivalScore >= 35;

  if (safeToBias && preferred.name !== selected.name) {
    log(`RL advisor nudged action from ${selected.name} to ${preferred.name} (state=${advice.state}, suggestion=${advice.suggestedAction})`);
    return preferred;
  }

  return selected;
}

function noteAutonomyBlock(key, detail = {}) {
  const now = Date.now();
  const previous = _state.autonomyBlocks[key] || { count: 0, lastAt: 0, rerouteAt: 0 };
  const count = now - previous.lastAt < 120000 ? previous.count + 1 : 1;
  _state.autonomyBlocks[key] = {
    count,
    lastAt: now,
    rerouteAt: previous.rerouteAt || 0,
    detail,
  };
  return _state.autonomyBlocks[key];
}

async function maybeRerouteAutonomyFromBlock(key, detail = {}) {
  if (!_bot?.runAIAutonomy || !_bot?.aiAutonomy?.enabled) return false;
  const blockState = noteAutonomyBlock(key, detail);
  if (blockState.count < AUTONOMY_BLOCK_THRESHOLD) return false;
  if (Date.now() - (blockState.rerouteAt || 0) < AUTONOMY_BLOCK_REROUTE_COOLDOWN_MS) return false;

  blockState.rerouteAt = Date.now();
  announce('ai_reroute', 'I am stuck on this step. Asking the AI supervisor for a different plan.', 20000);
  const result = await _bot.runAIAutonomy({
    force: true,
    trigger: 'blocked_autonomy_loop',
    blockedAction: key,
    blockedDetail: detail,
    survivalScore: _state.lastSurvivalScore,
    lastAction: _state.lastAction,
    persistentGoal: _state.persistentGoal,
  });

  if (!result.success) {
    log(`AI reroute skipped: ${result.reason || 'unknown reason'}`);
    return false;
  }

  clearAutonomyBlock(key);
  return true;
}

function chooseBestAction(actions) {
  actions.sort((a, b) => b.priority - a.priority);
  const selected = actions.find(canRunAction);
  if (selected) return selected;

  const emergency = actions.find(action => action.priority >= PRIORITIES.flee);
  return emergency || null;
}

function shouldTreatAsExternalActiveTask(taskName) {
  if (!taskName) return false;
  const task = String(taskName);
  if (task.startsWith('cortex:')) return false;
  if (task.startsWith('autonomy:')) return false;
  if (task.startsWith('resume:')) return true;
  if (task.includes('mine') || task.includes('gather') || task.includes('build') || task.includes('follow') || task.includes('farm') || task.includes('strip')) {
    return true;
  }
  return false;
}

function isMaintenanceAction(actionName) {
  return [
    'equip_torch_night',
    'equip_armor',
    'cook_food',
    'craft_bread',
    'idle',
  ].includes(actionName);
}

function rememberPersistentGoal(action) {
  if (!action || isMaintenanceAction(action.name)) return;
  _state.persistentGoal = action.name;
  _state.persistentSince = Date.now();
}

function clearPersistentGoal(actionName = null) {
  if (!actionName || _state.persistentGoal === actionName) {
    _state.persistentGoal = null;
    _state.persistentSince = 0;
  }
}

function shouldKeepPersistentGoal() {
  if (!_state.persistentGoal) return false;
  if (!shouldTreatAsExternalActiveTask(_bot?._currentTask)) return false;
  return Date.now() - (_state.persistentSince || 0) < 90000;
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

  // Biome detection — use the new biom/ plan system
  const biomePlan     = biom.getCurrentBiomePlan(_bot);
  const biomeName     = biom.getBiomeName(_bot);
  const biomeCategory = biomePlan.category;
  const biomeRisk     = biom.getRiskFlags(_bot);
  const biomeHazards  = biom.getHazards(_bot);
  const biomeStrategy = {
    priorities: biom.getSurvivalPriorities(_bot).slice(0, 6),
    resources: biom.getResourceTargets(_bot),
    relocation: biom.getRelocationPlan(_bot),
  };

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
    biomeName,
    biomeCategory,
    biomeRisk,
    biomeHazards,
    biomeStrategy,
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
    biomeCategory, biomeRisk,
  } = situation;

  if (shouldAttemptDeathRecovery(_bot, _state.deathRecovery) && threatReport.level !== 'high') {
    actions.push({
      name: 'death_recovery',
      priority: PRIORITIES.flee + 1,
      maxDuration: 20000,
      execute: async () => {
        await handleDeathRecovery();
      },
    });
  }

  if (!inCombat && threatReport.level === 'none' && findRecoverableDrops(50).length > 0) {
    actions.push({
      name: 'collect_dropped_items',
      priority: PRIORITIES.gather + 1,
      maxDuration: 20000,
      execute: async () => {
        await collectNearbyDropsWithinRadius(50);
      },
    });
  }

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

  if (biomeRisk.needsShoreFirst && threatReport.level !== 'high') {
    actions.push({
      name: 'reach_shore',
      priority: PRIORITIES.swim - 2,
      maxDuration: 12000,
      execute: async () => {
        const result = await swimBrain.swimToSafety(_bot, { radius: 24 });
        log(`Shore-seeking: ${result.reason}`);
      },
    });
  }

  // ── 2. Flee — health critical AND hostile mob close ──
  if (health <= 6 && threatReport.closeThreats > 0) {
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
      ? PRIORITIES.flee - 1
      : PRIORITIES.combat;

    actions.push({
      name: 'combat',
      priority: combatPriority,
      maxDuration: 15000,
      execute: async () => {
        try { await craftBrain.ensureWeapon(_bot); } catch {}
        if (threatReport.level === 'high' && health <= 8) {
          await mineBrain.retreatFromThreats(_bot, threatReport);
          if (_bot.food <= 18) {
            await eatBrain.eat(_bot, { silent: true, force: true, threatLevel: threatReport.level });
          }
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
  if (isNight && !holdingTorch && !inCombat && threatReport.level === 'none' && health >= 12) {
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
  if (isNight && !inCombat && threatReport.level !== 'high') {
    actions.push({
      name: 'night_safety',
      priority: PRIORITIES.night_safety,
      maxDuration: 30000,
      execute: async () => {
        await handleNightSafety();
      },
    });
  }

  // ── 7. Normal hunger / Procurement ──
  if (food <= 14) {
    if (hasFood) {
      if (!_bot.autoEat) {
        actions.push({
          name: 'eat_normal',
          priority: PRIORITIES.eat_normal,
          maxDuration: 5000,
          execute: async () => {
            await eatBrain.eat(_bot, { silent: true, force: false });
          },
        });
      }
    } else {
      actions.push({
        name: 'procure_food',
        priority: PRIORITIES.eat_normal,
        maxDuration: 40000,
        execute: async () => {
          log('Out of food! Attempting to craft, cook, or hunt for food.');
          let craftResult = { success: false };
          try {
            craftResult = await craftBrain.craftFoodIfPossible(_bot, { silent: true });
          } catch {}
          if (craftResult.success) {
            log('Auto-crafted food during procurement.');
            await eatBrain.eat(_bot, { silent: false, force: false });
            return;
          }

          let cookResult = { success: false };
          try {
            cookResult = await cookController.cookBestFood(_bot);
          } catch {}
          if (cookResult.success) {
            log('Cooked raw food during procurement.');
            await eatBrain.eat(_bot, { silent: false, force: false });
            return;
          }

          try {
            const huntResult = await eatBrain.huntPassiveFood(_bot, { silent: false });
            if (huntResult.success) {
              if (threatReport.level === 'none') {
                try { await cookController.cookBestFood(_bot); } catch {}
              }
              await eatBrain.eat(_bot, { silent: false, force: false });
            }
          } catch (err) {
            log(`Food procurement hunt failed: ${err.message}`);
          }
        },
      });
    }
  }

  // ── 8. No tools — need to gather and craft ──
  if (!hasPickaxe && isDaytime && threatReport.level === 'none') {
    actions.push({
      name: 'craft_tools',
      priority: PRIORITIES.craft_tools,
      maxDuration: 120000, // needs time to wander + chop a tree
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

  // ── 10. Low resources (biome-aware) ──
  const biomeLogTypes = biom.getLogTypes(_bot);
  const logCount = craftBrain.countAnyOf(_bot, biomeLogTypes);
  const starterStock = hasStarterBuildMaterials();
  if (starterStock.ready && isDaytime && threatReport.level === 'none') {
    actions.push({
      name: 'starter_build',
      priority: PRIORITIES.upgrade + 2,
      maxDuration: 120000,
      execute: async () => {
        await handleStarterBuildOrCraft();
      },
    });
  }

  {
    const armorState = getArmorManagementState();
    if (armorState.shouldCraftArmor && isDaytime && threatReport.level === 'none') {
      actions.push({
        name: 'craft_armor',
        priority: PRIORITIES.upgrade + 1,
        maxDuration: 20000,
        execute: async () => {
          announce('craft_armor', 'Crafting and managing armor upgrades.', 20000);
          await craftBrain.ensureArmor(_bot).catch(() => {});
        },
      });
    }

    if (armorState.shouldCraftShield && threatReport.level !== 'high') {
      actions.push({
        name: 'craft_shield',
        priority: PRIORITIES.craft_tools + 1,
        maxDuration: 10000,
        execute: async () => {
          announce('craft_shield', 'Crafting a shield for safer combat.', 20000);
          await skills.craftItem(_bot, 'shield', 1);
          const shield = _bot.inventory.items().find(item => item.name === 'shield');
          if (shield) {
            try { await _bot.equip(shield, 'off-hand'); } catch {}
          }
        },
      });
    }
  }

  if (logCount < 10 && isDaytime && threatReport.level === 'none' && !isNight) {
    actions.push({
      name: 'gather_resources',
      priority: PRIORITIES.gather,
      maxDuration: 60000,
      execute: async () => {
        const plan = biom.getCurrentBiomePlan(_bot);
        announce('gather', `🪵 Gathering ${plan.logTypes[0] || 'wood'} for this biome...`, 20000);
        const result = await mineBrain.cutTreeSafely(_bot, _options, plan.logTypes);
        if (result.success) {
          await mineBrain.ensureProgression(_bot);
        } else if (result.reason === 'no tree found') {
          announce('gather_wander', `🌲 No ${plan.logTypes[0] || 'wood'} nearby — searching...`, 20000);
          const wander = await mineBrain.wanderToTree(_bot, _options, plan.logTypes);
          if (wander.success) {
            await mineBrain.cutTreeSafely(_bot, _options, plan.logTypes);
          } else if (biomeRisk.shouldRelocateForWood) {
            await relocateToBetterBiomeForWood();
          } else if (biom.needsSurfaceWood(_bot)) {
            const fallbackLogs = biom.getFallbackLogTypes(_bot);
            announce('gather_surface_fallback', `🌲 No native wood here — falling back to surface logs.`, 25000);
            const retry = await mineBrain.wanderToTree(_bot, _options, fallbackLogs);
            if (retry.success) {
              await mineBrain.cutTreeSafely(_bot, _options, fallbackLogs);
            }
          }
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
    const armorTypes = ['helmet', 'chestplate', 'leggings', 'boots'];
    const slotMap = { helmet: 5, chestplate: 6, leggings: 7, boots: 8 };
    const tierScore = { leather: 1, golden: 2, chainmail: 3, iron: 4, diamond: 5, netherite: 6 };
    const shouldUpgradeArmor = armorTypes.some(type => {
      const equipped = _bot.inventory.slots[slotMap[type]];
      const equippedTier = equipped ? (Object.keys(tierScore).find(t => equipped.name.startsWith(`${t}_`)) || '') : '';
      const equippedScore = tierScore[equippedTier] || 0;
      return _bot.inventory.items().some(item => {
        if (!item.name.endsWith(`_${type}`)) return false;
        const itemTier = Object.keys(tierScore).find(t => item.name.startsWith(`${t}_`)) || '';
        return (tierScore[itemTier] || 0) > equippedScore;
      });
    });

    if (shouldUpgradeArmor) {
      actions.push({
        name: 'equip_armor',
        priority: PRIORITIES.gather, // Low priority, quick action
        maxDuration: 5000,
        execute: async () => {
          await craftBrain.ensureArmor(_bot).catch(() => {});
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

  if (
    _bot.runAIAutonomy &&
    _bot.aiAutonomy?.enabled &&
    survivalScore >= 70 &&
    health >= 14 &&
    food >= 12 &&
    threatReport.level === 'none' &&
    !inCombat &&
    !isNight &&
    !isUnderwater &&
    !isDrowning
  ) {
    actions.push({
      name: 'ai_supervisor',
      priority: PRIORITIES.idle + 3,
      maxDuration: 45000,
      execute: async () => {
        announce('ai_supervisor', 'AI supervisor is choosing a safe autonomous goal.', 45000);
        const result = await _bot.runAIAutonomy({
          survivalScore,
          biomeCategory,
          biomeRisk,
          topPriorities: situation.biomeStrategy?.priorities?.slice(0, 3) || [],
          lastAction: _state.lastAction,
        });
        if (!result.success && result.reason !== 'cooldown') {
          log(`AI supervisor skipped: ${result.reason}`);
        }
      },
    });
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
  if (actions.length === 0 && threatReport.level === 'high') {
    actions.push({
      name: 'survive_high_threat',
      priority: PRIORITIES.flee,
      maxDuration: 10000,
      execute: async () => {
        await mineBrain.retreatFromThreats(_bot, threatReport);
        if (_bot.food <= 16 || _bot.health <= 10) {
          await eatBrain.eat(_bot, { silent: true, force: _bot.health <= 8, threatLevel: threatReport.level });
        }
      },
    });
  }

  return chooseActionWithRL(actions, situation);
}

// ─── Sub-actions (extracted from survive.js) ─────────────────────────────────

async function handleNightSafety() {
  const { goals } = require('mineflayer-pathfinder');
  const { Vec3 } = require('vec3');
  const { placeBlockAt } = require('../actions/building');

  if (_bot.isSleeping) return;

  // Detect biome — this drives all decisions below
  const biomePlan = biom.getCurrentBiomePlan(_bot);
  const bedSafe   = biom.canSleepInBed(_bot);

  // A. Try to find a nearby bed block to sleep (only if safe in this biome)
  if (bedSafe) {
    const bedBlock = world.getNearestBlock(_bot, block => block.name.endsWith('_bed'), 24);
    if (bedBlock) {
      const dist = _bot.entity.position.distanceTo(bedBlock.position);
      if (dist > 3) {
        try {
          await _bot.pathfinder.goto(new goals.GoalNear(bedBlock.position.x, bedBlock.position.y, bedBlock.position.z, 2.5));
        } catch {}
      } else {
        try {
          _bot.chat("🛏️ Going to sleep...");
          await _bot.sleep(bedBlock);
        } catch (err) {
          log(`Sleep failed: ${err.message}`);
        }
      }
      return;
    }

    // B. Place a bed if we have one (only safe in overworld)
    const bedItem = _bot.inventory.items().find(i => i.name.endsWith('_bed'));
    if (bedItem) {
      const ref = world.getNearestBlock(_bot, block =>
        ['grass_block', 'dirt', 'stone', 'cobblestone', 'oak_planks', 'spruce_planks', 'birch_planks'].includes(block.name), 4);
      if (ref) {
        _bot.chat("🛏️ Placing bed to sleep...");
        try {
          await _bot.equip(bedItem, 'hand');
          await _bot.placeBlock(ref, new Vec3(0, 1, 0));
        } catch (err) {
          log(`Placing bed failed: ${err.message}`);
        }
        return;
      }
    }
  } else {
    // Nether / End — warn if someone has a bed (it will explode!)
    const bedItem = _bot.inventory.items().find(i => i.name.endsWith('_bed'));
    if (bedItem) {
      announce('nether_bed_warn', `💥 NOT sleeping in ${biomePlan.name} — beds EXPLODE here! Building shelter instead.`, 60000);
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

  // D. Build emergency shelter using biome-appropriate block
  const blockToUse = biom.getShelterBlock(_bot);
  if (blockToUse) {
    const pos = _bot.entity.position.floored();
    _bot.chat(`🛡️ Building ${biomePlan.name} shelter using ${blockToUse}...`);

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

  // E. Fallback: mine the biome's common block for shelter material
  const fallbackBlock = biomePlan.stoneEquivalents?.[0]
    || biomePlan.commonBlocks?.[0]
    || (biomePlan.category === 'nether' ? 'netherrack' : 'dirt');
  const fallbackCount = craftBrain.countItem(_bot, fallbackBlock);
  if (fallbackCount < 15) {
    _bot.chat(`Mining some ${fallbackBlock} for emergency shelter...`);
    const result = await skills.mineBlock(_bot, fallbackBlock, 15);
    if (!result?.success) {
      const rerouted = await maybeRerouteAutonomyFromBlock('night_shelter_materials', {
        block: fallbackBlock,
        needed: 15,
        reason: result?.error || 'shelter_material_unavailable',
        mode: 'night_safety',
      });
      if (!rerouted) {
        throw new Error(`Shelter material mining failed: ${result?.error || fallbackBlock}`);
      }
    } else {
      clearAutonomyBlock('night_shelter_materials');
    }
  }
}

async function handleToolProgression() {
  // Get the current biome plan to know which logs to search for
  const biomePlan     = biom.getCurrentBiomePlan(_bot);
  const biomeLogTypes = biom.getLogTypes(_bot);
  const fallbackLogs  = biom.getFallbackLogTypes(_bot);

  const logCount   = craftBrain.countAnyOf(_bot, biomeLogTypes);
  const planks     = craftBrain.countAnyOf(_bot, craftBrain.PLANK_TYPES);
  const sticks     = craftBrain.countItem(_bot, 'stick');
  const table      = craftBrain.countItem(_bot, 'crafting_table');
  const progressionBlocks = biom.getProgressionBlocks(_bot);
  const coreBlock = biomePlan.stoneEquivalents?.[0] || progressionBlocks[0] || 'cobblestone';
  const cobble     = craftBrain.countAnyOf(_bot, progressionBlocks);
  const hasPickaxe = _bot.inventory.items().some(i => i.name.endsWith('_pickaxe'));

  // Step 1: Gather the biome-correct wood/stems if needed
  if (!hasPickaxe && logCount < 4 && planks < 4) {
    const primaryLog = biomeLogTypes[0] || 'logs';
    announce('tools', `No pickaxe — going to chop ${primaryLog}.`, 20000);
    let result = await mineBrain.cutTreeSafely(_bot, _options, biomeLogTypes);

    // If no tree/stem found nearby, actively explore to find one
    if (!result.success && result.reason === 'no tree found') {
      announce('tools_wander', `🌲 No ${primaryLog} nearby — exploring to find some...`, 20000);
      const wander = await mineBrain.wanderToTree(_bot, _options, biomeLogTypes);
      if (wander.success) {
        result = await mineBrain.cutTreeSafely(_bot, _options, biomeLogTypes);
      } else {
        announce('tools_wander_fail', `🌲 Could not find ${primaryLog} — trying secondary log types...`, 30000);
        const wander2 = await mineBrain.wanderToTree(_bot, _options, fallbackLogs);
        if (wander2.success) result = await mineBrain.cutTreeSafely(_bot, _options, fallbackLogs);
      }
    }

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
    announce('tools', `Mining ${coreBlock} to upgrade tools...`, 20000);
    const result = await skills.mineBlock(_bot, coreBlock, 8);
    if (!result?.success) {
      const rerouted = await maybeRerouteAutonomyFromBlock('tool_progression_mining', {
        block: coreBlock,
        needed: 8,
        reason: result?.error || 'tool_progression_blocked',
        mode: 'tool_progression',
      });
      if (!rerouted) {
        throw new Error(`Tool progression mining failed: ${result?.error || coreBlock}`);
      }
    } else {
      clearAutonomyBlock('tool_progression_mining');
    }
    return;
  }

  // Step 6: Craft stone tools
  if (pickaxe && cobble >= 11) {
    if (biomePlan.category === 'nether') {
      announce('tools', 'Upgrading to blackstone gear!', 15000);
      await skills.craftItem(_bot, 'stone_pickaxe', 1);
      await skills.craftItem(_bot, 'stone_sword', 1);
      await skills.craftItem(_bot, 'stone_axe', 1);
    } else {
      announce('tools', 'Upgrading to stone gear!', 15000);
      await skills.craftItem(_bot, 'stone_pickaxe', 1);
      await skills.craftItem(_bot, 'stone_sword', 1);
      await skills.craftItem(_bot, 'stone_axe', 1);
    }
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
        try { await digSafely(_bot, ceilingBlock, { requireDrops: true }); } catch {}
      }
      const wallBlock = _bot.blockAt(pos.offset(0, 1, -1));
      if (wallBlock && wallBlock.name !== 'air') {
        try { await digSafely(_bot, wallBlock, { requireDrops: true }); } catch {}
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
            await digSafely(_bot, furnaceBlock, { requireDrops: true });
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
  const timeSinceInteraction = Date.now() - (_bot.lastUserInteractionTime || 0);
  const isPlayerBusy = shouldTreatAsExternalActiveTask(_bot._currentTask);
  const isThinking = _bot.isThinking;

  if (timeSinceInteraction < 1000) {
    if (_state.surviveActive) {
      log('User activity detected. Deactivating autonomous mode.');
      _state.surviveActive = false;
      _bot.setControlState('jump', false);
      _bot.setControlState('sneak', false);
      _bot.setControlState('sprint', false);
      releaseLock();
    }
    return;
  }

  if (isPlayerBusy || isThinking) {
    return;
  }

  // Activate autonomous mode if not already
  if (!_state.surviveActive) {
    _state.surviveActive = true;
    const biomePlan = biom.getCurrentBiomePlan(_bot);
    announce('autonomy_on', "💤 Player is idle. Cortex engaging autonomous survival mode...", 30000);
    announce(`biome_tip:${biomePlan.category}`, biomePlan.survivalTip, 45000);
    log(`Autonomous mode activated. Biome: ${biomePlan.name}`);
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
    let action = selectAction(situation);
    if (!action) {
      await maybeAskCoreLLMForDirection('no_core_action', {
        reason: 'cortex_no_action_available',
        situationSummary: {
          survivalScore: situation.survivalScore,
          threat: situation.threatReport?.level,
          biome: situation.biomeCategory,
        },
      }, situation);
      return;
    }

    if (shouldKeepPersistentGoal() && action.name !== _state.persistentGoal && isMaintenanceAction(action.name)) {
      log(`Keeping persistent goal: ${_state.persistentGoal} (skip maintenance ${action.name})`);
      return;
    }

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
    rememberPersistentGoal(action);
    _bot._currentTask = `cortex:${action.name}`;

    let actionFailed = false;
    let failureReason = '';
    const snapshotBefore = rlCritic.takeSnapshot(_bot);
    try {
      await action.execute();
    } catch (err) {
      actionFailed = true;
      failureReason = err.message;
      log(`Action ${action.name} failed: ${err.message}`);
      if (shouldEscalateToLLM(err.message, situation)) {
        await maybeAskCoreLLMForDirection('core_action_failed', {
          action: action.name,
          reason: err.message,
        }, situation);
      }
    } finally {
      if (snapshotBefore) {
        const rlAction = rlEngine.mapCortexActionToRL(action.name);
        const evaluation = await rlCritic.recordExperience(_bot, `cortex_${action.name}`, snapshotBefore, !actionFailed, failureReason);
        const reward = evaluation?.reward || 0;
        _state.rlStats.totalSteps += 1;
        _state.rlStats.totalReward += reward;
        _state.rlStats.lastReward = reward;
        _state.rlStats.epsilon = rlEngine.recommendEpsilon(_state.rlStats.epsilon, _state.rlStats, reward);

        if (rlAction && _state.rlStats.lastState) {
          const nextState = rlEngine.discretizeState(_bot);
          rlEngine.updateQValue(_state.rlStats.lastState, rlAction, reward, nextState, {
            terminal: actionFailed && shouldEscalateToLLM(failureReason, situation),
          });
        }
      }
      markActionFinished(action, actionFailed);
      releaseLock(action.name);
      if (_bot._currentTask === `cortex:${action.name}`) {
        _bot._currentTask = null;
      }
      if (isMaintenanceAction(action.name)) {
        // Keep current long-term goal intact across background maintenance ticks.
      } else if (action.name === _state.persistentGoal && !shouldKeepPersistentGoal()) {
        clearPersistentGoal(action.name);
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
  return 3000;
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
  _state.lastActionAt = 0;
  _state.persistentGoal = null;
  _state.persistentSince = 0;
  _state.tickCount = 0;
  _state.surviveActive = false;
  _state.shelterPos = null;
  _state.furnacePos = null;
  _state.smeltingActive = false;
  _state.announcements = {};
  _state.actionCooldowns = {};
  _state.actionFailures = {};
  _state.rlStats = {
    epsilon: rlEngine.DEFAULT_EPSILON,
    totalSteps: 0,
    totalReward: 0,
    lastReward: 0,
    lastAdvice: null,
    lastState: null,
  };
  _state.autonomyBlocks = {};

  // Death snapshot listener
  _state._onDeath = () => {
    log('Bot died. Recording death snapshot.');
    _state.deathRecovery = {
      position: _bot.entity.position.clone(),
      lostItems: snapshotInventory(_bot),
      createdAt: Date.now(),
      attempts: 0,
      done: false,
    };
  };
  bot.on('death', _state._onDeath);

  // Start quickly after spawn, then continue on the normal tick loop.
  setTimeout(() => {
    if (_running) {
      cortexTick().catch(err => warn(`Initial tick error: ${err.message}`));
    }
  }, 1000);
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
  const biomePlan = _bot ? biom.getCurrentBiomePlan(_bot) : null;
  return {
    running: _running,
    surviveActive: _state.surviveActive,
    survivalScore: _state.lastSurvivalScore,
    lastAction: _state.lastAction,
    tickCount: _state.tickCount,
    currentLock: currentLock(),
    tickInterval: getTickInterval(),
    persistentGoal: _state.persistentGoal,
    cooldowns: { ..._state.actionCooldowns },
    failures: { ..._state.actionFailures },
    autonomyBlocks: { ..._state.autonomyBlocks },
    rlStats: { ..._state.rlStats },
    aiAutonomy: _bot?.aiAutonomy ? { ..._bot.aiAutonomy } : null,
    biome: biomePlan ? {
      name: biomePlan.name,
      category: biomePlan.category,
      hazards: biom.getHazards(_bot),
      topPriorities: biom.getSurvivalPriorities(_bot).slice(0, 3),
      relocation: biom.getRelocationPlan(_bot),
    } : null,
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
