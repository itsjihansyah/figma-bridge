# Figma Bridge

**Let any AI coding agent design live in your Figma file, without the Figma MCP.**

Figma Bridge is a tiny Figma plugin plus a relay you deploy for free on Cloudflare. Your agent sends JavaScript over HTTP. The plugin runs it with the [Figma Plugin API](https://www.figma.com/plugin-docs/), and the changes appear on your canvas immediately. The agent gets back results, node IDs, and PNG screenshots so it can check its own work.

```
AI agent ──HTTP POST /run──▶ Relay (Cloudflare Worker) ──WebSocket──▶ "Claude Bridge" plugin in Figma
         ◀──────────── result / error / node IDs / PNG ◀───────────────────┘
```

> Unofficial community project. Not affiliated with Figma or Anthropic.

---

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [What's included vs. what you set up](#whats-included-vs-what-you-set-up)
- [Setup](#setup)
- [Usage](#usage)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Limitations](#limitations)
- [Project structure](#project-structure)
- [License](#license)

---

## Features

- **Full Plugin API access.** Create frames, auto layout, text, components, variables, and anything else the Plugin API can do.
- **Works with any agent that can run a shell command.** That includes Claude Code (terminal, desktop or web), Cursor, Codex, Aider, or a plain `curl`.
- **Visual feedback loop.** The agent can export PNG screenshots of any node and look at them before it moves on.
- **Plugin never needs updating.** It is a thin executor with no design logic, and all logic arrives at runtime.
- **Free to run.** The relay fits comfortably in Cloudflare's free plan (Workers + SQLite-backed Durable Objects).
- **Private by default.** You deploy your own relay, and each channel token gets its own isolated channel.

## How it works

1. **Relay (`relay/`).** A Cloudflare Worker with one Durable Object per channel token.
   - It accepts `POST /run` from the agent and forwards the code over a WebSocket to the plugin.
   - It waits for the result and returns it to the agent.
2. **Plugin (`plugin/`).** Runs in Figma desktop and holds the WebSocket open.
   - It executes each incoming script as the body of an async function, with `figma` in scope.
   - It sends back the return value. Nodes are serialized and `Uint8Array` values are encoded as PNG.
3. **CLI (`cli/figma-send.mjs`).** An optional helper that sends a script file and saves returned PNGs to disk.

The channel token is the shared secret: the agent and the plugin connect to the same channel only if they use the same token.

## Requirements

| | |
|---|---|
| **Figma desktop app** | Development plugins don't run in the browser |
| **Node.js 18+** | To deploy the relay and to use the CLI |
| **Cloudflare account** (free) | To host the relay. Your email must be verified. |
| **An AI agent with shell access** | Claude Code, Cursor, Codex, … Plain chat apps without tool access can't reach the relay. |

## What's included vs. what you set up

| Part | Status |
|---|---|
| Figma plugin (`plugin/`) | ✅ **Ready.** Import it into Figma. |
| Relay source (`relay/`) | ✅ **Ready.** Deploy it with one command. |
| CLI (`cli/figma-send.mjs`) | ✅ **Ready** |
| Agent instructions (`docs/AGENT_GUIDE.md`) | ✅ **Ready.** Point your agent at it. |
| Deploying the relay | ✋ **You,** once (Step 1) |
| Channel token | ✋ **You,** once (Step 2). No token file is needed in the repo. |
| Installing and connecting the plugin | ✋ **You,** once (Steps 3–4). The plugin remembers your settings. |
| Giving the agent the URL and token | ✋ **You,** once (Step 5) |
| Opening the plugin before each session | ✋ **You,** every session |

---

## Setup

### Step 1: Deploy the relay

```bash
git clone https://github.com/itsjihansyah/figma-bridge.git
cd figma-bridge/relay
npx wrangler login     # a browser window opens → click Allow
npx wrangler deploy    # prints https://figma-bridge.<your-subdomain>.workers.dev
```

- If Wrangler asks you to register a `workers.dev` subdomain, choose any name.
- Open the printed URL in a browser. It should show `figma-bridge relay ok`. DNS can take a few minutes.

> **Sharing with a team?** One relay can serve many people. Everyone just needs their **own** token, because each token is a separate channel.

### Step 2: Generate a channel token

The token is a random secret of at least 24 characters. Pick any method:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
# or
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

No terminal? Generate a random 32-character password in your password manager.

Store the token somewhere safe, such as your password manager or a local `.env` (see [Configuration](#configuration)). **Don't commit it, and don't paste it into chats.**

### Step 3: Install the plugin

1. Download or clone this repo.
2. In **Figma desktop**, go to **Plugins → Development → Import plugin from manifest…**
3. Select `plugin/manifest.json`.

### Step 4: Connect the plugin

1. Open the design file you want to work on.
2. Run **Plugins → Development → Claude Bridge**.
3. Paste your **Relay URL** and **Channel token**, then click **Connect**.
4. The dot turns **green**. The plugin remembers both values from now on.

### Step 5: Give your agent the URL and token

The agent reads two environment variables, `FIGMA_BRIDGE_URL` and `FIGMA_BRIDGE_TOKEN`:

| Agent | Where to put them |
|---|---|
| **Claude Code** (terminal / desktop) | Add an `env` block to `~/.claude/settings.json`: `{"env": {"FIGMA_BRIDGE_URL": "…", "FIGMA_BRIDGE_TOKEN": "…"}}` |
| **Claude Code on the web** | Session environment → Edit → **Environment variables**. Make sure network access allows `*.workers.dev`. |
| **Other agents / shells** | Use a `.env` file (see [Configuration](#configuration)), `export` them in `~/.zshrc` / `~/.bashrc`, or use your agent's secrets feature. |

### Step 6: Verify

```bash
curl -s -H "x-bridge-token: $FIGMA_BRIDGE_TOKEN" "$FIGMA_BRIDGE_URL/status"
# {"pluginConnected":true}
```

---

## Usage

### With an AI agent

1. Open your Figma file and run **Claude Bridge**. Leave it open.
2. Start your agent in this repo's folder and give it a prompt like:

   > Read `docs/AGENT_GUIDE.md`. Check the bridge status, then inspect the open Figma page before changing anything. Task: add a settings screen that matches the style of the existing "Home" frame.

The agent then:
1. checks the connection,
2. reads the file's structure,
3. builds the design one section at a time,
4. exports screenshots to review its own work.

**Tips for better results**
- **Name a reference frame**, e.g. "match the style of frame X". The agent can clone and adapt existing screens, which reuses your map, status bar, components and fonts, and saves tokens.
- **Keep sessions focused.** Start a fresh agent session for each new task.
- Every node the agent creates is tagged with `setSharedPluginData("claude", "created", "1")`, so later runs can find and update their own work without touching yours.

### Manually (CLI or curl)

```bash
# Using a .env file (Node 20.6+)
node --env-file=.env cli/figma-send.mjs --status
echo 'return figma.currentPage.name' | node --env-file=.env cli/figma-send.mjs
node --env-file=.env cli/figma-send.mjs my-script.js
node --env-file=.env cli/figma-send.mjs screenshot.js --out shot.png

# Or plain curl
curl -s -X POST "$FIGMA_BRIDGE_URL/run" \
  -H "content-type: application/json" -H "x-bridge-token: $FIGMA_BRIDGE_TOKEN" \
  --data '{"code":"return figma.currentPage.name"}'
```

**Script contract**
- Your code runs as the body of an `async` function, with `figma` and `log()` in scope.
- `return` sends a value back:
  - nodes come back as `{id, name, type}`,
  - a `Uint8Array` (e.g. from `exportAsync`) comes back as a PNG,
  - anything else comes back as JSON.

See [`docs/AGENT_GUIDE.md`](docs/AGENT_GUIDE.md) for the full contract, Plugin API rules and examples.

---

## Configuration

| Variable | Description |
|---|---|
| `FIGMA_BRIDGE_URL` | Your relay URL, e.g. `https://figma-bridge.<subdomain>.workers.dev` |
| `FIGMA_BRIDGE_TOKEN` | Your channel token (24+ random characters) |

To use a `.env` file, copy the template and fill it in. `.env` is git-ignored.

```bash
cp .env.example .env
```

The relay itself needs no configuration. Its name and Durable Object binding are set in `relay/wrangler.toml`.

---

## Troubleshooting

| Symptom | Cause & fix |
|---|---|
| The relay URL doesn't load in your browser, or `dig` points to an ISP "block page" | **Your ISP blocks `*.workers.dev`** (this happens on some networks, e.g. in Indonesia). Turn on [Cloudflare WARP / 1.1.1.1](https://one.one.one.one), use another network, or [add a custom domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) to the Worker. |
| The plugin dot is green but `/status` says `"pluginConnected":false` | **The token in the plugin and the agent's token differ.** Re-paste the exact same token (no trailing space or newline) and click Connect. |
| The plugin says "Replaced by another Figma window" | The same token was connected from another window. One window per token. |
| The plugin says "Disconnected — retrying…" | Network drop, sleep, or VPN off. It reconnects automatically every 3 s. |
| `Plugin not connected` error | Re-run **Claude Bridge** in Figma. |
| `Timed out after …ms` | The script did too much in one call. Split the work into smaller calls. |
| `wrangler deploy` fails with "verify your email address" (code 10034) | Verify your Cloudflare account email, then run `npx wrangler deploy` again. |
| `wrangler deploy` warns about a `workers.dev` subdomain | Register one when prompted, or in the Cloudflare dashboard under **Workers → Subdomain**. |

---

## Security

- **Your channel token grants full code execution in whichever Figma file has the plugin open.** Treat it like a password.
- The relay authenticates only by token, so use a long random one (24 characters minimum, 32+ recommended).
- If a token leaks, generate a new one and update it in the plugin and in your agent's environment. The old channel becomes unused immediately.
- Tokens never need to be in this repo. `.gitignore` excludes `.env`, `CHANNEL_TOKEN.txt` and `*.token` as a safety net.
- The plugin's network access is limited to `*.workers.dev` (see `plugin/manifest.json`). If you move the relay to a custom domain, add that domain to `allowedDomains`.
- Only connect the plugin to files you're comfortable letting your agent edit. A good agent only modifies nodes it created unless you ask otherwise.

## Limitations

- **Figma desktop must stay open** with the plugin running. If it's closed or the computer sleeps, the bridge goes down until the plugin reconnects.
- **One Figma window per token** at a time.
- Each call times out after **120 s**.
- Development plugins only run in the **desktop app**, not in the browser.

---

## Project structure

```
figma-bridge/
├── plugin/
│   ├── manifest.json     # Figma plugin manifest (import this)
│   ├── code.js           # Executor: runs incoming scripts with the Plugin API
│   └── ui.html           # Connection UI + WebSocket client
├── relay/
│   ├── src/index.js      # Cloudflare Worker + Durable Object relay
│   ├── wrangler.toml
│   └── package.json
├── cli/
│   └── figma-send.mjs    # Send a script, print the result, save PNGs
├── docs/
│   └── AGENT_GUIDE.md    # Instructions for AI agents
├── .env.example          # Template for FIGMA_BRIDGE_URL / FIGMA_BRIDGE_TOKEN
└── LICENSE
```

## Contributing

Issues and pull requests are welcome. Keep the plugin a thin executor: design logic belongs in the agent's scripts, not in the plugin.

## License

[MIT](LICENSE)
