import type { Plugin } from "@opencode/plugin"
import { GUIDANCE, peerOf, render } from "./format.js"
import type { Store } from "./store.js"
import type { BatonOptions } from "./types.js"

interface AnyEvent {
  readonly type: string
  readonly data?: unknown
}

type DeliveryContext = Pick<Plugin.Context, "event" | "session">

/** Everything delivery needs; tools call this to push a handoff without waiting for an idle event. */
export type DeliverContext = Pick<Plugin.Context, "session">

/**
 * Watch the server event stream and, whenever a paired session goes idle, hand it
 * any undelivered relay messages. This is what removes the human from the loop.
 */
export async function startDelivery(
  ctx: DeliveryContext,
  store: Store,
  options: BatonOptions,
): Promise<() => void> {
  if (!options.autoDeliver) return () => {}

  const controller = new AbortController()
  const inFlight = new Set<string>()

  const loop = (async () => {
    for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
      const sessionID = idleSession(event as AnyEvent)
      if (!sessionID || inFlight.has(sessionID)) continue
      inFlight.add(sessionID)
      try {
        await deliverTo(ctx, store, options, sessionID)
      } catch (error) {
        console.error("[baton] delivery failed", sessionID, error)
      } finally {
        inFlight.delete(sessionID)
      }
    }
  })().catch((error) => {
    if (!controller.signal.aborted) console.error("[baton] event stream ended", error)
  })

  void loop

  return () => controller.abort()
}

function idleSession(event: AnyEvent): string | undefined {
  if (event.type === "session.status") {
    const data = event.data as { sessionID?: string; status?: { type?: string } } | undefined
    if (data?.status?.type === "idle") return data.sessionID
    return undefined
  }
  if (
    event.type === "session.execution.succeeded" ||
    event.type === "session.execution.failed" ||
    event.type === "session.execution.interrupted"
  ) {
    const data = event.data as { sessionID?: string } | undefined
    return data?.sessionID
  }
  return undefined
}

export async function deliverTo(ctx: DeliverContext, store: Store, options: BatonOptions, sessionID: string) {
  const pair = await store.readPair()
  if (!pair || !peerOf(pair, sessionID)) return

  const cursor = await store.readCursor(sessionID)
  const log = await store.read()
  const unread = log.filter(
    (message) =>
      message.seq >= cursor.seq &&
      message.from !== sessionID &&
      (message.to === sessionID || message.to === "*"),
  )
  if (unread.length === 0) return

  const lastSeq = unread.reduce((max, message) => Math.max(max, message.seq), cursor.seq)
  const deliverable = unread.filter(
    (message) => options.deliverTypes.includes(message.type) && message.hop < options.maxHop,
  )

  if (deliverable.length === 0) {
    await store.writeCursor(sessionID, { seq: lastSeq + 1, hop: cursor.hop })
    return
  }

  const hop = deliverable.reduce((max, message) => Math.max(max, message.hop), cursor.hop)
  try {
    await ctx.session.prompt({
      sessionID,
      text: `${render(deliverable, pair, options.maxHop)}${GUIDANCE}`,
      delivery: "queue",
    })
  } catch (error) {
    // Do not advance the cursor: retry at the next idle boundary.
    console.error("[baton] could not deliver to", sessionID, error)
    return
  }
  await store.writeCursor(sessionID, { seq: lastSeq + 1, hop })
}
