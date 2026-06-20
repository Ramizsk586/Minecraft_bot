// ─── Brain: Eat Module ────────────────────────────────────────────────────────
// Instant, LLM-free food intelligence. Knows every Minecraft food item,
// its hunger/saturation values, and side effects. Picks the most efficient
// food based on current hunger deficit — no AI round-trip needed.

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

  // ══════════════════════ D-TIER: Raw meat (safe) ══════════════════════
  raw_beef:               { hunger: 3,  saturation: 1.8,  harmful: false, effect: null },
  raw_porkchop:           { hunger: 3,  saturation: 1.8,  harmful: false, effect: null },
  raw_mutton:             { hunger: 2,  saturation: 1.2,  harmful: false, effect: null },
  raw_rabbit:             { hunger: 3,  saturation: 1.8,  harmful: false, effect: null },
  raw_cod:                { hunger: 2,  saturation: 0.4,  harmful: false, effect: null },
  raw_salmon:             { hunger: 2,  saturation: 0.4,  harmful: false, effect: null },
  potato:                 { hunger: 1,  saturation: 0.6,  harmful: false, effect: null },

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
  const { silent = false, force = false } = options;
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
      if (!silent) bot.chat('No food in inventory and nothing to craft!');
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
  return lines;
}

// ─── Background Auto-Eat Monitor ──────────────────────────────────────────────

let _autoEatHandle = null;
let _isEating = false;

/**
 * Start the background auto-eat loop. Checks hunger every few seconds and
 * eats automatically when needed — completely LLM-free.
 *
 * Thresholds:
 *   food <= 6  → CRITICAL: eat immediately, check every 3s
 *   food <= 14 → LOW: eat soon, check every 10s
 *   food <= 17 → FINE: eat if convenient, check every 20s
 *   food > 17  → FULL: do nothing, check every 30s
 *
 * @param {import('mineflayer').Bot} bot
 */
function startAutoEat(bot) {
  stopAutoEat();

  async function tick() {
    if (_isEating) return;

    try {
      const food = bot.food;

      if (food <= 6) {
        // CRITICAL — eat immediately, craft food if needed
        _isEating = true;
        console.log(`🧠 Brain:Eat [CRITICAL] food=${food}/20 — eating NOW`);
        const result = await eat(bot, { silent: false, force: true });
        if (!result.ate) {
          // Desperate: try crafting food
          try {
            const craftBrain = require('./craft');
            await craftBrain.craftFoodIfPossible(bot, { silent: false });
            await eat(bot, { silent: false, force: true });
          } catch {}
        }
        _isEating = false;
        // Check again quickly in case we're still low
        _autoEatHandle = setTimeout(tick, 3000);
      } else if (food <= 14) {
        // LOW — eat soon
        _isEating = true;
        console.log(`🧠 Brain:Eat [LOW] food=${food}/20 — eating`);
        await eat(bot, { silent: true });
        _isEating = false;
        _autoEatHandle = setTimeout(tick, 10000);
      } else if (food <= 17) {
        // FINE — eat if we have good food available
        const best = pickBestFood(bot);
        if (best && best.score >= 1.5) {
          _isEating = true;
          await eat(bot, { silent: true });
          _isEating = false;
        }
        _autoEatHandle = setTimeout(tick, 20000);
      } else {
        // FULL — just check later
        _autoEatHandle = setTimeout(tick, 30000);
      }
    } catch (err) {
      console.log(`🧠 Brain:Eat tick error: ${err.message}`);
      _isEating = false;
      _autoEatHandle = setTimeout(tick, 15000);
    }
  }

  // Start the first tick after 5s (let bot settle after spawn)
  _autoEatHandle = setTimeout(tick, 5000);
  console.log('🧠 Brain:Eat auto-eat monitor started');
}

/**
 * Stop the background auto-eat loop.
 */
function stopAutoEat() {
  if (_autoEatHandle) {
    clearTimeout(_autoEatHandle);
    _autoEatHandle = null;
  }
  _isEating = false;
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
  eat,
  foodReport,
  startAutoEat,
  stopAutoEat,
  isFood,
  getFoodData,
};
