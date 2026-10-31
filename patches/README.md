# patches

`baton-split.patch` is the complete change baton makes to the pinned OpenCode source
(`VENDOR.lock`). It adds a second, read-only pane that mirrors the partner agent, the
`--peer` / `--peer-home` / `--peer-feed` flags, two editable panes, and the `split.left` / `split.right` keys (F7 / F8).

Apply it to a clean checkout at the pinned commit:

```sh
git apply patches/baton-split.patch
```

## What it touches

| File | Change |
|---|---|
| `packages/tui/src/app.tsx` | renders the split when `--peer` is set; split keybindings |
| `packages/tui/src/component/session-frame.tsx` | `compact` / `active` / `onActivate`: half-width frame, keyboard ownership |
| `packages/tui/src/routes/session/index.tsx` | sessionID override, active prompt ref, empty state |
| `packages/core/src/tool/plugin/websearch.ts` | search permission says "baton", not "OpenCode" |
| `packages/tui/src/routes/session/permission.tsx` | reject hint says "baton" |
| `packages/tui/src/attention.ts`, `sidebar/footer.tsx` | notification + footer branding |
| `packages/tui/src/component/prompt/index.tsx` | `active` prop: an inactive pane never takes the keyboard |
| `packages/tui/src/context/args.tsx` | `peer`, `peerFeed` args |
| `packages/tui/src/config/keybind.ts` | `split.left` / `split.right` (alt+shift+left/right) |
| `packages/cli/src/commands/commands.ts` | `--peer` / `--peer-feed` flags |
| `packages/cli/src/commands/handlers/default.ts` | pass them to the TUI |

## Build

```sh
cd packages/cli
OPENCODE_VERSION=2.0.28 bun run script/build.ts --single --skip-web-ui --skip-install
```

**Do not lower `OPENCODE_VERSION`.** `opencode-go` rejects clients older than 1.18.0
("OpenCode 1.18.0 or newer is required to use the free tier"); brand the display name
(`OPENCODE_CLI_NAME` is already `baton`), never the version.

On a small box, install only what the CLI needs (the full monorepo install is ~3 GB):

```sh
# in package.json, keep only the closure of @opencode/cli + packages/plugins/*
bun install --ignore-scripts --production
bun add --no-save @effect/platform-node@4.0.1   # hoisted dep the bundler needs
```
