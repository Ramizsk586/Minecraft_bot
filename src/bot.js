require('dotenv').config();
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { plugin: pvp } = require('mineflayer-pvp');
const armorManager = require('mineflayer-armor-manager');
const { plugin: toolPlugin } = require('mineflayer-tool');
const autoEat = require('mineflayer-auto-eat');

const { normalizeMinecraftVersion, extractJson, sleep, installCompactChat } = require('./utils');
const { getWorldState } = require('./worldState');
const { createExecutor } = require('./actions/index');
const brain = require('./brain/index');
const libraryFunctions = require('./library/functions');
const librarySkills = require('./library/skills');
const libraryWorld = require('./library/world');
const libraryData = require('./library/data');
const libraryCalc = require('./library/modules/calc');
const { resolveItemName } = require('./library/modules/itemNameResolver');
const miningRules = require('./brain/miningRules');
const {
  startDashboardServer,
  updateBotInstance,
  setDashboardStatus,
  registerDashboardControls
} = require('./dashboard/server');
const memory = require('./brain/memory');
const recovery = require('./tasks/recovery');
const modes = require('./brain/modes');
const coder = require('./actions/coder');
const pathfinderHooks = require('./utils/pathfinderHooks');
const HudTracker = require('./brain/hudTracker');

function envValue(name, fallback = '') {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : fallback;
}

function buildLlmConfig() {
  const provider = envValue('PROVIDER', 'openrouter').toLowerCase();
  return {
    provider,
    llmApiBase: envValue('LLM_API_BASE') || (provider === 'ollama'
      ? 'https://ollama.com/v1'
      : 'https://openrouter.ai/api/v1'),
    llmApiKey: envValue('MODEL_KEY') || envValue('LLM_API_KEY') || envValue('OPENROUTER_API_KEY'),
    llmModel: envValue('LLM_MODEL') || (provider === 'ollama' ? 'llama3' : 'openai/gpt-4o-mini'),
    llmReferer: envValue('OPENROUTER_SITE_URL'),
    llmTitle: envValue('OPENROUTER_APP_NAME', 'Minecraft AI Bot'),
    aiAutonomyEnabled: envValue('AI_AUTONOMY', 'true').toLowerCase() !== 'false',
    aiAutonomyIntervalMs: parseInt(envValue('AI_AUTONOMY_INTERVAL_MS', '45000'), 10) || 45000,
    aiAutonomyMode: envValue('AI_AUTONOMY_MODE', 'llm').toLowerCase(),
  };
}

// ????????? Config ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????

const llmConfig = buildLlmConfig();

const config = {
  host: envValue('MC_HOST', 'localhost'),
  port: parseInt(envValue('MC_PORT', '25565'), 10) || 25565,
  username: envValue('MC_USERNAME', 'AIBot'),
  version: normalizeMinecraftVersion(process.env.MC_VERSION),
  owner: envValue('OWNER_USERNAME'),
  provider: llmConfig.provider,
  llmApiBase: llmConfig.llmApiBase,
  llmApiKey: llmConfig.llmApiKey,
  llmModel: llmConfig.llmModel,
  llmReferer: llmConfig.llmReferer,
  llmTitle: llmConfig.llmTitle,
  aiAutonomyEnabled: llmConfig.aiAutonomyEnabled,
  aiAutonomyIntervalMs: llmConfig.aiAutonomyIntervalMs,
  aiAutonomyMode: llmConfig.aiAutonomyMode,
};

const MAX_AI_EMPTY_RETRIES = 2;

// ─── State ────────────────────────────────────────────────────────────────────

let bot;
global.conversationHistory = [];
global.autonomyHistory = [];
let isThinking = false;
let executeAction = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let reconnectDelayOverrideMs = null;
let pendingResumeTask = null;
let botStartRequested = false;
let botConnecting = false;
const aiAutonomyState = {
  enabled: config.aiAutonomyEnabled,
  mode: config.aiAutonomyMode || 'llm',
  lastPlanAt: 0,
  lastErrorAt: 0,
  rlStats: {
    totalSteps: 0,
    totalReward: 0,
    lastReward: 0,
    epsilon: 0.15,
    lastAction: null,
    lastState: null
  }
};

function shouldPersistActionPlan(action) {
  if (!action || typeof action !== 'object') return false;
  const resumableActions = new Set([
    'sequence',
    'build_house',
    'house_plan',
    'build',
    'fill',
    'place',
    'mine',
    'strip_mine',
    'chop_tree',
    'gather_wood',
    'farm_cycle',
    'create_farm',
    'harvest',
    'plant',
  ]);
  return resumableActions.has(action.action);
}

function setPendingResumeTask(command, action, meta = {}) {
  if (!shouldPersistActionPlan(action)) {
    pendingResumeTask = null;
    return;
  }

  pendingResumeTask = {
    type: 'action',
    command,
    action,
    createdAt: Date.now(),
    source: meta.source || 'user',
    username: meta.username || null,
  };
}

function clearPendingResumeTask() {
  pendingResumeTask = null;
}

async function resumePendingTaskIfNeeded() {
  if (!pendingResumeTask || !executeAction || !bot) return;
  if (isThinking || bot._resumingTask) return;

  const task = pendingResumeTask;
  bot._resumingTask = true;
  bot._currentTask = `resume:${task.command}`;
  bot.lastInteractionTime = Date.now();
  bot.lastUserInteractionTime = 0;

  try {
    await sleep(2500);
    bot.chat(`Resuming my last task: ${task.command}`);
    await executeAction(task.action);
    clearPendingResumeTask();
  } catch (err) {
    console.error('Resume task failed:', err);
    bot.chat(`I couldn't fully resume "${task.command}".`);
  } finally {
    if (bot && bot._currentTask === `resume:${task.command}`) {
      bot._currentTask = null;
    }
    if (bot) {
      bot._resumingTask = false;
      bot.lastInteractionTime = Date.now();
    }
  }
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}


function refreshDashboardStatus(overrides = {}) {
  const hasBot = !!bot;
  const username = hasBot ? (bot.username || config.username) : config.username;
  setDashboardStatus({
    username,
    host: config.host,
    port: config.port,
    owner: config.owner || 'N/A',
    persona: process.env.PERSONA || 'No custom persona set.',
    provider: process.env.PROVIDER || 'openrouter',
    model: process.env.LLM_MODEL || '',
    apiKey: process.env.MODEL_KEY || process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY || '',
    botConnectionState: botConnecting ? 'connecting' : (hasBot ? 'online' : (botStartRequested ? 'stopped' : 'idle')),
    canStartBot: !botConnecting && !hasBot,
    ...overrides,
  });
}

function scheduleReconnect(reason = 'disconnect', delayMs = 5000) {
  if (!botStartRequested) {
    console.log(`Reconnect skipped (${reason}) because the bot has not been started from the dashboard.`);
    refreshDashboardStatus({
      currentTask: 'Waiting for you to start the bot.',
      botConnectionState: 'idle',
      canStartBot: true
    });
    return;
  }

  if (reconnectTimer) {
    console.log(`Reconnect already scheduled, skipping duplicate request (${reason}).`);
    return;
  }

  reconnectAttempt += 1;
  const finalDelay = reconnectDelayOverrideMs ?? delayMs;
  reconnectDelayOverrideMs = null;

  console.log(`Disconnected (${reason}). Reconnecting in ${Math.round(finalDelay / 1000)}s...`);
  refreshDashboardStatus({
    currentTask: `Disconnected (${reason}). Retrying in ${Math.round(finalDelay / 1000)}s...`,
    botConnectionState: 'stopped',
    canStartBot: false
  });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    createBot();
  }, finalDelay);
}

// ─── Create Bot ───────────────────────────────────────────────────────────────

function createBot() {
  if (botConnecting) {
    return;
  }

  clearReconnectTimer();
  botConnecting = true;
  refreshDashboardStatus({
    currentTask: `Connecting to Minecraft server at ${config.host}:${config.port}...`,
    botConnectionState: 'connecting',
    canStartBot: false
  });
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
  });
  installCompactChat(bot, { maxLength: parseInt(envValue('CHAT_MAX_LENGTH', '96'), 10) || 96 });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(pvp);
  bot.loadPlugin(armorManager);
  bot.loadPlugin(toolPlugin);
  bot.loadPlugin(autoEat);

  bot._config = config;
  updateBotInstance(bot);

  // Dynamic override of bot.digTime to prevent server desyncs by forcing isInWater to false
  bot.digTime = function (block) {
    if (!block) return 0;
    let type = null;
    let enchantments = [];
    const currentlyHeldItem = bot.heldItem;
    if (currentlyHeldItem) {
      type = currentlyHeldItem.type;
      enchantments = currentlyHeldItem.enchants || [];
    }
    const headEquipmentSlot = bot.getEquipmentDestSlot('head');
    const headEquippedItem = bot.inventory.slots[headEquipmentSlot];
    if (headEquippedItem) {
      enchantments = enchantments.concat(headEquippedItem.enchants || []);
    }
    const creative = bot.game.gameMode === 'creative';
    return block.digTime(
      type,
      creative,
      false, // isInWater forced to false
      !bot.entity.onGround,
      enchantments,
      bot.entity.effects
    );
  };

  // Custom state property used by action modules
  bot._currentTask = null;
  bot.lastInteractionTime = Date.now();

  bot.once('spawn', () => {
    console.log(`✅ ${config.username} spawned in the world`);
    reconnectAttempt = 0;
    botConnecting = false;
    refreshDashboardStatus({
      username: bot.username || config.username,
      currentTask: 'Idle',
      botConnectionState: 'online',
      canStartBot: false
    });

    if (bot.autoEat) {
      bot.autoEat.options = {
        priority: 'saturation',
        startAt: 14,
        bannedFood: ['rotten_flesh', 'spider_eye', 'pufferfish', 'poisonous_potato'],
        eatingTimeout: 3000,
        ignoreInventoryCheck: false,
        checkOnParticles: true
      };
    }

    const defaultMove = new Movements(bot);
    defaultMove.canSwim = true;
    defaultMove.allowSprinting = true;
    bot.pathfinder.setMovements(defaultMove);

    // Initialize the action executor with all modules
    executeAction = createExecutor(bot);
    bot.executeAction = executeAction;
    bot.runAIAutonomy = runAIAutonomy;
    bot.aiAutonomy = aiAutonomyState;
    bot.library = {
      functions: libraryFunctions,
      skills: librarySkills,
      world: libraryWorld,
      data: libraryData,
      calc: libraryCalc,
      resolveItemName,
      availableSkills: libraryFunctions.availableSkills,
      availableBuilds: libraryData.listKnownBuilds(),
      executeSkill: (...args) => libraryFunctions.executeSkill(bot, ...args),
    };

    // Initialize the brain (auto-eat, instant command handling, autonomous survival)
    libraryData.init?.(bot);
    miningRules.init?.(bot);
    resolveItemName.init?.(bot);
    brain.init(bot, { owner: config.owner });

    // Dynamic upgrades initialization
    (async () => {
      bot._llmConfig = llmConfig; // Save config reference
      pathfinderHooks.applyHooks(bot);
      bot._hudTracker = new HudTracker();
      await memory.init(bot);
      recovery.setupAutoRecovery(bot);
      await recovery.loadAndRestoreSnapshot(bot);
      modes.startModesLoop(bot);
    })().catch(err => console.error('[Spawn Init] Error:', err.message));

    // Initialize the Task Manager if task env is set
    if (process.env.MC_TASK) {
      (async () => {
        try {
          const { TaskManager } = require('./tasks/taskManager');
          const taskData = JSON.parse(process.env.MC_TASK);
          bot.taskManager = new TaskManager(bot, taskData);
          await bot.taskManager.initialize();

          const taskInterval = setInterval(async () => {
            if (!bot || !bot.taskManager) {
              clearInterval(taskInterval);
              return;
            }
            try {
              const check = await bot.taskManager.checkCompletion();
              if (check.done) {
                clearInterval(taskInterval);
                bot.chat(`[Task Completed] Score: ${check.score} | Reason: ${check.reason}`);
                await bot.taskManager.teardown();
                setTimeout(() => {
                  bot.quit();
                  process.exit(0);
                }, 1000);
              }
            } catch (err) {
              console.error('Error checking task completion:', err);
            }
          }, 2000);
        } catch (err) {
          console.error('Failed to initialize task manager:', err);
        }
      })();
    }

    bot.chat(`Hello! I'm ${config.username}, your AI assistant. Type !help to see what I can do.`);

    if (pendingResumeTask) {
      setTimeout(() => {
        resumePendingTaskIfNeeded().catch(err => {
          console.error('Deferred resume failed:', err);
        });
      }, 1000);
    }
  });

  bot.on('chat', async (username, message) => {
    if (username === bot.username) return;
    if (config.owner && username !== config.owner) {
      bot.chat(`Sorry ${username}, only ${config.owner} can command me.`);
      return;
    }

    // Any message from the owner resets the idle timer
    bot.lastInteractionTime = Date.now();

    if (!message.startsWith('!')) {
      const handled = await brain.chat.tryHandleChat(bot, username, message);
      if (handled) {
        console.log(`💬 Chat brain handled: "${message}"`);
      }
      return;
    }

    const command = message.slice(1).trim();
    await handleCommand(username, command);
  });

  bot.on('death', () => {
    console.log('💀 Bot died, respawning...');
    bot._currentTask = null;
    global.conversationHistory = [];
    bot.chat('I died! Ready for new commands.');
  });

  bot.on('kicked', (reason) => {
    const reasonText = typeof reason === 'string' ? reason : JSON.stringify(reason);
    console.log('Kicked:', reasonText);

    if (reasonText.includes('multiplayer.disconnect.duplicate_login')) {
      reconnectDelayOverrideMs = 15000;
      console.log('Duplicate login detected. Waiting longer before reconnecting.');
    }
  });
  bot.on('error', (err) => {
    const message = String(err?.message || err);
    console.error('Bot error:', err);

    if (message.includes('ECONNREFUSED')) {
      botConnecting = false;
      bot = null;
      updateBotInstance(null);
      refreshDashboardStatus({
        username: config.username,
        currentTask: `Minecraft server not reachable at ${config.host}:${config.port}.`,
        botConnectionState: 'stopped',
        canStartBot: true
      });
    }
  });

  bot.on('end', () => {
    const interruptedTask = bot?._currentTask;
    if (!pendingResumeTask && interruptedTask && !String(interruptedTask).startsWith('cortex:') && !String(interruptedTask).startsWith('autonomy:')) {
      pendingResumeTask = null;
    }
    botConnecting = false;
    bot = null;
    updateBotInstance(null);
    brain.shutdown();
    scheduleReconnect('end', 5000);
  });
}

async function startBotFromDashboard() {
  if (botConnecting) {
    return { started: false, reason: 'Bot connection is already in progress.' };
  }

  if (bot) {
    return { started: false, reason: 'Bot is already running.' };
  }

  botStartRequested = true;
  createBot();
  return { started: true };
}

async function saveSettingsFromDashboard(payload = {}, helpers = {}) {
  const nextHost = String(payload.host || '').trim() || 'localhost';
  const nextPort = String(payload.port || '').trim() || '25565';
  const nextOwner = String(payload.owner || '').trim();
  const nextUsername = String(payload.username || '').trim() || 'AIBot';
  const updates = {
    MC_HOST: nextHost,
    MC_PORT: nextPort,
    MC_USERNAME: nextUsername,
    OWNER_USERNAME: nextOwner,
    PROVIDER: String(payload.provider || '').trim() || 'openrouter',
    LLM_MODEL: String(payload.model || '').trim(),
    MODEL_KEY: String(payload.apiKey || '').trim(),
    PERSONA: String(payload.persona || '').trim(),
  };

  if (typeof helpers.updateEnvFile === 'function') {
    helpers.updateEnvFile(updates);
  }

  Object.entries(updates).forEach(([key, value]) => {
    process.env[key] = value;
  });

  // Update in-memory config object
  config.host = nextHost;
  config.port = parseInt(nextPort, 10) || 25565;
  config.owner = nextOwner;
  config.username = nextUsername;

  refreshDashboardStatus({
    username: nextUsername,
    host: nextHost,
    port: parseInt(nextPort, 10) || 25565,
    owner: nextOwner || 'N/A',
    provider: updates.PROVIDER,
    model: updates.LLM_MODEL,
    apiKey: updates.MODEL_KEY,
    persona: updates.PERSONA || 'No custom persona set.'
  });

  return {
    saved: true,
    message: 'Settings saved to .env. Restart the bot process to fully apply provider changes.'
  };
}


// ─── AI Decision Engine ───────────────────────────────────────────────────────

const PERSONA = process.env.PERSONA || process.env.presona || '';

const SYSTEM_PROMPT = `You are an AI agent controlling a Minecraft bot named ${config.username}. 
${PERSONA ? `\n=== CHARACTER PERSONA ===\n${PERSONA}\n` : ''}
You can see the current world state and must decide what actions to take.

You respond ONLY with a JSON object. No extra text, no markdown, just valid JSON.

IMPORTANT: Simple tasks like eating, crafting tools, crafting food, and gearing up are handled INSTANTLY by the bot's built-in brain. For those, just use a "chat" action to tell the player you're doing it — the brain intercepts the command before the LLM is even called. Focus on complex multi-step tasks that require planning.

Available actions:

=== BASIC ===
- {"action": "chat", "message": "text to say in game"}
- {"action": "goto", "x": number, "y": number, "z": number}
- {"action": "attack", "target": "entity_name"}
- {"action": "follow", "player": "username"}
- {"action": "stop"}
- {"action": "craft", "item": "item_name", "count": number}
- {"action": "equip", "item": "item_name"}
- {"action": "eat", "item": "food_item"}
- {"action": "collect"}
- {"action": "find_block", "block": "block_name"}

=== BUILDING ===
- {"action": "place", "block": "block_name", "x": number, "y": number, "z": number}
- {"action": "build", "block": "block_name", "x": number, "y": number, "z": number, "width": number, "height": number, "depth": number, "type": "walls|floor|solid|shell"}
- {"action": "fill", "block": "block_name", "x1": number, "y1": number, "z1": number, "x2": number, "y2": number, "z2": number}
- {"action": "house_plan", "blueprint": "home|farm|animal_pen|cooking_shack|storage_hut|watch_tower|ironfarm"}
- {"action": "build_house", "blueprint": "home|farm|animal_pen|cooking_shack|storage_hut|watch_tower|ironfarm", "x": number, "y": number, "z": number, "facing": "north|south|east|west"}

=== MINING & WOOD ===
- {"action": "mine", "block": "block_name", "count": number}
- {"action": "strip_mine", "direction": "north|south|east|west", "length": number, "y": number}
- {"action": "chop_tree"}
- {"action": "gather_wood", "count": number, "replant": true|false}

=== INVENTORY & CHESTS ===
- {"action": "deposit", "item": "item_name", "count": number}
- {"action": "deposit_all", "keep": ["item1", "item2"]}
- {"action": "withdraw", "item": "item_name", "count": number}
- {"action": "inventory_list"}
- {"action": "sort_inventory"}

=== FARMING & FOOD ===
- {"action": "create_farm", "x": number, "y": number, "z": number, "width": number, "length": number, "crop": "wheat_seeds|carrot|potato|beetroot_seeds"}
- {"action": "plant", "crop": "seed_name"}
- {"action": "harvest", "crop": "crop_name", "replant": true|false}
- {"action": "farm_cycle"}
- {"action": "auto_eat"}
- {"action": "craft_food", "item": "bread|cooked_beef|etc", "count": number}

=== META ===
- {"action": "sequence", "steps": [array of actions above]}

GUIDELINES:
- For multi-step tasks, use "sequence" to chain actions.
- Always pick the most logical action given the world state and inventory.
- If the player asks to build something, calculate approximate coordinates relative to the bot's position.
- If the player asks for a house or survival structure, prefer "build_house". The builder can gather missing core materials like logs, cobblestone, sand, coal, and some crafted parts before construction.
- For mining, prefer the correct tool. The bot auto-equips the best tool.
- The bot auto-eats when hungry, auto-crafts weapons before combat, and auto-equips armor.
- If the task is impossible or you need clarification, use "chat" to explain why.
- Keep every "chat" message short: one compact sentence, under 80 characters.
- When building structures, use "build" with type "walls" for custom sizes, or "build_house" for built-in JSON blueprints like home, farm, animal pen, cooking shack, storage hut, watch tower, and ironfarm.
- For farming, use "create_farm" to set up new farms, "harvest" with replant for ongoing harvesting.
- Use "house_plan" when you want to report the blueprint and materials before building.

=== MEMORY MANAGEMENT ===
You can manage your persistent long-term memory by adding the "manage_memories" array at the root of your JSON response.
Format:
{
  "action": "...",
  ...,
  "manage_memories": [
    "ADD:text to remember",
    "DELETE:MEM-shortId",
    "UPDATE:MEM-shortId:new text to remember"
  ]
}
Use memories to keep track of coordinates of key locations (chests, homes, farms), player agreements, or long-term plans.`;

const AUTONOMY_PROMPT = `You are the autonomous supervisor for a Minecraft bot.
Return ONLY one JSON action object. No markdown, no explanation.

Goal: keep the bot productively alive when the player is idle.
The local survival cortex already handles emergencies: combat, drowning, eating, death recovery, and night shelter.
You should choose only safe long-term survival improvements.

Allowed autonomous actions:
- {"action":"chat","message":"short status"}
- {"action":"collect"}
- {"action":"chop_tree"}
- {"action":"gather_wood","count":1,"replant":false}
- {"action":"mine","block":"stone|cobblestone|coal_ore|iron_ore|sand|sandstone","count":number}
- {"action":"craft","item":"crafting_table|stick|torch|furnace|bread|shield|wooden_pickaxe|stone_pickaxe|stone_sword|stone_axe|iron_pickaxe|iron_sword","count":number}
- {"action":"farm_cycle"}
- {"action":"sequence","steps":[2 to 5 allowed actions]}

Rules:
- Do not attack unless directly commanded by player; cortex handles threats.
- Do not build large structures unless enough materials are clearly available.
- Do not mine ores that require a better pickaxe than the bot has.
- Prefer wooden-first then stone then iron progression.
- If biome strategy says relocate for wood/shore, prefer gather_wood or safe mining before wandering.
- Keep actions small: counts <= 16 for mining, count <= 1 for gather_wood.
- If no productive safe step exists, return {"action":"chat","message":"Autonomy stable: monitoring."}.`;

const AUTONOMY_ALLOWED_ACTIONS = new Set([
  'chat',
  'collect',
  'chop_tree',
  'gather_wood',
  'mine',
  'craft',
  'farm_cycle',
  'sequence',
]);

const AUTONOMY_MINE_BLOCKS = new Set([
  'stone',
  'cobblestone',
  'coal_ore',
  'iron_ore',
  'sand',
  'sandstone',
]);

const AUTONOMY_CRAFT_ITEMS = new Set([
  'crafting_table',
  'stick',
  'torch',
  'furnace',
  'bread',
  'shield',
  'wooden_pickaxe',
  'stone_pickaxe',
  'stone_sword',
  'stone_axe',
  'iron_pickaxe',
  'iron_sword',
]);

const responseSchema = {
  name: "minecraft_action",
  strict: true,
  schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "chat", "goto", "attack", "follow", "stop", "craft", "equip", "eat", "collect",
          "place", "build", "fill", "house_plan", "build_house",
          "mine", "strip_mine", "chop_tree", "gather_wood",
          "deposit", "deposit_all", "withdraw", "inventory_list", "sort_inventory",
          "create_farm", "plant", "harvest", "farm_cycle", "auto_eat", "craft_food",
          "sequence", "find_block"
        ]
      },
      message: { type: "string" },
      x: { type: "number" },
      y: { type: "number" },
      z: { type: "number" },
      x1: { type: "number" },
      y1: { type: "number" },
      z1: { type: "number" },
      x2: { type: "number" },
      y2: { type: "number" },
      z2: { type: "number" },
      target: { type: "string" },
      player: { type: "string" },
      item: { type: "string" },
      count: { type: "number" },
      food_item: { type: "string" },
      block: { type: "string" },
      width: { type: "number" },
      height: { type: "number" },
      depth: { type: "number" },
      type: { type: "string", enum: ["walls", "floor", "solid", "shell"] },
      blueprint: { type: "string", enum: ["home", "farm", "animal_pen", "cooking_shack", "storage_hut", "watch_tower", "ironfarm"] },
      facing: { type: "string", enum: ["north", "south", "east", "west"] },
      direction: { type: "string", enum: ["north", "south", "east", "west"] },
      length: { type: "number" },
      replant: { type: "boolean" },
      crop: { type: "string" },
      keep: { type: "array", items: { type: "string" } },
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [
                "chat", "goto", "attack", "follow", "stop", "craft", "equip", "eat", "collect",
                "place", "build", "fill", "house_plan", "build_house",
                "mine", "strip_mine", "chop_tree", "gather_wood",
                "deposit", "deposit_all", "withdraw", "inventory_list", "sort_inventory",
                "create_farm", "plant", "harvest", "farm_cycle", "auto_eat", "craft_food",
                "find_block"
              ]
            },
            message: { type: "string" },
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
            x1: { type: "number" },
            y1: { type: "number" },
            z1: { type: "number" },
            x2: { type: "number" },
            y2: { type: "number" },
            z2: { type: "number" },
            target: { type: "string" },
            player: { type: "string" },
            item: { type: "string" },
            count: { type: "number" },
            food_item: { type: "string" },
            block: { type: "string" },
            width: { type: "number" },
            height: { type: "number" },
            depth: { type: "number" },
            type: { type: "string", enum: ["walls", "floor", "solid", "shell"] },
            blueprint: { type: "string", enum: ["home", "farm", "animal_pen", "cooking_shack", "storage_hut", "watch_tower", "ironfarm"] },
            facing: { type: "string", enum: ["north", "south", "east", "west"] },
            direction: { type: "string", enum: ["north", "south", "east", "west"] },
            length: { type: "number" },
            replant: { type: "boolean" },
            crop: { type: "string" }
          },
          required: ["action"],
          additionalProperties: false
        }
      },
      manage_memories: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["action"],
    additionalProperties: false
  }
};

async function askAI(username, userMessage) {
  if (!config.llmApiKey && config.provider !== 'ollama') {
    throw new Error('Missing MODEL_KEY (or legacy LLM_API_KEY / OPENROUTER_API_KEY)');
  }

  const statusUpdate = bot._hudTracker ? bot._hudTracker.generateDiff(bot) : getWorldState(bot);

  global.conversationHistory.push({
    role: 'user',
    content: `Player ${username} says: "${userMessage}"\n\n${statusUpdate}`,
  });

  // Keep history to last 10 exchanges to avoid token bloat
  if (global.conversationHistory.length > 20) {
    global.conversationHistory = global.conversationHistory.slice(-20);
  }

  // Retrieve memories
  const relevantMemories = await memory.searchRelevant(userMessage, 5);
  const memoriesText = relevantMemories.length > 0
    ? relevantMemories.map(r => `[${r.shortId}] ${r.text}`).join('\n')
    : 'None';

  let raw = '';

  for (let attempt = 0; attempt <= MAX_AI_EMPTY_RETRIES; attempt++) {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (config.llmApiKey) {
      headers['Authorization'] = `Bearer ${config.llmApiKey}`;
    }
    if (config.provider !== 'ollama') {
      if (config.llmReferer) headers['HTTP-Referer'] = config.llmReferer;
      if (config.llmTitle) headers['X-Title'] = config.llmTitle;
    }

    // Assemble messages array optimizing for prefix caching (static system prompt + historical conversation prefix)
    const messages = [
      { 
        role: 'system', 
        content: SYSTEM_PROMPT,
        // Enable Claude prompt caching if using Anthropic Claude models on OpenRouter
        ...(config.llmModel.includes('anthropic') || config.llmModel.includes('claude') 
          ? { cache_control: { type: 'ephemeral' } } 
          : {})
      }
    ];

    if (global.conversationHistory.length > 0) {
      // Add all previous messages except the very last one we just added (the new query)
      const previousHistory = global.conversationHistory.slice(0, -1);
      messages.push(...previousHistory);
      
      // Inject the turn-specific dynamic context (memories)
      messages.push({
        role: 'system',
        content: `[CONTEXT] Relevant memories retrieved:\n${memoriesText}`
      });
      
      // Add the current user query (which is also dynamic)
      messages.push(global.conversationHistory[global.conversationHistory.length - 1]);
    } else {
      if (relevantMemories.length > 0) {
        messages.push({
          role: 'system',
          content: `[CONTEXT] Relevant memories retrieved:\n${memoriesText}`
        });
      }
      messages.push(...global.conversationHistory);
    }

    const response = await fetch(`${config.llmApiBase}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.llmModel,
        max_tokens: 512, // Optimized down from 1024 (sufficient for any valid JSON action schema)
        temperature: 0.2,
        messages,
        response_format: {
          type: "json_schema",
          json_schema: responseSchema
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM request failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    raw = data?.choices?.[0]?.message?.content?.trim() || '';

    if (raw) {
      break;
    }

    if (attempt < MAX_AI_EMPTY_RETRIES) {
      console.warn(`AI returned empty response (attempt ${attempt + 1}/${MAX_AI_EMPTY_RETRIES + 1}), retrying...`);
      await sleep(600 * (attempt + 1));
    }
  }

  if (!raw) {
    throw new Error(`LLM returned an empty response after ${MAX_AI_EMPTY_RETRIES + 1} attempts`);
  }

  global.conversationHistory.push({
    role: 'assistant',
    content: raw,
  });

  return raw;
}

function sanitizeAutonomyAction(action, depth = 0) {
  if (!action || typeof action !== 'object') return null;
  if (!AUTONOMY_ALLOWED_ACTIONS.has(action.action)) return null;

  if (action.action === 'sequence') {
    if (depth > 0 || !Array.isArray(action.steps)) return null;
    const steps = action.steps
      .slice(0, 5)
      .map(step => sanitizeAutonomyAction(step, depth + 1))
      .filter(Boolean);
    return steps.length > 0 ? { action: 'sequence', steps } : null;
  }

  if (action.action === 'mine') {
    const block = String(action.block || '').trim().toLowerCase();
    if (!AUTONOMY_MINE_BLOCKS.has(block)) return null;
    const count = Math.max(1, Math.min(parseInt(action.count, 10) || 4, 16));
    return { action: 'mine', block, count };
  }

  if (action.action === 'craft') {
    const item = String(action.item || '').trim().replace(/\s+/g, '_').toLowerCase();
    if (!AUTONOMY_CRAFT_ITEMS.has(item)) return null;
    const count = Math.max(1, Math.min(parseInt(action.count, 10) || 1, 8));
    return { action: 'craft', item, count };
  }

  if (action.action === 'gather_wood') {
    return { action: 'gather_wood', count: 1, replant: false };
  }

  if (action.action === 'chat') {
    const message = String(action.message || 'Autonomy stable: monitoring.').slice(0, 120);
    return { action: 'chat', message };
  }

  return { action: action.action };
}

const autonomyResponseSchema = {
  name: "autonomy_action",
  strict: true,
  schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["chat", "collect", "chop_tree", "gather_wood", "mine", "craft", "farm_cycle", "sequence"]
      },
      message: { type: "string" },
      count: { type: "number" },
      block: { type: "string", enum: ["stone", "cobblestone", "coal_ore", "iron_ore", "sand", "sandstone"] },
      item: {
        type: "string",
        enum: [
          "crafting_table", "stick", "torch", "furnace", "bread", "shield",
          "wooden_pickaxe", "stone_pickaxe", "stone_sword", "stone_axe",
          "iron_pickaxe", "iron_sword"
        ]
      },
      replant: { type: "boolean" },
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["chat", "collect", "chop_tree", "gather_wood", "mine", "craft", "farm_cycle"]
            },
            message: { type: "string" },
            count: { type: "number" },
            block: { type: "string", enum: ["stone", "cobblestone", "coal_ore", "iron_ore", "sand", "sandstone"] },
            item: {
              type: "string",
              enum: [
                "crafting_table", "stick", "torch", "furnace", "bread", "shield",
                "wooden_pickaxe", "stone_pickaxe", "stone_sword", "stone_axe",
                "iron_pickaxe", "iron_sword"
              ]
            },
            replant: { type: "boolean" }
          },
          required: ["action"],
          additionalProperties: false
        }
      }
    },
    required: ["action"],
    additionalProperties: false
  }
};

async function askAutonomousAI(context = {}) {
  if (!config.llmApiKey && config.provider !== 'ollama') {
    return { action: 'chat', message: 'AI autonomy disabled: missing model key.' };
  }

  const goalReadiness = require('./brain/goalReadiness');
  const worldState = getWorldState(bot);
  const cortexStatus = brain.cortex?.getStatus?.() || {};
  const readiness = goalReadiness.buildAutonomyReadiness(bot);
  const prompt = [
    worldState,
    '',
    '=== CORTEX STATUS ===',
    JSON.stringify(cortexStatus, null, 2),
    '',
    '=== INVENTORY / GOAL READINESS ===',
    JSON.stringify(readiness, null, 2),
    '',
    '=== AUTONOMY CONTEXT ===',
    JSON.stringify(context, null, 2),
  ].join('\n');

  global.autonomyHistory.push({ role: 'user', content: prompt });
  if (global.autonomyHistory.length > 8) {
    global.autonomyHistory = global.autonomyHistory.slice(-8);
  }

  const headers = { 'Content-Type': 'application/json' };
  if (config.llmApiKey) {
    headers.Authorization = `Bearer ${config.llmApiKey}`;
  }
  if (config.provider !== 'ollama') {
    if (config.llmReferer) headers['HTTP-Referer'] = config.llmReferer;
    if (config.llmTitle) headers['X-Title'] = config.llmTitle;
  }

  const response = await fetch(`${config.llmApiBase}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.llmModel,
      max_tokens: 512,
      temperature: 0.15,
      messages: [
        { role: 'system', content: AUTONOMY_PROMPT },
        ...global.autonomyHistory,
      ],
      response_format: {
        type: "json_schema",
        json_schema: autonomyResponseSchema
      }
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Autonomy LLM request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content?.trim() || '';
  if (!raw) throw new Error('Autonomy LLM returned empty plan');
  global.autonomyHistory.push({ role: 'assistant', content: raw });

  const parsed = extractJson(raw);
  return sanitizeAutonomyAction(parsed);
}

async function runAIAutonomy(context = {}) {
  if (!aiAutonomyState.enabled) return { success: false, reason: 'disabled' };
  if (!executeAction || !bot) return { success: false, reason: 'not ready' };
  if (isThinking || bot.isThinking) return { success: false, reason: 'busy thinking' };

  const now = Date.now();
  const forcePlan = !!context.force;
  if (!forcePlan && now - aiAutonomyState.lastPlanAt < config.aiAutonomyIntervalMs) {
    return { success: false, reason: 'cooldown' };
  }

  aiAutonomyState.lastPlanAt = now;
  bot.isThinking = true;
  bot._currentTask = 'autonomy:ai_supervisor';

  try {
    if (aiAutonomyState.mode === 'rl') {
      const rlEngine = require('./brain/rlEngine');
      const rlCritic = require('./brain/rlCritic');

      const stateBefore = rlEngine.discretizeState(bot);
      const snapshotBefore = rlCritic.takeSnapshot(bot);

      const actionName = rlEngine.selectAction(stateBefore, aiAutonomyState.rlStats.epsilon, bot);
      console.log(`[RL Autonomy] Selected action: ${actionName} for state: ${stateBefore}`);

      let executionSuccess = false;
      let errorMsg = '';
      try {
        const result = await rlEngine.executeRLAction(bot, actionName);
        executionSuccess = !!result.success;
        if (result?.error) errorMsg = result.error;
        else if (result?.reason) errorMsg = result.reason;
      } catch (err) {
        errorMsg = err.message;
      }

      const stateAfter = rlEngine.discretizeState(bot);
      const evaluation = await rlCritic.recordExperience(bot, `autonomy_rl_${actionName}`, snapshotBefore, executionSuccess, errorMsg);

      const reward = evaluation?.reward || 0;
      rlEngine.updateQValue(stateBefore, actionName, reward, stateAfter, {
        terminal: !executionSuccess && /unknown|missing|no .*available|no target|no pickaxe|already sufficient/i.test(errorMsg)
      });

      // Update local stats
      aiAutonomyState.rlStats.totalSteps++;
      aiAutonomyState.rlStats.totalReward += reward;
      aiAutonomyState.rlStats.lastReward = reward;
      aiAutonomyState.rlStats.lastAction = actionName;
      aiAutonomyState.rlStats.lastState = stateBefore;
      aiAutonomyState.rlStats.epsilon = rlEngine.recommendEpsilon(
        aiAutonomyState.rlStats.epsilon,
        aiAutonomyState.rlStats,
        reward
      );

      return { success: true, mode: 'rl', action: actionName, reward, epsilon: aiAutonomyState.rlStats.epsilon };
    } else {
      const action = await askAutonomousAI(context);
      if (!action) return { success: false, reason: 'unsafe or invalid plan' };
      const goalReadiness = require('./brain/goalReadiness');
      const preflight = goalReadiness.evaluateActionReadiness(bot, action);
      if (!preflight.ready) {
        return {
          success: false,
          action,
          reason: `goal_not_ready:${preflight.reason}`,
          missing: preflight.missing || [],
        };
      }
      console.log('AI autonomy action:', JSON.stringify(action));

      const rlCritic = require('./brain/rlCritic');
      const snapshotBefore = rlCritic.takeSnapshot(bot);

      let executionSuccess = true;
      let errorMsg = '';
      try {
        await coder.execute(bot, async () => {
          const executionResult = await executeAction(action);
          if (executionResult && executionResult.success === false) {
            executionSuccess = false;
            errorMsg = executionResult.error || 'autonomy_action_failed';
          }
        });
      } catch (err) {
        executionSuccess = false;
        errorMsg = err.message;
      }

      // Record critic critique for LLM learning
      await rlCritic.recordExperience(bot, action.action, snapshotBefore, executionSuccess, errorMsg);

      return executionSuccess
        ? { success: true, action }
        : { success: false, action, reason: errorMsg || 'autonomy_action_failed' };
    }
  } catch (err) {
    aiAutonomyState.lastErrorAt = Date.now();
    console.error('AI autonomy error:', err);
    return { success: false, reason: err.message };
  } finally {
    bot.isThinking = false;
    if (bot._currentTask === 'autonomy:ai_supervisor') {
      bot._currentTask = null;
    }
    bot.lastInteractionTime = Date.now() - Math.max(config.aiAutonomyIntervalMs, 30000);
  }
}

function findFailedNode(node) {
  if (!node) return null;
  if (node.status === 'failed' && node.type === 'ACTION') {
    return node;
  }
  for (const child of node.children) {
    const failed = findFailedNode(child);
    if (failed) return failed;
  }
  return null;
}

async function handleCommand(username, command) {
  bot.lastUserInteractionTime = Date.now();
  bot.lastInteractionTime = Date.now();

  if (command === 'help') {
    bot.chat('Commands: !<natural language> | !stop | !status | !reset | !commands');
    bot.chat('Instant: !eat | !craft <item> | !gear up | !food report | !craft report');
    bot.chat('Examples: !mine 10 stone | !build a house | !chop trees | !craft diamond sword');
    return;
  }

  if (command === 'stop') {
    await coder.stop(bot);
    clearPendingResumeTask();
    bot.chat('Stopped everything.');
    return;
  }

  if (command === 'status') {
    const ws = getWorldState(bot);
    const lines = ws.split('\n').slice(0, 8);
    lines.forEach(l => bot.chat(l));
    bot.chat(`AI autonomy: ${aiAutonomyState.enabled ? 'ON' : 'OFF'} | interval ${Math.round(config.aiAutonomyIntervalMs / 1000)}s`);
    return;
  }

  if (/^(ai\s*)?auto(nomy)?\s+on$/i.test(command)) {
    aiAutonomyState.enabled = true;
    bot.chat('AI autonomy enabled. I will let the AI supervise safe idle goals.');
    return;
  }

  if (/^(ai\s*)?auto(nomy)?\s+off$/i.test(command)) {
    aiAutonomyState.enabled = false;
    bot.chat('AI autonomy disabled. Local cortex survival remains active.');
    return;
  }

  if (/^(ai\s*)?auto(nomy)?\s*(status|report)?$/i.test(command)) {
    const lastPlan = aiAutonomyState.lastPlanAt ? `${Math.round((Date.now() - aiAutonomyState.lastPlanAt) / 1000)}s ago` : 'never';
    const lastError = aiAutonomyState.lastErrorAt ? `${Math.round((Date.now() - aiAutonomyState.lastErrorAt) / 1000)}s ago` : 'none';
    bot.chat(`AI autonomy: ${aiAutonomyState.enabled ? 'ON' : 'OFF'} | last plan ${lastPlan} | last error ${lastError}`);
    return;
  }

  if (command === 'reset') {
    global.conversationHistory = [];
    global.autonomyHistory = [];
    bot._currentTask = null;
    clearPendingResumeTask();
    bot.chat('Memory cleared, ready for new tasks!');
    return;
  }

  if (command === 'commands') {
    bot.chat('⚡ Instant (brain): eat, craft <item>, make planks, make sticks, gear up');
    bot.chat('⚡ Instant (brain): food report, craft report, attack, defend');
    bot.chat('🔨 Build: place, build, fill, house, wall, clear');
    bot.chat('⛏️ Gather: mine, strip_mine, chop_tree, gather_wood');
    bot.chat('📦 Items: deposit, withdraw, deposit_all, inventory_list');
    bot.chat('🌾 Farm: create_farm, plant, harvest, farm_cycle');
    bot.chat('🤖 Auto: bot auto-eats, auto-equips armor, auto-crafts gear');
    return;
  }

  if (isThinking) {
    bot.chat("I'm still thinking about the last command, please wait...");
    return;
  }

  // ── Brain intercept: handle simple commands instantly ──
  try {
    bot._currentTask = command;
    const handled = await brain.tryHandle(bot, command, username);
    if (handled) {
      console.log(`🧠 Brain handled: "${command}"`);
      if (bot._currentTask === command) {
        bot._currentTask = null;
      }
      return;
    }
  } catch (err) {
    console.log(`🧠 Brain error: ${err.message}`);
    if (bot._currentTask === command) {
      bot._currentTask = null;
    }
    // Fall through to LLM
  }

  // ── LLM path: complex commands ──
  bot.chat(`Thinking about: "${command}"...`);
  isThinking = true;
  bot.isThinking = true;
  bot._currentTask = command;

  try {
    const raw = await askAI(username, command);
    console.log('AI response:', raw);

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      try {
        parsed = extractJson(raw);
      } catch {
        bot.chat("Hmm, I got confused. Let me try again...");
        console.error('Failed to parse AI response:', raw);
        isThinking = false;
        bot.isThinking = false;
        return;
      }
    }

    // Process memory commands
    if (parsed && Array.isArray(parsed.manage_memories)) {
      for (const op of parsed.manage_memories) {
        try {
          if (op.startsWith('ADD:')) {
            await memory.insertMemory(op.slice(4).trim());
          } else if (op.startsWith('DELETE:')) {
            await memory.deleteMemoryByShortId(op.slice(7).trim());
          } else if (op.startsWith('UPDATE:')) {
            const parts = op.slice(7).trim().split(':');
            const shortId = parts[0].trim();
            const newText = parts.slice(1).join(':').trim();
            await memory.updateMemoryByShortId(shortId, newText);
          }
        } catch (memErr) {
          console.error('[Memory] Operation failed:', op, memErr.message);
        }
      }
    }

    const { TaskNode, TaskTreeExecutor } = require('./tasks/taskTree');
    const treeExecutor = new TaskTreeExecutor(bot);
    let rootNode;

    if (parsed.action === 'sequence' && Array.isArray(parsed.steps)) {
      rootNode = new TaskNode('root_seq', 'NL', `Sequence of ${parsed.steps.length} tasks`);
      parsed.steps.forEach((step, idx) => {
        rootNode.addChild(new TaskNode(`step_${idx}`, 'ACTION', `Step ${idx + 1}: ${step.action}`, step));
      });
    } else {
      rootNode = new TaskNode('root_single', 'ACTION', `Execute action: ${parsed.action}`, parsed);
    }

    setPendingResumeTask(command, parsed, { source: 'llm', username });
    let executeSuccess = true;
    let executeError = '';
    try {
      await coder.execute(bot, async () => {
        executeSuccess = await treeExecutor.run(rootNode);
      });
    } catch (err) {
      executeSuccess = false;
      executeError = err.message;
    }
    clearPendingResumeTask();

    if (!executeSuccess) {
      const failedNode = findFailedNode(rootNode);
      const errorDetail = failedNode ? `'${failedNode.data.action}' failed: ${failedNode.label}` : (executeError || 'Unknown task failure');
      const feedback = `[System Feedback] Plan execution failed: ${errorDetail}`;
      global.conversationHistory.push({
        role: 'system',
        content: feedback
      });
      console.log(`[Feedback Loop] Added execution feedback to context: ${feedback}`);
      bot.chat(`I failed to complete the action sequence: ${failedNode ? failedNode.data.action : 'error'}.`);
    }

  } catch (err) {
    console.error('AI error:', err);
    if (String(err.message || '').includes('empty response')) {
      bot.chat("My AI brain returned an empty plan. Please try the command again, or use a simpler command.");
    } else {
      bot.chat('Something went wrong with my brain. Try again!');
    }
  } finally {
    isThinking = false;
    bot.isThinking = false;
    if (bot._currentTask === command) bot._currentTask = null;
    bot.lastInteractionTime = Date.now();
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

registerDashboardControls({
  startBot: startBotFromDashboard,
  saveSettings: saveSettingsFromDashboard
});

startDashboardServer(3000);
refreshDashboardStatus({
  username: config.username,
  currentTask: 'Waiting for you to start the bot.',
  botConnectionState: 'idle',
  canStartBot: true
});
