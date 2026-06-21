let watchdogTimer = null;

async function executeCommand(bot, actionFn) {
  if (!bot) return;

  // Stop any currently running command first
  if (bot._executingCommand) {
    await stopCommand(bot);
  }

  bot.interrupt_code = false;
  bot._executingCommand = true;

  try {
    const result = await actionFn();
    return result;
  } catch (err) {
    if (err.message === 'aborted' || bot.interrupt_code) {
      console.log('[Coder] Command was interrupted/aborted.');
    } else {
      console.error('[Coder] Command execution failed:', err.message);
    }
    throw err;
  } finally {
    bot._executingCommand = false;
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  }
}

async function stopCommand(bot) {
  if (!bot) return;
  console.log('[Coder] Interrupting active command...');

  bot.interrupt_code = true;

  // Halt pathfinder goals
  if (bot.pathfinder) {
    try {
      bot.pathfinder.setGoal(null);
      bot.pathfinder.stop();
    } catch (err) {
      console.log('[Coder] Failed to stop pathfinder:', err.message);
    }
  }

  // Halt PvP
  if (bot.pvp && typeof bot.pvp.stop === 'function') {
    try {
      bot.pvp.stop();
    } catch (err) {
      console.log('[Coder] Failed to stop PvP:', err.message);
    }
  }

  // Clear targets
  if (bot.hawkEye) {
    try {
      bot.hawkEye.stop();
    } catch {}
  }

  // Start watchdog timer
  if (bot._executingCommand) {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    
    watchdogTimer = setTimeout(() => {
      if (bot._executingCommand) {
        console.error('⚠️ [Coder Watchdog] Command failed to abort within 10 seconds. Forcing restart...');
        // Save recovery snapshot before forcing exit
        const { saveSnapshot } = require('../tasks/recovery');
        saveSnapshot(bot);
        process.exit(1);
      }
    }, 10000);
  }
}

module.exports = {
  execute: executeCommand,
  stop: stopCommand
};
