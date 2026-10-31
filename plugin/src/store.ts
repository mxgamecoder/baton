import { createHash, randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type { Cursor, Pair, RelayMessage, RelayType } from "./types.js"

export interface NewMessage {
  readonly from: string
  readonly to: string
  readonly type: RelayType
  readonly summary: string
  readonly body?: string
  readonly files?: string[]
  readonly next?: string[]
  readonly hop: number
  readonly inReplyTo?: string
  readonly replyRequired?: boolean
}

export interface Store {
  readonly directory: string
  readonly root: string
  ensure(): Promise<void>
  append(input: NewMessage): Promise<RelayMessage>
  read(): Promise<RelayMessage[]>
  reset(): Promise<void>
  readPair(): Promise<Pair | undefined>
  writePair(pair: Pair): Promise<void>
  clearPair(): Promise<void>
  readCursor(sessionID: string): Promise<Cursor>
  writeCursor(sessionID: string, cursor: Cursor): Promise<void>
}

const DEFAULT_CURSOR: Cursor = { seq: 0, hop: 0 }

/** Session IDs are ULID-like but never verified here; keep the filename portable. */
const safeName = (sessionID: string) => sessionID.replace(/[^a-zA-Z0-9._-]/g, "_")

/** A stable, readable id for a project directory (used for its state dir and tmux session). */
export function projectSlug(directory: string): string {
  const base = path.basename(directory) || "root"
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 24)
  const hash = createHash("sha1").update(directory).digest("hex").slice(0, 8)
  return `${clean}-${hash}`
}

/**
 * Relay state lives under baton's home, keyed by project, so the project directory
 * itself is never touched — baton can then run anywhere, including a parent folder.
 */
function stateRoot(directory: string): string {
  const home = process.env.BATON_HOME
  if (!home) return path.join(directory, ".baton")
  return path.join(home, "projects", projectSlug(directory))
}

export function makeStore(directory: string): Store {
  const root = stateRoot(directory)
  const logPath = path.join(root, "log.jsonl")
  const pairPath = path.join(root, "pair.json")
  const cursorPath = (sessionID: string) => path.join(root, "cursors", `${safeName(sessionID)}.json`)

  async function readLog(): Promise<RelayMessage[]> {
    const raw = await readFile(logPath, "utf8").catch(() => "")
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .flatMap((line, seq) => {
        try {
          const parsed = JSON.parse(line) as Omit<RelayMessage, "seq">
          return [{ ...parsed, seq }]
        } catch {
          // A torn tail line (crash mid-append) is skipped rather than fatal.
          return []
        }
      })
  }

  return {
    directory,
    root,

    async ensure() {
      await mkdir(path.join(root, "cursors"), { recursive: true })
      const log = await readFile(logPath).catch(() => undefined)
      if (log === undefined) await writeFile(logPath, "")
    },

    async append(input: NewMessage) {
      const message: Omit<RelayMessage, "seq"> = {
        id: randomUUID(),
        ts: Date.now(),
        ...input,
      }
      // One appendFile call per message: a single short line stays atomic on Linux,
      // so two agents writing at once cannot interleave inside a record.
      await appendFile(logPath, `${JSON.stringify(message)}\n`)
      return { ...message, seq: (await readLog()).length - 1 }
    },

    read: readLog,

    async reset() {
      // A relay log and cursors belong to one pair; a new pair must not inherit them.
      await writeFile(logPath, "")
      await rm(path.join(root, "cursors"), { recursive: true, force: true })
      await mkdir(path.join(root, "cursors"), { recursive: true })
    },

    async readPair() {
      const raw = await readFile(pairPath, "utf8").catch(() => undefined)
      if (raw === undefined) return undefined
      try {
        return JSON.parse(raw) as Pair
      } catch {
        return undefined
      }
    },

    async writePair(pair: Pair) {
      await writeFile(pairPath, `${JSON.stringify(pair, null, 2)}\n`)
    },

    async clearPair() {
      await writeFile(pairPath, "null\n")
    },

    async readCursor(sessionID: string) {
      const raw = await readFile(cursorPath(sessionID), "utf8").catch(() => undefined)
      if (raw === undefined) return DEFAULT_CURSOR
      try {
        const parsed = JSON.parse(raw) as Partial<Cursor>
        return { seq: parsed.seq ?? 0, hop: parsed.hop ?? 0 }
      } catch {
        return DEFAULT_CURSOR
      }
    },

    async writeCursor(sessionID: string, cursor: Cursor) {
      await mkdir(path.join(root, "cursors"), { recursive: true })
      await writeFile(cursorPath(sessionID), `${JSON.stringify(cursor)}\n`)
    },
  }
}
