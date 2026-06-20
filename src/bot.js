require('dotenv').config();
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

const { normalizeMinecraftVersion, extractJson, findBestFood, sleep } = require('./utils');
const { getWorldState } = require('./worldState');
const { createExecutor } = require('./actions/index');

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
let autoEatInterval = null;

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

  bot.once('spawn', () => {
    console.log(`✅ ${config.username} spawned in the world`);
    const defaultMove = new Movements(bot);
    bot.pathfinder.setMovements(defaultMove);

    // Initialize the action executor with all modules
    executeAction = createExecutor(bot);

    // Start auto-eat background loop
    startAutoEat();

    bot.chat(`Hello! I'm ${config.username}, your AI assistant. Type !help to see what I can do.`);
  });

  bot.on('chat', async (username, message) => {
    if (username === bot.username) return;
    if (config.owner && username !== config.owner) {
      bot.chat(`Sorry ${username}, only ${config.owner} can command me.`);
      return;
    }
    if (!message.startsWith('!')) return;

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
    if (autoEatInterval) clearInterval(autoEatInterval);
    setTimeout(createBot, 5000);
  });
}

// ─── Auto Eat ─────────────────────────────────────────────────────────────────

function startAutoEat() {
  if (autoEatInterval) clearInterval(autoEatInterval);

  autoEatInterval = setInterval(async () => {
    try {
      // Only auto-eat when food is low and we're not busy
      if (bot.food <= 14 && !isThinking) {
        const food = findBestFood(bot);
        if (food) {
          console.log(`🍖 Auto-eating ${food.name} (food level: ${bot.food}/20)`);
          await bot.equip(food, 'hand');
          await bot.consume();
        }
      }
    } catch (err) {
      // Silently ignore auto-eat errors (might be mid-action)
      console.log('Auto-eat skipped:', err.message);
    }
  }, 30000); // Check every 30 seconds
}

// ─── AI Decision Engine ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI agent controlling a Minecraft bot named ${config.username}. 
You can see the current world state and must decide what actions to take.

You respond ONLY with a JSON object. No extra text, no markdown, just valid JSON.

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
- For mining, prefer the correct tool. The bot will auto-equip the best tool available.
- If the bot is hungry (food < 14), prioritize eating before other tasks.
- If the task is impossible or you need clarification, use "chat" to explain why.
- When building structures, use "build" with type "walls" for houses, "floor" for platforms, etc.
- For farming, use "create_farm" to set up new farms, "harvest" with replant for ongoing harvesting.`;

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
  if (command === 'help') {
    bot.chat('Commands: !<natural language> | !stop | !status | !reset | !commands');
    bot.chat('Examples: !mine 10 stone | !build a house | !chop trees | !create a wheat farm');
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
    bot.chat('Actions: mine, strip_mine, chop_tree, gather_wood');
    bot.chat('Actions: place, build, fill');
    bot.chat('Actions: deposit, deposit_all, withdraw, inventory_list');
    bot.chat('Actions: create_farm, plant, harvest, farm_cycle, auto_eat');
    bot.chat('Actions: goto, follow, attack, craft, equip, eat, collect');
    return;
  }

  if (isThinking) {
    bot.chat("I'm still thinking about the last command, please wait...");
    return;
  }

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
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

createBot();
