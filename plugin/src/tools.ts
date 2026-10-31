import type { Plugin } from "@opencode/plugin"
import { deliverTo } from "./delivery.js"
import { labelOf, peerOf, render, renderSteer } from "./format.js"
import type { Store } from "./store.js"
import type { BatonOptions, Pair } from "./types.js"
import type { WatchFeed } from "./watch.js"

type RelayContext = Pick<Plugin.Context, "tool" | "session">

interface HandoffInput {
  readonly summary: string
  readonly body?: string
  readonly files?: string[]
  readonly next?: string[]
  readonly replyRequired?: boolean
}

interface SteerInput {
  readonly message: string
  readonly interrupt?: boolean
}

interface WatchInput {
  readonly limit?: number
  readonly sessionID?: string
}

interface DoneInput {
  readonly summary: string
  readonly body?: string
  readonly files?: string[]
}

interface FyiInput {
  readonly summary: string
  readonly body?: string
}

interface InboxInput {
  readonly limit?: number
  readonly unreadOnly?: boolean
}

const NAMESPACE = {
  name: "baton",
  description:
    "Pass work between the two agents in this baton pair. Use these to hand a task to your partner or report one finished — never to chat or acknowledge. Only valid inside a project started with `baton`.",
}

const EMPTY_INPUT = { type: "object", properties: {}, additionalProperties: false } as const

export async function registerTools(ctx: RelayContext, store: Store, options: BatonOptions, feed: WatchFeed) {
  await ctx.tool.transform((tools) => {
    tools.namespace(NAMESPACE)

    tools.add({
      name: "handoff",
      description:
        "Hand an actionable task to your partner agent. It is picked up automatically at the partner's next turn boundary, until the hop budget runs out.",
      input: {
        type: "object",
        properties: {
          summary: { type: "string", description: "One-line description of the work" },
          body: { type: "string", description: "Everything the partner needs to act" },
          files: { type: "array", items: { type: "string" }, description: "Paths the partner should look at" },
          next: { type: "array", items: { type: "string" }, description: "Concrete next actions" },
          replyRequired: { type: "boolean" },
        },
        required: ["summary"],
        additionalProperties: false,
      },
      options: { namespace: "baton", codemode: false },
      execute: async (raw, toolCtx) => {
        const input = raw as HandoffInput
        const pair = await requirePair(store)
        const from = toolCtx.sessionID
        const to = requirePeer(pair, from)
        const hop = (await store.readCursor(from)).hop + 1
        const message = await store.append({
          from,
          to,
          type: "handoff",
          summary: input.summary,
          body: input.body,
          files: input.files,
          next: input.next,
          hop,
          replyRequired: input.replyRequired,
        })
        await poke(ctx, store, options, to, "handoff", hop)
        return {
          content: `handoff queued for ${labelOf(pair, to)} (seq ${message.seq}, hop ${hop}/${options.maxHop}).`,
        }
      },
    })

    tools.add({
      name: "done",
      description:
        "Report a task finished and verified back to your partner. Closes the thread; the partner is notified at its next turn boundary.",
      input: {
        type: "object",
        properties: {
          summary: { type: "string" },
          body: { type: "string" },
          files: { type: "array", items: { type: "string" } },
        },
        required: ["summary"],
        additionalProperties: false,
      },
      options: { namespace: "baton", codemode: false },
      execute: async (raw, toolCtx) => {
        const input = raw as DoneInput
        const pair = await requirePair(store)
        const from = toolCtx.sessionID
        const to = requirePeer(pair, from)
        const hop = (await store.readCursor(from)).hop + 1
        const message = await store.append({
          from,
          to,
          type: "done",
          summary: input.summary,
          body: input.body,
          files: input.files,
          hop,
        })
        await poke(ctx, store, options, to, "done", hop)
        return { content: `done sent to ${labelOf(pair, to)} (seq ${message.seq}).` }
      },
    })

    tools.add({
      name: "fyi",
      description:
        "Share an observation with your partner without handing off work. Delivered but never continues the partner's turn.",
      input: {
        type: "object",
        properties: {
          summary: { type: "string" },
          body: { type: "string" },
        },
        required: ["summary"],
        additionalProperties: false,
      },
      options: { namespace: "baton", codemode: false },
      execute: async (raw, toolCtx) => {
        const input = raw as FyiInput
        const pair = await requirePair(store)
        const from = toolCtx.sessionID
        const to = requirePeer(pair, from)
        const message = await store.append({
          from,
          to,
          type: "fyi",
          summary: input.summary,
          body: input.body,
          hop: (await store.readCursor(from)).hop,
        })
        return { content: `fyi logged (seq ${message.seq}).` }
      },
    })

    tools.add({
      name: "watch",
      description:
        "See what your partner is doing right now: its recent tool calls, files it touched and what it said. Use this when asked to monitor, review live progress, or pick up where the partner stopped.",
      input: {
        type: "object",
        properties: {
          limit: { type: "number", description: "How many recent activity lines (default 20, max 100)" },
          sessionID: { type: "string", description: "Watch a specific session instead of your partner" },
        },
        additionalProperties: false,
      },
      options: { namespace: "baton", codemode: false },
      execute: async (raw, toolCtx) => {
        const input = raw as WatchInput
        const pair = await store.readPair()
        const from = toolCtx.sessionID
        const target = input.sessionID ?? (pair ? requirePeer(pair, from) : undefined)
        if (!target) return { content: "Not paired. Run `baton` to start a pair." }
        const limit = Math.max(1, Math.min(Number(input.limit) || 20, 100))
        const entries = feed.read(target, limit)
        const status = feed.status(target)
        const head = `[baton] watching ${labelOf(pair, target)} (${target}) · ${status} · last ${entries.length} line(s)`
        if (entries.length === 0) {
          return { content: `${head}\n(no activity seen yet — the partner may not have started a turn)` }
        }
        const lines = entries.map((entry) => `${clock(entry.ts)} ${entry.kind.padEnd(5)} ${entry.text}`)
        return { content: [head, ...lines].join("\n") }
      },
    })

    tools.add({
      name: "steer",
      description:
        "Redirect your partner while it is working — tell it to change what it is doing, fix a specific thing, or take a different approach. Delivered at the next step boundary; set interrupt to stop the current step immediately. If the partner is idle this starts it with your instruction.",
      input: {
        type: "object",
        properties: {
          message: { type: "string", description: "The instruction to give your partner, in plain language" },
          interrupt: { type: "boolean", description: "Stop the running step now instead of waiting for it to finish" },
        },
        required: ["message"],
        additionalProperties: false,
      },
      options: { namespace: "baton", codemode: false },
      execute: async (raw, toolCtx) => {
        const input = raw as SteerInput
        const message = String(input.message ?? "").trim()
        if (message.length === 0) throw new Error("steer needs a message")
        const pair = await requirePair(store)
        const from = toolCtx.sessionID
        const to = requirePeer(pair, from)
        const hop = (await store.readCursor(from)).hop
        await store.append({
          from,
          to,
          type: "steer",
          summary: message.length > 120 ? `${message.slice(0, 119)}…` : message,
          body: message,
          hop,
        })
        const midTurn = feed.status(to) === "working"
        await ctx.session.prompt({
          sessionID: to,
          text: renderSteer(pair, from, message),
          delivery: midTurn ? "steer" : "queue",
        })
        let stopped = false
        if (input.interrupt === true && midTurn) {
          // resume:true replays the steer we just queued, so the partner stops and reads it.
          const result = await ctx.session.interrupt({ sessionID: to, resume: true })
          stopped = result?.interrupted === true
        }
        return {
          content: `steer delivered to ${labelOf(pair, to)} (${midTurn ? "mid-turn" : "queued, partner was idle"})${
            stopped ? ", current step interrupted" : ""
          }`,
        }
      },
    })

    tools.add({
      name: "inbox",
      description: "Read the baton relay log for this pair, newest first.",
      input: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max messages to return (default 10)" },
          unreadOnly: { type: "boolean" },
        },
        additionalProperties: false,
      },
      options: { namespace: "baton", codemode: false },
      execute: async (raw, toolCtx) => {
        const input = raw as InboxInput
        const pair = await store.readPair()
        const from = toolCtx.sessionID
        const cursor = await store.readCursor(from)
        const limit = Math.max(1, Math.min(Number(input.limit) || 10, 50))
        const messages = (await store.read())
          .filter((message) => message.to === from || message.to === "*")
          .filter((message) => (input.unreadOnly ? message.seq >= cursor.seq : true))
          .slice(-limit)
          .reverse()
        if (messages.length === 0) return { content: "No baton messages." }
        return { content: render(messages, pair, options.maxHop) }
      },
    })

    tools.add({
      name: "status",
      description: "Show the baton pair, delivery cursors, hop budget, and the last message.",
      input: EMPTY_INPUT,
      options: { namespace: "baton", codemode: false },
      execute: async (_raw, toolCtx) => {
        const pair = await store.readPair()
        if (!pair) return { content: "Not paired. Run `baton` to start a pair." }
        const from = toolCtx.sessionID
        const mine = await store.readCursor(from)
        const last = (await store.read()).at(-1)
        return {
          content: [
            `pair: left=${pair.left} right=${pair.right}`,
            `you: ${labelOf(pair, from)} (${from})`,
            `cursor: seq ${mine.seq}, hop ${mine.hop}/${options.maxHop}`,
            `autoDeliver: ${options.autoDeliver}, deliverTypes: ${options.deliverTypes.join(", ")}`,
            last ? `last: ${last.type} from ${labelOf(pair, last.from)} — ${last.summary}` : "last: none",
          ].join("\n"),
        }
      },
    })
  })
}

async function requirePair(store: Store): Promise<Pair> {
  const pair = await store.readPair()
  if (!pair) throw new Error("No baton pair in this project. Run `baton` to start one.")
  return pair
}

const clock = (ts: number) => new Date(ts).toISOString().slice(11, 19)

function requirePeer(pair: Pair, sessionID: string): string {
  const peer = peerOf(pair, sessionID)
  if (!peer) throw new Error("This session is not part of the baton pair. Restart it with `baton`.")
  return peer
}

/**
 * Push a just-written message to the peer now instead of waiting for its next idle
 * turn — an idle agent that has never run emits no idle event, so a handoff would
 * otherwise sit undelivered. Queueing is safe while the peer is mid-turn.
 */
async function poke(
  ctx: RelayContext,
  store: Store,
  options: BatonOptions,
  to: string,
  type: "handoff" | "done",
  hop: number,
) {
  if (!options.autoDeliver || !options.deliverTypes.includes(type) || hop >= options.maxHop) return
  await deliverTo(ctx, store, options, to).catch((error) =>
    console.error("[baton] immediate delivery failed; the idle watcher will retry", error),
  )
}
