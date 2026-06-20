// ─── Cooking Task Initiator ──────────────────────────────────────────────────
// Automatically prepares the Minecraft world environment for cooking benchmarks.

const { Vec3 } = require('vec3');

class CookingTaskInitiator {
  constructor(bot, data) {
    this.bot = bot;
    this.data = data || {};
  }

  async init() {
    console.log('[Task] Preparing cooking environment...');
    
    // 1. Clear area and place grass base
    await this.bot.chat('/fill ~-20 ~-1 ~-20 ~20 ~-1 ~20 grass_block');
    await new Promise(resolve => setTimeout(resolve, 300));
    await this.bot.chat('/fill ~-20 ~ ~-20 ~20 ~8 ~20 air');
    await new Promise(resolve => setTimeout(resolve, 300));

    const origin = this.bot.entity.position.floored();

    // 2. Set up mature crops for immediate harvest
    // Spawns a 5x5 wheat field
    await this.plantCrops(origin.offset(5, 0, 5), 'wheat[age=7]');
    // Spawns a 5x5 carrot field
    await this.plantCrops(origin.offset(5, 0, -10), 'carrots[age=7]');

    // 3. Clear existing items/animals and summon fresh ones
    await this.bot.chat('/kill @e[type=item]');
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const animals = ['chicken', 'cow', 'sheep', 'pig'];
    for (const animal of animals) {
      const pos = origin.offset(-8, 0, this.animalsOffset(animal));
      await this.bot.chat(`/summon ${animal} ${pos.x} ${pos.y} ${pos.z}`);
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // 4. Construct pre-fueled cooking house
    await this.buildHouse(origin.offset(-15, 0, -5));
  }

  animalsOffset(animal) {
    const offsets = { chicken: -5, cow: 0, sheep: 5, pig: 10 };
    return offsets[animal] || 0;
  }

  async plantCrops(startPos, cropBlock) {
    for (let dx = 0; dx < 5; dx++) {
      for (let dz = 0; dz < 5; dz++) {
        const x = startPos.x + dx;
        const z = startPos.z + dz;
        const y = startPos.y;
        
        // Till the ground to farmland
        await this.bot.chat(`/setblock ${x} ${y - 1} ${z} farmland`);
        // Plant crop with specified state
        await this.bot.chat(`/setblock ${x} ${y} ${z} ${cropBlock}`);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  async buildHouse(pos) {
    const { x, y, z } = pos;
    
    // Construct simple 5x5x4 stone brick structure
    await this.bot.chat(`/fill ${x} ${y} ${z} ${x + 4} ${y + 3} ${z + 4} stone_bricks`);
    await new Promise(resolve => setTimeout(resolve, 200));
    await this.bot.chat(`/fill ${x + 1} ${y} ${z + 1} ${x + 3} ${y + 2} ${z + 3} air`); // Hollow out
    await new Promise(resolve => setTimeout(resolve, 200));

    // Place door and window openings
    await this.bot.chat(`/setblock ${x + 2} ${y} ${z} air`);
    await this.bot.chat(`/setblock ${x + 2} ${y + 1} ${z} air`);
    await this.bot.chat(`/setblock ${x + 2} ${y} ${z} oak_door[half=lower,facing=north]`);
    await this.bot.chat(`/setblock ${x + 2} ${y + 1} ${z} oak_door[half=upper,facing=north]`);
    await new Promise(resolve => setTimeout(resolve, 200));

    // Furnish interior
    await this.bot.chat(`/setblock ${x + 1} ${y} ${z + 1} crafting_table`);
    await this.bot.chat(`/setblock ${x + 3} ${y} ${z + 1} furnace`);
    await new Promise(resolve => setTimeout(resolve, 200));

    // Pre-fuel the furnace with coal
    await this.bot.chat(`/data merge block ${x + 3} ${y} ${z + 1} {Items:[{Slot:1b,id:"minecraft:coal",Count:64b}]}`);
    
    // Place a bed
    await this.bot.chat(`/setblock ${x + 1} ${y} ${z + 3} oak_bed[part=foot,facing=south]`);
    await this.bot.chat(`/setblock ${x + 1} ${y} ${z + 2} oak_bed[part=head,facing=south]`);
    await new Promise(resolve => setTimeout(resolve, 200));
    
    console.log(`[Task] Prefuel cooking house spawned at ${x}, ${y}, ${z}`);
  }
}

module.exports = { CookingTaskInitiator };
