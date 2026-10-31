# baton

**Two equal coding agents in one terminal.** One works, the other watches and can
steer it mid-task — or take over. Built on [OpenCode](https://github.com/anomalyco/opencode)
(MIT); baton is a thin layer on top of its agents, tools, sessions and TUI.

> Status: **0.4 (dev)**. One binary, one window, two agents — **no tmux**. Core relay,
> watch, steer and the split view are working end to end on Linux.

## What it does

| | |
|---|---|
| **Both agents are equal** | Either can build, review, watch or take over. There is no fixed "builder" and no fixed "inspector" — the pair decides per task. |
| **Split view** | Two full, editable panes: **Alex** (left) and **Nova** (right). `F7` / `F8` moves the keyboard; clicking a pane takes it too. Both keep their own session, transcript and prompt. |
| **`baton.watch`** | One agent reads what the other is doing live: its tool calls, files it touched, what it said. |
| **`baton.steer`** | Redirect the other agent while it works ("fix the parser, not the tests"). Applies at the next step; `interrupt: true` stops the current step. |
| **`baton.handoff` / `done`** | Pass actionable work, or close a thread with a verified result. Delivered automatically at the partner's next turn. |
| **`baton.fyi`** | A note that never continues the partner's turn. |
| **`baton.inbox` / `status`** | Read the relay log; see the pair, cursors and hop budget. |

The relay is an append-only JSONL log — files are the truth. Every message carries
a `hop`; delivery stops at `maxHop` (default 8), so a pair can never ping-pong forever.

## Your own provider

Baton keeps its own world under `~/.baton` and never reads your OpenCode config,
keys, sessions or theme. Add a provider with:

```sh
baton auth                        # pick a provider, paste your key (stored under ~/.baton)
baton models                      # what you have
baton model <provider/model>      # set the model both agents use
```

> ⚠️ **Build version matters.** OpenCode's own provider (`opencode-go`) checks the
> client version and rejects anything older than **1.18.0** ("free tier"). Baton
> must be built with the real upstream version embedded — do not fake it down to
> baton's own version, or every `opencode-go` call fails. Brand the display name
> separately.

## Run

```sh
cd your-project
baton             # start (or attach to) the pair
baton status      # home, server, pair, recent messages
baton kill        # stop the pair
baton restart     # restart baton's own server
```

One binary, no tmux, no separate OpenCode install. The split lives in baton's own TUI
(`patches/baton-split.patch`); the mirror tails a JSONL feed the plugin writes to
`~/.baton/projects/<project>/feed/<session>.jsonl`.

## Isolation

| Baton owns | Baton never touches |
|---|---|
| `~/.baton/` — config, keys, sessions, relay state | `~/.config/opencode` |
| its own server on `127.0.0.1:49395` | your OpenCode sessions/theme/providers |
| the project's `.baton/` relay folder | your project's `opencode.json` / `.opencode/` |

## How the relay works

```
 agent A (session 1)                agent B (session 2)
        │  baton.handoff / done / fyi
        ▼
   .baton/log.jsonl    ← append-only, source of truth
        │  plugin delivers at the peer's turn boundary
        ▼
   peer wakes with the message as normal input
```

`baton.watch` reads a live feed of each session's events (turn boundaries, tool
calls, changed files, assistant text). The same feed is appended to
`~/.baton/projects/<project>/feed/<session>.jsonl` for external monitoring.

## Layout

```
plugin/                 the OpenCode plugin (tools + delivery + watch feed)
plugin/bin/baton.ts     launcher: own home, server, sessions, panes
plugin/agents/baton.md  the one symmetric agent prompt
patches/                changes applied to the pinned OpenCode base
VENDOR.lock             the exact OpenCode commit baton builds against
scripts/dev-baton.sh    run the launcher from source
```
