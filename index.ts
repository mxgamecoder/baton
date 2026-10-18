import { Plugin } from "@opencode/plugin"
import { startDelivery } from "./src/delivery.js"
import { makeStore } from "./src/store.js"
import { registerTools } from "./src/tools.js"
import type { BatonOptions, RelayType } from "./src/types.js"

const TYPES: RelayType[] = ["handoff", "done", "fyi", "question", "answer"]
const DEFAULT_DELIVER: RelayType[] = ["handoff", "done"]

/**
 * baton — pass work between the two agents of a split-terminal pair.
 *
 * The plugin only wires up an agent's side of the relay: it registers the `baton.*`
 * tools and delivers queued messages to a paired session when that session goes idle.
 * Which two sessions are paired is decided by the launcher (`bin/baton.ts`) via
 * `.baton/pair.json` — this plugin never guesses.
 */
export default Plugin.define({
  id: "lumorapp.baton",
  async setup(ctx) {
    const options = resolveOptions(ctx.options)
    const store = makeStore(ctx.location.directory)
    await store.ensure()
    await registerTools(ctx, store, options)
    return startDelivery(ctx, store, options)
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
