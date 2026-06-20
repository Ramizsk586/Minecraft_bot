// Brain: Defance Module
// Watches for damage, identifies likely attackers, and triggers the local
// combat brain immediately without any LLM usage.

const attackBrain = require('./attack');
const libraryData = require('../library/data');

let _defanceState = null;
const DEFANCE_TRIGGER_COOLDOWN_MS = 2500;

function isLikelyThreat(bot, entity, options = {}) {
  if (!attackBrain.isAttackableEntity(bot, entity, options)) return false;

  if (entity.type === 'player') return true;

  const name = entity.name || '';
  const info = libraryData.getMobInfo(name);
  if (!info) return false;
  return info.type === 'hostile' || (info.type === 'neutral' && info.threat >= 4);
}

function findNearestThreat(bot, options = {}) {
  return bot.nearestEntity(entity => {
    if (!isLikelyThreat(bot, entity, options)) return false;
    return entity.position.distanceTo(bot.entity.position) <= 16;
  });
}

function selectAttacker(bot, source, options = {}) {
  if (source && isLikelyThreat(bot, source, options)) {
    return source;
  }

  if (_defanceState?.lastAttacker?.isValid) {
    return _defanceState.lastAttacker;
  }

  return findNearestThreat(bot, options);
}

async function handleIncomingAttack(bot, source, options = {}) {
  if (!_defanceState?.enabled) return;

  const attacker = selectAttacker(bot, source, options);
  if (!attacker) return;

  const now = Date.now();
  const sameAttacker = _defanceState.lastAttacker?.id === attacker.id;
  const recentlyHandled = now - (_defanceState.lastHandledAt || 0) < DEFANCE_TRIGGER_COOLDOWN_MS;

  if (sameAttacker && recentlyHandled) {
    return;
  }

  _defanceState.lastAttacker = attacker;
  _defanceState.lastHitAt = Date.now();
  _defanceState.lastHandledAt = now;

  // Signal the cortex so it doesn't start a conflicting action during combat
  try {
    const cortex = require('./cortex');
    cortex.signalExternalAction('defance_combat', 75, 15000);
  } catch {}

  // Auto-craft weapon if we don't have one
  try {
    const craftBrain = require('./craft');
    await craftBrain.ensureWeapon(bot);
  } catch (err) {
    console.log('Brain:Defance craft-weapon failed: ' + err.message);
  }

  // Auto-equip armor
  try {
    const craftBrain = require('./craft');
    await craftBrain.ensureArmor(bot);
  } catch (err) {
    console.log('Brain:Defance equip-armor failed: ' + err.message);
  }

  // Eat if low on food
  if (bot.food <= 10) {
    try {
      const eatBrain = require('./eat');
      await eatBrain.eat(bot, { silent: true, force: false });
    } catch {}
  }

  await attackBrain.startAttack(bot, attacker, options);

  // Release the cortex lock after combat finishes
  try {
    const cortex = require('./cortex');
    cortex.releaseExternalAction('defance_combat');
  } catch {}
}

function onHealth(bot, options = {}) {
  if (!_defanceState?.enabled) return;

  const previousHealth = _defanceState.lastHealth;
  _defanceState.lastHealth = bot.health;

  if (previousHealth == null) return;
  if (bot.health >= previousHealth) return;

  handleIncomingAttack(bot, null, options).catch(err => {
    console.log(`Brain:Defance health handler error: ${err.message}`);
  });
}

function onEntityHurt(bot, entity, source, options = {}) {
  if (!_defanceState?.enabled) return;
  if (!entity || entity.id !== bot.entity.id) return;

  handleIncomingAttack(bot, source, options).catch(err => {
    console.log(`Brain:Defance hurt handler error: ${err.message}`);
  });
}

function onEntityGone(bot, entity) {
  if (!_defanceState?.enabled) return;
  if (!entity || !bot._combatState?.target) return;
  if (bot._combatState.target.id !== entity.id) return;

  // Check if there are other nearby threats before finishing (e.g. slimes split)
  const nextTarget = attackBrain.findNearbyHostile ? attackBrain.findNearbyHostile(bot, 16) : null;
  if (nextTarget) {
    console.log(`[Defance] Target entity ${entity.name} is gone. Switching to next threat: ${nextTarget.name}`);
    bot._combatState.target = nextTarget;
    bot._combatState.enemyName = attackBrain.describeEntity(nextTarget);
    bot._combatState.lastSeenAt = Date.now();
    return;
  }

  attackBrain.stopAttack(bot, { reason: 'finish' });
}

function startAutoDefance(bot, options = {}) {
  stopAutoDefance(bot);

  _defanceState = {
    enabled: true,
    lastHealth: bot.health,
    lastHitAt: 0,
    lastHandledAt: 0,
    lastAttacker: null,
    options,
    onHealth: () => onHealth(bot, options),
    onEntityHurt: (entity, source) => onEntityHurt(bot, entity, source, options),
    onEntityGone: entity => onEntityGone(bot, entity),
    onDeath: () => attackBrain.stopAttack(bot, { silent: true }),
  };

  bot.on('health', _defanceState.onHealth);
  bot.on('entityHurt', _defanceState.onEntityHurt);
  bot.on('entityGone', _defanceState.onEntityGone);
  bot.on('death', _defanceState.onDeath);

  console.log('Brain:Defance auto-defense monitor started');
}

function stopAutoDefance(bot) {
  if (!_defanceState) return;

  bot.off('health', _defanceState.onHealth);
  bot.off('entityHurt', _defanceState.onEntityHurt);
  bot.off('entityGone', _defanceState.onEntityGone);
  bot.off('death', _defanceState.onDeath);

  attackBrain.stopAttack(bot, { silent: true });
  _defanceState = null;
}

function defanceReport(bot) {
  const lines = attackBrain.combatReport(bot);
  const enabled = _defanceState?.enabled ? 'ON' : 'OFF';
  lines.splice(1, 0, `Auto-defance: ${enabled}`);
  return lines;
}

module.exports = {
  startAutoDefance,
  stopAutoDefance,
  defanceReport,
  handleIncomingAttack,
  findNearestThreat,
};
