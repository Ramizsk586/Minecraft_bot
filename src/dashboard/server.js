const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

let serverStarted = false;
let botInstance = null;
let io = null;
const logBuffer = [];
const MAX_LOGS = 100;

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
      username: 'AIBot (Offline)',
      health: 0,
      food: 0,
      position: { x: 0, y: 0, z: 0 },
      currentTask: 'Connecting to Minecraft server...',
      inventory: [],
      host: process.env.MC_HOST || 'localhost',
      port: parseInt(process.env.MC_PORT, 10) || 25565,
      owner: process.env.OWNER_USERNAME || 'N/A',
      persona: process.env.PERSONA || 'No custom persona set.'
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
    persona: process.env.PERSONA || 'No custom persona set.'
  };
}

function updateBotInstance(newBot) {
  if (botInstance) {
    try {
      botInstance.removeAllListeners('physicTick');
      botInstance.removeAllListeners('chat');
      if (botInstance.inventory) {
        botInstance.inventory.removeAllListeners('updateSlot');
      }
    } catch (e) {}
  }

  botInstance = newBot;
  if (!newBot) return;

  let lastEmit = 0;
  newBot.on('physicTick', () => {
    const now = Date.now();
    if (now - lastEmit < 500) return;
    lastEmit = now;
    if (io) io.emit('state', getBotState());
  });

  const onSpawn = () => {
    if (newBot.inventory) {
      newBot.inventory.on('updateSlot', () => {
        if (io) io.emit('state', getBotState());
      });
    }
    if (io) io.emit('state', getBotState());
  };

  if (newBot.entity) {
    onSpawn();
  } else {
    newBot.once('spawn', onSpawn);
  }

  newBot.on('chat', (username, message) => {
    pushLog('chat', `<${username}> ${message}`);
  });

  if (io) io.emit('state', getBotState());
}

function startDashboardServer(port = 3000) {
  if (serverStarted) return;
  serverStarted = true;

  const app = express();
  const server = http.createServer(app);
  io = new Server(server);

  app.use(express.static(path.join(__dirname, '../../public')));

  io.on('connection', (socket) => {
    originalLog(`[Dashboard] Web client connected (${socket.id})`);
    
    socket.emit('init-logs', logBuffer);
    socket.emit('state', getBotState());

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
      io.emit('state', getBotState());
    });
  });

  server.listen(port, () => {
    originalLog(`\n🚀 [Dashboard Server] Professional Dashboard running at http://localhost:${port}\n`);
  });
}

module.exports = {
  startDashboardServer,
  updateBotInstance
};
