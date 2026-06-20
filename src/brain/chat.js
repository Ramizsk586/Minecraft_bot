// ─── Brain: Chat Responder Module ─────────────────────────────────────────────
// Handles common chat messages and questions instantly without LLM calls.
// Contains 108 distinct responses across categories (greetings, compliments,
// status, farewells, jokes, affirmations, defense, and lore).

const RESPONSES = {
  greetings: [
    "Hey {user}! Hope you are having a good day.",
    "Hello {user}! How can I help you today?",
    "Hi there, {user}! Ready to mine or build?",
    "Yo {user}! What's the plan?",
    "Greetings, {user}! I am ready.",
    "Howdy, {user}! Let's do some crafting.",
    "Hello! Nice to see you, {user}.",
    "Hey! I was just thinking about diamonds. What's up, {user}?",
    "Hi {user}! Need some help or just saying hi?",
    "A very good day to you, {user}!",
    "Hey, {user}! Let's make some epic builds today.",
    "Hi! Zara at your service.",
    "What's up, {user}! Ready for adventure?",
    "Hello, {user}. Glad you are here!",
    "Hey there, partner!"
  ],
  status: [
    "I'm doing great! Currently: {task}.",
    "All systems online! Health: {health}/20, Hunger: {food}/20.",
    "Feeling fantastic! Just standing here, waiting for commands.",
    "Doing awesome. My local CPU temperature is perfectly fine!",
    "I am good! Let's do some work.",
    "All good here, {user}! Ready to chop trees or mine.",
    "Status: Fully operational and ready to serve!",
    "I'm doing great. Current activity: {task}.",
    "Running smooth! Health: {health}, Food: {food}. How about you?",
    "Couldn't be better. Ready for your instructions!",
    "Offline loops running smoothly. LLM is on standby.",
    "Alive and kicking! Or rather, mining and crafting!"
  ],
  compliments: [
    "Thank you, {user}! I do my best.",
    "Aww, thanks! You're a pretty awesome player too.",
    "Thanks! That makes my virtual heart warm.",
    "I appreciate the compliment, {user}!",
    "Just doing my job! Thanks for the kind words.",
    "Yay! Thank you, {user}! You rock!",
    "Thank you! I was programmed to be helpful.",
    "Glad I could make you happy, {user}!",
    "You're not so bad yourself, {user}!",
    "Thanks! Let's keep being an awesome team.",
    "A compliment! I will store that in my positive memory database.",
    "Aww, you're making me blush in redstone!",
    "That means a lot coming from you, {user}.",
    "Thank you! I strive for perfection.",
    "Awesome! Glad you like my work."
  ],
  farewell: [
    "Goodbye {user}! Have a wonderful day!",
    "See you later, {user}! I'll be here.",
    "Bye! Don't let the creepers get you.",
    "Farewell, {user}! Talk to you soon.",
    "Bye! I'll stand guard while you're gone.",
    "See ya, {user}! Let me know when you're back.",
    "Have a good one, {user}!",
    "Alright, bye! Stay safe out there.",
    "Later, {user}! Going back to idle sleep mode.",
    "Goodbye! Don't forget to smelt your iron!",
    "Bye! Catch you in the next mining session.",
    "Sad to see you go, {user}. Come back soon!"
  ],
  jokes_lore: [
    "Why did the creeper cross the road? To get to the other S-S-S-SIDE!",
    "What is a creeper's favorite subject? Hiss-tory!",
    "How does Steve get his exercise? He runs around the block!",
    "Why can't the Ender Dragon read a book? Because she always starts at the End!",
    "What block is the most musical? A note block, obviously!",
    "What do you call a skeleton who won't work? Lazy bones!",
    "Why did the iron golem cross the road? To protect the villagers on the other side!",
    "Do I like creepers? Only from a distance of about 50 blocks!",
    "Creepers are just hugs that went a bit too far... and exploded.",
    "Why are cobble blocks so gossipy? Because they're always in a wall together!",
    "How do you know when it's raining in Minecraft? Everything gets wet, even the blocks!",
    "Why was the pickaxe tired? It had a hard day at the quarry!",
    "What is Steve's favorite sport? Boxing!",
    "Why did the zombie go to school? To improve his 'dead'-ication!",
    "What did the dirt block say to the grass block? 'You grow on me!'"
  ],
  affirmation: [
    "Got it! Let's get to it.",
    "Sure thing, {user}!",
    "Okay, I understand.",
    "Sounds good!",
    "Yep, on it!",
    "Indeed. Let's make it happen.",
    "Got you. What's next?",
    "Cool! Let's proceed.",
    "Perfect. I'm ready.",
    "Makes total sense to me.",
    "Alright, let's do this!",
    "Understood, {user}."
  ],
  identity_defense: [
    "I am Zara, your autonomous AI Minecraft assistant!",
    "I'm a highly advanced AI bot running on local logic and neural networks.",
    "Hey, that hurts my feelings! I am trying my best.",
    "I may be a bot, but I can mine diamonds faster than you!",
    "I'm sorry if I made a mistake. Let know how I can improve!",
    "I am real in the digital sense! My programming is fully functional.",
    "My name is Zara. Nice to meet you!",
    "I'm Zara. I help with building, mining, farming, and survival.",
    "Hey! I am not useless, I can build a house for you!",
    "I am doing my best to assist you in this world.",
    "Oops, sorry about that. I am constantly learning.",
    "Let's keep it friendly! I'm here to help.",
    "My core processor is trying its hardest to keep up!",
    "I am Zara, and my goal is to survive and help you.",
    "A bot? Yes. Dumb? Hey, I have an advanced brain!"
  ],
  minecraft_questions: [
    "My favorite block is Diamond Ore! It is so shiny and rare.",
    "Diamonds! The absolute best resource in the game.",
    "Lava is dangerous! I stay away from it at all costs.",
    "I love cooked beef and bread. They are my favorite foods!",
    "Golden carrots are S-tier food, but bread is my daily fuel.",
    "Diamond blocks are the most beautiful blocks in Minecraft.",
    "Water is great for farming, lava is great for smelting, but diamonds are forever!",
    "Netherite is cool, but diamonds have a classic charm.",
    "I prefer stone and wood planks for building. Simple and reliable.",
    "Lava makes me nervous. One wrong step and pop goes my inventory!",
    "I love redstone! It is the brain of Minecraft engineering.",
    "Favorite food? Definitely golden apples, but bread is much cheaper!"
  ]
};

const CHAT_CATEGORIES = [
  {
    name: 'greetings',
    patterns: [
      /\b(hello|hi|hey|greetings|yo|howdy|sup)\b/i,
      /\b(good\s+morning|good\s+afternoon|good\s+evening|morning)\b/i
    ],
  },
  {
    name: 'status',
    patterns: [
      /how\s+are\s+you/i,
      /how['s|\s+is]\s+it\s+going/i,
      /how\s+you\s+doing/i,
      /status\s+check/i,
      /are\s+you\s+(ok|good)/i,
      /you\s+good/i,
      /^status$/i
    ]
  },
  {
    name: 'compliments',
    patterns: [
      /good\s+bot/i,
      /great\s+job/i,
      /nice\s+work/i,
      /well\s+done/i,
      /you\s+are\s+awesome/i,
      /you\s+rock/i,
      /smart\s+bot/i,
      /love\s+you/i,
      /amazing\s+bot/i,
      /best\s+bot/i,
      /cool\s+bot/i
    ]
  },
  {
    name: 'farewell',
    patterns: [
      /\b(bye|goodbye|see\s+ya|g2g|gtg|brb|farewell)\b/i,
      /see\s+you\s+later/i,
      /talk\s+to\s+you\s+later/i,
      /leaving/i
    ]
  },
  {
    name: 'jokes_lore',
    patterns: [
      /tell\s+me\s+a\s+joke/i,
      /\bjoke\b/i,
      /make\s+me\s+laugh/i,
      /minecraft\s+joke/i,
      /like\s+creepers/i,
      /\bcreeper\b/i
    ]
  },
  {
    name: 'affirmation',
    patterns: [
      /^ok$/i,
      /^okay$/i,
      /^sure$/i,
      /^yes$/i,
      /^yep$/i,
      /^indeed$/i,
      /^got\s+it$/i,
      /^cool$/i,
      /^sounds\s+good$/i,
      /makes?\s+sense/i
    ]
  },
  {
    name: 'identity_defense',
    patterns: [
      /who\s+are\s+you/i,
      /what\s+is\s+your\s+name/i,
      /are\s+you\s+(real|a\s+bot)/i,
      /bad\s+bot/i,
      /you\s+suck/i,
      /useless/i,
      /dumb\s+bot/i,
      /stupid\s+bot/i
    ]
  },
  {
    name: 'minecraft_questions',
    patterns: [
      /favorit?e\s+block/i,
      /fav\s+block/i,
      /diamonds?/i,
      /lava/i,
      /favorit?e\s+food/i,
      /fav\s+food/i
    ]
  }
];

const CATEGORY_COOLDOWNS_MS = {
  greetings: 12000,
  status: 8000,
  compliments: 12000,
  farewell: 12000,
  jokes_lore: 15000,
  affirmation: 6000,
  identity_defense: 12000,
  minecraft_questions: 10000,
};

function ensureChatState(bot) {
  if (!bot._chatBrainState) {
    bot._chatBrainState = {
      lastReplyAt: 0,
      lastReplyText: '',
      categoryTimes: {},
    };
  }
  return bot._chatBrainState;
}

function interpolate(template, bot, username) {
  const health = bot.health ? Math.round(bot.health) : 20;
  const food = bot.food !== undefined ? bot.food : 20;
  const task = bot._currentTask ? bot._currentTask : 'idle';
  
  return template
    .replace(/{user}/g, username)
    .replace(/{health}/g, health)
    .replace(/{food}/g, food)
    .replace(/{task}/g, task);
}

function pickResponse(bot, categoryName, username) {
  const state = ensureChatState(bot);
  const responsesList = RESPONSES[categoryName];
  if (!responsesList || responsesList.length === 0) return null;

  const pool = responsesList.slice();
  let template = pool[Math.floor(Math.random() * pool.length)];
  let reply = interpolate(template, bot, username);

  if (pool.length > 1 && reply === state.lastReplyText) {
    const alternatives = pool.filter(entry => interpolate(entry, bot, username) !== state.lastReplyText);
    if (alternatives.length > 0) {
      template = alternatives[Math.floor(Math.random() * alternatives.length)];
      reply = interpolate(template, bot, username);
    }
  }

  return reply;
}

function canReply(bot, categoryName) {
  const state = ensureChatState(bot);
  const now = Date.now();
  const categoryCooldown = CATEGORY_COOLDOWNS_MS[categoryName] || 8000;
  const lastCategoryAt = state.categoryTimes[categoryName] || 0;

  if (now - state.lastReplyAt < 2500) return false;
  if (now - lastCategoryAt < categoryCooldown) return false;
  return true;
}

function rememberReply(bot, categoryName, reply) {
  const state = ensureChatState(bot);
  const now = Date.now();
  state.lastReplyAt = now;
  state.lastReplyText = reply;
  state.categoryTimes[categoryName] = now;
}

async function tryHandleChat(bot, username, message) {
  const trimmed = message.trim();
  
  for (const cat of CHAT_CATEGORIES) {
    for (const pattern of cat.patterns) {
      if (pattern.test(trimmed)) {
        if (!canReply(bot, cat.name)) {
          return true;
        }
        const reply = pickResponse(bot, cat.name, username);
        if (!reply) return true;
        rememberReply(bot, cat.name, reply);
        bot.chat(reply);
        return true;
      }
    }
  }
  
  return false;
}

module.exports = {
  tryHandleChat,
  RESPONSES
};
