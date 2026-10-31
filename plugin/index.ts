import type { Plugin } from "@opencode/plugin"
import { startDelivery } from "./src/delivery.js"
import { makeStore } from "./src/store.js"
import { registerTools } from "./src/tools.js"
import type { BatonOptions, RelayType } from "./src/types.js"
import { makeWatchFeed } from "./src/watch.js"

const TYPES: RelayType[] = ["handoff", "done", "fyi", "question", "answer", "steer"]
const DEFAULT_DELIVER: RelayType[] = ["handoff", "done"]

/**
 * baton — two peer agents in one split terminal.
 *
 * Both agents are equal: either can build, either can watch, either can steer.
 * This plugin gives each of them the `baton.*` tools, mirrors what each one is
 * doing into a live feed, and delivers queued work to a paired session when it
 * goes idle. The pairing itself is written by the launcher (`bin/baton.ts`) —
 * the plugin never guesses.
 */
// Plain-object ABI: no runtime import, so the shipped plugin needs no node_modules.
const define = (plugin: Plugin) => plugin

export default define({
  id: "lumorapp.baton",
  async setup(ctx) {
    const options = resolveOptions(ctx.options)
    const store = makeStore(ctx.location.directory)
    const feed = makeWatchFeed(store.root)
    await store.ensure()
    await registerTools(ctx, store, options, feed)
    return startDelivery(ctx, store, options, feed)
  },
})

function resolveOptions(raw: Readonly<Record<string, unknown>>): BatonOptions {
  const maxHop = typeof raw.maxHop === "number" && raw.maxHop > 0 ? Math.floor(raw.maxHop) : 8
  const deliverTypes = Array.isArray(raw.deliverTypes)
    ? raw.deliverTypes.filter((value): value is RelayType => TYPES.includes(value as RelayType))
    : []
  return {
    maxHop,
    autoDeliver: raw.autoDeliver !== false,
    deliverTypes: deliverTypes.length > 0 ? deliverTypes : DEFAULT_DELIVER,
  }
}
