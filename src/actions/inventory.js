const { sleep } = require('../utils');

function register(bot, goals) {
  const { GoalNear } = goals;

  /**
   * Helper: find the nearest chest block within 32 blocks.
   * Returns the Block object or null.
   */
  function findNearestChest() {
    const chestId = bot.registry.blocksByName['chest']?.id;
    if (chestId == null) return null;
    const found = bot.findBlock({ matching: chestId, maxDistance: 32 });
    return found ? bot.blockAt(found.position) : null;
  }

  /**
   * Helper: navigate to a position using GoalNear then open the chest.
   * Returns the chest window (Container) or null on failure.
   */
  async function navigateAndOpenChest(chestBlock) {
    try {
      const { x, y, z } = chestBlock.position;
      await bot.pathfinder.goto(new GoalNear(x, y, z, 3));
    } catch (err) {
      console.log('Pathfinder error navigating to chest:', err.message);
      // Continue anyway — we might already be close enough
    }

    await sleep(300);

    try {
      const chestWindow = await bot.openContainer(chestBlock);
      await sleep(300);
      return chestWindow;
    } catch (err) {
      console.log('Failed to open chest:', err.message);
      bot.chat(`Failed to open chest: ${err.message}`);
      return null;
    }
  }

  return {
    /**
     * deposit — Deposit a specific item into the nearest chest.
     * Action: { "action": "deposit", "item": "cobblestone", "count": 64 }
     */
    deposit: async (action) => {
      const itemName = action.item;
      const count = action.count || 64;

      const chestBlock = findNearestChest();
      if (!chestBlock) {
        bot.chat('No chest found within 32 blocks.');
        return;
      }

      const chestWindow = await navigateAndOpenChest(chestBlock);
      if (!chestWindow) return;

      try {
        const items = bot.inventory.items().filter(i => i.name === itemName);
        if (items.length === 0) {
          bot.chat(`I don't have any ${itemName} to deposit.`);
          return;
        }

        const item = items[0];
        await chestWindow.deposit(item.type, item.metadata, count);
        await sleep(300);
        bot.chat(`Deposited ${count} ${itemName} into chest.`);
      } catch (err) {
        console.log('Deposit error:', err.message);
        bot.chat(`Failed to deposit ${itemName}: ${err.message}`);
      } finally {
        chestWindow.close();
      }
    },

    /**
     * deposit_all — Deposit all items, optionally keeping some.
     * Action: { "action": "deposit_all", "keep": ["diamond_pickaxe", "diamond_sword", "bread"] }
     */
    deposit_all: async (action) => {
      const keepList = action.keep || [];

      const chestBlock = findNearestChest();
      if (!chestBlock) {
        bot.chat('No chest found within 32 blocks.');
        return;
      }

      const chestWindow = await navigateAndOpenChest(chestBlock);
      if (!chestWindow) return;

      let deposited = 0;

      try {
        const items = bot.inventory.items();
        const toDeposit = items.filter(i => !keepList.includes(i.name));

        if (toDeposit.length === 0) {
          bot.chat('No items to deposit (all items are in the keep list).');
          return;
        }

        for (const item of toDeposit) {
          try {
            await chestWindow.deposit(item.type, item.metadata, item.count);
            deposited++;
            await sleep(300);
          } catch (err) {
            console.log(`Failed to deposit ${item.name}:`, err.message);
          }
        }

        bot.chat(`Deposited ${deposited} stack(s) into chest. Kept: ${keepList.join(', ') || 'nothing'}.`);
      } catch (err) {
        console.log('Deposit all error:', err.message);
        bot.chat(`Error during deposit_all: ${err.message}`);
      } finally {
        chestWindow.close();
      }
    },

    /**
     * withdraw — Take items from the nearest chest.
     * Action: { "action": "withdraw", "item": "oak_planks", "count": 32 }
     */
    withdraw: async (action) => {
      const itemName = action.item;
      const count = action.count || 1;

      const chestBlock = findNearestChest();
      if (!chestBlock) {
        bot.chat('No chest found within 32 blocks.');
        return;
      }

      const chestWindow = await navigateAndOpenChest(chestBlock);
      if (!chestWindow) return;

      try {
        const chestItems = chestWindow.containerItems().filter(i => i.name === itemName);
        if (chestItems.length === 0) {
          bot.chat(`No ${itemName} found in this chest.`);
          return;
        }

        const item = chestItems[0];
        await chestWindow.withdraw(item.type, item.metadata, count);
        await sleep(300);
        bot.chat(`Withdrew ${count} ${itemName} from chest.`);
      } catch (err) {
        console.log('Withdraw error:', err.message);
        bot.chat(`Failed to withdraw ${itemName}: ${err.message}`);
      } finally {
        chestWindow.close();
      }
    },

    /**
     * inventory_list — Report full inventory contents.
     * Action: { "action": "inventory_list" }
     */
    inventory_list: async (action) => {
      const items = bot.inventory.items();

      if (items.length === 0) {
        bot.chat('My inventory is empty.');
        return;
      }

      const emptySlots = 36 - items.length;

      // Group items by name and sum counts
      const grouped = {};
      for (const item of items) {
        if (!grouped[item.name]) {
          grouped[item.name] = { count: 0, maxDurability: item.maxDurability || 0 };
        }
        grouped[item.name].count += item.count;
        // Track lowest durability for tools/armor
        if (item.maxDurability && item.durabilityUsed != null) {
          const remaining = item.maxDurability - item.durabilityUsed;
          if (grouped[item.name].lowestDurability == null || remaining < grouped[item.name].lowestDurability) {
            grouped[item.name].lowestDurability = remaining;
            grouped[item.name].maxDur = item.maxDurability;
          }
        }
      }

      // Build message lines, splitting into chunks that fit Minecraft chat
      const lines = [];
      for (const [name, info] of Object.entries(grouped)) {
        let line = `${name} x${info.count}`;
        if (info.lowestDurability != null) {
          line += ` (dur: ${info.lowestDurability}/${info.maxDur})`;
        }
        lines.push(line);
      }

      // Send header
      bot.chat(`--- Inventory (${items.length} stacks, ${emptySlots} empty slots) ---`);
      await sleep(300);

      // Batch lines into messages of ~200 chars each to stay under Minecraft limit
      let currentMsg = '';
      for (const line of lines) {
        if (currentMsg.length + line.length + 2 > 200) {
          bot.chat(currentMsg);
          await sleep(300);
          currentMsg = line;
        } else {
          currentMsg = currentMsg ? currentMsg + ', ' + line : line;
        }
      }
      if (currentMsg) {
        bot.chat(currentMsg);
      }
    },

    /**
     * sort_inventory — Consolidate stacks and report organized inventory.
     * Action: { "action": "sort_inventory" }
     */
    sort_inventory: async (action) => {
      const items = bot.inventory.items();

      if (items.length === 0) {
        bot.chat('My inventory is empty, nothing to sort.');
        return;
      }

      // Group items by name to find partial stacks
      const grouped = {};
      for (const item of items) {
        if (!grouped[item.name]) {
          grouped[item.name] = [];
        }
        grouped[item.name].push(item);
      }

      // Try to consolidate partial stacks using bot.clickWindow
      let consolidated = 0;

      for (const [name, itemGroup] of Object.entries(grouped)) {
        if (itemGroup.length <= 1) continue;

        // Check if there are partial stacks worth consolidating
        const stackSize = itemGroup[0].stackSize || 64;
        const hasPartials = itemGroup.some(i => i.count < stackSize);
        if (!hasPartials) continue;

        // Attempt to consolidate by picking up and placing items
        try {
          for (let i = 1; i < itemGroup.length; i++) {
            const source = itemGroup[i];
            const target = itemGroup[0];

            // Skip if target is already full
            if (target.count >= stackSize) break;

            // Pick up the source stack (left click), then left click the target slot
            await bot.clickWindow(source.slot, 0, 0); // pick up
            await sleep(200);
            await bot.clickWindow(target.slot, 0, 0); // place on target
            await sleep(200);

            // If there's a remainder on cursor (target was nearly full), put it back
            if (bot.inventory.selectedItem) {
              await bot.clickWindow(source.slot, 0, 0);
              await sleep(200);
            }

            consolidated++;
          }
        } catch (err) {
          console.log(`Failed to consolidate ${name}:`, err.message);
        }
      }

      // Categorize items for organized report
      const categories = {
        'Tools': [],
        'Weapons': [],
        'Armor': [],
        'Blocks': [],
        'Food': [],
        'Materials': [],
        'Other': []
      };

      const toolNames = ['pickaxe', 'axe', 'shovel', 'hoe', 'shears', 'flint_and_steel', 'fishing_rod'];
      const weaponNames = ['sword', 'bow', 'crossbow', 'trident', 'arrow'];
      const armorNames = ['helmet', 'chestplate', 'leggings', 'boots', 'shield'];
      const foodNames = ['bread', 'cooked', 'apple', 'steak', 'porkchop', 'chicken', 'mutton', 'rabbit',
        'cod', 'salmon', 'potato', 'carrot', 'beetroot', 'melon_slice', 'sweet_berries',
        'golden_apple', 'cake', 'cookie', 'pumpkin_pie', 'mushroom_stew', 'dried_kelp'];

      // Re-read inventory after consolidation
      const updatedItems = bot.inventory.items();
      const itemSummary = {};
      for (const item of updatedItems) {
        if (!itemSummary[item.name]) {
          itemSummary[item.name] = 0;
        }
        itemSummary[item.name] += item.count;
      }

      for (const [name, count] of Object.entries(itemSummary)) {
        const entry = `${name} x${count}`;
        if (toolNames.some(t => name.includes(t))) {
          categories['Tools'].push(entry);
        } else if (weaponNames.some(w => name.includes(w))) {
          categories['Weapons'].push(entry);
        } else if (armorNames.some(a => name.includes(a))) {
          categories['Armor'].push(entry);
        } else if (foodNames.some(f => name.includes(f))) {
          categories['Food'].push(entry);
        } else {
          categories['Other'].push(entry);
        }
      }

      if (consolidated > 0) {
        bot.chat(`Consolidated ${consolidated} partial stack(s).`);
        await sleep(300);
      }

      // Report organized inventory
      bot.chat('--- Organized Inventory ---');
      await sleep(300);

      for (const [category, entries] of Object.entries(categories)) {
        if (entries.length === 0) continue;

        let msg = `[${category}] ${entries.join(', ')}`;
        // Split long messages
        while (msg.length > 240) {
          const cutoff = msg.lastIndexOf(', ', 240);
          if (cutoff <= 0) break;
          bot.chat(msg.substring(0, cutoff));
          await sleep(300);
          msg = `[${category}] ${msg.substring(cutoff + 2)}`;
        }
        bot.chat(msg);
        await sleep(300);
      }

      const emptySlots = 36 - updatedItems.length;
      bot.chat(`Empty slots: ${emptySlots}`);
    }
  };
}

module.exports = { register };
