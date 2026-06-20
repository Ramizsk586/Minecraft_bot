// ─── Brain: Eat Module ────────────────────────────────────────────────────────
// Instant, LLM-free food intelligence. Knows every Minecraft food item,
// its hunger/saturation values, and side effects. Picks the most efficient
// food based on current hunger deficit — no AI round-trip needed.

const cookData = require('../library/cook');
const libraryData = require('../library/data');
const { collectDrops } = require('../utils');

const HUNTABLE_PASSIVE_MOBS = new Set([
  'cow', 'pig', 'sheep', 'chicken', 'rabbit', 'mooshroom',
]);

const HUNT_DROP_NAMES = new Set([
  'raw_beef', 'raw_porkchop', 'raw_mutton', 'raw_chicken', 'raw_rabbit',
]);

// ─── Complete Minecraft Food Database ─────────────────────────────────────────
// Each entry: { hunger, saturation, harmful, effect }
// hunger     = hunger points restored (half drumsticks, max 20)
// saturation = saturation points restored (hidden buffer before hunger drops)
// harmful    = true if the food has negative side effects
// effect     = description of side effect (if any)

const FOOD_DB = {
  // ══════════════════════ S-TIER: Best foods ══════════════════════
  enchanted_golden_apple: { hunger: 4,  saturation: 9.6,  harmful: false, effect: 'Absorption IV, Regen II, Resistance, Fire Resistance' },
  golden_apple:           { hunger: 4,  saturation: 9.6,  harmful: false, effect: 'Absorption, Regen II' },
  golden_carrot:          { hunger: 6,  saturation: 14.4, harmful: false, effect: null },
  cooked_sniffer_egg:     { hunger: 10, saturation: 14.4, harmful: false, effect: null },

  // ══════════════════════ A-TIER: Cooked meats ══════════════════════
  cooked_beef:            { hunger: 8,  saturation: 12.8, harmful: false, effect: null },
  cooked_porkchop:        { hunger: 8,  saturation: 12.8, harmful: false, effect: null },
  rabbit_stew:            { hunger: 10, saturation: 12.0, harmful: false, effect: null },
  cooked_mutton:          { hunger: 6,  saturation: 9.6,  harmful: false, effect: null },
  cooked_salmon:          { hunger: 6,  saturation: 9.6,  harmful: false, effect: null },

  // ══════════════════════ B-TIER: Good food ══════════════════════
  cooked_chicken:         { hunger: 6,  saturation: 7.2,  harmful: false, effect: null },
  cooked_cod:             { hunger: 5,  saturation: 6.0,  harmful: false, effect: null },
  cooked_rabbit:          { hunger: 5,  saturation: 6.0,  harmful: false, effect: null },
  bread:                  { hunger: 5,  saturation: 6.0,  harmful: false, effect: null },
  baked_potato:           { hunger: 5,  saturation: 6.0,  harmful: false, effect: null },
  beetroot_soup:          { hunger: 6,  saturation: 7.2,  harmful: false, effect: null },
  mushroom_stew:          { hunger: 6,  saturation: 7.2,  harmful: false, effect: null },
  suspicious_stew:        { hunger: 6,  saturation: 7.2,  harmful: false, effect: 'varies' },
  pumpkin_pie:            { hunger: 8,  saturation: 4.8,  harmful: false, effect: null },
  honey_bottle:           { hunger: 6,  saturation: 1.2,  harmful: false, effect: 'Clears poison' },
  cooked_carrot:          { hunger: 6,  saturation: 7.2,  harmful: false, effect: null },
  baked_apple:            { hunger: 6,  saturation: 7.2,  harmful: false, effect: null },
  fried_egg:              { hunger: 4,  saturation: 4.8,  harmful: false, effect: null },
  cooked_rotten_flesh:    { hunger: 5,  saturation: 6.0,  harmful: false, effect: null },
  roasted_pumpkin:        { hunger: 6,  saturation: 7.2,  harmful: false, effect: null },
  roasted_poisonous_potato:{ hunger: 5, saturation: 6.0, harmful: false, effect: null },
  cooked_turtle_egg:      { hunger: 5,  saturation: 6.0,  harmful: false, effect: null },
  roasted_brown_mushroom: { hunger: 4,  saturation: 4.8,  harmful: false, effect: null },
  roasted_red_mushroom:   { hunger: 4,  saturation: 4.8,  harmful: false, effect: null },

  // ══════════════════════ C-TIER: Snacks ══════════════════════
  apple:                  { hunger: 4,  saturation: 2.4,  harmful: false, effect: null },
  carrot:                 { hunger: 3,  saturation: 3.6,  harmful: false, effect: null },
  melon_slice:            { hunger: 2,  saturation: 1.2,  harmful: false, effect: null },
  sweet_berries:          { hunger: 2,  saturation: 1.2,  harmful: false, effect: null },
  glow_berries:           { hunger: 2,  saturation: 0.4,  harmful: false, effect: null },
  cookie:                 { hunger: 2,  saturation: 0.4,  harmful: false, effect: null },
  dried_kelp:             { hunger: 1,  saturation: 0.6,  harmful: false, effect: null },
  beetroot:               { hunger: 1,  saturation: 1.2,  harmful: false, effect: null },
  chorus_fruit:           { hunger: 4,  saturation: 2.4,  harmful: false, effect: 'Random teleport' },
  cooked_sweet_berries:   { hunger: 4,  saturation: 4.8,  harmful: false, effect: null },
  cooked_beetroot:        { hunger: 3,  saturation: 3.6,  harmful: false, effect: null },
  cooked_tropical_fish:   { hunger: 4,  saturation: 4.8,  harmful: false, effect: null },
  cooked_pufferfish:      { hunger: 3,  saturation: 3.6,  harmful: false, effect: null },
  cooked_spider_eye:      { hunger: 4,  saturation: 4.8,  harmful: false, effect: null },
  cooked_glow_berries:    { hunger: 4,  saturation: 4.8,  harmful: false, effect: null },
  roasted_melon_slice:    { hunger: 5,  saturation: 6.0,  harmful: false, effect: null },

  // ══════════════════════ D-TIER: Raw meat (safe) ══════════════════════
  raw_beef:               { hunger: 3,  saturation: 1.8,  harmful: false, effect: null },
  raw_porkchop:           { hunger: 3,  saturation: 1.8,  harmful: false, effect: null },
  raw_mutton:             { hunger: 2,  saturation: 1.2,  harmful: false, effect: null },
  raw_rabbit:             { hunger: 3,  saturation: 1.8,  harmful: false, effect: null },
  raw_cod:                { hunger: 2,  saturation: 0.4,  harmful: false, effect: null },
  raw_salmon:             { hunger: 2,  saturation: 0.4,  harmful: false, effect: null },
  potato:                 { hunger: 1,  saturation: 0.6,  harmful: false, effect: null },
  tropical_fish:          { hunger: 1,  saturation: 0.2,  harmful: false, effect: null },
  egg:                    { hunger: 0,  saturation: 0.0,  harmful: false, effect: null },
  turtle_egg:             { hunger: 0,  saturation: 0.0,  harmful: false, effect: null },
  sniffer_egg:            { hunger: 0,  saturation: 0.0,  harmful: false, effect: null },
  brown_mushroom:         { hunger: 0,  saturation: 0.0,  harmful: false, effect: null },
  red_mushroom:           { hunger: 0,  saturation: 0.0,  harmful: false, effect: null },
  pumpkin:                { hunger: 0,  saturation: 0.0,  harmful: false, effect: null },

  // ══════════════════════ F-TIER: Harmful / desperate ══════════════════════
  raw_chicken:            { hunger: 2,  saturation: 1.2,  harmful: true,  effect: '30% Hunger effect' },
  pufferfish:             { hunger: 1,  saturation: 0.2,  harmful: true,  effect: 'Hunger III, Nausea, Poison IV' },
  rotten_flesh:           { hunger: 4,  saturation: 0.8,  harmful: true,  effect: '80% Hunger effect' },
  spider_eye:             { hunger: 2,  saturation: 3.2,  harmful: true,  effect: 'Poison 4s' },
  poisonous_potato:       { hunger: 2,  saturation: 1.2,  harmful: true,  effect: '60% Poison 5s' },
};

// ─── Efficiency Calculator ────────────────────────────────────────────────────

/**
 * Calculate how efficient a food item is for the current hunger deficit.
 *
 * Scoring formula:
 *   score = saturation_per_hunger_point × waste_penalty × safety_bonus
 *
 * - saturation_per_hunger = saturation / hunger (higher = more value per bite)
 * - waste_penalty: if the food restores more hunger than deficit, the excess
 *   is wasted. Penalize foods that overshoot by too much.
 * - safety_bonus: harmful foods get a massive penalty unless desperate
 *
 * @param {string} foodName - Item name from inventory
 * @param {number} deficit - How many hunger points the bot needs (20 - current)
 * @param {number} currentFood - Current food level
 * @returns {number} efficiency score (higher = better choice)
 */
function calculateEfficiency(foodName, deficit, currentFood) {
  const data = FOOD_DB[foodName];
  if (!data) return -1; // not a known food

  // Base score: saturation efficiency (how much hidden hunger you get per bite)
  const saturationRatio = data.saturation / Math.max(data.hunger, 1);

  // Waste penalty: how much of the hunger restoration is actually useful
  const usefulHunger = Math.min(data.hunger, deficit);
  const wasteRatio = usefulHunger / Math.max(data.hunger, 1);
  // Soft penalty: don't completely reject slightly oversized foods
  const wastePenalty = 0.3 + (0.7 * wasteRatio);

  // Safety penalty
  let safetyMultiplier = 1.0;
  if (data.harmful) {
    if (currentFood <= 2) {
      // Desperate: allow harmful foods but still penalize
      safetyMultiplier = 0.3;
    } else if (currentFood <= 6) {
      // Very hungry: small penalty
      safetyMultiplier = 0.1;
    } else {
      // Not that hungry: strongly avoid harmful foods
      safetyMultiplier = 0.01;
    }
  }

  // Bonus for foods that exactly fill the deficit (no waste, no undershoot)
  let exactFitBonus = 1.0;
  if (data.hunger === deficit) {
    exactFitBonus = 1.5;
  } else if (Math.abs(data.hunger - deficit) <= 1) {
    exactFitBonus = 1.2;
  }

  // Final score
  return saturationRatio * wastePenalty * safetyMultiplier * exactFitBonus;
}

/**
 * Scan the bot's inventory and rank all edible items by efficiency.
 * Returns a sorted array of { item, foodData, score }.
 *
 * @param {import('mineflayer').Bot} bot
 * @returns {Array<{item: object, foodData: object, score: number, reason: string}>}
 */
function rankFoods(bot) {
  const currentFood = bot.food;
  const deficit = 20 - currentFood;

  if (deficit <= 0) return []; // already full

  const items = bot.inventory.items();
  const ranked = [];

  for (const item of items) {
    const data = FOOD_DB[item.name];
    if (!data) continue; // not food

    const score = calculateEfficiency(item.name, deficit, currentFood);
    if (score <= 0) continue;

    // Build a human-readable reason
    let reason;
    if (data.hunger === deficit) {
      reason = `exactly fills ${deficit} hunger`;
    } else if (data.hunger < deficit) {
      reason = `restores ${data.hunger}/${deficit} hunger needed`;
    } else {
      reason = `restores ${data.hunger} (wastes ${data.hunger - deficit})`;
    }
    if (data.harmful) reason += ' ⚠️ harmful';

    ranked.push({ item, foodData: data, score, reason });
  }

  // Sort by score descending (best first)
  ranked.sort((a, b) => b.score - a.score);

  return ranked;
}

/**
 * Pick the single best food to eat right now.
 *
 * @param {import('mineflayer').Bot} bot
 * @returns {{ item: object, foodData: object, score: number, reason: string } | null}
 */
function pickBestFood(bot) {
  const ranked = rankFoods(bot);
  return ranked.length > 0 ? ranked[0] : null;
}

function isRawFood(itemName) {
  return typeof itemName === 'string' && (
    itemName.startsWith('raw_') ||
    ['potato', 'kelp', 'tropical_fish', 'egg'].includes(itemName)
  );
}

function pickBestImmediateFood(bot, options = {}) {
  const { allowHarmful = true } = options;
  const ranked = rankFoods(bot);
  const filtered = ranked.filter(entry => {
    if (!allowHarmful && entry.foodData.harmful) return false;
    return true;
  });
  return filtered[0] || null;
}

function shouldCookBeforeEating(bot, options = {}) {
  const {
    threatLevel = 'none',
    health = bot.health ?? 20,
    food = bot.food ?? 20,
    force = false,
  } = options;

  if (force) return false;
  if (health <= 8) return false;
  if (food <= 6) return false;
  if (threatLevel === 'high' || threatLevel === 'medium') return false;

  const bestReady = pickBestFood(bot);
  if (bestReady && !isRawFood(bestReady.item.name)) return false;

  return !!cookData.getBestCookableFood(bot);
}

function findNearestFoodAnimal(bot, maxDistance = 24) {
  return bot.nearestEntity(entity => {
    if (!entity || !entity.isValid || entity.type === 'object') return false;
    if (!HUNTABLE_PASSIVE_MOBS.has(entity.name)) return false;
    const info = libraryData.getMobInfo(entity.name);
    if (!info || info.type !== 'passive') return false;
    return entity.position.distanceTo(bot.entity.position) <= maxDistance;
  });
}

async function huntPassiveFood(bot, options = {}) {
  const { silent = false } = options;
  const target = findNearestFoodAnimal(bot, 24);
  if (!target) {
    return { success: false, reason: 'no passive food animal nearby' };
  }

  try {
    const attackBrain = require('./attack');
    const { goals } = require('mineflayer-pathfinder');
    const beforeCounts = {};
    for (const name of HUNT_DROP_NAMES) {
      beforeCounts[name] = bot.inventory.items()
        .filter(item => item.name === name)
        .reduce((sum, item) => sum + item.count, 0);
    }

    if (!silent) {
      bot.chat(`Hunting ${target.name} for food.`);
    }

    const started = await attackBrain.startAttack(bot, target, { allowPassive: true });
    if (!started?.started) {
      return { success: false, reason: started?.reason || 'could not start hunt' };
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < 12000) {
      if (!target.isValid) break;
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    attackBrain.stopAttack(bot, { silent: true });
    await collectDrops(bot, goals, 400, { maxDistance: 12, maxItems: 10, passes: 2 });

    const gained = [];
    for (const name of HUNT_DROP_NAMES) {
      const after = bot.inventory.items()
        .filter(item => item.name === name)
        .reduce((sum, item) => sum + item.count, 0);
      const diff = after - (beforeCounts[name] || 0);
      if (diff > 0) gained.push(`${name} x${diff}`);
    }

    if (gained.length === 0) {
      return { success: false, reason: 'hunt finished but no meat collected' };
    }

    return { success: true, reason: 'food hunted', drops: gained };
  } catch (err) {
    return { success: false, reason: err.message };
  }
}

/**
 * Execute eating — equip and consume the best food. Returns immediately,
 * no LLM call needed.
 *
 * @param {import('mineflayer').Bot} bot
 * @param {object} [options]
 * @param {boolean} [options.silent=false] - Don't chat about eating
 * @param {boolean} [options.force=false] - Eat even if not hungry
 * @returns {Promise<{ate: boolean, item: string|null, foodBefore: number, foodAfter: number}>}
 */
async function eat(bot, options = {}) {
  const { silent = false, force = false, threatLevel = 'none', preferCooking = false } = options;
  const foodBefore = bot.food;

  // Don't eat if full (unless forced)
  if (foodBefore >= 20 && !force) {
    if (!silent) bot.chat('Already full! (20/20)');
    return { ate: false, item: null, foodBefore, foodAfter: foodBefore };
  }

  // Don't eat if hunger is fine and not forced
  if (foodBefore > 17 && !force) {
    return { ate: false, item: null, foodBefore, foodAfter: foodBefore };
  }

  let best = pickBestFood(bot);
  const cookingPreferred = preferCooking || shouldCookBeforeEating(bot, {
    threatLevel,
    health: bot.health,
    food: foodBefore,
    force,
  });

  if (cookingPreferred) {
    try {
      await require('../cook').cookBestFood(bot);
    } catch {}

    best = pickBestFood(bot);
  }

  if (!best) {
    best = pickBestImmediateFood(bot, { allowHarmful: foodBefore <= 6 || force });
  }

  if (!best) {
    // Try to craft food before giving up
    try {
      const craftBrain = require('./craft');
      const craftResult = await craftBrain.craftFoodIfPossible(bot, { silent: true });
      if (craftResult.success) {
        console.log('🧠 Brain:Eat auto-crafted food: ' + craftResult.crafted);
        best = pickBestFood(bot);
      }
    } catch (err) {
      console.log('🧠 Brain:Eat craft-food failed: ' + err.message);
    }
    if (!best) {
      const shouldHuntCook = !force && bot.health >= 12 && foodBefore >= 8 && threatLevel === 'none';
      const huntResult = await huntPassiveFood(bot, { silent }).catch(err => ({ success: false, reason: err.message }));
      if (huntResult.success) {
        if (shouldHuntCook) {
          try {
            await require('../cook').cookBestFood(bot);
          } catch {}
        }
        best = pickBestFood(bot) || pickBestImmediateFood(bot, { allowHarmful: foodBefore <= 6 || force });
      }
    }
    if (!best) {
      if (!silent) bot.chat('No food in inventory, nothing craftable, and no meat source found!');
      return { ate: false, item: null, foodBefore, foodAfter: foodBefore };
    }
  }

  try {
    await bot.equip(best.item, 'hand');
    await bot.consume();
    const foodAfter = bot.food;

    if (!silent) {
      const deficit = 20 - foodBefore;
      bot.chat(
        `🍖 Ate ${best.item.name} (+${best.foodData.hunger} hunger, +${best.foodData.saturation} sat) ` +
        `| ${foodBefore}→${foodAfter}/20 | ${best.reason}`
      );
    }

    console.log(
      `🧠 Brain:Eat → ${best.item.name} (score: ${best.score.toFixed(2)}, ` +
      `${best.reason}) | food: ${foodBefore}→${bot.food}/20`
    );

    return { ate: true, item: best.item.name, foodBefore, foodAfter: bot.food };
  } catch (err) {
    console.log(`🧠 Brain:Eat failed: ${err.message}`);
    if (!silent) bot.chat(`Couldn't eat: ${err.message}`);
    return { ate: false, item: null, foodBefore, foodAfter: foodBefore };
  }
}

/**
 * Get a status report of all food in inventory with efficiency rankings.
 *
 * @param {import('mineflayer').Bot} bot
 * @returns {string[]} Array of chat-friendly lines
 */
function foodReport(bot) {
  const ranked = rankFoods(bot);
  const lines = [];
  const bestCookable = cookData.getBestCookableFood(bot);

  lines.push(`🧠 Food Report | Hunger: ${bot.food}/20 | Deficit: ${20 - bot.food}`);

  if (ranked.length === 0) {
    lines.push('No food in inventory!');
    return lines;
  }

  // Group by tier
  const tiers = { '★★★': [], '★★☆': [], '★☆☆': [], '☆☆☆': [] };
  for (const entry of ranked) {
    const s = entry.score;
    const tier = s >= 2.0 ? '★★★' : s >= 1.0 ? '★★☆' : s >= 0.3 ? '★☆☆' : '☆☆☆';
    tiers[tier].push(entry);
  }

  for (const [tier, entries] of Object.entries(tiers)) {
    if (entries.length === 0) continue;
    const items = entries
      .map(e => `${e.item.name} x${e.item.count} (${e.reason})`)
      .join(', ');
    lines.push(`${tier}: ${items}`);
  }

  lines.push(`Best choice: ${ranked[0].item.name} — ${ranked[0].reason}`);
  if (bestCookable) {
    lines.push(`Best raw food to cook: ${bestCookable.item.name} -> ${bestCookable.info.result}`);
  }
  return lines;
}

// ─── Auto-Eat Stubs (loop removed — cortex handles eating) ─────────────────

// _autoEatHandle and _isEating removed — no longer needed.

function startAutoEat(bot) {
  // Deprecated: Auto-eat loop removed. Cortex handles eating.
  console.log('Brain:Eat auto-eat loop deprecated — cortex handles eating now.');
}

function stopAutoEat() {
  // Deprecated: No-op, cortex handles eating.
}

/**
 * Check if a food item name is in the database.
 * @param {string} name
 * @returns {boolean}
 */
function isFood(name) {
  return name in FOOD_DB;
}

/**
 * Get food data for an item.
 * @param {string} name
 * @returns {object|null}
 */
function getFoodData(name) {
  return FOOD_DB[name] || null;
}

module.exports = {
  FOOD_DB,
  calculateEfficiency,
  rankFoods,
  pickBestFood,
  huntPassiveFood,
  eat,
  foodReport,
  startAutoEat,
  stopAutoEat,
  isFood,
  getFoodData,
};
