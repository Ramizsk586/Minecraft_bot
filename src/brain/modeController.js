/**
 * Object-Oriented controller for bot safety and survival modes.
 */
class ModeController {
  constructor(bot) {
    this.bot = bot;
    this.modes = [];
    this.modesInterval = null;
  }

  /**
   * Registers a behavior mode.
   * @param {Object} mode - The mode definition { name, priority, enabled, interrupts, cortexLockName, shouldTrigger, execute }
   */
  registerMode(mode) {
    this.modes.push({
      enabled: true,
      cortexLockName: null,
      interrupts: 'none',
      ...mode
    });
    // Sort descending by priority
    this.modes.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Starts the 500ms modes check interval loop.
   */
  start() {
    if (this.modesInterval) clearInterval(this.modesInterval);

    this.modesInterval = setInterval(async () => {
      if (!this.bot || !this.bot.entity) return;

      for (const mode of this.modes) {
        if (!mode.enabled) continue;

        try {
          const trigger = await mode.shouldTrigger(this.bot);
          if (trigger) {
            // Handle preemption interruptions
            if (mode.interrupts === 'all') {
              const coder = require('../actions/coder');
              await coder.stop(this.bot);
            }

            // Signal cortex via locks to prevent interference
            if (mode.cortexLockName) {
              const cortex = require('./cortex');
              cortex.signalExternalAction(mode.cortexLockName, mode.priority, 10000);
            }

            await mode.execute(this.bot);
            break; // Higher priority mode took action, skip remaining modes
          } else {
            // Clean up lock if the mode trigger conditions have cleared
            if (mode.cortexLockName) {
              const hasPvpTarget = this.bot.pvp && this.bot.pvp.target;
              if (!hasPvpTarget) {
                const cortex = require('./cortex');
                cortex.releaseExternalAction(mode.cortexLockName);
              }
            }
          }
        } catch (err) {
          console.error(`[ModeController] Error running mode "${mode.name}":`, err.message);
        }
      }
    }, 500);
  }

  /**
   * Stops the check interval loop.
   */
  stop() {
    if (this.modesInterval) {
      clearInterval(this.modesInterval);
      this.modesInterval = null;
    }
  }
}

module.exports = ModeController;
