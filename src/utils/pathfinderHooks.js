const { Vec3 } = require('vec3');

/**
 * Applies runtime hooks to mineflayer-pathfinder to prevent stuck loops.
 * @param {Object} bot - The mineflayer bot instance.
 */
function applyHooks(bot) {
  const stallCounters = new Map(); // key: 'x,y,z' -> { count, timestamp }
  const EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes expiration for stall exclusion area

  /**
   * Records a movement stall at a specific position.
   * Increments the stall counter and updates the timestamp.
   */
  bot.recordStall = (pos) => {
    if (!pos) return;
    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
    const now = Date.now();
    const existing = stallCounters.get(key) || { count: 0, timestamp: now };
    existing.count++;
    existing.timestamp = now;
    stallCounters.set(key, existing);
    console.log(`[PathfinderHooks] Registered stall at ${key} (count: ${existing.count})`);
  };

  // Intercept movements when they are set
  const originalSetMovements = bot.pathfinder.setMovements;
  bot.pathfinder.setMovements = function (movements) {
    originalSetMovements.apply(this, arguments);
    if (movements) {
      if (!Array.isArray(movements.exclusionAreasStep)) {
        movements.exclusionAreasStep = [];
      }
      
      // Clean up previous hook if any
      movements.exclusionAreasStep = movements.exclusionAreasStep.filter(f => f.name !== 'stallPenaltyHook');
      
      // Push our custom penalty function
      const stallPenaltyHook = function stallPenaltyHook(block) {
        if (!block || !block.position) return 0;
        const key = `${block.position.x},${block.position.y},${block.position.z}`;
        const entry = stallCounters.get(key);
        if (entry) {
          // Check expiration
          if (Date.now() - entry.timestamp > EXPIRATION_MS) {
            stallCounters.delete(key);
            return 0;
          }
          return 1000 * entry.count; // Apply steep penalty
        }
        return 0;
      };

      movements.exclusionAreasStep.push(stallPenaltyHook);
      
      // Enable smart flags
      movements.allowDoors = true;
      movements.allowParkour = true;
    }
  };

  // Track movements to detect stalls
  let lastPos = null;
  let lastPosTime = Date.now();
  
  const checkInterval = setInterval(() => {
    if (!bot || !bot.entity) return;
    
    // Reset counters when not moving
    if (!bot.pathfinder || !bot.pathfinder.isMoving()) {
      lastPos = null;
      return;
    }

    const currentPos = bot.entity.position;
    if (lastPos && currentPos.distanceTo(lastPos) < 0.15) {
      // Stuck in nearly the exact same position for more than 2.5s while active
      if (Date.now() - lastPosTime > 2500) {
        bot.recordStall(currentPos);
        lastPosTime = Date.now(); // Reset timer to prevent double firing

        // Trigger path recalculation
        try {
          const currentGoal = bot.pathfinder.goal;
          if (currentGoal) {
            console.log('[PathfinderHooks] Bot is stuck. Forcing path recalculation...');
            bot.pathfinder.setGoal(null);
            bot.pathfinder.setGoal(currentGoal);
          }
        } catch (err) {
          console.error('[PathfinderHooks] Force recalculation failed:', err.message);
        }
      }
    } else {
      lastPos = currentPos.clone();
      lastPosTime = Date.now();
    }
  }, 500);

  // Monitor doors/gates to recalculate pathing immediately if opened/closed
  const onBlockUpdate = (oldBlock, newBlock) => {
    if (!oldBlock || !newBlock) return;
    const isDoor = (b) => b.name.endsWith('_door') || b.name.endsWith('_gate');
    if (isDoor(oldBlock) && isDoor(newBlock)) {
      // Check if open state changed
      const wasOpen = oldBlock.metadata & 0x4; // 0x4 bit represents open in most door states
      const isOpen = newBlock.metadata & 0x4;
      if (wasOpen !== isOpen) {
        if (bot.pathfinder && bot.pathfinder.isMoving()) {
          const goal = bot.pathfinder.goal;
          if (goal) {
            console.log('[PathfinderHooks] Door state changed. Recalculating pathing...');
            bot.pathfinder.setGoal(null);
            bot.pathfinder.setGoal(goal);
          }
        }
      }
    }
  };
  bot.on('blockUpdate', onBlockUpdate);

  bot.once('end', () => {
    clearInterval(checkInterval);
    bot.off('blockUpdate', onBlockUpdate);
  });
}

module.exports = {
  applyHooks
};
