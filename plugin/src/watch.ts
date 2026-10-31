/**
 * A live, in-memory feed of what each agent is doing.
 *
 * The relay log is for handoffs; this is for *watching*. The plugin sees every
 * event on the project's event stream, so it keeps the last few hundred things
 * each session did (tool calls, files touched, things it said) and lets the
 * partner read that with `baton.watch`.
 *
 * The ring is a rear-view mirror, not a transcript. With a root it is also
 * appended to disk so the split TUI can show the peer live.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

export interface WatchEntry {
  readonly ts: number
  readonly kind: "turn" | "tool" | "files" | "say" | "error"
  readonly text: string
}

export type WatchStatus = "idle" | "working" | "unknown"

export interface WatchFeed {
  push(sessionID: string, entry: WatchEntry): void
  status(sessionID: string): WatchStatus
  setStatus(sessionID: string, status: WatchStatus): void
  read(sessionID: string, limit: number): WatchEntry[]
}

const MAX_ENTRIES = 200
const MAX_TEXT = 600
const MAX_FILE_LINES = 600

/**
 * `root` makes the feed durable: every line is also appended to
 * `<root>/feed/<sessionID>.jsonl`, which the split TUI reads to show the peer
 * live. The tool reads the in-memory ring; the pane reads the file.
 */
export function makeWatchFeed(root?: string): WatchFeed {
  const entries = new Map<string, WatchEntry[]>()
  const statuses = new Map<string, WatchStatus>()
  const counts = new Map<string, number>()

  const append = (sessionID: string, entry: WatchEntry) => {
    if (!root) return
    const file = path.join(root, "feed", `${sessionID.replace(/[^a-zA-Z0-9._-]/g, "_")}.jsonl`)
    mkdirSync(path.dirname(file), { recursive: true })
    if ((counts.get(sessionID) ?? 0) >= MAX_FILE_LINES) {
      const kept = readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-MAX_FILE_LINES / 2)
      writeFileSync(file, kept.length > 0 ? `${kept.join("\n")}\n` : "")
      counts.set(sessionID, kept.length)
    }
    appendFileSync(file, `${JSON.stringify(entry)}\n`)
    counts.set(sessionID, (counts.get(sessionID) ?? 0) + 1)
  }

  return {
    push(sessionID, entry) {
      const line = { ...entry, text: clip(entry.text) }
      const list = entries.get(sessionID) ?? []
      list.push(line)
      if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES)
      entries.set(sessionID, list)
      append(sessionID, line)
    },
    status: (sessionID) => statuses.get(sessionID) ?? "unknown",
    setStatus: (sessionID, status) => {
      statuses.set(sessionID, status)
    },
    read: (sessionID, limit) => {
      const list = entries.get(sessionID) ?? []
      return list.slice(-Math.max(1, Math.min(limit, 100)))
    },
  }
}

function clip(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim()
  return oneLine.length > MAX_TEXT ? `${oneLine.slice(0, MAX_TEXT - 1)}…` : oneLine
}

interface AnyEvent {
  readonly type: string
  readonly data?: unknown
}

const TOOL_NAMES = new Map<string, string>()

/** Turn one opencode event into a feed line. Returns undefined for noise. */
export function watchEvent(event: AnyEvent, feed: WatchFeed): void {
  const data = (event.data ?? {}) as Record<string, any>
  const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined
  if (!sessionID) return
  const now = Date.now()

  switch (event.type) {
    case "session.execution.started":
      feed.setStatus(sessionID, "working")
      feed.push(sessionID, { ts: now, kind: "turn", text: "turn started" })
      return
    case "session.execution.succeeded":
      feed.setStatus(sessionID, "idle")
      feed.push(sessionID, { ts: now, kind: "turn", text: "turn finished" })
      return
    case "session.execution.failed":
      feed.setStatus(sessionID, "idle")
      feed.push(sessionID, { ts: now, kind: "error", text: `turn failed: ${describe(data.error)}` })
      return
    case "session.execution.interrupted":
      feed.setStatus(sessionID, "idle")
      feed.push(sessionID, { ts: now, kind: "turn", text: "turn interrupted" })
      return

    case "session.tool.input.started":
      if (typeof data.id === "string" && typeof data.name === "string") {
        TOOL_NAMES.set(data.id, data.name)
      }
      return

    case "session.tool.called": {
      feed.setStatus(sessionID, "working")
      const name = typeof data.id === "string" ? (TOOL_NAMES.get(data.id) ?? "tool") : "tool"
      feed.push(sessionID, { ts: now, kind: "tool", text: `${name} ${summarize(data.input)}`.trim() })
      return
    }

    case "session.step.ended": {
      const files = Array.isArray(data.files) ? data.files.filter((f: unknown) => typeof f === "string") : []
      if (files.length > 0) {
        feed.push(sessionID, { ts: now, kind: "files", text: `changed ${files.slice(0, 8).join(", ")}` })
      }
      return
    }

    case "session.text.ended":
      if (typeof data.text === "string" && data.text.trim().length > 0) {
        feed.push(sessionID, { ts: now, kind: "say", text: data.text })
      }
      return

    case "session.retry.scheduled":
      feed.push(sessionID, {
        ts: now,
        kind: "error",
        text: `retrying (attempt ${String(data.attempt ?? "?")}): ${describe(data.error)}`,
      })
      return
  }
}

/** Pick the fields a human/agent actually recognises out of the call's input. */
function summarize(input: unknown): string {
  if (input === undefined || input === null) return ""
  if (typeof input !== "object") return String(input)
  const record = input as Record<string, unknown>
  const interesting = ["command", "filePath", "path", "pattern", "description", "prompt", "url", "query"]
  for (const key of interesting) {
    const value = record[key]
    if (typeof value === "string" && value.trim().length > 0) return value.trim()
  }
  const json = JSON.stringify(record)
  return json === undefined ? "" : json
}

function describe(error: unknown): string {
  if (!error) return "unknown error"
  if (typeof error === "string") return error
  if (typeof error === "object") {
    const record = error as Record<string, unknown>
    for (const key of ["message", "name", "type", "reason"]) {
      if (typeof record[key] === "string") return record[key] as string
    }
  }
  return "error"
}
