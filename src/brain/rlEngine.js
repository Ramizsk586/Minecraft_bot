const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '../../memory_db');
const Q_TABLE_PATH = path.join(DB_DIR, 'q_table.json');

const ALPHA = 0.2;
const GAMMA = 0.9;
const DEFAULT_EPSILON = 0.15;
const MIN_EPSILON = 0.03;
const EPSILON_DECAY = 0.995;

const ACTIONS = [
  'idle',
  'eat',
  'fight',
  'flee',
  'gather_wood',
  'mine_stone',
  'craft_gear'
];

const CORTEX_ACTION_MAP = {
  idle: 'idle',
  eat_normal: 'eat',
  eat_emergency: 'eat',
  eat_critical: 'eat',
  procure_food: 'eat',
  combat: 'fight',
  flee_and_eat: 'flee',
  survive_high_threat: 'flee',
  gather_resources: 'gather_wood',
  craft_tools: 'craft_gear',
  upgrade_tools: 'craft_gear',
};

const HOSTILE_NAMES = ['zombie', 'skeleton', 'creeper', 'spider', 'witch', 'slime', 'drowned', 'husk', 'enderman', 'phantom'];

let qTable = {};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function loadQTable() {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    if (fs.existsSync(Q_TABLE_PATH)) {
      const data = fs.readFileSync(Q_TABLE_PATH, 'utf8');
      qTable = JSON.parse(data);
      console.log(`[RL Engine] Loaded Q-Table with ${Object.keys(qTable).length} states.`);
    } else {
      qTable = {};
      console.log('[RL Engine] No existing Q-Table found. Initializing empty.');
    }
  } catch (err) {
    console.error('[RL Engine] Failed to load Q-Table:', err);
    qTable = {};
  }
}

function saveQTable() {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    fs.writeFileSync(Q_TABLE_PATH, JSON.stringify(qTable, null, 2), 'utf8');
  } catch (err) {
    console.error('[RL Engine] Failed to save Q-Table:', err);
  }
}

function countItems(bot, itemNames) {
  if (!bot?.inventory) return 0;
  return bot.inventory.items()
    .filter(item => itemNames.some(name => item.name.includes(name)))
    .reduce((sum, item) => sum + item.count, 0);
}

function hasItem(bot, matcher) {
  return !!bot?.inventory?.items().some(item => matcher(item.name, item));
}

function hasEdibleFood(bot) {
  return hasItem(bot, (_name, item) => !!item?.foodPoints);
}

function hasPickaxe(bot) {
  return hasItem(bot, name => name.endsWith('_pickaxe'));
}

function getToolTier(bot) {
  if (hasItem(bot, name => name.includes('iron_sword') || name.includes('iron_axe') || name.includes('iron_pickaxe'))) return 'iron';
  if (hasItem(bot, name => name.includes('stone_sword') || name.includes('stone_axe') || name.includes('stone_pickaxe'))) return 'stone';
  if (hasItem(bot, name => name.includes('wooden_sword') || name.includes('wooden_axe') || name.includes('wooden_pickaxe'))) return 'wood';
  return 'none';
}

function getNearbyHostiles(bot) {
  if (!bot?.entities || !bot?.entity?.position) return [];
  return Object.values(bot.entities)
    .filter(e => e.type === 'mob' && HOSTILE_NAMES.includes(e.name?.toLowerCase()))
    .map(e => ({
      entity: e,
      name: e.name || e.username || 'hostile',
      dist: e.position.distanceTo(bot.entity.position)
    }))
    .sort((a, b) => a.dist - b.dist);
}

function discretizeState(bot) {
  if (!bot) return 'default';

  let healthStr = 'high';
  if (bot.health <= 6) {
    healthStr = 'low';
  } else if (bot.health <= 14) {
    healthStr = 'mid';
  }

  let hungerStr = 'full';
  if (bot.food <= 6) {
    hungerStr = 'starving';
  } else if (bot.food <= 15) {
    hungerStr = 'hungry';
  }

  let threatStr = 'none';
  const nearbyHostiles = getNearbyHostiles(bot);
  if (nearbyHostiles.some(h => h.dist < 6)) {
    threatStr = 'attacked';
  } else if (nearbyHostiles.some(h => h.dist < 16)) {
    threatStr = 'nearby';
  }

  const time = bot.time?.timeOfDay || 0;
  const isDay = time < 13000 || time >= 23000;
  const daytimeStr = isDay ? 'day' : 'night';

  const woodCount = countItems(bot, ['log', 'planks']);
  const woodStr = woodCount < 4 ? 'low' : 'enough';

  const stoneCount = countItems(bot, ['cobblestone', 'stone']);
  const stoneStr = stoneCount < 8 ? 'low' : 'enough';

  const foodSupplyStr = hasEdibleFood(bot) ? 'food' : 'nofood';
  const toolTierStr = getToolTier(bot);

  return `${healthStr}:${hungerStr}:${threatStr}:${daytimeStr}:${woodStr}:${stoneStr}:${foodSupplyStr}:${toolTierStr}`;
}

function getQValues(state) {
  if (!qTable[state]) {
    qTable[state] = {};
    for (const action of ACTIONS) {
      qTable[state][action] = 0.0;
    }
  }
  return qTable[state];
}

function getActionPreferences(bot) {
  const nearbyHostiles = getNearbyHostiles(bot);
  const nearestThreat = nearbyHostiles[0];
  const woodCount = countItems(bot, ['log', 'planks']);
  const stoneCount = countItems(bot, ['cobblestone', 'stone']);
  const lowHealth = (bot?.health || 20) <= 8;
  const hungry = (bot?.food || 20) <= 14;
  const hasFood = hasEdibleFood(bot);
  const canCraftPlanks = countItems(bot, ['log']) > 0;
  const cobblestone = countItems(bot, ['cobblestone']);
  const iron = countItems(bot, ['iron_ingot']);
  const planks = countItems(bot, ['planks']);
  const toolTier = getToolTier(bot);

  return {
    idle: { allowed: !nearestThreat && !hungry && woodCount >= 4 && stoneCount >= 8, bonus: 0.1 },
    eat: { allowed: hungry && hasFood, bonus: hungry ? 3.5 : -1 },
    fight: { allowed: !!nearestThreat && nearestThreat.dist < 8 && !lowHealth, bonus: nearestThreat ? (nearestThreat.dist < 5 ? 1.4 : 0.5) : -2 },
    flee: { allowed: !!nearestThreat, bonus: nearestThreat ? (lowHealth ? 4.5 : 2.2) : -1.5 },
    gather_wood: { allowed: !nearestThreat && woodCount < 6, bonus: woodCount < 4 ? 2.8 : 1.2 },
    mine_stone: { allowed: !nearestThreat && stoneCount < 12 && hasPickaxe(bot), bonus: stoneCount < 8 ? 2.4 : 0.8 },
    craft_gear: {
      allowed: !nearestThreat && (
        toolTier === 'none' ||
        (toolTier === 'wood' && cobblestone >= 2) ||
        ((toolTier === 'wood' || toolTier === 'stone') && iron >= 2) ||
        (planks < 2 && canCraftPlanks)
      ),
      bonus: toolTier === 'none' ? 2.6 : ((toolTier === 'wood' && cobblestone >= 2) || iron >= 2 ? 2 : 0.7)
    }
  };
}

function selectAction(state, epsilon = DEFAULT_EPSILON, bot = null) {
  const values = getQValues(state);
  const preferences = getActionPreferences(bot);
  const feasibleActions = ACTIONS.filter(action => preferences[action]?.allowed);
  const actionPool = feasibleActions.length > 0 ? feasibleActions : ACTIONS;

  if (Math.random() < epsilon) {
    const ranked = [...actionPool].sort((a, b) => (preferences[b]?.bonus || 0) - (preferences[a]?.bonus || 0));
    const topSlice = ranked.slice(0, Math.min(3, ranked.length));
    const randomAction = topSlice[Math.floor(Math.random() * topSlice.length)];
    console.log(`[RL Engine] Explore action: ${randomAction}`);
    return randomAction;
  }

  let bestAction = actionPool[0];
  let maxVal = values[bestAction] + (preferences[bestAction]?.bonus || 0) * 0.05;

  for (let i = 1; i < actionPool.length; i++) {
    const act = actionPool[i];
    const adjustedValue = values[act] + (preferences[act]?.bonus || 0) * 0.05;
    if (adjustedValue > maxVal) {
      maxVal = adjustedValue;
      bestAction = act;
    }
  }

  console.log(`[RL Engine] Exploit action: ${bestAction} (Adjusted Q-Value: ${maxVal.toFixed(4)})`);
  return bestAction;
}

function mapCortexActionToRL(actionName) {
  return CORTEX_ACTION_MAP[actionName] || null;
}

function getActionAdvice(bot, epsilon = DEFAULT_EPSILON) {
  const state = discretizeState(bot);
  const suggestedAction = selectAction(state, epsilon, bot);
  const values = getQValues(state);
  return {
    state,
    suggestedAction,
    qValues: { ...values },
    mappedCortexActions: Object.entries(CORTEX_ACTION_MAP)
      .filter(([, rlAction]) => rlAction === suggestedAction)
      .map(([cortexAction]) => cortexAction),
  };
}

function updateQValue(state, action, reward, nextState, options = {}) {
  const currentQ = getQValues(state)[action];
  const terminal = !!options.terminal;

  const nextQValues = getQValues(nextState);
  let maxNextQ = -Infinity;
  for (const act of ACTIONS) {
    if (nextQValues[act] > maxNextQ) {
      maxNextQ = nextQValues[act];
    }
  }

  const futureReward = terminal ? 0 : maxNextQ;
  const target = reward + GAMMA * futureReward;
  qTable[state][action] = currentQ + ALPHA * (target - currentQ);

  console.log(`[RL Engine] Q-Table update [${state}] -> Action: ${action} | Reward: ${reward} | Old Q: ${currentQ.toFixed(4)} | New Q: ${qTable[state][action].toFixed(4)}`);

  saveQTable();
  return qTable[state][action];
}

function recommendEpsilon(currentEpsilon = DEFAULT_EPSILON, stats = {}, lastReward = 0) {
  const totalSteps = stats.totalSteps || 0;
  const stepDecay = Math.pow(EPSILON_DECAY, Math.max(0, totalSteps));
  let next = Math.max(MIN_EPSILON, currentEpsilon * stepDecay);

  if (lastReward < -15) next = Math.min(0.35, next + 0.03);
  if (lastReward > 15) next = Math.max(MIN_EPSILON, next - 0.01);

  return clamp(Number(next.toFixed(4)), MIN_EPSILON, 0.5);
}

async function executeRLAction(bot, actionName) {
  bot.chat(`[RL Autonomy] Executing action: ${actionName}`);

  try {
    if (actionName === 'idle') {
      await new Promise(resolve => setTimeout(resolve, 3000));
      return { success: true };
    }

    if (actionName === 'eat') {
      if (!hasEdibleFood(bot)) {
        return { success: false, reason: 'no food available' };
      }
      const skills = require('../library/skills');
      const result = await skills.eatFood(bot);
      return { success: !!result };
    }

    if (actionName === 'fight') {
      const target = getNearbyHostiles(bot)[0]?.entity;
      if (!target) {
        bot.chat('[RL Autonomy] Fight action: No threats found nearby.');
        return { success: false, reason: 'no target' };
      }

      await bot.executeAction({
        action: 'attack',
        target: target.name || target.username
      });
      return { success: true };
    }

    if (actionName === 'flee') {
      const target = getNearbyHostiles(bot)[0]?.entity;
      if (!target) {
        bot.chat('[RL Autonomy] Flee action: No threats nearby. Moving 10 blocks random.');
        const rx = bot.entity.position.x + (Math.random() - 0.5) * 20;
        const rz = bot.entity.position.z + (Math.random() - 0.5) * 20;
        await bot.executeAction({ action: 'goto', x: Math.round(rx), y: Math.round(bot.entity.position.y), z: Math.round(rz) });
        return { success: true };
      }

      const dir = bot.entity.position.minus(target.position).normalize();
      const runPos = bot.entity.position.plus(dir.scaled(15));
      bot.chat(`[RL Autonomy] Running away from ${target.name} to safety...`);
      await bot.executeAction({
        action: 'goto',
        x: Math.round(runPos.x),
        y: Math.round(bot.entity.position.y),
        z: Math.round(runPos.z)
      });
      return { success: true };
    }

    if (actionName === 'gather_wood') {
      await bot.executeAction({ action: 'chop_tree' });
      return { success: true };
    }

    if (actionName === 'mine_stone') {
      if (!hasPickaxe(bot)) {
        return { success: false, reason: 'no pickaxe available' };
      }
      await bot.executeAction({ action: 'mine', block: 'cobblestone', count: 8 });
      return { success: true };
    }

    if (actionName === 'craft_gear') {
      const planks = countItems(bot, ['planks']);
      const cobblestone = countItems(bot, ['cobblestone']);
      const iron = countItems(bot, ['iron_ingot']);
      const toolTier = getToolTier(bot);

      let itemToCraft = 'wooden_sword';
      if (toolTier !== 'iron' && iron >= 2) {
        itemToCraft = 'iron_sword';
      } else if (toolTier === 'wood' && cobblestone >= 2) {
        itemToCraft = 'stone_sword';
      } else if (toolTier === 'none' && planks >= 2) {
        itemToCraft = 'wooden_sword';
      } else if (planks < 2) {
        const woodCount = countItems(bot, ['log']);
        if (woodCount > 0) {
          await bot.executeAction({ action: 'craft', item: 'oak_planks', count: 1 });
        } else {
          return { success: false, reason: 'missing crafting materials' };
        }
      } else {
        return { success: false, reason: 'gear already sufficient' };
      }

      bot.chat(`[RL Autonomy] Crafting gear: ${itemToCraft}...`);
      await bot.executeAction({ action: 'craft', item: itemToCraft, count: 1 });
      return { success: true };
    }
  } catch (err) {
    console.error(`[RL Autonomy] Action ${actionName} execution failed:`, err.message);
    return { success: false, error: err.message };
  }

  return { success: false, reason: 'unknown action' };
}

loadQTable();

module.exports = {
  ACTIONS,
  CORTEX_ACTION_MAP,
  DEFAULT_EPSILON,
  MIN_EPSILON,
  discretizeState,
  selectAction,
  mapCortexActionToRL,
  getActionAdvice,
  updateQValue,
  recommendEpsilon,
  executeRLAction,
  getQValues,
  qTable
};
