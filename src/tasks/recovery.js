const fs = require('fs');
const path = require('path');

const SNAPSHOT_PATH = path.join(__dirname, '../../recovery_snapshot.json');

function saveSnapshot(bot) {
  if (!bot) return;
  try {
    const snapshot = {
      conversationHistory: global.conversationHistory || [],
      autonomyHistory: global.autonomyHistory || [],
      lastGoal: bot._currentTask,
      coords: bot.entity?.position ? {
        x: Math.round(bot.entity.position.x),
        y: Math.round(bot.entity.position.y),
        z: Math.round(bot.entity.position.z)
      } : null,
      timestamp: Date.now()
    };
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
    console.log('[Recovery] Saved brain recovery snapshot to disk.');
  } catch (err) {
    console.error('[Recovery] Failed to save recovery snapshot:', err.message);
  }
}

async function loadAndRestoreSnapshot(bot) {
  if (!bot) return;
  if (!fs.existsSync(SNAPSHOT_PATH)) return;

  try {
    const data = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    
    // Check if snapshot is recent (e.g. less than 10 minutes old)
    if (Date.now() - data.timestamp < 10 * 60 * 1000) {
      if (Array.isArray(data.conversationHistory)) {
        global.conversationHistory = data.conversationHistory;
        console.log(`[Recovery] Restored conversation history (${global.conversationHistory.length} turns).`);
      }
      if (Array.isArray(data.autonomyHistory)) {
        global.autonomyHistory = data.autonomyHistory;
      }
      if (data.lastGoal) {
        bot._currentTask = data.lastGoal;
        console.log(`[Recovery] Restored last task: ${bot._currentTask}`);
        
        // Notify LLM that it crashed/reconnected and needs to resume the task
        setTimeout(() => {
          bot.chat("Hello! I disconnected briefly but I'm back. Resuming my last task...");
          bot.emit('chat', 'System', `[System Alert] You disconnected and just reconnected. Your conversation memory has been preserved. Your prior active goal was: "${data.lastGoal}". Please continue executing it.`);
        }, 3000);
      }
    } else {
      console.log('[Recovery] Stale snapshot found, discarding.');
    }

    // Delete snapshot after reading
    fs.unlinkSync(SNAPSHOT_PATH);
  } catch (err) {
    console.error('[Recovery] Failed to restore snapshot:', err.message);
  }
}

function setupAutoRecovery(bot) {
  if (!bot) return;

  // Hook errors and kicks to save state
  bot.on('error', (err) => {
    console.log('[Recovery] Error detected, saving snapshot...');
    saveSnapshot(bot);
  });

  bot.on('kicked', (reason) => {
    console.log('[Recovery] Bot kicked, saving snapshot...');
    saveSnapshot(bot);
  });

  bot.on('end', () => {
    console.log('[Recovery] Bot connection ended, saving snapshot...');
    saveSnapshot(bot);
  });

  // Save on process exit
  const handleExit = () => {
    saveSnapshot(bot);
    process.exit();
  };

  process.once('SIGINT', handleExit);
  process.once('SIGTERM', handleExit);
}

module.exports = {
  saveSnapshot,
  loadAndRestoreSnapshot,
  setupAutoRecovery
};
