export type RelayType = "handoff" | "done" | "fyi" | "question" | "answer"

export interface RelayMessage {
  readonly id: string
  readonly seq: number
  readonly ts: number
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

export interface Pair {
  readonly left: string
  readonly right: string
  readonly leftAgent?: string
  readonly rightAgent?: string
  readonly created: number
}

export interface Cursor {
  readonly seq: number
  readonly hop: number
}

export interface BatonOptions {
  readonly maxHop: number
  readonly deliverTypes: RelayType[]
  readonly autoDeliver: boolean
}
