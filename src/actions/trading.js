// ─── Villager Trading Actions ──────────────────────────────────────────────────
// Action handlers to query trades and perform transactions with villagers.

const { sleep } = require('../utils');

function register(bot, goals) {
  const { GoalFollow } = goals;

  function findVillager(action) {
    const villagerType = bot.registry.entitiesByName.villager?.id;
    if (!villagerType) return null;
    
    // 1. Try specific ID if provided
    if (action.id !== undefined) {
      const entity = bot.entities[action.id];
      if (entity && entity.entityType === villagerType) {
        return entity;
      }
    }
    
    // 2. Try target name matching
    if (action.target) {
      const entity = Object.values(bot.entities).find(
        e => e.entityType === villagerType && 
             (e.name === action.target || e.username === action.target || 
              (e.customName && e.customName.toString().includes(action.target)))
      );
      if (entity) return entity;
    }
    
    // 3. Fallback: find nearest villager entity
    return bot.nearestEntity(e => e.entityType === villagerType);
  }

  function getVillagerProfession(entity) {
    const professions = {
      0: 'Unemployed', 1: 'Armorer', 2: 'Butcher', 3: 'Cartographer',
      4: 'Cleric', 5: 'Farmer', 6: 'Fisherman', 7: 'Fletcher',
      8: 'Leatherworker', 9: 'Librarian', 10: 'Mason', 11: 'Nitwit',
      12: 'Shepherd', 13: 'Toolsmith', 14: 'Weaponsmith'
    };
    
    if (entity.metadata && entity.metadata[18]) {
      if (typeof entity.metadata[18] === 'object' && entity.metadata[18].villagerProfession !== undefined) {
        const professionId = entity.metadata[18].villagerProfession;
        const level = entity.metadata[18].level || 1;
        return `${professions[professionId] || 'Unknown'} L${level}`;
      } else if (typeof entity.metadata[18] === 'number') {
        return professions[entity.metadata[18]] || 'Unknown';
      }
    }
    if (entity.metadata && entity.metadata[16] !== 1) return 'Adult';
    return 'Unknown';
  }

  function stringifyItem(item) {
    if (!item) return 'nothing';
    let text = `${item.count} ${item.displayName}`;
    if (item.nbt && item.nbt.value) {
      const ench = item.nbt.value.ench;
      const StoredEnchantments = item.nbt.value.StoredEnchantments;
      const Potion = item.nbt.value.Potion;
      const display = item.nbt.value.display;

      if (Potion) text += ` of ${Potion.value.replace(/_/g, ' ').split(':')[1] || 'unknown'}`;
      if (display && display.value && display.value.Name) text += ` named ${display.value.Name.value}`;
      if (ench || StoredEnchantments) {
        text += ` enchanted with ${(ench || StoredEnchantments).value.value.map((e) => {
          const lvl = e.lvl.value;
          const id = e.id.value;
          const enchName = bot.registry.enchantments[id]?.displayName || `enchantment_${id}`;
          return `${enchName} ${lvl}`;
        }).join(' ')}`;
      }
    }
    return text;
  }

  function hasResources(slots, trade, count) {
    const first = enough(trade.inputItem1, count);
    const second = !trade.inputItem2 || enough(trade.inputItem2, count);
    return first && second;

    function enough(item, count) {
      let available = 0;
      slots.forEach((element) => {
        if (element && element.type === item.type) {
          available += element.count;
        }
      });
      return available >= item.count * count;
    }
  }

  const handlers = {
    show_trades: async (action) => {
      const villagerEntity = findVillager(action);
      if (!villagerEntity) {
        bot.chat("No villager found nearby.");
        return;
      }

      const dist = bot.entity.position.distanceTo(villagerEntity.position);
      if (dist > 4) {
        bot.chat(`Walking to villager (${dist.toFixed(1)} blocks away)...`);
        try {
          await bot.pathfinder.goto(new GoalFollow(villagerEntity, 2));
        } catch (err) {
          bot.chat(`Failed to reach villager: ${err.message}`);
          return;
        }
      }

      try {
        bot.chat("Opening trades window...");
        const villager = await bot.openVillager(villagerEntity);
        if (!villager.trades || villager.trades.length === 0) {
          bot.chat("This villager has no trades available.");
          villager.close();
          return;
        }

        bot.chat(`Villager (${getVillagerProfession(villagerEntity)}) trades:`);
        villager.trades.forEach((trade, i) => {
          let desc = stringifyItem(trade.inputItem1);
          if (trade.inputItem2) desc += ` & ${stringifyItem(trade.inputItem2)}`;
          desc += trade.disabled ? ' x ' : ' » ';
          desc += stringifyItem(trade.outputItem);
          bot.chat(`[Trade ${i + 1}] (${trade.nbTradeUses}/${trade.maximumNbTradeUses}) ${desc}`);
          console.log(`[Trade ${i + 1}] (${trade.nbTradeUses}/${trade.maximumNbTradeUses}) ${desc}`);
        });

        villager.close();
      } catch (err) {
        bot.chat(`Error showing trades: ${err.message}`);
      }
    },

    trade: async (action) => {
      const villagerEntity = findVillager(action);
      if (!villagerEntity) {
        bot.chat("No villager found nearby.");
        return;
      }

      const dist = bot.entity.position.distanceTo(villagerEntity.position);
      if (dist > 4) {
        bot.chat(`Walking to villager (${dist.toFixed(1)} blocks away)...`);
        try {
          await bot.pathfinder.goto(new GoalFollow(villagerEntity, 2));
        } catch (err) {
          bot.chat(`Failed to reach villager: ${err.message}`);
          return;
        }
      }

      let villagerWindow;
      try {
        bot.chat("Opening trades window...");
        villagerWindow = await bot.openVillager(villagerEntity);
        
        const tradeIndex = (action.tradeIndex || 1) - 1;
        const trade = villagerWindow.trades[tradeIndex];
        if (!trade) {
          bot.chat(`Invalid trade index ${action.tradeIndex || 1}.`);
          villagerWindow.close();
          return;
        }

        if (trade.disabled) {
          bot.chat("This trade is currently disabled/locked.");
          villagerWindow.close();
          return;
        }

        const maxTrades = trade.maximumNbTradeUses - trade.nbTradeUses;
        const count = action.count || 1;
        const actualCount = Math.min(count, maxTrades);
        if (actualCount <= 0) {
          bot.chat("This trade has reached its limit.");
          villagerWindow.close();
          return;
        }

        if (!hasResources(villagerWindow.slots, trade, actualCount)) {
          bot.chat("I don't have enough resources for this trade.");
          villagerWindow.close();
          return;
        }

        bot.chat(`Trading for ${stringifyItem(trade.outputItem)} (x${actualCount})...`);
        await bot.trade(villagerWindow, tradeIndex, actualCount);
        bot.chat("Trade completed successfully!");
      } catch (err) {
        bot.chat(`Trade failed: ${err.message}`);
      } finally {
        if (villagerWindow) {
          try {
            villagerWindow.close();
          } catch (err) {
            // ignore
          }
        }
      }
    }
  };

  return { handlers };
}

module.exports = { register };
