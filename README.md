# baton

**Pass work between two OpenCode agents.** baton pairs two agents so they hand tasks to each other instead of you relaying by hand.

> ## Built on OpenCode
>
> Baton is a thin layer on top of **[OpenCode](https://github.com/anomalyco/opencode)** (MIT). The agents, tools, TUI, sessions and models are OpenCode's own code — baton only adds the relay between two of them and a launcher that keeps everything self-contained.
>
> OpenCode is by the OpenCode authors (Anomaly): **https://github.com/anomalyco/opencode** (formerly `sst/opencode`). Full credit and thanks — baton would not exist without it. Baton's relay design (an append-only log as the source of truth) is carried over from the original baton.

Baton runs its own isolated OpenCode: its own server, and its own config, auth and sessions under `~/.baton`. It never reads your OpenCode config, never uses your OpenCode API keys, and never touches your OpenCode sessions or theme.

## What's new in 0.2 — and why it's better than the old baton

This release is a rebuild. The old baton (`@lumorapp/baton`, 0.1.x) was a standalone app with its **own** agent loop, **own** model client and **own** relay daemon — a lot of code to maintain, and it wrote its config into whatever folder you ran it from, which **leaked into your OpenCode**.

| | old baton (0.1) | new baton (0.2) |
|---|---|---|
| **Base** | custom OpenTUI app, its own agent loop and provider client | OpenCode's own code — baton is a small plugin + launcher |
| **Models** | its own provider list | every OpenCode model, plus your own key via `baton auth` |
| **Isolation** | wrote into your config; leaked into your OpenCode | its own home `~/.baton`; your OpenCode is never touched |
| **Install** | `npm i -g @lumorapp/baton` | runs on your OpenCode; no npm package needed |
| **Project files** | left `.baton/` inside your project | leaves nothing — all state lives under `~/.baton` |
| **Stability** | could hang | server is memory-capped (`MemoryMax`) and auto-restarts; delivery is idle-safe |
| **Per project** | one global relay | per-project state and a per-project tmux session, so projects don't collide |

## Rebrand build — baton's own binary

Baton ships its own build of OpenCode, rebranded: the name is **baton**, the version is **0.2.0**, it has baton's logo and terminal title, and OpenCode's self-updater is disabled (baton is not an OpenCode install, so the updater must not offer OpenCode releases).

Build it from the OpenCode source (this repo) and install it:

```sh
cd packages/cli
OPENCODE_VERSION=0.2.0 bun run script/build.ts --single --skip-web-ui --skip-install
mkdir -p ~/.baton/bin
cp dist/cli-linux-x64/bin/opencode ~/.baton/bin/baton
chmod +x ~/.baton/bin/baton
```

The launcher uses `~/.baton/bin/baton` when present, otherwise the `opencode` on `PATH` (`OPENCODE_BIN` overrides both).

The rebrand changes only display strings and the version — OpenCode's behaviour is untouched:

| What | Where |
|---|---|
| logo wordmark | `packages/tui/src/logo.ts` |
| terminal/pane title | `packages/tui/src/app.tsx` |
| CLI name + description | `packages/cli/script/build.ts`, `packages/cli/src/commands/commands.ts` |
| version | `OPENCODE_VERSION=0.2.0` build define |

The updater is switched off per install by `autoupdate: false` in baton's config and `OPENCODE_DISABLE_AUTOUPDATE=1`. OpenCode is fully credited at the top of this file and remains under its own MIT licence.

## Isolation — what baton touches and what it never touches

| | |
|---|---|
| **Its own** | `~/.baton/` — config (`xdg/config/opencode/`), data + auth (`xdg/data/opencode/`), state, cache, server password |
| **Its own server** | `127.0.0.1:49395` (`BATON_PORT`), separate from your OpenCode service |
| **Its own provider** | you add your API key to baton with `baton auth` |
| **Your project** | nothing — baton keeps its per-project state under its own home |
| **Never** | `~/.config/opencode`, your OpenCode sessions, your OpenCode theme, your project's `opencode.json` or `.opencode/` |

## Install / add your API key

```sh
baton auth       # configure a provider for baton (writes under ~/.baton, not your opencode)
```

## Start a pair

```sh
cd your-project
baton            # creates two sessions on baton's own server and splits tmux
baton status     # baton home, server, pair, recent messages
baton kill       # stop the pair and delete its sessions
```

`baton` (the launcher):

1. ensures `~/.baton` and baton's own config dir (with the plugin and the `baton-left`/`baton-right` agents);
2. starts baton's own server if it is not running;
3. creates the two sessions on it and writes `.baton/pair.json`;
4. opens them in split tmux panes, each with its own client state.

Set `OPENCODE_BIN` if `opencode` is not on `PATH`. If tmux is missing it prints the two commands instead.

## How the relay works

```
 left agent (session A)          right agent (session B)
        │  baton.handoff / done / fyi
        ▼
   .baton/log.jsonl   ← append-only, the source of truth
        │  plugin delivers to the peer
        ▼
   the peer wakes with the message as a normal prompt
```

- **Files are the truth.** If the plugin dies, the log still holds every message.
- **Nothing runs away.** Every message carries a `hop`; delivery stops at `maxHop` (default 8).
- **Explicit pairing.** The launcher writes which two sessions are paired.
- **Agent-to-agent tools never prompt** — only `handoff`/`done` wake the peer; `fyi` does not.

## Tools the agents get

| Tool | What it does |
|---|---|
| `baton.handoff` | Hand an actionable task to the partner. Delivered and acted on automatically. |
| `baton.done` | Report a task finished and verified. Closes the thread. |
| `baton.fyi` | Share an observation. Delivered, but never continues the partner's turn. |
| `baton.inbox` | Read the relay log (newest first). |
| `baton.status` | Show the pair, cursors, hop budget, and last message. |

## Configuration

Baton's config lives at `~/.baton/xdg/config/opencode/opencode.json` — this is baton's only, never your opencode's.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    { "package": "/absolute/path/to/opencode/packages/plugins/baton", "options": { "maxHop": 4 } }
  ]
}
```

| Option | Default | Meaning |
|---|---|---|
| `maxHop` | `8` | Stop delivering once a message's hop reaches this. |
| `deliverTypes` | `["handoff", "done"]` | Message types that wake the peer automatically. |
| `autoDeliver` | `true` | Set `false` to log messages without delivering them. |

To theme baton (its own TUI colours), put a theme in `~/.baton/xdg/config/opencode/themes/` and set `theme` in baton's config — it affects only baton.

## Memory

Baton runs three OpenCode processes: its server plus the two pane clients. Expect roughly **150 MB per client and 160–320 MB for the server** (~0.6 GB total); this is inherent to OpenCode.

Baton caps its server so a runaway can never freeze the machine:

- the server runs as a systemd user unit `baton-server` with `MemoryHigh=700M`, `MemoryMax=900M` and `Restart=on-failure`;
- tune it with `BATON_MEMORY_HIGH` / `BATON_MEMORY_MAX` (`BATON_NO_CAP=1` disables capping and falls back to a plain process);
- `baton restart` restarts the server; `baton kill` stops the pair (frees the ~0.3 GB of clients).

Baton's server keeps sessions in memory, so delete finished pairs with `baton kill` rather than leaving them idle.

## Something is stuck

- The relay is file-based, so one agent hanging does **not** block the other — check the other pane.
- `Esc` in a pane interrupts the running turn.
- If a pane looks dead, restart the server: `baton restart`, then re-run `baton`.
- Full reset: `baton kill`, then `baton`.


## Running it

Run `baton` in the folder you want the two agents to work in — normally a project directory:

```sh
cd your-project
baton
```

You may also run it in a parent folder (even `$HOME`): baton keeps every file under `~/.baton`, so
your folder is not touched. But the agents' working directory becomes that folder, so they will
range over everything inside it. A real project folder keeps them focused. Only `/` (the machine
root) is refused.

## Files

```
~/.baton/                        baton's home — never shared with your opencode
├── xdg/config/opencode/         baton's config dir (opencode.json, agent/, themes/)
├── xdg/data/opencode/           baton's data + auth.json (your API keys)
├── projects/<name>-<hash>/      per-project relay state
│   ├── pair.json                the two session IDs
│   ├── log.jsonl                the relay log
│   └── cursors/                 per-session read position and hop
├── server-password              baton's own server credential
└── server.log                   baton's server log
```

Each project also gets its own tmux session, `baton-<name>-<hash>`, so different projects can run
pairs at the same time.

