# Minecraft AI Bot

A Minecraft AI bot powered by a Large Language Model (via OpenRouter or Ollama). Control it using natural language commands in the in-game chat.

## Features

- **Cortex Orchestrator**: A unified loop that dynamically assesses threat and survival metrics, managing eating, fleeing, combat defense, swimming, and stuck recovery.
- **Intelligent LLM Actions**: Translates natural language instructions (like `!build a house near me`) into multi-step in-game action sequences.
- **Auto-Farming & Cooking**: Dynamically harvests and replants crops, cooks food, and smelt mined ores.
- **Night Safety**: Automatically seeks shelter or builds a basic temporary structure when night falls or when hostile threats multiply.
- **Armor & Tool Upgrades**: Automatically crafts better weapons/tools and equips armor as resources become available.
- **Interactive Chat**: Can respond to standard chat messages in addition to direct commands.

---

## Setup

### 1. Requirements
- **Node.js**: Version 18 or higher
- **Minecraft Java Edition**: A running server (v1.20.1 recommended, but compatible with other versions)
- **LLM API Key**: Either an OpenRouter API Key, or a local instance of Ollama

### 2. Install
Clone the repository and install dependencies:
```bash
npm install
```

### 3. Configure
Copy the environment variable template:
```bash
cp .env.example .env
```

Open `.env` in a text editor and fill in your details. Here is the structure of `.env.example`:

```env
# Minecraft Connection Settings
# Hostname or IP of the Minecraft server
MC_HOST=localhost

# Port of the Minecraft server
MC_PORT=25565

# Username for the bot to join the server with
MC_USERNAME=AIBot

# Minecraft version. Use 'auto' to auto-detect, or set an exact supported version string (e.g. 1.20.1)
MC_VERSION=auto

# The username of the player who owns and controls the bot. The bot will only listen to commands from this user.
OWNER_USERNAME=YourUsername

# LLM Provider Configuration
# Supported providers: openrouter, ollama
PROVIDER=openrouter

# OpenRouter Settings (Used if PROVIDER=openrouter)
# Your OpenRouter API Key (prefixed with sk-or-)
OPENROUTER_API_KEY=your_openrouter_api_key_here

# The LLM model to use on OpenRouter (e.g., openai/gpt-4o-mini, meta-llama/llama-3-8b-instruct:free, etc.)
LLM_MODEL=openai/gpt-4o-mini

# Optional OpenRouter headers (recommended by OpenRouter guidelines)
OPENROUTER_SITE_URL=https://your-site.example
OPENROUTER_APP_NAME=Minecraft AI Bot

# Ollama Settings (Used if PROVIDER=ollama)
# Base URL for Ollama local API. Defaults to http://ollama.com/v1 in code if empty.
# LLM_API_BASE=http://localhost:11434/v1
# LLM_MODEL=llama3

# Provider-agnostic API settings (can override LLM_API_KEY/LLM_API_BASE for custom endpoints)
# LLM_API_KEY=
# LLM_API_BASE=
```

#### Provider Settings:
- **OpenRouter (Default)**: Set `PROVIDER=openrouter` and input your `OPENROUTER_API_KEY`.
- **Ollama (Local)**: Set `PROVIDER=ollama`. Make sure Ollama is running on your machine (usually at `http://localhost:11434/v1`). You can customize `LLM_API_BASE` and `LLM_MODEL` (e.g. `llama3` or `mistral`) to point to your local endpoints.

`LLM_API_KEY` can be used as a provider-agnostic alias for `OPENROUTER_API_KEY`.
`MC_VERSION=auto` lets Mineflayer detect the server version. If you set it manually, use an exact supported version string.

### 4. Allow offline players (if local server)
If you are running the server locally, ensure you set the online-mode to false in your `server.properties` file:
```properties
online-mode=false
```

### 5. Run
To start the bot, run:
```bash
npm start
```
To run in development mode with automatic restarts on changes:
```bash
npm run dev
```

---

## In-game Commands

All commands start with `!` in chat, and are only executed if sent by the user defined in `OWNER_USERNAME`.

### Core System Commands

| Command | Description |
|---------|-------------|
| `!help` | Shows general command usage and basic shortcuts. |
| `!commands` | Lists all bot capabilities (Build, Gather, Farming, Auto-behaviors, etc.). |
| `!status` | Reports current health, coordinates, hunger, and inventory. |
| `!stop` | Aborts current actions and stops pathfinding immediately. |
| `!reset` | Clears conversation memory/history. |
| `!<anything>` | Translates your natural language instructions into actions. |

### Instant Brain Actions (No LLM Calls)
Simple operations are intercepted and handled immediately by the bot's internal rules:
- `!eat` (auto-consumes the best food)
- `!craft <item>` / `!make planks` / `!make sticks`
- `!gear up` (crafts the best available weapons/armor)
- `!food report` / `!craft report`
- `!attack` / `!defend`

---

## Example Instructions

You can instruct the bot to perform complex workflows. Examples:
```text
!come to me
!mine 32 oak_log
!build a watch_tower near me
!fight that zombie
!go to 100 64 -250
!craft a wooden pickaxe
!what do I need to make iron armor?
!gather food, I'm starving
!follow me
!mine diamonds and come back
```

---

## How It Works

1. **Input**: You type `!<command>` in Minecraft chat (or talk to the bot normally without a prefix for conversational chat).
2. **Brain Check**: The internal brain checks if it is an instant-action command. If it is, the bot executes it directly without hitting the LLM.
3. **LLM Reasoning**: For complex requests, the bot collects the current world state (coordinates, inventory, nearby entities) and sends it to the LLM (OpenRouter/Ollama).
4. **Action Execution**: The model responds with a structured JSON action object. The bot parses and executes the task sequence (e.g. going to a location, mining blocks, crafting requirements).
5. **Autonomy Loop**: Under the hood, the **Cortex Orchestrator** monitors vital stats (like hunger and threats) in the background to ensure safety.

---

## Tips

- **Be Specific**: Detailed directions (e.g., `!mine 10 iron_ore`) work better than vague requests (e.g., `!get iron`).
- **Use !stop**: If the bot is stuck or performing a long-running activity you want to abort, type `!stop`.
- **Autonomy**: The bot remembers up to 10 back-and-forth messages. Use `!reset` if it gets confused or you want to start a new sequence of tasks.
- **Safety**: Make sure `OWNER_USERNAME` matches your Minecraft username exactly so the bot responds to you.

