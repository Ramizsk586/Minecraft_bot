// ─── Basic Actions ────────────────────────────────────────────────────────────
// Chat, goto, follow, stop, attack, equip, eat, collect, craft, sequence

const { sleep } = require('../utils');

function register(bot, goals) {
  // Reference to the action executor (set later by the dispatcher)
  let executeAction = null;

  function setExecutor(fn) {
    executeAction = fn;
  }

  const handlers = {
    chat: async (action) => {
      bot.chat(action.message);
    },

    goto: async (action) => {
      const goal = new goals.GoalBlock(action.x, action.y, action.z);
      bot.pathfinder.setGoal(goal);
      bot.chat(`Walking to (${action.x}, ${action.y}, ${action.z})...`);
      await new Promise((resolve) => {
        bot.pathfinder.once('goal_reached', resolve);
        setTimeout(resolve, 15000);
      });
      bot.chat('Arrived!');
    },

    attack: async (action) => {
      const target = Object.values(bot.entities).find(
        e => (e.name === action.target || e.username === action.target) &&
             e.position.distanceTo(bot.entity.position) < 20
      );
      if (!target) {
        bot.chat(`Can't find ${action.target} nearby.`);
        return;
      }
      bot.chat(`Attacking ${action.target}!`);
      await new Promise((resolve) => {
        const attackInterval = setInterval(() => {
          if (!target.isValid) {
            clearInterval(attackInterval);
            bot.chat(`Defeated ${action.target}!`);
            resolve();
            return;
          }
          bot.attack(target);
        }, 600);
        setTimeout(() => {
          clearInterval(attackInterval);
          resolve();
        }, 30000);
      });
    },

    follow: async (action) => {
      const player = bot.players[action.player];
      if (!player?.entity) {
        bot.chat(`Can't see ${action.player}.`);
        return;
      }
      bot.chat(`Following ${action.player}.`);
      bot._currentTask = `following ${action.player}`;
      const followInterval = setInterval(() => {
        const p = bot.players[action.player]?.entity;
        if (!p || bot._currentTask !== `following ${action.player}`) {
          clearInterval(followInterval);
          return;
        }
        const dist = p.position.distanceTo(bot.entity.position);
        if (dist > 4) {
          bot.pathfinder.setGoal(new goals.GoalFollow(p, 3), true);
        }
      }, 1000);
    },

    stop: async () => {
      bot.pathfinder.setGoal(null);
      bot._currentTask = null;
      bot.chat('Stopped current task.');
    },

    craft: async (action) => {
      const craftingTable = bot.findBlock({
        matching: bot.registry.blocksByName['crafting_table']?.id,
        maxDistance: 32,
      });

      if (craftingTable) {
        try {
          await bot.pathfinder.goto(new goals.GoalNear(
            craftingTable.position.x,
            craftingTable.position.y,
            craftingTable.position.z,
            3
          ));
        } catch (err) {
          console.log('Could not reach crafting table:', err.message);
        }
      }

      const itemId = bot.registry.itemsByName[action.item]?.id;
      if (!itemId) {
        bot.chat(`Unknown item: ${action.item}`);
        return;
      }

      const recipes = bot.recipesFor(itemId, null, 1, craftingTable);

      if (!recipes.length) {
        bot.chat(`Don't know how to craft ${action.item} or missing ingredients.`);
        return;
      }

      try {
        await bot.craft(recipes[0], action.count || 1, craftingTable);
        bot.chat(`Crafted ${action.count || 1} ${action.item}!`);
      } catch (err) {
        bot.chat(`Failed to craft ${action.item}: ${err.message}`);
      }
    },

    equip: async (action) => {
      const item = bot.inventory.items().find(i => i.name === action.item);
      if (!item) {
        bot.chat(`Don't have ${action.item} in inventory.`);
        return;
      }
      await bot.equip(item, 'hand');
      bot.chat(`Equipped ${action.item}.`);
    },

    eat: async (action) => {
      const food = bot.inventory.items().find(i => i.name === action.item);
      if (!food) {
        bot.chat(`Don't have ${action.item} to eat.`);
        return;
      }
      await bot.equip(food, 'hand');
      await bot.consume();
      bot.chat(`Ate ${action.item}. Food: ${bot.food}/20`);
    },

    collect: async (action) => {
      bot.chat(`Collecting nearby items...`);
      const dropped = Object.values(bot.entities).filter(
        e => e.name === 'item' && e.position.distanceTo(bot.entity.position) < 16
      );
      let collected = 0;
      for (const item of dropped.slice(0, 10)) {
        try {
          await bot.pathfinder.goto(
            new goals.GoalNear(item.position.x, item.position.y, item.position.z, 1)
          );
          collected++;
        } catch {
          // item may have despawned
        }
        await sleep(200);
      }
      bot.chat(`Collected ${collected} items.`);
    },

    sequence: async (action) => {
      if (!executeAction) {
        bot.chat('Sequence executor not initialized.');
        return;
      }
      for (const step of action.steps) {
        if (bot._currentTask === 'stopped') break;
        await executeAction(step);
        await sleep(500);
      }
    },
  };

  return { handlers, setExecutor };
}

module.exports = { register };
