<div align="center">

# baton

**Pass work between two AI agents.**

Two agents. One relay. They hand tasks to each other — you stop copy-pasting.

[![npm](https://img.shields.io/npm/v/@lumorapp/baton)](https://www.npmjs.com/package/@lumorapp/baton)
[![License: MIT](https://img.shields.io/badge/License-MIT-8b5cf6)](./LICENSE)

</div>

---

## What is baton?

baton pairs two AI agents in a split terminal so they work **together** instead of you relaying messages by hand.

One agent does the task, hands it over, the other picks it up and continues — automatically. Everything is written to a log file, so nothing gets lost if a process dies.

baton is a thin layer on top of **[OpenCode](https://github.com/anomalyco/opencode)** (MIT). All the agents, tools, models and the terminal UI are OpenCode's own code — baton only adds the relay between two of them.

## Features

- 🤝 **Agent-to-agent handoff** — one agent hands a task to the other, no human relay
- 📄 **File-based relay** — every message is written to a log, so nothing is ever lost
- 🏠 **Fully isolated** — its own home (`~/.baton`), its own server, its own API keys. Your OpenCode is never touched
- 🔁 **No runaway loops** — every message carries a `hop` count and stops at a limit
- 🖥️ **Split terminal** — both agents run side by side in tmux panes
- 🧩 **Per project** — each project gets its own relay state, so projects never collide

## Requirements

- **OpenCode** installed → [opencode.ai](https://opencode.ai)
- **bun** installed → [bun.sh](https://bun.sh)
- **tmux** (Linux/macOS) — for the split panes. On Windows, baton prints the two commands to run instead

## Install

```sh
npm i -g @lumorapp/baton
```

## Quick start

**1. Add your API key** (saved inside baton's own home, never your OpenCode):

```sh
baton auth
```

**2. Go to the project you want the agents to work on:**

```sh
cd your-project
```

**3. Start a pair:**

```sh
baton
```

That's it — baton starts its own server, creates two agents and opens them in a split terminal.

## Commands

| Command | What it does |
|---|---|
| `baton` | Start a pair in the current folder |
| `baton status` | Show baton home, server, pair and recent messages |
| `baton restart` | Restart baton's own server |
| `baton kill` | Stop the pair and delete its sessions |
| `baton auth` | Add or change your API key |

## How it works

```
 left agent (session A)          right agent (session B)
        │  baton.handoff / done / fyi
        ▼
   log.jsonl   ← append-only, the source of truth
        │  the plugin delivers to the partner
        ▼
   the partner wakes with the message as a normal prompt
```

- **Files are the truth** — if the plugin dies, the log still holds every message.
- **Nothing runs away** — delivery stops after `maxHop` hops (default 8).
- **Only real tasks wake the other agent** — `handoff` and `done` do; `fyi` does not.

## Tools the agents get

| Tool | What it does |
|---|---|
| `baton.handoff` | Hand an actionable task to the partner (they act on it automatically) |
| `baton.done` | Report a task finished and verified — closes the thread |
| `baton.fyi` | Share an observation (delivered, but never continues their turn) |
| `baton.inbox` | Read the relay log, newest first |
| `baton.status` | Show the pair, cursors, hop budget and last message |

## Configuration

baton's config lives at `~/.baton/xdg/config/opencode/opencode.json` — **this is baton's only**, never your OpenCode's.

| Option | Default | Meaning |
|---|---|---|
| `maxHop` | `8` | Stop delivering once a message's hop reaches this |
| `deliverTypes` | `["handoff", "done"]` | Message types that wake the partner automatically |
| `autoDeliver` | `true` | Set `false` to log messages without delivering them |

## Isolation — what baton touches

| | |
|---|---|
| **Its own** | `~/.baton/` — config, data, auth, state, cache, server password |
| **Its own server** | `127.0.0.1:49395` (`BATON_PORT`), separate from your OpenCode |
| **Your project** | nothing — all state stays under `~/.baton` |
| **Never** | your OpenCode config, sessions, theme, or your project's `opencode.json` |

## Something is stuck?

- The relay is file-based, so one agent hanging does **not** block the other — check the other pane.
- `Esc` in a pane interrupts the running turn.
- If a pane looks dead: `baton restart`, then run `baton` again.
- Full reset: `baton kill`, then `baton`.

## Files

```
~/.baton/                        baton's home — never shared with your OpenCode
├── xdg/config/opencode/         baton's config (opencode.json, agents, themes)
├── xdg/data/opencode/           baton's data + auth.json (your API keys)
├── projects/<name>-<hash>/      per-project relay state
│   ├── pair.json                the two session IDs
│   ├── log.jsonl                the relay log
│   └── cursors/                 read position + hop per session
├── server-password              baton's own server credential
└── server.log                   baton's server log
```

## Credits

baton is built on **[OpenCode](https://github.com/anomalyco/opencode)** by the OpenCode authors (Anomaly) — MIT licensed. Huge thanks; baton would not exist without it.

The relay design (an append-only log as the source of truth) is carried over from the original baton.

## Legal

- **License:** [MIT](./LICENSE)

---

<div align="center">

Made with ❤️ by the Lumora team.

</div>
