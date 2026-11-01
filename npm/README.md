# @lumorapp/baton

**Two equal coding agents in one terminal** — Alex (left) and Nova (right). One
works, the other watches and can steer it mid-task.

This npm package is a **thin launcher**. On first run it downloads the self-contained
baton bundle for your platform once (~110 MB), caches it under `~/.baton/runtime/`,
then starts the real binary. After that, runs are instant.

Nothing else is required: no bun, no separate OpenCode install, no tmux.

## Install

```sh
npm i -g @lumorapp/baton
baton auth                 # add your provider (stored in ~/.baton)
baton model <provider/model>
cd your-project && baton
```

## Platforms

| Platform | Status |
|---|---|
| Linux x64 | tested |
| Windows x64 | built, smoke-test pending |
| macOS / arm64 | not built yet — the launcher says so and gives the download link |

## What it does

- `baton` starts a pair: two full agent panes in one window.
- `F7` / `F8` or clicking a pane moves the keyboard.
- `/new` opens a new session in the left half; Nova stays on the right.
- Tools: `baton.watch`, `baton.steer`, `baton.handoff`, `baton.done`, `baton.fyi`.

The bundle lives in `~/.baton/runtime/0.4.6/`; your config and sessions live in
`~/.baton/`. Delete `~/.baton/runtime` to force a fresh download.

## Manual download

The same bundles are published at
`https://media.lumorapp.name.ng/baton/` (`baton-<version>-<platform>.zip` plus
`.sha256`). Unzip anywhere and run `baton` (`baton.exe` on Windows).

Source, patches and build scripts: `github.com/msgamecoder/baton`.
