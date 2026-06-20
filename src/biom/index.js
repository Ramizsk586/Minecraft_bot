// ─── Biome Plan Registry ──────────────────────────────────────────────────────
// Central dispatcher: detects the bot's current biome and returns the
// matching biome survival plan. Each plan defines log types, shelter blocks,
// food sources, survival steps, and safety flags (e.g. no beds in Nether/End).

'use strict';

const desert = require('./desert');
const forest  = require('./forest');
const cold    = require('./cold');
const nether  = require('./nether');
const ocean   = require('./ocean');
const end     = require('./end');
const cave    = require('./cave');

// Ordered by specificity — more specific biomes first
const BIOME_PLANS = [nether, end, desert, cold, ocean, cave, forest];
const DEFAULT_SURFACE_LOG_TYPES = forest.logTypes.slice();
const STRONG_DIMENSION_PLANS = new Set(['nether', 'end']);

function normalizeBiomeName(name) {
  return String(name || '')
    .replace(/^minecraft:/, '')
    .toLowerCase();
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getPlanConfidence(plan, source) {
  if (!plan) return 0;
  if (STRONG_DIMENSION_PLANS.has(plan.category)) return 100;
  if (source === 'metadata-name') return 82;
  if (source === 'metadata-climate') return 72;
  if (source === 'terrain') return 68;
  if (source === 'direct-name') return 58;
  return 40;
}

function getBiomeBlock(bot, pos = null) {
  try {
    const basePos = pos || bot.entity.position;
    const candidates = [
      basePos,
      basePos.floored?.() || basePos,
      basePos.offset?.(0, -1, 0),
      basePos.offset?.(0, 1, 0),
    ].filter(Boolean);

    for (const candidate of candidates) {
      const block = bot.blockAt(candidate);
      if (block?.biome?.name) return block;
    }
  } catch {}
  return null;
}

function tallyNearbyBlocks(bot, names, radius = 10, samples = 48) {
  const ids = names
    .map(name => bot.registry.blocksByName[name]?.id)
    .filter(id => id != null);
  if (!ids.length) return 0;

  try {
    return bot.findBlocks({
      matching: ids,
      maxDistance: radius,
      count: samples,
    }).length;
  } catch {
    return 0;
  }
}

function countNearbyEntities(bot, names, radius = 24) {
  return Object.values(bot.entities || {}).filter(entity => {
    if (!entity || !entity.isValid || entity.id === bot.entity.id) return false;
    if (!names.includes(entity.name)) return false;
    return entity.position.distanceTo(bot.entity.position) <= radius;
  }).length;
}

function getRegistryBiome(bot, biome) {
  if (!bot?.registry || !biome) return null;

  const id = biome.id ?? biome.biome;
  if (id != null && bot.registry.biomes?.[id]) return bot.registry.biomes[id];

  const names = [
    biome.name,
    biome.displayName,
    biome.biomeName,
  ].filter(Boolean);

  for (const name of names) {
    const normalized = normalizeBiomeName(name);
    const variants = [name, normalized, `minecraft:${normalized}`];
    for (const variant of variants) {
      if (bot.registry.biomesByName?.[variant]) return bot.registry.biomesByName[variant];
    }
  }

  return null;
}

function getBiomeMetadata(bot, biome = null) {
  const blockBiome = biome || getBiomeBlock(bot)?.biome || null;
  const registryBiome = getRegistryBiome(bot, blockBiome) || null;
  const merged = {
    ...(registryBiome || {}),
    ...(blockBiome || {}),
  };
  const climate = merged.climate || {};
  const name = normalizeBiomeName(merged.name || registryBiome?.name || blockBiome?.name || '');
  const displayName = merged.displayName || registryBiome?.displayName || blockBiome?.displayName || name;
  const humidity = normalizeNumber(
    merged.rainfall ??
    merged.downfall ??
    climate.rainfall ??
    climate.downfall ??
    climate.humidity
  );
  const temperature = normalizeNumber(merged.temperature ?? climate.temperature);

  return {
    ...merged,
    name: name || 'unknown',
    displayName,
    humidity,
    temperature,
    precipitation: merged.precipitation ?? climate.precipitation ?? null,
    dimension: normalizeBiomeName(merged.dimension || climate.dimension || ''),
    category: normalizeBiomeName(merged.category || merged.parent || ''),
    source: registryBiome && blockBiome ? 'registry+block' : registryBiome ? 'registry' : blockBiome ? 'block' : 'none',
  };
}

function inferBiomeFromTerrain(bot, includeScores = false) {
  const pos = bot.entity?.position;
  if (!pos) return includeScores ? { plan: null, scores: {} } : null;

  const desertScore =
    tallyNearbyBlocks(bot, ['sand', 'red_sand', 'sandstone', 'red_sandstone', 'cactus', 'dead_bush', 'terracotta', 'red_terracotta'], 14, 80) +
    (countNearbyEntities(bot, ['husk'], 28) * 4);

  const oceanScore =
    tallyNearbyBlocks(bot, ['water', 'kelp', 'seagrass', 'sand', 'gravel', 'clay'], 12, 80);

  const coldScore =
    tallyNearbyBlocks(bot, ['snow', 'snow_block', 'ice', 'packed_ice', 'blue_ice', 'powder_snow'], 14, 80);

  const caveScore =
    (pos.y < 52 ? 4 : 0) +
    tallyNearbyBlocks(bot, ['deepslate', 'tuff', 'sculk', 'dripstone_block', 'pointed_dripstone', 'amethyst_block'], 10, 40);

  let plan = null;
  if (desertScore >= 10 && desertScore > oceanScore && desertScore > coldScore) plan = desert;
  else if (oceanScore >= 18 && oceanScore > desertScore && oceanScore > coldScore) plan = ocean;
  else if (coldScore >= 10 && coldScore >= desertScore) plan = cold;
  else if (caveScore >= 10 && pos.y < 52) plan = cave;

  if (!includeScores) return plan;
  return {
    plan,
    scores: {
      desert: desertScore,
      ocean: oceanScore,
      cold: coldScore,
      cave: caveScore,
    },
  };
}

function classifyPlanFromMetadata(metadata) {
  if (!metadata || metadata.source === 'none') return { plan: null, source: 'none', reason: 'no metadata' };

  const name = normalizeBiomeName(metadata.name);
  const category = normalizeBiomeName(metadata.category);
  const dimension = normalizeBiomeName(metadata.dimension);
  const precipitation = normalizeBiomeName(metadata.precipitation);
  const text = `${name} ${category} ${dimension} ${precipitation}`;
  const directPlan = getPlanForBiomeName(text);

  if (text.includes('the_nether') || text.includes('nether')) {
    return { plan: nether, source: 'metadata-name', reason: 'nether dimension/name' };
  }
  if (text.includes('the_end') || text.includes('end_') || name === 'end') {
    return { plan: end, source: 'metadata-name', reason: 'end dimension/name' };
  }
  if (directPlan !== forest || forest.keywords.some(kw => text.includes(kw))) {
    return { plan: directPlan, source: 'metadata-name', reason: 'metadata keyword match' };
  }

  const temperature = metadata.temperature;
  const humidity = metadata.humidity;
  if (temperature != null && humidity != null) {
    if (temperature >= 0.95 && humidity <= 0.25) {
      return { plan: desert, source: 'metadata-climate', reason: 'hot and dry climate' };
    }
    if (temperature <= 0.2 || precipitation === 'snow') {
      return { plan: cold, source: 'metadata-climate', reason: 'cold climate' };
    }
    if (humidity >= 0.5 && temperature >= 0.45) {
      return { plan: forest, source: 'metadata-climate', reason: 'temperate or humid climate' };
    }
  } else if (temperature != null && temperature <= 0.2) {
    return { plan: cold, source: 'metadata-climate', reason: 'low temperature' };
  } else if (humidity != null && humidity <= 0.15 && temperature == null) {
    return { plan: desert, source: 'metadata-climate', reason: 'very low humidity' };
  }

  return { plan: directPlan, source: 'direct-name', reason: 'fallback keyword/default' };
}

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Get the raw biome name from the bot's position.
 * @param {object} bot
 * @returns {string}
 */
function getBiomeName(bot) {
  try {
    return getBiomeMetadata(bot).name || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Find the right biome plan for a given biome name string.
 * Falls back to 'forest' (temperate) if nothing matches.
 * @param {string} biomeName
 * @returns {object} biome plan
 */
function getPlanForBiomeName(biomeName) {
  if (!biomeName || biomeName === 'unknown') return forest;
  const lower = normalizeBiomeName(biomeName);
  for (const plan of BIOME_PLANS) {
    if (plan.keywords.some(kw => lower.includes(kw))) {
      return plan;
    }
  }
  return forest; // default temperate
}

function chooseVerifiedPlan(metadataResult, terrainResult, directPlan, biomeName) {
  const metadataPlan = metadataResult.plan;
  const terrainPlan = terrainResult.plan;

  if (metadataPlan && STRONG_DIMENSION_PLANS.has(metadataPlan.category)) {
    return {
      plan: metadataPlan,
      source: metadataResult.source,
      confidence: getPlanConfidence(metadataPlan, metadataResult.source),
      reason: metadataResult.reason,
    };
  }

  if (terrainPlan && (!metadataPlan || metadataPlan === forest || biomeName === 'unknown')) {
    return {
      plan: terrainPlan,
      source: 'terrain',
      confidence: getPlanConfidence(terrainPlan, 'terrain'),
      reason: 'terrain evidence corrected weak/unknown metadata',
    };
  }

  if (terrainPlan && metadataPlan && terrainPlan !== metadataPlan) {
    const terrainScores = terrainResult.scores || {};
    const terrainScore = terrainScores[terrainPlan.category] || 0;
    const metadataConfidence = getPlanConfidence(metadataPlan, metadataResult.source);

    if (metadataPlan === forest && terrainScore >= 12) {
      return {
        plan: terrainPlan,
        source: 'terrain',
        confidence: 74,
        reason: 'terrain evidence overrode broad forest/default metadata',
      };
    }

    return {
      plan: metadataPlan,
      source: metadataResult.source,
      confidence: metadataConfidence,
      reason: `${metadataResult.reason}; terrain disagreed with ${terrainPlan.category}`,
    };
  }

  if (metadataPlan) {
    return {
      plan: metadataPlan,
      source: metadataResult.source,
      confidence: getPlanConfidence(metadataPlan, metadataResult.source),
      reason: metadataResult.reason,
    };
  }

  return {
    plan: directPlan,
    source: 'direct-name',
    confidence: getPlanConfidence(directPlan, 'direct-name'),
    reason: 'raw biome name fallback',
  };
}

function getBiomeEvidence(bot) {
  const metadata = getBiomeMetadata(bot);
  const biomeName = metadata.name || 'unknown';
  const directPlan = getPlanForBiomeName(biomeName);
  const metadataResult = classifyPlanFromMetadata(metadata);
  const terrainResult = inferBiomeFromTerrain(bot, true);
  const verified = chooseVerifiedPlan(metadataResult, terrainResult, directPlan, biomeName);

  return {
    biomeName,
    metadata,
    directPlan: directPlan.category,
    metadataPlan: metadataResult.plan?.category || null,
    terrainPlan: terrainResult.plan?.category || null,
    terrainScores: terrainResult.scores || {},
    finalPlan: verified.plan.category,
    confidence: verified.confidence,
    source: verified.source,
    reason: verified.reason,
  };
}

/**
 * Detect and return the current biome plan for the bot's position.
 * @param {object} bot
 * @returns {object} biome plan
 */
function getCurrentBiomePlan(bot) {
  const evidence = getBiomeEvidence(bot);
  return BIOME_PLANS.find(plan => plan.category === evidence.finalPlan) || forest;
}

// ─── Convenience Helpers ──────────────────────────────────────────────────────

/**
 * Get log types appropriate for the bot's current biome.
 * @param {object} bot
 * @returns {string[]}
 */
function getLogTypes(bot) {
  const plan = getCurrentBiomePlan(bot);
  if (!plan.logTypes.length) return DEFAULT_SURFACE_LOG_TYPES;
  return plan.logTypes;
}

/**
 * Returns true if it is safe to sleep in a bed here.
 * @param {object} bot
 * @returns {boolean}
 */
function canSleepInBed(bot) {
  return getCurrentBiomePlan(bot).canSleepInBed;
}

/**
 * Get the best shelter block available in the bot's inventory for this biome.
 * Falls back gracefully through the plan's preference list.
 * @param {object} bot
 * @returns {string|null}
 */
function getShelterBlock(bot) {
  const plan = getCurrentBiomePlan(bot);
  for (const blockName of plan.shelterBlocks) {
    const count = bot.inventory.items()
      .filter(i => i.name === blockName)
      .reduce((sum, i) => sum + i.count, 0);
    if (count >= 8) return blockName;
  }

  // Universal fallback — any block with 8+ count
  const FALLBACK = [
    'cobblestone', 'stone', 'dirt', 'sandstone', 'netherrack',
    'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
    'acacia_planks', 'dark_oak_planks', 'crimson_planks', 'warped_planks',
    'blackstone', 'basalt', 'end_stone',
  ];
  for (const blockName of FALLBACK) {
    const count = bot.inventory.items()
      .filter(i => i.name === blockName)
      .reduce((sum, i) => sum + i.count, 0);
    if (count >= 8) return blockName;
  }
  return null;
}

/**
 * Get the survival tip message for the current biome.
 * @param {object} bot
 * @returns {string}
 */
function getSurvivalTip(bot) {
  return getCurrentBiomePlan(bot).survivalTip;
}

function getFallbackLogTypes(bot) {
  const plan = getCurrentBiomePlan(bot);
  if (plan.category === 'nether') return nether.logTypes;
  return DEFAULT_SURFACE_LOG_TYPES;
}

function needsSurfaceWood(bot) {
  const plan = getCurrentBiomePlan(bot);
  return plan.nativeWood === false;
}

function getProgressionBlocks(bot) {
  const plan = getCurrentBiomePlan(bot);
  const blocks = new Set([
    ...(plan.stoneEquivalents || []),
    ...(plan.commonBlocks || []),
  ]);

  if (plan.category === 'nether') {
    blocks.add('blackstone');
    blocks.add('netherrack');
    blocks.add('nether_quartz_ore');
    blocks.add('nether_gold_ore');
  } else if (plan.category === 'ocean') {
    blocks.add('sandstone');
    blocks.add('gravel');
    blocks.add('clay');
  } else if (plan.category === 'cave') {
    blocks.add('coal_ore');
    blocks.add('iron_ore');
    blocks.add('deepslate_iron_ore');
  } else if (plan.category === 'end') {
    blocks.add('end_stone');
  } else {
    blocks.add('stone');
    blocks.add('cobblestone');
  }

  return [...blocks];
}

function getEmergencyFoodTargets(bot) {
  const plan = getCurrentBiomePlan(bot);
  return (plan.foodSources || []).filter(Boolean);
}

function getSurvivalPriorities(bot) {
  const plan = getCurrentBiomePlan(bot);
  return (plan.survivalPriorities || [])
    .slice()
    .sort((a, b) => (b.urgency || 0) - (a.urgency || 0));
}

function getResourceTargets(bot, group = null) {
  const plan = getCurrentBiomePlan(bot);
  const targets = plan.resourceTargets || {};
  if (group) return (targets[group] || []).filter(Boolean);
  return targets;
}

function getRelocationPlan(bot) {
  const plan = getCurrentBiomePlan(bot);
  return plan.relocation || {
    enabled: plan.nativeWood === false,
    trigger: plan.nativeWood === false ? 'no_native_wood' : 'none',
    searchFor: plan.nativeWood === false ? ['forest', 'plains', 'village'] : [],
    maxLocalSearchRadius: 64,
    travelRadius: 128,
  };
}

function getHazards(bot) {
  const plan = getCurrentBiomePlan(bot);
  return (plan.hazards || []).filter(Boolean);
}

function getRiskFlags(bot) {
  const plan = getCurrentBiomePlan(bot);
  const hazards = new Set(plan.hazards || []);
  const relocation = getRelocationPlan(bot);
  return {
    avoidBeds: !plan.canSleepInBed,
    avoidWaterBuckets: plan.category === 'nether' || hazards.has('no_water'),
    needsShoreFirst: plan.category === 'ocean' || hazards.has('drowning'),
    needsSurfaceWood: plan.nativeWood === false,
    shouldRelocateForWood: relocation.enabled && (plan.category === 'desert' || plan.nativeWood === false),
    avoidPowderSnow: plan.category === 'cold' || hazards.has('powder_snow'),
    avoidVoid: plan.category === 'end' || hazards.has('void'),
    prioritizeTorches: plan.category === 'cave' || hazards.has('darkness'),
    avoidLava: hazards.has('lava'),
    avoidDrowning: hazards.has('drowning'),
    avoidBedUse: hazards.has('bed_explosion') || !plan.canSleepInBed,
    avoidEndermen: hazards.has('enderman'),
    needsGoldArmor: plan.category === 'nether' || hazards.has('piglin'),
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  // Plans
  plans: { desert, forest, cold, nether, ocean, end, cave },

  // Detection
  getBiomeName,
  getBiomeMetadata,
  getBiomeEvidence,
  getPlanForBiomeName,
  getCurrentBiomePlan,

  // Convenience helpers used by cortex.js and mine.js
  getLogTypes,
  getFallbackLogTypes,
  canSleepInBed,
  getShelterBlock,
  getSurvivalTip,
  getProgressionBlocks,
  getEmergencyFoodTargets,
  getSurvivalPriorities,
  getResourceTargets,
  getRelocationPlan,
  getHazards,
  getRiskFlags,
  needsSurfaceWood,
};
