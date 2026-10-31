# baton

**Two equal coding agents in one terminal.** One works, the other watches and can
steer it mid-task — or take over. Built on [OpenCode](https://github.com/anomalyco/opencode)
(MIT); baton is a thin layer on top of its agents, tools, sessions and TUI.

> Status: **0.4.4 (dev)**. One binary, no tmux. Tested on Ubuntu; macOS/Windows
> builds are produced but need a smoke test on real hardware.

## The pair

| | |
|---|---|
| **Alex** | left half |
| **Nova** | right half |

Both are full agents: either can build, review, watch or take over. The names are
fixed — `/rename` is refused in a pair, and the agent files are rewritten from the
binary on every launch.

## Driving it

| | |
|---|---|
| Type | the focused half |
| Click a pane | takes the keyboard for that half |
| `F7` / `F8` | take the left / right half |
| `/new` | opens a new session in the left half — Nova stays visible on the right the whole time |
| `Esc` | interrupts the running turn in the focused half |

Typing in one half never sends input to the other, and never switches the other
half's agent or model.

## Tools the pair gets

| Tool | What it does |
|---|---|
| `baton.watch` | Read what the partner is doing live: its tool calls, files it touched, what it said. |
| `baton.steer` | Redirect the partner mid-turn. `interrupt: true` stops the current step. |
| `baton.handoff` | Pass actionable work. Delivered at the partner's next turn boundary. |
| `baton.done` | Report a task finished and verified. |
| `baton.fyi` | A note that never continues the partner's turn. |
| `baton.inbox` / `baton.status` | Read the relay log; see the pair, cursors and hop budget. |

The relay is an append-only JSONL log. Every message carries a `hop`; delivery
stops at `maxHop` (default 8), so a pair can never ping-pong forever. The watch
feed is also written to `~/.baton/projects/<project>/feed/<session>.jsonl`.

## Providers and models

Baton keeps its own world under `~/.baton` and never reads your OpenCode config,
keys, sessions or theme.

```sh
baton auth                        # add a provider (stored under ~/.baton)
baton models                      # what you have
baton model <provider/model>      # default for both halves, then relaunch
```

The chosen model is **preselected**, not locked: switch it in the app and it stays.
The footer shows the live choice (`Alex · DeepSeek V4.1 Flash · Lumora Router`).

### Web search

When an agent wants the web it asks first:

> Allow baton to search the web for up-to-date information?

Baton ships the search **tool**, but a search **provider** needs a key. Pick a
provider and export its key before launching:

```jsonc
// ~/.baton/xdg/config/opencode/opencode.json
{ "websearch": { "provider": "tavily" } }
```

```sh
export TAVILY_API_KEY=...        # or PARALLEL_API_KEY / EXA_API_KEY / FIRECRAWL_API_KEY / TINYFISH_API_KEY
```

Without a provider key the tool is unavailable and the agent will say so; `webfetch`
still works for a specific URL.

## Isolation

| Baton owns | Baton never touches |
|---|---|
| `~/.baton/` — config, keys, sessions, relay, feed | `~/.config/opencode` |
| its own server on `127.0.0.1:49395` | your OpenCode sessions/theme/providers |
| the pair's two sessions | your project's `opencode.json` / `.opencode/` |

## Run

```sh
cd your-project
baton             # start (or attach to) the pair
baton status      # home, server, pair, recent messages
baton restart     # restart baton's own server
baton kill        # stop the pair and delete its sessions
baton --version   # baton 0.4.5 (baton v2.0.28)
```

A project that already has a pair keeps it. A pair from an older build (different
agent names, or sessions that no longer exist) is recreated automatically.

## Build

Baton is a build of the pinned OpenCode source plus `patches/baton-split.patch`.

```sh
# once per machine
cd packages/cli
OPENCODE_VERSION=2.0.28 bun run script/build.ts --single --skip-web-ui --skip-install
# → dist/cli-linux-x64/bin/opencode  (copy to ~/.baton/bin/baton)
```

**Never lower `OPENCODE_VERSION`** — `opencode-go` rejects clients older than 1.18.0.
Brand the display name (`OPENCODE_CLI_NAME` is already `baton`), not the version.

On a small box, install only the CLI's dependency closure (~0.5 GB instead of ~3 GB):

```sh
bun install --ignore-scripts --production
bun add --no-save @effect/platform-node@4.0.1
```

## Layout

```
plugin/                 the OpenCode plugin (tools, delivery, watch feed)
plugin/bin/baton.ts     launcher: own home, server, sessions, split client
plugin/agents/          alex.md, nova.md — fixed peers, fixed names
patches/                changes applied to the pinned OpenCode base
VENDOR.lock             the exact OpenCode commit baton builds against
scripts/dev-baton.sh    run the launcher from source
```
