const { createExecutor } = require('../actions/index');

class TaskNode {
  constructor(id, type, label, data = {}) {
    this.id = id;
    this.type = type; // 'NL' or 'ACTION'
    this.label = label; // human description
    this.data = data; // action JSON or prompt context
    this.status = 'pending'; // 'pending', 'running', 'succeeded', 'failed'
    this.children = [];
    this.parentId = null;
  }

  addChild(childNode) {
    childNode.parentId = this.id;
    this.children.push(childNode);
  }
}

class TaskTreeExecutor {
  constructor(bot) {
    this.bot = bot;
    this.rootNode = null;
    this.nodesMap = new Map();
  }

  setRoot(node) {
    this.rootNode = node;
    this.registerNode(node);
  }

  registerNode(node) {
    this.nodesMap.set(node.id, node);
    for (const child of node.children) {
      this.registerNode(child);
    }
  }

  async executeNode(node) {
    if (this.bot.interrupt_code) {
      node.status = 'failed';
      throw new Error('aborted');
    }

    node.status = 'running';
    console.log(`[TaskTree] Executing node ${node.id} (${node.label}) [${node.type}]`);

    if (node.type === 'ACTION') {
      try {
        const executeAction = this.bot.executeAction || createExecutor(this.bot);
        await executeAction(node.data);
        node.status = 'succeeded';
      } catch (err) {
        node.status = 'failed';
        throw err;
      }
    } else if (node.type === 'NL') {
      // Decompose if it has no children yet and is an NL node
      if (node.children.length === 0) {
        const nlDecomposer = require('./nlDecomposer');
        await nlDecomposer.decomposeNLNode(this.bot, node, this);
      }

      // Execute children sequentially
      try {
        for (const child of node.children) {
          await this.executeNode(child);
        }
        node.status = 'succeeded';
      } catch (err) {
        node.status = 'failed';
        throw err;
      }
    }
  }

  async run(rootNode) {
    this.setRoot(rootNode);
    try {
      await this.executeNode(this.rootNode);
      console.log(`[TaskTree] Tree ${this.rootNode.id} completed successfully!`);
      return true;
    } catch (err) {
      console.error(`[TaskTree] Tree execution failed:`, err.message);
      return false;
    }
  }
}

module.exports = {
  TaskNode,
  TaskTreeExecutor
};
