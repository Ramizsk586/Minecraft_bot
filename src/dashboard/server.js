const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

let serverStarted = false;

function startDashboardServer(bot, port = 3000) {
  if (serverStarted) return;
  serverStarted = true;

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);

  // Serve static files from the public folder
  app.use(express.static(path.join(__dirname, '../../public')));

  // Log buffer to send to newly connected clients
  const logBuffer = [];
  const MAX_LOGS = 100;

  function pushLog(type, text) {
    const logEntry = { time: new Date().toLocaleTimeString(), type, text };
    logBuffer.push(logEntry);
    if (logBuffer.length > MAX_LOGS) logBuffer.shift();
    io.emit('log', logEntry);
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

  // Helper to compile state
  function getBotState() {
    if (!bot || !bot.entity) return {};

    const items = bot.inventory.items().map(i => ({
      name: i.name,
      count: i.count,
      slot: i.slot
    }));

    return {
      username: bot.username || 'AIBot',
      health: bot.health !== undefined ? bot.health : 20,
      food: bot.food !== undefined ? bot.food : 20,
      position: bot.entity.position ? {
        x: Math.round(bot.entity.position.x),
        y: Math.round(bot.entity.position.y),
        z: Math.round(bot.entity.position.z)
      } : { x: 0, y: 0, z: 0 },
      currentTask: bot._currentTask || 'Idle',
      inventory: items,
    };
  }

  // Throttle tick emissions
  let lastEmit = 0;
  bot.on('physicTick', () => {
    const now = Date.now();
    if (now - lastEmit < 500) return;
    lastEmit = now;

    const state = getBotState();
    io.emit('state', state);
  });

  // Handle inventory updates
  bot.inventory.on('updateSlot', () => {
    io.emit('state', getBotState());
  });

  // Handle chat events
  bot.on('chat', (username, message) => {
    pushLog('chat', `<${username}> ${message}`);
  });

  io.on('connection', (socket) => {
    originalLog(`[Dashboard] Web client connected (${socket.id})`);
    
    // Send current logs and initial state
    socket.emit('init-logs', logBuffer);
    socket.emit('state', getBotState());

    // Execute command from dashboard
    socket.on('command', async (cmd) => {
      if (!cmd) return;
      pushLog('command', `[Command Executed] ${cmd}`);
      
      if (cmd.startsWith('!')) {
        // Trigger command handler by emitting to bot
        try {
          const ownerName = process.env.OWNER_USERNAME || 'Owner';
          bot.emit('chat', ownerName, cmd);
        } catch (err) {
          pushLog('error', `Command failed: ${err.message}`);
        }
      } else {
        bot.chat(cmd);
      }
    });

    // Handle stop command
    socket.on('stop', () => {
      pushLog('info', '[Dashboard] Stopping current task');
      if (bot.pathfinder) {
        bot.pathfinder.setGoal(null);
      }
      bot._currentTask = null;
      io.emit('state', getBotState());
    });
  });

  server.listen(port, () => {
    originalLog(`\n🚀 [Dashboard Server] Professional Dashboard running at http://localhost:${port}\n`);
  });
}

module.exports = {
  startDashboardServer
};
