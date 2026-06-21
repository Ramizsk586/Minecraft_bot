const fs = require('fs');
const path = require('path');
const { LocalIndex } = require('vectra');

const DB_DIR = path.join(__dirname, '../../memory_db');
const MAP_PATH = path.join(DB_DIR, 'memory_map.json');
const INDEX_DIR = path.join(DB_DIR, 'index');
const SHORT_ID_PREFIX = 'MEM-';

let index = null;
let shortIdMap = {};
let shortIdCounter = 0;
let currentBot = null;

function getLocalEmbedding(text, dimensions = 384) {
  const vector = new Array(dimensions).fill(0);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  
  words.forEach((word) => {
    if (!word) return;
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = (hash << 5) - hash + word.charCodeAt(i);
      hash |= 0;
    }
    const idx = Math.abs(hash) % dimensions;
    vector[idx] += 1.0;
  });

  let sumSq = 0;
  for (let i = 0; i < dimensions; i++) sumSq += vector[i] * vector[i];
  const norm = Math.sqrt(sumSq) || 1;
  for (let i = 0; i < dimensions; i++) vector[i] /= norm;

  return vector;
}

async function getEmbedding(text) {
  if (currentBot && currentBot._llmConfig) {
    const config = currentBot._llmConfig;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (config.llmApiKey) {
        headers['Authorization'] = `Bearer ${config.llmApiKey}`;
      }
      
      let embedModel = 'text-embedding-3-small';
      if (config.provider === 'ollama') {
        embedModel = 'nomic-embed-text';
      }
      
      const response = await fetch(`${config.llmApiBase}/embeddings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: embedModel,
          input: text
        }),
        signal: AbortSignal.timeout(4000)
      });
      
      if (response.ok) {
        const resData = await response.json();
        const vector = resData?.data?.[0]?.embedding;
        if (Array.isArray(vector)) return vector;
      }
    } catch (err) {
      console.log(`[Memory] API embedding failed, using local hashing fallback: ${err.message}`);
    }
  }
  return getLocalEmbedding(text, 384);
}

function saveMap() {
  try {
    fs.writeFileSync(MAP_PATH, JSON.stringify({
      shortIdCounter,
      shortIdMap
    }, null, 2));
  } catch (err) {
    console.error('[Memory] Failed to save memory map:', err);
  }
}

async function init(bot) {
  currentBot = bot;
  
  // Attach LLM config reference to bot if not already done
  if (!bot._llmConfig && global.llmConfig) {
    bot._llmConfig = global.llmConfig;
  }

  // Ensure directories exist
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  // Load short ID maps
  if (fs.existsSync(MAP_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
      shortIdCounter = data.shortIdCounter || 0;
      shortIdMap = data.shortIdMap || {};
    } catch (err) {
      console.error('[Memory] Failed to read memory map, resetting:', err);
    }
  }

  // Initialize Vectra index
  index = new LocalIndex(INDEX_DIR);
  if (!fs.existsSync(INDEX_DIR)) {
    await index.createIndex();
  }
  
  console.log('[Memory] Vectra memory bank initialized successfully.');
}

async function insertMemory(text) {
  if (!index) return false;
  try {
    shortIdCounter++;
    const shortId = `${SHORT_ID_PREFIX}${shortIdCounter}`;
    const vector = await getEmbedding(text);
    
    const insertResult = await index.insertItem({
      vector,
      metadata: { text }
    });

    shortIdMap[insertResult.id] = shortId;
    saveMap();

    console.log(`[Memory] Saved memory: ${shortId} -> "${text}"`);
    return true;
  } catch (err) {
    console.error('[Memory] Failed to insert memory:', err);
    return false;
  }
}

async function searchRelevant(text, limit = 5) {
  if (!index) return [];
  try {
    const vector = await getEmbedding(text);
    const results = await index.queryItems(vector, limit);

    const mapped = [];
    let changed = false;

    for (const res of results) {
      const fullId = res.item.id;
      let shortId = shortIdMap[fullId];

      if (!shortId) {
        shortIdCounter++;
        shortId = `${SHORT_ID_PREFIX}${shortIdCounter}`;
        shortIdMap[fullId] = shortId;
        changed = true;
      }

      mapped.push({
        text: res.item.metadata.text,
        score: res.score,
        shortId
      });
    }

    if (changed) saveMap();
    return mapped;
  } catch (err) {
    console.error('[Memory] Failed to query memories:', err);
    return [];
  }
}

async function deleteMemoryByShortId(shortId) {
  if (!index) return false;
  try {
    let fullIdToDelete = null;
    for (const [fullId, sId] of Object.entries(shortIdMap)) {
      if (sId === shortId) {
        fullIdToDelete = fullId;
        break;
      }
    }

    if (fullIdToDelete) {
      await index.deleteItem(fullIdToDelete);
      delete shortIdMap[fullIdToDelete];
      saveMap();
      console.log(`[Memory] Deleted memory: ${shortId}`);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`[Memory] Failed to delete memory ${shortId}:`, err);
    return false;
  }
}

async function updateMemoryByShortId(shortId, newText) {
  if (!index) return false;
  try {
    let fullIdToDelete = null;
    for (const [fullId, sId] of Object.entries(shortIdMap)) {
      if (sId === shortId) {
        fullIdToDelete = fullId;
        break;
      }
    }

    if (fullIdToDelete) {
      // Delete old vector
      await index.deleteItem(fullIdToDelete);
      delete shortIdMap[fullIdToDelete];

      // Insert new vector
      const vector = await getEmbedding(newText);
      const insertResult = await index.insertItem({
        vector,
        metadata: { text: newText }
      });

      shortIdMap[insertResult.id] = shortId;
      saveMap();
      console.log(`[Memory] Updated memory ${shortId} -> "${newText}"`);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`[Memory] Failed to update memory ${shortId}:`, err);
    return false;
  }
}

module.exports = {
  init,
  insertMemory,
  searchRelevant,
  deleteMemoryByShortId,
  updateMemoryByShortId
};
