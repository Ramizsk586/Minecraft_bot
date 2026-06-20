require('dotenv').config();
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

const { normalizeMinecraftVersion, extractJson, sleep } = require('./utils');
const { getWorldState } = require('./worldState');
const { createExecutor } = require('./actions/index');
const brain = require('./brain/index');
const libraryFunctions = require('./library/functions');
const librarySkills = require('./library/skills');
const libraryWorld = require('./library/world');
const libraryData = require('./library/data');
const libraryCalc = require('./library/modules/calc');
const { resolveItemName } = require('./library/modules/itemNameResolver');

// ─── Config ──────────────────────────────────────────────────────────────────

const config = {
  host: process.env.MC_HOST || 'localhost',
  port: parseInt(process.env.MC_PORT) || 25565,
  username: process.env.MC_USERNAME || 'AIBot',
  version: normalizeMinecraftVersion(process.env.MC_VERSION),
  owner: process.env.OWNER_USERNAME || '',
  llmApiBase: process.env.LLM_API_BASE || 'https://openrouter.ai/api/v1',
  llmApiKey: process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY || '',
  llmModel: process.env.LLM_MODEL || 'openai/gpt-4o-mini',
  llmReferer: process.env.OPENROUTER_SITE_URL || '',
  llmTitle: process.env.OPENROUTER_APP_NAME || 'Minecraft AI Bot',
};

// ─── State ────────────────────────────────────────────────────────────────────

let bot;
let conversationHistory = [];
let isThinking = false;
let executeAction = null;

// ─── Create Bot ───────────────────────────────────────────────────────────────

function createBot() {
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
  });

  bot.loadPlugin(pathfinder);

  // Custom state property used by action modules
  bot._currentTask = null;
  bot.lastInteractionTime = Date.now();

  bot.once('spawn', () => {
    console.log(`✅ ${config.username} spawned in the world`);
    const defaultMove = new Movements(bot);
    bot.pathfinder.setMovements(defaultMove);

    // Initialize the action executor with all modules
    executeAction = createExecutor(bot);
    bot.executeAction = executeAction;
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
    brain.init(bot, { owner: config.owner });

    bot.chat(`Hello! I'm ${config.username}, your AI assistant. Type !help to see what I can do.`);
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
    conversationHistory = [];
    bot.chat('I died! Ready for new commands.');
  });

  bot.on('kicked', (reason) => console.log('Kicked:', reason));
  bot.on('error', (err) => console.error('Bot error:', err));

  bot.on('end', () => {
    console.log('Disconnected. Reconnecting in 5s...');
    bot._currentTask = null;
    brain.shutdown();
    setTimeout(createBot, 5000);
  });
}


// ─── AI Decision Engine ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI agent controlling a Minecraft bot named ${config.username}. 
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
- When building structures, use "build" with type "walls" for custom sizes, or "build_house" for built-in JSON blueprints like home, farm, animal pen, cooking shack, storage hut, watch tower, and ironfarm.
- For farming, use "create_farm" to set up new farms, "harvest" with replant for ongoing harvesting.
- Use "house_plan" when you want to report the blueprint and materials before building.`;

async function askAI(username, userMessage) {
  if (!config.llmApiKey) {
    throw new Error('Missing LLM_API_KEY or OPENROUTER_API_KEY');
  }

  const worldState = getWorldState(bot);

  conversationHistory.push({
    role: 'user',
    content: `Player ${username} says: "${userMessage}"\n\n${worldState}`,
  });

  // Keep history to last 10 exchanges to avoid token bloat
  if (conversationHistory.length > 20) {
    conversationHistory = conversationHistory.slice(-20);
  }

  const response = await fetch(`${config.llmApiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.llmApiKey}`,
      'Content-Type': 'application/json',
      ...(config.llmReferer ? { 'HTTP-Referer': config.llmReferer } : {}),
      ...(config.llmTitle ? { 'X-Title': config.llmTitle } : {}),
    },
    body: JSON.stringify({
      model: config.llmModel,
      max_tokens: 1024,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...conversationHistory,
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content?.trim();

  if (!raw) {
    throw new Error('LLM returned an empty response');
  }

  conversationHistory.push({
    role: 'assistant',
    content: raw,
  });

  return raw;
}

// ─── Command Handler ──────────────────────────────────────────────────────────

async function handleCommand(username, command) {
  bot.lastInteractionTime = Date.now();

  // If autonomy was active, abort it immediately
  if (brain.survive && brain.survive.isActive()) {
    brain.survive.abort(bot);
  }

  if (command === 'help') {
    bot.chat('Commands: !<natural language> | !stop | !status | !reset | !commands');
    bot.chat('Instant: !eat | !craft <item> | !gear up | !food report | !craft report');
    bot.chat('Examples: !mine 10 stone | !build a house | !chop trees | !craft diamond sword');
    return;
  }

  if (command === 'stop') {
    bot.pathfinder.setGoal(null);
    bot._currentTask = null;
    bot.chat('Stopped everything.');
    return;
  }

  if (command === 'status') {
    const ws = getWorldState(bot);
    const lines = ws.split('\n').slice(0, 8);
    lines.forEach(l => bot.chat(l));
    return;
  }

  if (command === 'reset') {
    conversationHistory = [];
    bot._currentTask = null;
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
    const handled = await brain.tryHandle(bot, command);
    if (handled) {
      console.log(`🧠 Brain handled: "${command}"`);
      return;
    }
  } catch (err) {
    console.log(`🧠 Brain error: ${err.message}`);
    // Fall through to LLM
  }

  // ── LLM path: complex commands ──
  bot.chat(`Thinking about: "${command}"...`);
  isThinking = true;
  bot._currentTask = command;

  try {
    const raw = await askAI(username, command);
    console.log('AI response:', raw);

    let parsed;
    try {
      parsed = extractJson(raw);
    } catch {
      bot.chat("Hmm, I got confused. Let me try again...");
      console.error('Failed to parse AI response:', raw);
      isThinking = false;
      return;
    }

    await executeAction(parsed);

  } catch (err) {
    console.error('AI error:', err);
    bot.chat('Something went wrong with my brain. Try again!');
  } finally {
    isThinking = false;
    if (bot._currentTask === command) bot._currentTask = null;
    bot.lastInteractionTime = Date.now();
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

createBot();
