const { TaskNode } = require('./taskTree');

const DECOMPOSER_PROMPT = `You are a task decomposer for a Minecraft bot.
Your job is to take a natural-language goal and break it down into a sequence of concrete, simple actions.

You respond ONLY with a JSON array of actions. Do not output any other text.
Each action in the array must be one of the standard bot actions:
- {"action": "goto", "x": number, "y": number, "z": number}
- {"action": "mine", "block": "block_name", "count": number}
- {"action": "craft", "item": "item_name", "count": number}
- {"action": "equip", "item": "item_name"}
- {"action": "place", "block": "block_name", "x": number, "y": number, "z": number}
- {"action": "build_house", "blueprint": "home|farm|etc", "x": number, "y": number, "z": number, "facing": "north|south|etc"}
- {"action": "chat", "message": "message"}

Example Goal: "make a stone pickaxe"
Example Output:
[
  {"action": "mine", "block": "stone", "count": 3},
  {"action": "craft", "item": "stone_pickaxe", "count": 1},
  {"action": "equip", "item": "stone_pickaxe"}
]`;

/**
 * Queries the LLM to decompose a natural language goal into specific ActionNodes in the tree.
 * @param {Object} bot - The mineflayer bot instance.
 * @param {TaskNode} node - The NLNode being decomposed.
 * @param {TaskTreeExecutor} executor - The active task tree executor.
 */
async function decomposeNLNode(bot, node, executor) {
  const config = bot._llmConfig || (global.llmConfig ? global.llmConfig : {});
  if (!config.llmApiBase) {
    throw new Error('LLM configuration is missing or not initialized');
  }

  const goal = node.label;
  console.log(`[NLDecomposer] Decomposing goal: "${goal}"`);

  const headers = { 'Content-Type': 'application/json' };
  if (config.llmApiKey) {
    headers['Authorization'] = `Bearer ${config.llmApiKey}`;
  }

  const response = await fetch(`${config.llmApiBase}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.llmModel,
      temperature: 0.1,
      messages: [
        { role: 'system', content: DECOMPOSER_PROMPT },
        { role: 'user', content: `Decompose the following goal: "${goal}"` }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "decomposed_actions",
          strict: true,
          schema: {
            type: "array",
            items: {
              type: "object",
              properties: {
                action: { type: "string" },
                block: { type: "string" },
                item: { type: "string" },
                count: { type: "number" },
                x: { type: "number" },
                y: { type: "number" },
                z: { type: "number" },
                blueprint: { type: "string" },
                facing: { type: "string" },
                message: { type: "string" }
              },
              required: ["action"],
              additionalProperties: false
            }
          }
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to decompose task via LLM: ${response.statusText}`);
  }

  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content?.trim();
  if (!raw) {
    throw new Error('Decomposer LLM returned empty decomposition');
  }

  let parsedArray;
  try {
    parsedArray = JSON.parse(raw);
  } catch (err) {
    // If strict json failed to parse, attempt manual regex extract as fallback
    const { extractJson } = require('../utils');
    parsedArray = extractJson(raw);
  }

  if (!Array.isArray(parsedArray)) {
    throw new Error('Decomposer LLM response is not a valid JSON array');
  }

  parsedArray.forEach((action, idx) => {
    const childId = `${node.id}_step_${idx}`;
    const actionNode = new TaskNode(childId, 'ACTION', `Step ${idx + 1}: ${action.action}`, action);
    node.addChild(actionNode);
    executor.registerNode(actionNode);
  });

  console.log(`[NLDecomposer] Successfully decomposed into ${node.children.length} subtasks.`);
}

module.exports = {
  decomposeNLNode
};
