const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

let serverStarted = false;
let botInstance = null;
let io = null;
const logBuffer = [];
const MAX_LOGS = 100;
let dashboardStatus = {
  username: process.env.MC_USERNAME || 'AIBot',
  health: 0,
  food: 0,
  position: { x: 0, y: 0, z: 0 },
  currentTask: 'Waiting for you to start the bot.',
  host: process.env.MC_HOST || 'localhost',
  port: parseInt(process.env.MC_PORT, 10) || 25565,
  owner: process.env.OWNER_USERNAME || 'N/A',
  persona: process.env.PERSONA || 'No custom persona set.',
  provider: process.env.PROVIDER || 'openrouter',
  model: process.env.LLM_MODEL || '',
  apiKey: process.env.MODEL_KEY || process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY || '',
  botConnectionState: 'idle',
  canStartBot: true
};
let controlHandlers = {
  startBot: null,
  saveSettings: null
};

const envFilePath = path.join(__dirname, '../../.env');

function escapeEnvValue(value) {
  const stringValue = String(value ?? '');
  if (stringValue === '') return '';
  if (/[\s"#'=]/.test(stringValue)) {
    return `"${stringValue.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return stringValue;
}

function updateEnvFile(updates = {}) {
  const existing = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
  const lines = existing ? existing.split(/\r?\n/) : [];
  const remaining = new Map(Object.entries(updates));
  const nextLines = lines.map((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match) return line;
    const key = match[1];
    if (!remaining.has(key)) return line;
    const value = remaining.get(key);
    remaining.delete(key);
    return `${key}=${escapeEnvValue(value)}`;
  });

  for (const [key, value] of remaining.entries()) {
    nextLines.push(`${key}=${escapeEnvValue(value)}`);
  }

  fs.writeFileSync(envFilePath, `${nextLines.join('\n').replace(/\n+$/g, '')}\n`, 'utf8');
}

function pushLog(type, text) {
  const logEntry = { time: new Date().toLocaleTimeString(), type, text };
  logBuffer.push(logEntry);
  if (logBuffer.length > MAX_LOGS) logBuffer.shift();
  if (io) io.emit('log', logEntry);
}

// Intercept console.log to show in dashboard
const originalLog = console.log;
console.log = (...args) => {
  originalLog(...args);
  const text = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  pushLog('info', text);
};

const originalError = console.error;
console.error = (...args) => {
  originalError(...args);
  const text = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  pushLog('error', text);
};

function getBotState() {
  if (!botInstance) {
    return {
      ...dashboardStatus,
      inventory: [],
    };
  }

  const items = (botInstance.inventory && typeof botInstance.inventory.items === 'function')
    ? botInstance.inventory.items().map(i => ({
        name: i.name,
        count: i.count,
        slot: i.slot
      }))
    : [];

  return {
    username: botInstance.username || 'AIBot',
    health: botInstance.health !== undefined ? botInstance.health : 20,
    food: botInstance.food !== undefined ? botInstance.food : 20,
    position: (botInstance.entity && botInstance.entity.position) ? {
      x: Math.round(botInstance.entity.position.x),
      y: Math.round(botInstance.entity.position.y),
      z: Math.round(botInstance.entity.position.z)
    } : { x: 0, y: 0, z: 0 },
    currentTask: botInstance._currentTask || 'Idle',
    inventory: items,
    host: botInstance._config ? botInstance._config.host : (process.env.MC_HOST || 'localhost'),
    port: botInstance._config ? botInstance._config.port : (parseInt(process.env.MC_PORT, 10) || 25565),
    owner: botInstance._config ? botInstance._config.owner : (process.env.OWNER_USERNAME || 'N/A'),
    persona: process.env.PERSONA || 'No custom persona set.',
    provider: dashboardStatus.provider,
    model: dashboardStatus.model,
    apiKey: dashboardStatus.apiKey,
    botConnectionState: dashboardStatus.botConnectionState,
    canStartBot: dashboardStatus.canStartBot
  };
}

function emitState() {
  if (io) io.emit('state', getBotState());
}

function setDashboardStatus(nextStatus = {}) {
  dashboardStatus = {
    ...dashboardStatus,
    ...nextStatus,
  };
  emitState();
}

function registerDashboardControls(handlers = {}) {
  controlHandlers = {
    ...controlHandlers,
    ...handlers
  };
}

function updateBotInstance(newBot) {
  if (botInstance) {
    try {
      botInstance.removeAllListeners('physicsTick');
      botInstance.removeAllListeners('chat');
      if (botInstance.inventory) {
        botInstance.inventory.removeAllListeners('updateSlot');
      }
    } catch (e) {}
  }

  botInstance = newBot;
  if (!newBot) return;

  let lastEmit = 0;
  newBot.on('physicsTick', () => {
    const now = Date.now();
    if (now - lastEmit < 500) return;
    lastEmit = now;
    emitState();
  });

  const onSpawn = () => {
    if (newBot.inventory) {
      newBot.inventory.on('updateSlot', () => {
        emitState();
      });
    }
    emitState();
  };

  if (newBot.entity) {
    onSpawn();
  } else {
    newBot.once('spawn', onSpawn);
  }

  newBot.on('chat', (username, message) => {
    pushLog('chat', `<${username}> ${message}`);
  });

  emitState();
}

function startDashboardServer(port = 3000) {
  if (serverStarted) return;
  serverStarted = true;

  const app = express();
  const server = http.createServer(app);
  io = new Server(server);

  app.use(express.static(path.join(__dirname, '../../public')));
  app.use(express.json());

  // --- API Endpoints ---
  const templatesDir = path.join(__dirname, '../../templates');

  app.get('/api/structures', (req, res) => {
    try {
      if (!fs.existsSync(templatesDir)) {
        return res.json([]);
      }
      const files = fs.readdirSync(templatesDir);
      const structures = [];
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(templatesDir, file);
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            const blocks = JSON.parse(content);
            if (Array.isArray(blocks)) {
              structures.push({
                name: path.basename(file, '.json'),
                blockCount: blocks.length
              });
            }
          } catch (e) {
            console.error(`Error reading structure file ${file}:`, e.message);
          }
        }
      }
      res.json(structures);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/upload-structure', (req, res) => {
    try {
      const { name, blocks } = req.body;
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Invalid name' });
      }
      if (!Array.isArray(blocks)) {
        return res.status(400).json({ error: 'Blocks must be a JSON array' });
      }
      const safeName = name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
      if (!fs.existsSync(templatesDir)) {
        fs.mkdirSync(templatesDir, { recursive: true });
      }
      const filePath = path.join(templatesDir, `${safeName}.json`);
      fs.writeFileSync(filePath, JSON.stringify(blocks, null, 2), 'utf8');
      
      res.json({ success: true, name: safeName });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/rl/status', (req, res) => {
    if (!botInstance || !botInstance.aiAutonomy) {
      return res.json({
        enabled: false,
        mode: 'llm',
        rlStats: { totalSteps: 0, totalReward: 0, lastReward: 0, epsilon: 0.15 }
      });
    }
    res.json(botInstance.aiAutonomy);
  });

  app.post('/api/rl/config', (req, res) => {
    const { mode, epsilon } = req.body;
    if (botInstance && botInstance.aiAutonomy) {
      if (mode && ['llm', 'rl'].includes(mode)) {
        botInstance.aiAutonomy.mode = mode;
      }
      if (typeof epsilon === 'number' && epsilon >= 0 && epsilon <= 1) {
        botInstance.aiAutonomy.rlStats.epsilon = epsilon;
      }
      return res.json({ success: true, config: botInstance.aiAutonomy });
    }
    res.status(400).json({ error: 'Bot is offline or autonomy not initialized' });
  });

  io.on('connection', (socket) => {
    originalLog(`[Dashboard] Web client connected (${socket.id})`);
    
    socket.emit('init-logs', logBuffer);
    socket.emit('state', getBotState());

    socket.on('start-bot', async () => {
      if (typeof controlHandlers.startBot !== 'function') {
        pushLog('error', 'Cannot start bot: start handler is unavailable');
        return;
      }

      try {
        const result = await controlHandlers.startBot();
        if (result?.started) {
          pushLog('info', `Starting bot connection to ${dashboardStatus.host}:${dashboardStatus.port}...`);
        } else if (result?.reason) {
          pushLog('info', result.reason);
        }
      } catch (err) {
        pushLog('error', `Failed to start bot: ${err.message}`);
      }
    });

    socket.on('save-settings', async (payload = {}) => {
      if (typeof controlHandlers.saveSettings !== 'function') {
        pushLog('error', 'Cannot save settings: settings handler is unavailable');
        return;
      }

      try {
        const result = await controlHandlers.saveSettings(payload, { updateEnvFile });
        if (result?.message) {
          pushLog('info', result.message);
        }
      } catch (err) {
        pushLog('error', `Failed to save settings: ${err.message}`);
      }
    });

    socket.on('command', async (cmd) => {
      if (!cmd) return;
      pushLog('command', `[Command Executed] ${cmd}`);
      
      if (!botInstance) {
        pushLog('error', 'Cannot execute command: Bot is offline');
        return;
      }

      if (cmd.startsWith('!')) {
        try {
          const ownerName = process.env.OWNER_USERNAME || 'Owner';
          botInstance.emit('chat', ownerName, cmd);
        } catch (err) {
          pushLog('error', `Command failed: ${err.message}`);
        }
      } else {
        botInstance.chat(cmd);
      }
    });

    socket.on('stop', () => {
      pushLog('info', '[Dashboard] Stopping current task');
      if (!botInstance) return;
      if (botInstance.pathfinder) {
        botInstance.pathfinder.setGoal(null);
      }
      botInstance._currentTask = null;
      emitState();
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      originalError(`\n⚠️  [Dashboard Server Error]: Port ${port} is already in use by another process!`);
      originalError(`Please close any existing Node processes or try a different port.\n`);
    } else {
      originalError(`\n⚠️  [Dashboard Server Error]: ${err.message}\n`);
    }
  });

  server.listen(port, () => {
    originalLog(`\n🚀 [Dashboard Server] Professional Dashboard running at http://localhost:${port}\n`);
  });
}

module.exports = {
  startDashboardServer,
  updateBotInstance,
  setDashboardStatus,
  registerDashboardControls
};
