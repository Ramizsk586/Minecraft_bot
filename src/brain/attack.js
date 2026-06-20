// Brain: Attack Module
// Instant, LLM-free combat logic. Scans inventory, scores weapons, equips the
// strongest option, and drives melee/ranged attacks without AI calls.

const { sleep, findBestTool } = require('../utils');

const ATTACK_TICK_MS = 550;
const TAUNT_COOLDOWN_MS = 4500;
const COMBAT_TIMEOUT_MS = 20000;
const COMBAT_CHAT_COOLDOWN_MS = 3000;

const HOSTILE_MOBS = [
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'drowned',
  'husk', 'phantom', 'pillager', 'vindicator', 'piglin', 'piglin_brute',
  'enderman', 'slime', 'magma_cube', 'blaze', 'witch', 'warden', 'ravager',
  'ghast', 'shulker', 'silverfish', 'endermite', 'hoglin', 'wither_skeleton'
];

const PASSABLE_BLOCKS = new Set([
  'air', 'cave_air', 'void_air', 'water', 'lava',
  'short_grass', 'tall_grass', 'fern', 'large_fern',
  'vine', 'glow_lichen', 'snow', 'torch', 'wall_torch',
]);

function findNearbyHostile(bot, maxDistance = 16) {
  return bot.nearestEntity(entity => {
    if (!entity || !entity.isValid || entity.id === bot.entity.id) return false;
    if (entity.type === 'object') return false;
    if (entity.name === 'item' || entity.name === 'xp_orb') return false;
    
    const name = entity.name || '';
    if (HOSTILE_MOBS.includes(name)) {
      return entity.position.distanceTo(bot.entity.position) <= maxDistance;
    }
    return false;
  });
}

const WEAPON_DB = {
  netherite_sword: { damage: 8, speed: 1.6, range: 'melee', priority: 10 },
  diamond_sword: { damage: 7, speed: 1.6, range: 'melee', priority: 9 },
  iron_sword: { damage: 6, speed: 1.6, range: 'melee', priority: 8 },
  stone_sword: { damage: 5, speed: 1.6, range: 'melee', priority: 7 },
  golden_sword: { damage: 4, speed: 1.6, range: 'melee', priority: 6 },
  wooden_sword: { damage: 4, speed: 1.6, range: 'melee', priority: 5 },
  netherite_axe: { damage: 10, speed: 1.0, range: 'melee', priority: 8 },
  diamond_axe: { damage: 9, speed: 1.0, range: 'melee', priority: 7 },
  iron_axe: { damage: 9, speed: 0.9, range: 'melee', priority: 6 },
  stone_axe: { damage: 9, speed: 0.8, range: 'melee', priority: 5 },
  golden_axe: { damage: 7, speed: 1.0, range: 'melee', priority: 4 },
  wooden_axe: { damage: 7, speed: 0.8, range: 'melee', priority: 3 },
  trident: { damage: 9, speed: 1.1, range: 'melee', priority: 7 },
  bow: { damage: 6, speed: 1.0, range: 'ranged', priority: 4, needsAmmo: 'arrow' },
  crossbow: { damage: 9, speed: 0.8, range: 'ranged', priority: 5, needsAmmo: 'arrow' },
};

const TOOL_FALLBACKS = {
  netherite_pickaxe: { damage: 6, speed: 1.2, range: 'melee', priority: 2 },
  diamond_pickaxe: { damage: 5, speed: 1.2, range: 'melee', priority: 2 },
  iron_pickaxe: { damage: 4, speed: 1.2, range: 'melee', priority: 1 },
  stone_pickaxe: { damage: 3, speed: 1.2, range: 'melee', priority: 1 },
  wooden_pickaxe: { damage: 2, speed: 1.2, range: 'melee', priority: 0 },
  netherite_shovel: { damage: 5.5, speed: 1.0, range: 'melee', priority: 1 },
  diamond_shovel: { damage: 4.5, speed: 1.0, range: 'melee', priority: 1 },
  iron_shovel: { damage: 3.5, speed: 1.0, range: 'melee', priority: 0 },
};

const WEAPON_SAYINGS = {
  opening: [
    'You picked the wrong fight, {enemy}.',
    '{enemy}, I am switching to combat mode.',
    'Defense online. Target locked: {enemy}.',
    '{enemy}, back away or get deleted.',
  ],
  pressure: [
    'Still standing, {enemy}? Not for long.',
    '{enemy}, your health bar is looking nervous.',
    'I have better aim than your plan, {enemy}.',
    '{enemy}, this is what local combat logic looks like.',
  ],
  lowHealth: [
    'I am hurt, {enemy}, but I am not done.',
    '{enemy}, that hit only made me serious.',
    'Critical health, maximum anger. Come here, {enemy}.',
  ],
  finish: [
    'Fight over, {enemy}.',
    '{enemy}, that was the last bad idea.',
    'Target neutralized: {enemy}.',
  ],
  retreat: [
    '{enemy}, enjoy the space while it lasts.',
    'Resetting position. This round is not over, {enemy}.',
  ],
};

function getWeaponData(itemName) {
  return WEAPON_DB[itemName] || TOOL_FALLBACKS[itemName] || null;
}

function hasAmmo(bot, ammoName) {
  return bot.inventory.items().some(item => item.name === ammoName && item.count > 0);
}

function calculateWeaponScore(bot, item) {
  const data = getWeaponData(item.name);
  if (!data) return -1;
  if (data.needsAmmo && !hasAmmo(bot, data.needsAmmo)) return -1;

  const durabilityLeft = item.maxDurability && item.durabilityUsed != null
    ? (item.maxDurability - item.durabilityUsed) / item.maxDurability
    : 1;
  const durabilityBonus = 0.5 + (durabilityLeft * 0.5);
  const attackValue = data.damage * (data.speed || 1);
  const stackPenalty = item.count > 1 ? 0.9 : 1;

  return ((attackValue * 2) + data.priority) * durabilityBonus * stackPenalty;
}

function rankWeapons(bot) {
  const ranked = [];

  for (const item of bot.inventory.items()) {
    const data = getWeaponData(item.name);
    if (!data) continue;

    const score = calculateWeaponScore(bot, item);
    if (score <= 0) continue;

    const durabilityText = item.maxDurability && item.durabilityUsed != null
      ? `${item.maxDurability - item.durabilityUsed}/${item.maxDurability} durability`
      : 'full readiness';

    ranked.push({
      item,
      weaponData: data,
      score,
      reason: `${data.damage} dmg ${data.range} | ${durabilityText}`,
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

function pickBestWeapon(bot) {
  const ranked = rankWeapons(bot);
  return ranked.length > 0 ? ranked[0] : null;
}

async function equipBestWeapon(bot) {
  const best = pickBestWeapon(bot);
  if (!best) return null;

  if (bot.heldItem && bot.heldItem.slot === best.item.slot) {
    return best;
  }

  await bot.equip(best.item, 'hand');
  return best;
}

function describeEntity(entity) {
  return entity?.username || entity?.displayName?.toString?.() || entity?.name || 'enemy';
}

function isAttackableEntity(bot, entity, options = {}) {
  if (!entity || !entity.isValid || entity.id === bot.entity.id) return false;
  if (entity.type === 'object') return false;
  if (entity.name === 'item' || entity.name === 'xp_orb') return false;

  const owner = options.owner?.toLowerCase();
  if (owner && entity.username?.toLowerCase() === owner) return false;

  return true;
}

function pickFightLine(bucket, enemyName) {
  const lines = WEAPON_SAYINGS[bucket] || WEAPON_SAYINGS.pressure;
  const line = lines[Math.floor(Math.random() * lines.length)];
  return line.replace(/\{enemy\}/g, enemyName);
}

function canSendCombatLine(bot, key, cooldownMs = COMBAT_CHAT_COOLDOWN_MS) {
  if (!bot._combatChatState) {
    bot._combatChatState = {};
  }

  const now = Date.now();
  const lastAt = bot._combatChatState[key] || 0;
  if (now - lastAt < cooldownMs) return false;
  bot._combatChatState[key] = now;
  return true;
}

function sendCombatLine(bot, key, message, cooldownMs = COMBAT_CHAT_COOLDOWN_MS) {
  if (!message) return false;
  if (!canSendCombatLine(bot, key, cooldownMs)) return false;
  bot.chat(message);
  return true;
}

function clearCombatState(bot) {
  if (!bot._combatState) return;

  if (bot._combatState.attackTimer) {
    clearInterval(bot._combatState.attackTimer);
  }
  if (bot._combatState.timeoutTimer) {
    clearTimeout(bot._combatState.timeoutTimer);
  }

  bot.deactivateItem?.();
  stopMovement(bot);
  bot._combatState = null;
}

function stopMovement(bot) {
  bot.clearControlStates();
}

function isPassableCombatBlock(block) {
  if (!block) return true;
  if (PASSABLE_BLOCKS.has(block.name)) return true;
  return !!block.boundingBox && block.boundingBox !== 'block';
}

function sampleLine(bot, from, to, steps = 8) {
  const points = [];
  const dx = (to.x - from.x) / steps;
  const dy = (to.y - from.y) / steps;
  const dz = (to.z - from.z) / steps;

  for (let i = 1; i < steps; i++) {
    points.push(from.offset(dx * i, dy * i, dz * i));
  }
  return points;
}

function findCombatObstacle(bot, target) {
  const botBase = bot.entity.position;
  const targetBase = target.position;
  const fromPoints = [
    botBase.offset(0, 1.6, 0),
    botBase.offset(0, 1.1, 0),
  ];
  const toPoints = [
    targetBase.offset(0, 1.2, 0),
    targetBase.offset(0, 0.6, 0),
  ];

  for (const from of fromPoints) {
    for (const to of toPoints) {
      const distance = from.distanceTo(to);
      const steps = Math.max(6, Math.min(14, Math.ceil(distance * 2)));
      for (const point of sampleLine(bot, from, to, steps)) {
        const block = bot.blockAt(point.floored());
        if (!isPassableCombatBlock(block)) {
          return block;
        }
      }
    }
  }

  return null;
}

function getDigCandidates(bot, target, obstacle) {
  const candidates = [];
  if (obstacle) candidates.push(obstacle.position);

  const botPos = bot.entity.position.floored();
  const targetPos = target.position.floored();
  const dx = Math.sign(targetPos.x - botPos.x);
  const dy = Math.sign(targetPos.y - botPos.y);
  const dz = Math.sign(targetPos.z - botPos.z);
  const front = botPos.offset(dx, 0, dz);

  if (dy > 0) {
    candidates.push(front.offset(0, 1, 0));
    candidates.push(botPos.offset(0, 2, 0));
  } else if (dy < 0) {
    candidates.push(front.offset(0, -1, 0));
    candidates.push(botPos.offset(0, -1, 0));
  }

  candidates.push(front);
  candidates.push(front.offset(0, 1, 0));
  candidates.push(botPos.offset(0, 1, 0));

  const seen = new Set();
  return candidates.filter(pos => {
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function digTowardTarget(bot, target, state) {
  const obstacle = findCombatObstacle(bot, target);
  if (!obstacle && Math.abs(target.position.y - bot.entity.position.y) < 1.2) {
    return false;
  }

  const now = Date.now();
  if (state.lastDigAt && now - state.lastDigAt < 700) {
    return true;
  }

  const candidates = getDigCandidates(bot, target, obstacle)
    .map(pos => bot.blockAt(pos))
    .filter(block => block && !isPassableCombatBlock(block) && block.name !== 'bedrock' && bot.canDigBlock(block));

  if (candidates.length === 0) {
    return false;
  }

  const block = candidates[0];
  const tool = findBestTool(bot, block.name);
  state.isDiggingPath = true;
  state.lastDigAt = now;
  stopMovement(bot);

  try {
    if (tool) {
      await bot.equip(tool, 'hand').catch(() => {});
    }
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
    await bot.dig(block, true);
    await sleep(120);
    return true;
  } catch (err) {
    if (!/digging aborted|goal was changed/i.test(err.message || '')) {
      console.log(`[Combat] Tunnel dig failed on ${block.name}: ${err.message}`);
    }
    return false;
  } finally {
    state.isDiggingPath = false;
  }
}

function approachTarget(bot, target, distance, state) {
  if (distance <= 2.8) {
    bot.setControlState('forward', false);
    bot.setControlState('sprint', false);
    
    // Circle/strafe the target when in close range (dodge attacks)
    if (state) {
      if (!state.lastStrafeSwitch || Date.now() - state.lastStrafeSwitch > 1200) {
        state.strafeDir = state.strafeDir === 'left' ? 'right' : 'left';
        state.lastStrafeSwitch = Date.now();
      }
      bot.setControlState(state.strafeDir, true);
      bot.setControlState(state.strafeDir === 'left' ? 'right' : 'left', false);
    }
    
    // Jump occasionally when close to hit critical hits
    const verticalGap = target.position.y - bot.entity.position.y;
    bot.setControlState('jump', verticalGap > 0.6 || (distance < 2.0 && bot.entity.onGround && Math.random() < 0.35));
    return;
  }

  // Clear strafe controls when approaching
  bot.setControlState('left', false);
  bot.setControlState('right', false);

  bot.setControlState('forward', true);
  bot.setControlState('sprint', distance > 4);

  const verticalGap = target.position.y - bot.entity.position.y;
  bot.setControlState('jump', verticalGap > 0.6 || distance < 1.8);
}

function canUseRanged(bot, weaponData, distance) {
  if (!weaponData || weaponData.range !== 'ranged') return false;
  if (distance < 6 || distance > 24) return false;
  if (weaponData.needsAmmo && !hasAmmo(bot, weaponData.needsAmmo)) return false;
  return true;
}

async function fireRanged(bot, target, weaponData) {
  try {
    await bot.lookAt(target.position.offset(0, 1.3, 0), true);
  } catch {}

  bot.activateItem();
  const drawTicks = weaponData.range === 'ranged' ? 18 : 12;
  await bot.waitForTicks(drawTicks);
  bot.deactivateItem();
}

async function strikeMelee(bot, target) {
  try {
    await bot.lookAt(target.position.offset(0, 1.0, 0), true);
  } catch {}

  bot.attack(target);
}

async function startAttack(bot, target, options = {}) {
  if (!isAttackableEntity(bot, target, options)) {
    return { started: false, reason: 'invalid target' };
  }

  const combatToken = bot.brainCoordinator?.acquire('combat', bot.brainPriorities?.combat || 80, COMBAT_TIMEOUT_MS + 5000);
  if (bot.brainCoordinator && !combatToken) {
    return { started: false, reason: 'brain busy with higher priority task' };
  }

  if (bot._combatState?.target?.id === target.id) {
    bot._combatState.lastSeenAt = Date.now();
    if (combatToken) {
      bot.brainCoordinator?.release('combat', combatToken);
    }
    return { started: true, reason: 'already attacking' };
  }

  stopAttack(bot, { silent: true });

  const best = await equipBestWeapon(bot).catch(() => null);

  // Auto-equip shield to off-hand if we have one
  const shield = bot.inventory.items().find(i => i.name === 'shield');
  if (shield) {
    try {
      await bot.equip(shield, 'off-hand');
    } catch {}
  }

  const enemyName = describeEntity(target);
  const combatState = {
    target,
    enemyName,
    startedAt: Date.now(),
    lastSeenAt: Date.now(),
    lastTauntAt: 0,
    lastDigAt: 0,
    isDiggingPath: false,
    mode: best?.weaponData?.range || 'melee',
    attackTimer: null,
    timeoutTimer: null,
    strafeDir: 'left',
    lastStrafeSwitch: 0,
    coordinatorToken: combatToken || null,
  };

  bot._combatState = combatState;
  sendCombatLine(bot, `opening:${enemyName}`, pickFightLine('opening', enemyName), 5000);

  let currentTarget = target;

  async function tick() {
    const state = bot._combatState;
    if (!state || state.target.id !== currentTarget.id) return;

    // Check target validity (slime splitting support)
    if (!state.target || !state.target.isValid) {
      const nextTarget = findNearbyHostile(bot, 16);
      if (nextTarget) {
        console.log(`[Combat] Target invalid/died. Switching to next nearby threat: ${nextTarget.name}`);
        state.target = nextTarget;
        state.enemyName = describeEntity(nextTarget);
        state.lastSeenAt = Date.now();
        currentTarget = nextTarget;
      } else {
        stopAttack(bot, { reason: 'finish' });
        return;
      }
    }

    const activeTarget = state.target;

    // Low-health retreat logic
    if (bot.health <= 7) {
      sendCombatLine(bot, 'retreat:low_health', 'Low health. Falling back to recover.', 6000);
      const enemyPos = activeTarget.position.clone();
      stopAttack(bot, { reason: 'retreat' });

      // Calculate opposite direction vector to sprint away
      const diff = bot.entity.position.subtract(enemyPos);
      diff.y = 0;
      const retreatDir = diff.normalize().scale(10);
      const retreatPos = bot.entity.position.plus(retreatDir);

      try {
        const { GoalNear } = require('mineflayer-pathfinder').goals;
        await bot.pathfinder.goto(new GoalNear(retreatPos.x, retreatPos.y, retreatPos.z, 2));
        // Force eat to regenerate health
        const eatBrain = require('./eat');
        await eatBrain.eat(bot, { silent: false, force: true });
      } catch (err) {
        console.log('[Combat] Retreat pathfind failed:', err.message);
      }
      return;
    }

    state.lastSeenAt = Date.now();

    const distance = bot.entity.position.distanceTo(activeTarget.position);
    const weapon = await equipBestWeapon(bot).catch(() => null);
    const weaponData = weapon?.weaponData || null;
    const obstacle = findCombatObstacle(bot, activeTarget);

    if (state.isDiggingPath) {
      return;
    }

    if (obstacle && distance <= 6) {
      const tunneled = await digTowardTarget(bot, activeTarget, state).catch(() => false);
      if (tunneled) {
        return;
      }
    }

    approachTarget(bot, activeTarget, distance, state);

    // Active shield usage against skeletons
    if (activeTarget.name === 'skeleton' && distance > 5 && distance < 15 && shield) {
      bot.activateItem('off-hand');
      await sleep(350);
      bot.deactivateItem('off-hand');
    }

    if (!weaponData) {
      if (Date.now() - state.lastTauntAt > TAUNT_COOLDOWN_MS) {
        sendCombatLine(bot, `fists:${state.enemyName}`, `No weapon ready, ${state.enemyName}. Still fighting.`, TAUNT_COOLDOWN_MS);
        state.lastTauntAt = Date.now();
      }
      await strikeMelee(bot, activeTarget).catch(() => {});
      return;
    }

    state.mode = weaponData.range;

    try {
      await bot.lookAt(activeTarget.position.offset(0, 1.0, 0), true);
    } catch {}

    if (canUseRanged(bot, weaponData, distance)) {
      bot.setControlState('forward', false);
      bot.setControlState('sprint', false);
      await fireRanged(bot, activeTarget, weaponData).catch(() => strikeMelee(bot, activeTarget).catch(() => {}));
    } else {
      if (obstacle && distance <= 4.5) {
        const tunneled = await digTowardTarget(bot, activeTarget, state).catch(() => false);
        if (tunneled) return;
      }
      await strikeMelee(bot, activeTarget).catch(() => {});
    }

    if (Date.now() - state.lastTauntAt > TAUNT_COOLDOWN_MS) {
      const bucket = bot.health <= 8 ? 'lowHealth' : 'pressure';
      sendCombatLine(bot, `${bucket}:${state.enemyName}`, pickFightLine(bucket, state.enemyName), TAUNT_COOLDOWN_MS);
      state.lastTauntAt = Date.now();
    }
  }

  combatState.attackTimer = setInterval(() => {
    tick().catch(err => {
      console.log(`Brain:Attack tick error: ${err.message}`);
    });
  }, ATTACK_TICK_MS);

  combatState.timeoutTimer = setTimeout(() => {
    if (bot._combatState?.target?.id === target.id) {
      stopAttack(bot, { reason: 'retreat' });
    }
  }, COMBAT_TIMEOUT_MS);

  await tick().catch(() => {});
  console.log(`Brain:Attack engaged ${enemyName}`);
  return { started: true, reason: 'engaged', weapon: best?.item?.name || null };
}

function stopAttack(bot, options = {}) {
  const state = bot._combatState;
  if (!state) return false;

  const enemyName = state.enemyName;
  const token = state.coordinatorToken || null;
  clearCombatState(bot);
  if (token) {
    bot.brainCoordinator?.release('combat', token);
  }

  if (!options.silent) {
    const bucket = options.reason === 'finish' ? 'finish' : options.reason === 'retreat' ? 'retreat' : null;
    if (bucket) {
      sendCombatLine(bot, `${bucket}:${enemyName}`, pickFightLine(bucket, enemyName), 3500);
    }
  }

  return true;
}

function combatReport(bot) {
  const lines = [];
  const ranked = rankWeapons(bot);
  const active = bot._combatState;

  lines.push(`Combat Report | Health: ${bot.health}/20 | Food: ${bot.food}/20`);

  if (active?.target?.isValid) {
    const distance = bot.entity.position.distanceTo(active.target.position).toFixed(1);
    lines.push(`Fighting: ${active.enemyName} | Distance: ${distance} | Mode: ${active.mode}`);
  } else {
    lines.push('Fighting: no active target');
  }

  if (ranked.length === 0) {
    lines.push('No weapons found. Fallback: fists.');
    return lines;
  }

  const top = ranked.slice(0, 3)
    .map(entry => `${entry.item.name} x${entry.item.count} (${entry.reason})`)
    .join(', ');
  lines.push(`Top weapons: ${top}`);
  lines.push(`Best weapon: ${ranked[0].item.name}`);
  return lines;
}

module.exports = {
  WEAPON_DB,
  TOOL_FALLBACKS,
  calculateWeaponScore,
  rankWeapons,
  pickBestWeapon,
  equipBestWeapon,
  startAttack,
  stopAttack,
  combatReport,
  isAttackableEntity,
  describeEntity,
  findNearbyHostile,
};
