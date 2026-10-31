#!/bin/sh
# Dev launcher: runs the baton launcher from source against the pinned opencode checkout.
export PATH="$HOME/.bun/bin:$HOME/.npm-global/bin:$PATH"
exec "$HOME/.bun/bin/bun" "$HOME/baton/bin/baton.ts" "$@"
