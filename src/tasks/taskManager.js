// ─── Task Manager ─────────────────────────────────────────────────────────────
// Manages the benchmark task lifecycle, timeouts, target validation, and cooperative state.

const fs = require('fs');
const { Vec3 } = require('vec3');

const PROGRESS_FILE = './hells_kitchen_progress.json';

const cooperativeProgress = {
  read() {
    try {
      if (fs.existsSync(PROGRESS_FILE)) {
        return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
      }
    } catch (err) {
      console.error('Error reading progress file:', err);
    }
    return { taskId: null, agent0Complete: false, agent1Complete: false };
  },
  
  update(taskId, agentId, isComplete) {
    const data = this.read();
    if (data.taskId !== taskId) {
      data.taskId = taskId;
      data.agent0Complete = false;
      data.agent1Complete = false;
    }
    if (agentId === 0) data.agent0Complete = isComplete;
    if (agentId === 1) data.agent1Complete = isComplete;
    try {
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data), 'utf8');
    } catch (err) {
      console.error('Error writing progress file:', err);
    }
    return data;
  }
};

class TaskManager {
  constructor(bot, data) {
    this.bot = bot;
    this.data = data || {};
    this.taskId = this.data.task_id || `task_${Date.now()}`;
    this.type = this.data.type || 'techtree'; // 'cooking', 'construction', 'techtree'
    this.timeout = this.data.timeout || 300; // in seconds
    this.startTime = Date.now();
    this.agentId = bot.count_id || 0;
  }

  async initialize() {
    this.bot.chat(`Initializing task: ${this.taskId} (${this.type})`);
    
    // 1. Clear inventory for a clean starting environment
    await this.bot.chat('/clear');
    await new Promise(resolve => setTimeout(resolve, 500));

    // 2. Set up task-specific worlds (only executed by agent 0 to prevent conflicts)
    if (this.agentId === 0) {
      if (this.type === 'cooking') {
        const { CookingTaskInitiator } = require('./cookingTaskInitiator');
        const initiator = new CookingTaskInitiator(this.bot, this.data);
        await initiator.init();
      }
    }

    // 3. Teleport and position bots
    if (this.data.blueprint && this.data.blueprint.levels && this.data.blueprint.levels[0]) {
      const coord = this.data.blueprint.levels[0].coordinates;
      if (coord) {
        // Teleport bot to the construction site origin
        await this.bot.chat(`/tp @s ${coord[0]} ${coord[1]} ${coord[2]}`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } else {
      // Disperse bots slightly to prevent stacking
      const offset = this.agentId * 2;
      await this.bot.chat(`/tp @s ~${offset} ~ ~`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 4. Distribute starting inventory items
    const inventoryConfig = this.data.initial_inventory;
    if (inventoryConfig) {
      const startItems = inventoryConfig[this.agentId.toString()] || inventoryConfig[this.agentId] || [];
      for (const item of startItems) {
        // item format: [itemName, count]
        const name = item[0].includes(':') ? item[0] : `minecraft:${item[0]}`;
        const count = item[1] || 1;
        await this.bot.chat(`/give @s ${name} ${count}`);
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // 5. Inject goal description
    const goalMsg = this.data.goal || `Complete the ${this.type} task targeting ${JSON.stringify(this.data.target)}.`;
    this.bot.chat(`[Goal] ${goalMsg}`);
    this.bot._currentTask = goalMsg;
  }

  getTargets() {
    const rawTarget = this.data.target;
    if (!rawTarget) return [];
    
    if (typeof rawTarget === 'string') {
      return [rawTarget];
    }
    
    if (Array.isArray(rawTarget)) {
      // Cooperative target lists
      if (this.data.task_id && this.data.task_id.endsWith('hells_kitchen') && rawTarget.length === 2) {
        return [rawTarget[this.agentId]];
      }
      return rawTarget;
    }
    
    if (typeof rawTarget === 'object') {
      return Object.keys(rawTarget);
    }
    
    return [];
  }

  checkItemPresence() {
    const rawTarget = this.data.target;
    const requiredNum = this.data.number_of_target || 1;

    // Helper: count items in inventory
    const countInInventory = (itemName) => {
      return this.bot.inventory.items()
        .filter(item => item.name === itemName || item.name === `minecraft:${itemName}`)
        .reduce((sum, item) => sum + item.count, 0);
    };

    // 1. Cooperative logic (Hells Kitchen)
    if (this.data.task_id && this.data.task_id.endsWith('hells_kitchen') && Array.isArray(rawTarget) && rawTarget.length === 2) {
      const targetForThisAgent = rawTarget[this.agentId];
      const count = countInInventory(targetForThisAgent);
      const isAgentComplete = count >= requiredNum;

      // Update cooperative shared state file
      const progress = cooperativeProgress.update(this.taskId, this.agentId, isAgentComplete);
      const success = progress.agent0Complete && progress.agent1Complete;

      return {
        success,
        score: success ? 100 : (isAgentComplete ? 50 : 0)
      };
    }

    // 2. Standard single/multi target maps
    if (typeof rawTarget === 'object' && !Array.isArray(rawTarget) && rawTarget !== null) {
      let matchedCount = 0;
      let totalItems = 0;
      
      for (const [name, targetQty] of Object.entries(rawTarget)) {
        const count = countInInventory(name);
        if (count >= targetQty) matchedCount++;
        totalItems++;
      }
      
      const success = matchedCount === totalItems;
      return {
        success,
        score: totalItems > 0 ? (matchedCount / totalItems) * 100 : 100
      };
    }

    // 3. Basic target string or single array target
    const targetName = Array.isArray(rawTarget) ? rawTarget[0] : rawTarget;
    if (targetName) {
      const count = countInInventory(targetName);
      const success = count >= requiredNum;
      return {
        success,
        score: Math.min(100, (count / requiredNum) * 100)
      };
    }

    return { success: false, score: 0 };
  }

  async checkCompletion() {
    // Check timeouts first
    const elapsedSeconds = (Date.now() - this.startTime) / 1000;
    if (elapsedSeconds >= this.timeout) {
      this.bot.chat(`[Task] Timeout reached after ${this.timeout} seconds.`);
      return { done: true, score: 0, reason: 'timeout' };
    }

    // Task type evaluations
    if (this.type === 'cooking' || this.type === 'techtree') {
      const result = this.checkItemPresence();
      if (result.success) {
        return { done: true, score: result.score, reason: 'completed' };
      }
    } else if (this.type === 'construction') {
      // Construction uses voxel blueprints validation
      if (this.data.blueprint) {
        const { validateStructure } = require('../actions/builder_utils');
        const origin = new Vec3(...this.data.blueprint.levels[0].coordinates);
        const facing = 'south'; // default orientation
        const report = validateStructure(this.bot, this.data.blueprint, origin, facing);
        if (report.valid && report.score >= 100) {
          return { done: true, score: 100, reason: 'completed' };
        }
      }
    }

    return { done: false };
  }

  async teardown() {
    this.bot.chat('[Task] Teardown started. Clearing inventory.');
    await this.bot.chat('/clear');
    this.bot._currentTask = null;
  }
}

module.exports = { TaskManager };
