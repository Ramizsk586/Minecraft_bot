# Minecraft AI Bot

A Minecraft bot powered by an LLM through OpenRouter. Control it with natural language commands in-game chat.

## Setup

### 1. Requirements
- Node.js 18+
- A running Minecraft Java Edition server (1.20.1)
- An OpenRouter API key

### 2. Install
```bash
npm install
```

### 3. Configure
Create a `.env` file and fill in your values:

```env
OPENROUTER_API_KEY=sk-or-...
LLM_MODEL=openai/gpt-4o-mini
MC_HOST=localhost
MC_PORT=25565
MC_USERNAME=AIBot
MC_VERSION=auto
OWNER_USERNAME=YourUsername
```

Optional settings:

```env
LLM_API_KEY=
LLM_API_BASE=https://openrouter.ai/api/v1
OPENROUTER_SITE_URL=https://your-site.example
OPENROUTER_APP_NAME=Minecraft AI Bot
```

`LLM_API_KEY` can be used as a provider-agnostic alias for `OPENROUTER_API_KEY`.
`MC_VERSION=auto` lets Mineflayer detect the server version. If you set it manually, use an exact supported version string.

### 4. Allow offline players (if local server)
In your `server.properties` set:

```properties
online-mode=false
```

### 5. Run
```bash
npm start
```

## In-game Commands

All commands start with `!`

| Command | What it does |
|---------|--------------|
| `!help` | Show command list |
| `!status` | Show bot health, position, and inventory |
| `!stop` | Stop whatever the bot is doing |
| `!reset` | Clear AI memory and start fresh |
| `!<anything>` | Give the AI a natural language task |

## Example Commands

```text
!come to me
!mine 32 oak_log
!build a small house near me
!fight that zombie
!go to 100 64 200
!craft a wooden pickaxe
!what do I need to make iron armor?
!gather food, I'm starving
!follow me
!mine diamonds and come back
```

## How It Works

1. You type `!<command>` in Minecraft chat.
2. The bot sends your message and current world state to the configured LLM.
3. The model returns a JSON action object.
4. The bot executes the action.
5. Multi-step tasks are handled with `sequence`.

## Tips

- Be specific: `!mine 10 iron_ore` works better than `!get iron`.
- The bot remembers the last 10 exchanges; use `!reset` to clear memory.
- Use `!stop` to interrupt a long-running task.
- The bot only listens to the player set in `OWNER_USERNAME`.
