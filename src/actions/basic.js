// ─── Basic Actions ────────────────────────────────────────────────────────────
// Chat, goto, follow, stop, attack, equip, eat, collect, craft, sequence
const { isDroppedItemEntity } = require('../utils');

const { sleep } = require('../utils');

function register(bot, goals) {
  // Reference to the action executor (set later by the dispatcher)
  let executeAction = null;

  function clearFollowState() {
    if (bot._followInterval) {
      clearInterval(bot._followInterval);
      bot._followInterval = null;
    }
    bot._followTarget = null;
  }

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
      const attackBrain = require('../brain/attack');
      const result = await attackBrain.startAttack(bot, target, {});
      if (!result?.started) {
        bot.chat(`Couldn't attack ${action.target}: ${result?.reason || 'unknown reason'}.`);
      }
    },

    follow: async (action) => {
      clearFollowState();
      const player = bot.players[action.player];
      if (!player?.entity) {
        bot.chat(`Can't see ${action.player}.`);
        return;
      }
      bot.chat(`Following ${action.player}.`);
      bot._currentTask = `following ${action.player}`;
      bot._followTarget = action.player;
      bot.lastUserInteractionTime = Date.now();
      bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, 3), true);
      bot._followInterval = setInterval(() => {
        const p = bot.players[action.player]?.entity;
        if (!p || bot._currentTask !== `following ${action.player}`) {
          clearFollowState();
          return;
        }
        const dist = p.position.distanceTo(bot.entity.position);
        if (dist > 2.5) {
          bot.pathfinder.setGoal(new goals.GoalFollow(p, 3), true);
        }
      }, 1000);
    },

    stop: async () => {
      clearFollowState();
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
      const eatBrain = require('../brain/eat');
      const result = await eatBrain.eat(bot, { silent: false, force: true, itemName: action.item });
      if (!result.ate && result.reason === 'item_not_found') {
        bot.chat(`Don't have ${action.item} to eat.`);
      }
    },

    collect: async (action) => {
      const requestedItem = String(action.item || action.target || '').trim().toLowerCase();
      const playerName = action.player || action.username || null;
      const gatherWoodTargets = new Set(['wood', 'log', 'logs', 'tree', 'trees', 'oak_log', 'spruce_log', 'birch_log', 'jungle_log']);

      if (
        requestedItem &&
        (gatherWoodTargets.has(requestedItem) ||
          requestedItem.includes('wood') ||
          requestedItem.includes('log') ||
          requestedItem.includes('tree'))
      ) {
        if (bot.executeAction) {
          await bot.executeAction({ action: 'gather_wood', count: 1, replant: false });
          bot.chat(`Gathered wood for ${playerName || 'you'}.`);
          return;
        }
      }

      const beforeCounts = {};
      for (const item of bot.inventory.items()) {
        beforeCounts[item.name] = (beforeCounts[item.name] || 0) + item.count;
      }

      bot.chat(requestedItem ? `Collecting nearby ${requestedItem}...` : 'Collecting nearby items...');
      const dropped = Object.values(bot.entities).filter(e => {
        if (!isDroppedItemEntity(e) || e.position.distanceTo(bot.entity.position) >= 16) return false;
        if (!requestedItem) return true;
        const droppedName = e.metadata?.find?.(value => value && typeof value === 'object' && value.itemId)?.name || '';
        const nameGuess = String(droppedName || e.displayName || e.name || '').toLowerCase();
        return !nameGuess || nameGuess.includes(requestedItem) || requestedItem.includes(nameGuess);
      });
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

      const afterCounts = {};
      for (const item of bot.inventory.items()) {
        afterCounts[item.name] = (afterCounts[item.name] || 0) + item.count;
      }
      const gainedStacks = Object.entries(afterCounts)
        .map(([name, count]) => ({ name, count: count - (beforeCounts[name] || 0) }))
        .filter(entry => entry.count > 0 && (!requestedItem || entry.name.includes(requestedItem) || requestedItem.includes(entry.name)));

      if (playerName && gainedStacks.length > 0) {
        const playerEntity = bot.players[playerName]?.entity;
        if (playerEntity) {
          try {
            await bot.pathfinder.goto(new goals.GoalNear(playerEntity.position.x, playerEntity.position.y, playerEntity.position.z, 2));
          } catch {}

          for (const gained of gainedStacks) {
            const stacks = bot.inventory.items().filter(i => i.name === gained.name);
            let left = gained.count;
            for (const stack of stacks) {
              if (left <= 0) break;
              const amount = Math.min(left, stack.count);
              try {
                await bot.toss(stack.type, stack.metadata, amount);
                left -= amount;
                await sleep(250);
              } catch (err) {
                console.log(`Failed to toss ${gained.name} to ${playerName}: ${err.message}`);
                break;
              }
            }
          }
          bot.chat(`Collected ${collected} items and gave them to ${playerName}.`);
          return;
        }
      }

      bot.chat(`Collected ${collected} items.`);
    },

    find_block: async (action) => {
      const blockName = action.block;
      if (!blockName) {
        bot.chat('find_block: Please specify a block name.');
        return;
      }
      
      const blockType = bot.registry.blocksByName[blockName];
      if (!blockType) {
        bot.chat(`find_block: Block "${blockName}" is not known.`);
        return;
      }

      const found = bot.findBlocks({
        matching: blockType.id,
        maxDistance: 48,
        count: 5,
      });

      if (found.length > 0) {
        const nearest = found[0];
        bot.chat(`Found ${found.length}x ${blockName} nearby. Nearest is at: ${nearest.x}, ${nearest.y}, ${nearest.z}.`);
        console.log(`[find_block] Found ${blockName} at ${nearest.x},${nearest.y},${nearest.z}`);
      } else {
        bot.chat(`I couldn't find any ${blockName} in a 48 block radius.`);
      }
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
