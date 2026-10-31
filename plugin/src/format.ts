import type { Pair, RelayMessage } from "./types.js"

export function peerOf(pair: Pair, sessionID: string): string | undefined {
  if (sessionID === pair.left) return pair.right
  if (sessionID === pair.right) return pair.left
  return undefined
}

export function sideOf(pair: Pair, sessionID: string): "left" | "right" | "unknown" {
  if (sessionID === pair.left) return "left"
  if (sessionID === pair.right) return "right"
  return "unknown"
}

export function labelOf(pair: Pair | undefined, sessionID: string): string {
  if (!pair) return "peer"
  return sideOf(pair, sessionID)
}

/** Render a batch of relay messages as one prompt the receiving agent can act on. */
export function render(messages: RelayMessage[], pair: Pair | undefined, maxHop: number): string {
  const blocks = messages.map((message) => renderOne(message, pair, maxHop))
  const header =
    messages.length === 1
      ? "[baton] Your partner sent you work."
      : `[baton] Your partner sent you ${messages.length} messages.`
  return [header, "", ...blocks].join("\n")
}

function renderOne(message: RelayMessage, pair: Pair | undefined, maxHop: number): string {
  const lines: string[] = []
  const from = labelOf(pair, message.from)
  const reply = message.replyRequired ? " (reply required)" : ""
  lines.push(`── ${message.type} · from ${from} · hop ${message.hop}/${maxHop}${reply}`)
  lines.push(`summary: ${message.summary}`)
  if (message.body) lines.push("body:", message.body.trim())
  if (message.files?.length) lines.push(`files: ${message.files.join(", ")}`)
  if (message.next?.length) {
    lines.push("next:")
    for (const step of message.next) lines.push(`- ${step}`)
  }
  return lines.join("\n")
}

export const GUIDANCE = [
  "",
  "Act on this. To pass work back, call `baton.handoff`. When the task is finished and verified, call `baton.done`.",
  "Do not call these tools just to acknowledge — only to move the work forward.",
].join("\n")
