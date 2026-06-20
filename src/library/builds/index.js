const fs = require('fs');
const path = require('path');

const BUILDS_DIR = __dirname;

function loadBuildFiles() {
  const files = fs.readdirSync(BUILDS_DIR)
    .filter(file => file.endsWith('.json'));

  const blueprints = {};
  for (const file of files) {
    const fullPath = path.join(BUILDS_DIR, file);
    const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    if (!data?.id) continue;
    blueprints[data.id] = data;
  }

  return blueprints;
}

const BLUEPRINTS = loadBuildFiles();

function listBlueprints() {
  return Object.keys(BLUEPRINTS);
}

function getBlueprint(id = 'home') {
  return BLUEPRINTS[id] || BLUEPRINTS.home || Object.values(BLUEPRINTS)[0] || null;
}

module.exports = {
  BLUEPRINTS,
  listBlueprints,
  getBlueprint,
};
