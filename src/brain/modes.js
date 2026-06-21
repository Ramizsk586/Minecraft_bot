const ModeController = require('./modeController');

let controller = null;

/**
 * Initializes and starts the OO Mode Controller for the bot.
 * Registers standard self-preservation and self-defense modes.
 * @param {Object} bot - The mineflayer bot instance.
 */
function startModesLoop(bot) {
  if (controller) controller.stop();

  controller = new ModeController(bot);

  // 1. Self-Preservation Mode (Drowning Safety)
  controller.registerMode({
    name: 'self_preservation',
    priority: 90,
    shouldTrigger: async (bot) => {
      const blockAtBot = bot.blockAt(bot.entity.position);
      const headBlock = bot.blockAt(bot.entity.position.offset(0, 1.6, 0));
      const inWater = (blockAtBot?.name === 'water' || headBlock?.name === 'water');
      return inWater && bot.oxygenLevel < 20;
    },
    execute: async (bot) => {
      bot.setControlState('jump', true); // Swim up
    }
  });

  // 2. Self-Defense Mode (Hostile mob combat)
  controller.registerMode({
    name: 'self_defense',
    priority: 80,
    interrupts: 'all',
    cortexLockName: 'emergency_combat',
    shouldTrigger: async (bot) => {
      // Find nearest hostile mob within 5 blocks
      const hostileEntities = Object.values(bot.entities)
        .filter(e => e.type === 'mob' && e.position.distanceTo(bot.entity.position) < 5)
        .filter(e => {
          const name = e.name?.toLowerCase() || '';
          const hostiles = ['zombie', 'skeleton', 'creeper', 'spider', 'witch', 'slime', 'drowned', 'husk', 'enderman', 'phantom'];
          return hostiles.includes(name);
        });
      return hostileEntities.length > 0;
    },
    execute: async (bot) => {
      const hostileEntities = Object.values(bot.entities)
        .filter(e => e.type === 'mob' && e.position.distanceTo(bot.entity.position) < 5)
        .filter(e => {
          const name = e.name?.toLowerCase() || '';
          const hostiles = ['zombie', 'skeleton', 'creeper', 'spider', 'witch', 'slime', 'drowned', 'husk', 'enderman', 'phantom'];
          return hostiles.includes(name);
        });

      if (hostileEntities.length > 0) {
        const target = hostileEntities[0];
        if (bot.pvp && bot.pvp.target !== target) {
          console.log(`[Modes] OO Defense: Engaging hostile ${target.name} within 5 blocks.`);
          
          // Equip weapon
          const weapon = bot.inventory.items().find(i => i.name.endsWith('_sword') || i.name.endsWith('_axe'));
          if (weapon) {
            try {
              await bot.equip(weapon, 'hand');
            } catch {}
          }
          
          bot.pvp.attack(target);
        }
      }
    }
  });

  controller.start();
}

/**
 * Stops the OO Mode Controller loop.
 */
function stopModesLoop() {
  if (controller) {
    controller.stop();
    controller = null;
  }
}

module.exports = {
  startModesLoop,
  stopModesLoop
};
