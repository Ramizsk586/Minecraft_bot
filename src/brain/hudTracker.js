const { getWorldState } = require('../worldState');

class HudTracker {
  constructor() {
    this.lastState = null;
  }

  /**
   * Compares the current bot state to the previous cached state and generates a markdown diff.
   * If there is no previous state, returns the complete world state description.
   * @param {Object} bot - The mineflayer bot instance.
   * @returns {string} The markdown diff of the status changes.
   */
  generateDiff(bot) {
    if (!bot || !bot.entity) return '';

    const currentState = {
      health: Math.round(bot.health || 20),
      food: Math.round(bot.food || 20),
      pos: bot.entity.position ? {
        x: Math.round(bot.entity.position.x),
        y: Math.round(bot.entity.position.y),
        z: Math.round(bot.entity.position.z)
      } : { x: 0, y: 0, z: 0 },
      inventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count })),
      biome: bot.blockAt(bot.entity.position)?.biome?.name || 'unknown'
    };

    if (!this.lastState) {
      this.lastState = currentState;
      return getWorldState(bot);
    }

    const diffLines = [];

    // Health
    if (currentState.health !== this.lastState.health) {
      const change = currentState.health - this.lastState.health;
      diffLines.push(`* Health: ${currentState.health}/20 (${change > 0 ? '+' : ''}${change})`);
    }

    // Food
    if (currentState.food !== this.lastState.food) {
      const change = currentState.food - this.lastState.food;
      diffLines.push(`* Food: ${currentState.food}/20 (${change > 0 ? '+' : ''}${change})`);
    }

    // Position (only if moved > 5 blocks)
    const lastPos = this.lastState.pos;
    const currPos = currentState.pos;
    const dist = Math.sqrt(Math.pow(currPos.x - lastPos.x, 2) + Math.pow(currPos.y - lastPos.y, 2) + Math.pow(currPos.z - lastPos.z, 2));
    if (dist > 5) {
      diffLines.push(`* Coordinates: X=${currPos.x}, Y=${currPos.y}, Z=${currPos.z} (Moved ${Math.round(dist)}m)`);
    }

    // Inventory additions / removals
    const lastInvMap = new Map(this.lastState.inventory.map(i => [i.name, i.count]));
    const currInvMap = new Map(currentState.inventory.map(i => [i.name, i.count]));

    const changes = [];
    
    // Additions
    for (const [name, count] of currInvMap) {
      const lastCount = lastInvMap.get(name) || 0;
      if (count > lastCount) {
        changes.push(`+${count - lastCount} ${name}`);
      }
    }
    // Removals
    for (const [name, count] of lastInvMap) {
      const currCount = currInvMap.get(name) || 0;
      if (currCount < count) {
        changes.push(`-${count - currCount} ${name}`);
      }
    }

    if (changes.length > 0) {
      diffLines.push(`* Inventory updates: ${changes.join(', ')}`);
    }

    // Biome
    if (currentState.biome !== this.lastState.biome) {
      diffLines.push(`* Biome: ${currentState.biome}`);
    }

    this.lastState = currentState;

    if (diffLines.length === 0) {
      return '';
    }

    return `[STATUS UPDATE]\n${diffLines.join('\n')}`;
  }
}

module.exports = HudTracker;
