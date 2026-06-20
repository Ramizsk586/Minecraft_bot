// Brain: Attack Module
// Instant, LLM-free combat logic. Scans inventory, scores weapons, equips the
// strongest option, and drives melee/ranged attacks without AI calls.

const ATTACK_TICK_MS = 550;
const TAUNT_COOLDOWN_MS = 4500;
const COMBAT_TIMEOUT_MS = 20000;

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

function approachTarget(bot, target, distance) {
  if (distance <= 2.8) {
    bot.setControlState('forward', false);
    bot.setControlState('sprint', false);
    bot.setControlState('jump', false);
    return;
  }

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

  if (bot._combatState?.target?.id === target.id) {
    bot._combatState.lastSeenAt = Date.now();
    return { started: true, reason: 'already attacking' };
  }

  stopAttack(bot, { silent: true });

  const best = await equipBestWeapon(bot).catch(() => null);
  const enemyName = describeEntity(target);
  const combatState = {
    target,
    enemyName,
    startedAt: Date.now(),
    lastSeenAt: Date.now(),
    lastTauntAt: 0,
    mode: best?.weaponData?.range || 'melee',
    attackTimer: null,
    timeoutTimer: null,
  };

  bot._combatState = combatState;
  bot.chat(pickFightLine('opening', enemyName));

  async function tick() {
    const state = bot._combatState;
    if (!state || state.target.id !== target.id) return;

    if (!target.isValid) {
      stopAttack(bot, { reason: 'finish' });
      return;
    }

    state.lastSeenAt = Date.now();

    const distance = bot.entity.position.distanceTo(target.position);
    const weapon = await equipBestWeapon(bot).catch(() => null);
    const weaponData = weapon?.weaponData || null;

    approachTarget(bot, target, distance);

    if (!weaponData) {
      if (Date.now() - state.lastTauntAt > TAUNT_COOLDOWN_MS) {
        bot.chat(`Fists only, ${state.enemyName}. You still lose.`);
        state.lastTauntAt = Date.now();
      }
      await strikeMelee(bot, target).catch(() => {});
      return;
    }

    state.mode = weaponData.range;

    try {
      await bot.lookAt(target.position.offset(0, 1.0, 0), true);
    } catch {}

    if (canUseRanged(bot, weaponData, distance)) {
      bot.setControlState('forward', false);
      bot.setControlState('sprint', false);
      await fireRanged(bot, target, weaponData).catch(() => strikeMelee(bot, target).catch(() => {}));
    } else {
      await strikeMelee(bot, target).catch(() => {});
    }

    if (Date.now() - state.lastTauntAt > TAUNT_COOLDOWN_MS) {
      const bucket = bot.health <= 8 ? 'lowHealth' : 'pressure';
      bot.chat(pickFightLine(bucket, state.enemyName));
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
  clearCombatState(bot);

  if (!options.silent) {
    const bucket = options.reason === 'finish' ? 'finish' : options.reason === 'retreat' ? 'retreat' : null;
    if (bucket) {
      bot.chat(pickFightLine(bucket, enemyName));
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
};
