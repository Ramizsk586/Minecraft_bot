const fs = require('fs');
const path = require('path');
const memory = require('./memory');

function takeSnapshot(bot) {
  if (!bot) return null;
  
  const inv = {};
  if (bot.inventory) {
    bot.inventory.items().forEach(item => {
      inv[item.name] = (inv[item.name] || 0) + item.count;
    });
  }

  return {
    health: bot.health || 20,
    food: bot.food || 20,
    position: bot.entity?.position ? { x: Math.round(bot.entity.position.x), y: Math.round(bot.entity.position.y), z: Math.round(bot.entity.position.z) } : null,
    inventory: inv,
    timestamp: Date.now()
  };
}

function computeDiff(before, after) {
  const diff = {
    itemsGained: {},
    itemsLost: {},
    healthDiff: after.health - before.health,
    foodDiff: after.food - before.food
  };

  const allKeys = new Set([...Object.keys(before.inventory), ...Object.keys(after.inventory)]);
  allKeys.forEach(key => {
    const countBefore = before.inventory[key] || 0;
    const countAfter = after.inventory[key] || 0;
    const delta = countAfter - countBefore;
    if (delta > 0) {
      diff.itemsGained[key] = delta;
    } else if (delta < 0) {
      diff.itemsLost[key] = Math.abs(delta);
    }
  });

  return diff;
}

function getDistance(posA, posB) {
  if (!posA || !posB) return 0;
  const dx = (posA.x || 0) - (posB.x || 0);
  const dy = (posA.y || 0) - (posB.y || 0);
  const dz = (posA.z || 0) - (posB.z || 0);
  return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
}

async function queryLLMCritique(bot, taskName, diff, success, errorMsg) {
  if (!bot || !bot._llmConfig || !bot._llmConfig.llmApiKey) {
    return null;
  }
  
  const config = bot._llmConfig;
  const prompt = `You are a self-reflection critic for a Minecraft bot named ${bot.username}.
A task was executed. Refined your analysis into a single concise "Lesson Learned" under 150 characters.

=== TASK DETAILS ===
Task: "${taskName}"
Success: ${success}
${errorMsg ? `Error Message: "${errorMsg}"` : ''}

=== STATE DIFFERENCES ===
Health Delta: ${diff.healthDiff} (from ${diff.healthDiff < 0 ? 'taking damage' : 'healing'})
Hunger Delta: ${diff.foodDiff}
Items Gained: ${JSON.stringify(diff.itemsGained)}
Items Lost: ${JSON.stringify(diff.itemsLost)}

Write a one-sentence lesson starting with "Lesson: " describing what to do or avoid next time.`;

  try {
    const response = await fetch(`${config.llmApiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.llmApiKey}`
      },
      body: JSON.stringify({
        model: config.llmModel,
        messages: [
          { role: 'system', content: 'You generate short, actionable self-critiques for a Minecraft bot. Keep responses under 150 characters.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 60,
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (content) return content;
    }
  } catch (err) {
    console.log(`[RL Critic] Critic LLM call failed: ${err.message}`);
  }
  return null;
}

function getHeuristicCritique(taskName, diff, success, errorMsg) {
  let lesson = '';
  
  if (success) {
    const gained = Object.keys(diff.itemsGained);
    if (gained.length > 0) {
      lesson = `Lesson: Successfully performed "${taskName}" and collected ${gained.map(k => `${k} x${diff.itemsGained[k]}`).join(', ')}.`;
    } else {
      lesson = `Lesson: Successfully completed "${taskName}" with stable resources.`;
    }
  } else {
    // Failure heuristic analysis
    const taskLower = taskName.toLowerCase();
    
    if (diff.healthDiff < 0) {
      lesson = `Lesson: Task "${taskName}" was dangerous (lost ${Math.abs(diff.healthDiff)} HP). Ensure defense or gear up before re-attempting.`;
    } else if (taskLower.includes('mine') && errorMsg && (errorMsg.includes('tool') || errorMsg.includes('pickaxe'))) {
      lesson = `Lesson: Mining failed due to tool constraints. Verify pickaxe tier requirement (e.g. iron for iron/diamond ores) before mining.`;
    } else if (taskLower.includes('craft') && errorMsg) {
      lesson = `Lesson: Crafting failed. Collect necessary raw ingredients (wood logs for sticks/planks) first.`;
    } else {
      lesson = `Lesson: Task "${taskName}" failed with error "${errorMsg || 'unknown reasons'}". Plan carefully and clear obstacles.`;
    }
  }
  
  return lesson;
}

async function recordExperience(bot, taskName, beforeSnapshot, success, errorMsg = '') {
  if (!bot || !beforeSnapshot) return;
  
  const afterSnapshot = takeSnapshot(bot);
  const diff = computeDiff(beforeSnapshot, afterSnapshot);
  
  console.log(`[RL Critic] Evaluating task: "${taskName}" | Success: ${success}`);
  
  // Try LLM critique first, fallback to heuristics
  let critique = await queryLLMCritique(bot, taskName, diff, success, errorMsg);
  if (!critique) {
    critique = getHeuristicCritique(taskName, diff, success, errorMsg);
  }
  
  const fullText = `[RL Lesson] Task: "${taskName}" | Outcome: ${success ? 'SUCCESS' : 'FAILED'} | ${critique}`;
  
  // Insert critique experience into vector database
  const saved = await memory.insertMemory(fullText);
  if (saved) {
    console.log(`[RL Critic] Experience recorded: "${fullText}"`);
  }
  
  // Compute numerical reward for stats reporting
  let reward = 0;
  if (success) reward += 20;
  else reward -= 12;
  reward += diff.healthDiff * 3;
  reward += diff.foodDiff * 1.5;
  reward += Object.values(diff.itemsGained).reduce((a, b) => a + b, 0) * 2;
  reward -= Object.values(diff.itemsLost).reduce((a, b) => a + b, 0) * 1;
  reward += Math.min(8, getDistance(beforeSnapshot.position, afterSnapshot.position) * 0.08);
  if (errorMsg) reward -= 4;
  if (taskName.includes('autonomy_rl_idle') && Object.keys(diff.itemsGained).length === 0 && diff.healthDiff <= 0 && diff.foodDiff <= 0) {
    reward -= 6;
  }
  if (afterSnapshot.health <= 0) reward -= 100; // died

  return { reward: Number(reward.toFixed(2)), critique };
}

module.exports = {
  takeSnapshot,
  recordExperience
};
