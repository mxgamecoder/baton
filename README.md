# baton

**Two equal coding agents in one terminal.** One works, the other watches and can
steer it mid-task — or take over.

Built on [OpenCode](https://github.com/anomalyco/opencode) (MIT). Baton is a thin
layer on top of OpenCode's agents, tools, sessions and TUI: one binary, no tmux.

```sh
npm i -g @lumorapp/baton
```

> **Status: 0.4.6.** Tested on Ubuntu; macOS and Windows builds are produced but
> still want a smoke test on real hardware.

## What it is

A pair of full agents side by side — **Alex** (left) and **Nova** (right). Either
can build, review, watch or take over. They share one project, one relay log, and
one terminal.

| Tool | What it does |
|---|---|
| `baton.watch` | Read what the partner is doing live — its tool calls, files it touched, what it said |
| `baton.steer` | Redirect the partner mid-turn (`interrupt: true` stops the current step) |
| `baton.handoff` | Pass actionable work, delivered at the partner's next turn boundary |
| `baton.done` | Report a task finished and verified |
| `baton.fyi` | A note that never continues the partner's turn |
| `baton.inbox` / `baton.status` | Read the relay log; see the pair, cursors and hop budget |

The relay is an append-only JSONL log. Every message carries a `hop`, and delivery
stops at `maxHop` (default 8), so a pair can never ping-pong forever.

Baton keeps its own world under `~/.baton` — its own config, data, credentials and
sessions. It never reads or touches your OpenCode config, keys or theme.

## Repository layout

| Path | What |
|---|---|
| `plugin/` | **the npm package** — `@lumorapp/baton` (the plugin + the `baton` launcher) |
| `patches/` | vendored patches against OpenCode that baton depends on |
| `scripts/` | `dev-baton.sh` (local dev) and `package.sh` (build the standalone bundle) |
| `VENDOR.lock` | the pinned upstream OpenCode commit |

Full documentation — the pair, key bindings, providers and models, web search,
where state lives, troubleshooting: **[`plugin/README.md`](plugin/README.md)**.

## Quick start

```sh
npm i -g @lumorapp/baton

baton auth        # add a provider (stored under ~/.baton)
baton models      # what you have
cd your-project
baton             # start a pair
```

## Licence

MIT. OpenCode is © the OpenCode authors (Anomaly), also MIT — baton would not
exist without it.
