#!/usr/bin/env bash
# Build a self-contained baton bundle: compiled launcher + baton's own opencode
# binary + the plugin. Users need nothing else — no bun, no node, no tmux, no
# separate opencode.
#
#   scripts/package.sh [linux-x64|linux-arm64|darwin-arm64|darwin-x64|windows-x64]
#
# The opencode binary must already be built for the target (see doc/BUILD in the
# README); this script does not build the base itself.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-linux-x64}"
VERSION="$(python3 -c "import json;print(json.load(open('$ROOT/plugin/package.json'))['version'])")"
OUT="$ROOT/out/baton-$VERSION-$TARGET"

case "$TARGET" in
  linux-x64)   BASE="$HOME/opencode/packages/cli/dist/cli-linux-x64/bin/opencode"; BUN_TARGET=bun-linux-x64 ;;
  linux-arm64) BASE="$HOME/opencode/packages/cli/dist/cli-linux-arm64/bin/opencode"; BUN_TARGET=bun-linux-arm64 ;;
  darwin-arm64) BASE="$HOME/opencode/packages/cli/dist/cli-darwin-arm64/bin/opencode"; BUN_TARGET=bun-darwin-arm64 ;;
  darwin-x64)  BASE="$HOME/opencode/packages/cli/dist/cli-darwin-x64/bin/opencode"; BUN_TARGET=bun-darwin-x64 ;;
  windows-x64) BASE="$HOME/opencode/packages/cli/dist/cli-windows-x64/bin/opencode.exe"; BUN_TARGET=bun-windows-x64 ;;
  *) echo "unknown target: $TARGET" >&2; exit 1 ;;
esac

[ -f "$BASE" ] || { echo "missing base binary: $BASE (build it first)" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT/plugin"

BUN="$HOME/.bun/bin/bun"
[ -x "$BUN" ] || BUN="bun"

"$BUN" build "$ROOT/plugin/bin/baton.ts" --compile --target="$BUN_TARGET" --outfile "$OUT/baton"

if [[ "$TARGET" == windows-* ]]; then
  cp "$BASE" "$OUT/opencode.exe"
else
  cp "$BASE" "$OUT/opencode"
fi

rsync -a --exclude node_modules \
  "$ROOT/plugin/index.ts" "$ROOT/plugin/src" "$ROOT/plugin/agents" \
  "$ROOT/plugin/package.json" "$ROOT/plugin/README.md" "$OUT/plugin/"

cat > "$OUT/README.txt" <<TXT
baton $VERSION ($TARGET) — two agents, one terminal.

Everything is in this folder. Do not install anything else.

  ./baton auth                 add your provider (stored in ~/.baton)
  ./baton models               list models
  ./baton model provider/model set the default model
  cd your-project && /path/to/baton

  ./baton --version            baton $VERSION
  ./baton kill                 stop the pair

F7 / F8 — take the left / right agent. Clicking a pane works too.
~/.baton is baton's own world; it never touches your opencode config.
TXT

chmod +x "$OUT/baton"
if [[ "$TARGET" != windows-* ]]; then chmod +x "$OUT/opencode"; fi

NAME="baton-$VERSION-$TARGET"
mkdir -p "$ROOT/dist"
if command -v zip >/dev/null 2>&1; then
  (cd "$ROOT/out" && zip -qr "$ROOT/dist/$NAME.zip" "$NAME")
else
  python3 - "$ROOT/out" "$NAME" "$ROOT/dist/$NAME.zip" <<'PY_ZIP'
import os, sys, zipfile
out, name, dst = sys.argv[1], sys.argv[2], sys.argv[3]
with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for root, _dirs, files in os.walk(os.path.join(out, name)):
        for f in files:
            path = os.path.join(root, f)
            info = zipfile.ZipInfo.from_file(path, os.path.relpath(path, out))
            mode = 0o755 if os.access(path, os.X_OK) and not f.endswith((".md", ".json", ".ts", ".txt")) else 0o644
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o100000 | mode) << 16
            with open(path, "rb") as fh:
                z.writestr(info, fh.read(), compresslevel=6)
PY_ZIP
fi
echo "bundle: $OUT"
echo "zip:    $ROOT/dist/$NAME.zip"
du -sh "$OUT" "$ROOT/dist/$NAME.zip"
