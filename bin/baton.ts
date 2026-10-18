#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { closeSync, existsSync, openSync } from "node:fs"
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { makeStore, projectSlug } from "../src/store.js"
import type { Pair } from "../src/types.js"

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const AGENTS_DIR = path.join(PLUGIN_DIR, "agents")

// Baton is self-contained: its own home, config, data, server and password.
// Every XDG directory opencode uses is redirected under ~/.baton, so baton never
// reads the user's config, providers, auth, sessions or theme.
const BATON_HOME = process.env.BATON_HOME ?? path.join(os.homedir(), ".baton")
process.env.BATON_HOME = BATON_HOME
const XDG = {
  config: path.join(BATON_HOME, "xdg", "config"),
  data: path.join(BATON_HOME, "xdg", "data"),
  state: path.join(BATON_HOME, "xdg", "state"),
  cache: path.join(BATON_HOME, "xdg", "cache"),
}
const CONFIG_DIR = path.join(XDG.config, "opencode")
const DATA_DIR = path.join(XDG.data, "opencode")
const PORT = Number(process.env.BATON_PORT ?? 49395)
const URL_ = `http://127.0.0.1:${PORT}`
const batonEnv: Record<string, string> = {
  BATON_HOME,
  OPENCODE_CLIENT: "baton",
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  XDG_CONFIG_HOME: XDG.config,
  XDG_DATA_HOME: XDG.data,
  XDG_STATE_HOME: XDG.state,
  XDG_CACHE_HOME: XDG.cache,
  OPENCODE_CONFIG_DIR: CONFIG_DIR,
  OPENCODE_DISABLE_PROJECT_CONFIG: "1",
}
// OpenCode is memory-hungry; cap baton's server so a runaway can never freeze the box.
const MEMORY_HIGH = process.env.BATON_MEMORY_HIGH ?? "700M"
const MEMORY_MAX = process.env.BATON_MEMORY_MAX ?? "900M"
const SERVER_UNIT = "baton-server"

// Prefer baton's own rebranded binary when it has been built; else the opencode on PATH.
const BATON_BIN = path.join(BATON_HOME, "bin", "baton")
const OPENCODE = process.env.OPENCODE_BIN ?? (existsSync(BATON_BIN) ? BATON_BIN : "opencode")
const TMUX_SESSION = process.env.BATON_SESSION ?? `baton-${projectSlug(process.cwd())}`
const LEFT = "baton-left"
const RIGHT = "baton-right"

const directory = process.cwd()
const command = process.argv[2] ?? "up"

async function up() {
  guardDirectory()
  const store = makeStore(directory)
  await store.ensure()
  if (tmuxAlive()) {
    console.log("baton pair already running in this project — attaching")
    attach()
    return
  }
  await ensureHome()
  const password = await ensurePassword()
  await ensureServer(password)
  const left = await createSession(password, LEFT, "baton · left")
  const right = await createSession(password, RIGHT, "baton · right")
  await store.writePair({ left, right, leftAgent: LEFT, rightAgent: RIGHT, created: Date.now() } satisfies Pair)
  await store.reset()
  console.log(`paired  left=${left}  right=${right}`)
  if (!existsSync(path.join(DATA_DIR, "auth.json"))) {
    console.log("tip: no API key added — baton uses OpenCode's default model; add your own with `baton auth`")
  }
  launchTmux(password, left, right)
}

async function kill() {
  spawnSync("tmux", ["kill-session", "-t", TMUX_SESSION])
  const store = makeStore(directory)
  const pair = await store.readPair()
  if (pair) {
    const password = await readPassword()
    if (password) {
      await removeSession(password, pair.left)
      await removeSession(password, pair.right)
    }
    await store.clearPair()
    await store.reset()
  }
  console.log("baton stopped")
}

async function status() {
  const store = makeStore(directory)
  const [pair, log] = await Promise.all([store.readPair(), store.read()])
  console.log(`home    ${BATON_HOME}`)
  console.log(`server  ${URL_} ${(await serverUp()) ? "(up)" : "(down)"}`)
  if (!pair) {
    console.log("pair    none")
    return
  }
  console.log(`pair    left=${pair.left}  right=${pair.right}`)
  console.log(`log     ${log.length} message(s)`)
  for (const m of log.slice(-5)) console.log(`  [${m.seq}] ${m.type} ${m.from} → ${m.to}: ${m.summary}`)
}

async function auth() {
  await ensureHome()
  console.log(`configuring providers for baton (${CONFIG_DIR}) — not your opencode`)
  const result = spawnSync(OPENCODE, ["auth", "login"], {
    stdio: "inherit",
    env: { ...process.env, ...batonEnv },
  })
  process.exit(result.status ?? 1)
}

// --- baton home: its own config + agents, never the user's ---

async function ensureHome() {
  await mkdir(path.join(CONFIG_DIR, "agent"), { recursive: true })
  const configFile = path.join(CONFIG_DIR, "opencode.json")
  const existing = await readFile(configFile, "utf8").catch(() => undefined)
  const config = existing === undefined ? {} : parseConfig(existing, configFile)
  if (config === undefined) return
  const plugins = Array.isArray(config.plugins) ? config.plugins : []
  const needsWrite = existing === undefined || !plugins.includes(PLUGIN_DIR) || config.autoupdate !== false
  if (!plugins.includes(PLUGIN_DIR)) config.plugins = [...plugins, PLUGIN_DIR]
  // Never check opencode's updater: baton is its own build, not an opencode install.
  config.autoupdate = false
  if (config.$schema === undefined) config.$schema = "https://opencode.ai/config.json"
  if (needsWrite) await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`)
  for (const file of ["baton-left.md", "baton-right.md"]) {
    const destination = path.join(CONFIG_DIR, "agent", file)
    if (!existsSync(destination)) await copyFile(path.join(AGENTS_DIR, file), destination)
  }
}

function parseConfig(raw: string, file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    console.warn(`could not parse ${file} — leaving it alone`)
    return undefined
  }
}

async function ensurePassword(): Promise<string> {
  const existing = await readPassword()
  if (existing) return existing
  const password = randomBytes(24).toString("base64url")
  await writeFile(path.join(BATON_HOME, "server-password"), password, { mode: 0o600 })
  return password
}

async function readPassword(): Promise<string | undefined> {
  const raw = await readFile(path.join(BATON_HOME, "server-password"), "utf8").catch(() => undefined)
  return raw?.trim() || undefined
}

// --- baton's own private server ---

async function serverUp(): Promise<boolean> {
  const password = await readPassword()
  if (!password) return false
  try {
    const response = await fetch(`${URL_}/api/info`, {
      headers: authHeaders(password),
      signal: AbortSignal.timeout(1500),
    })
    return response.ok
  } catch {
    return false
  }
}

async function ensureServer(password: string) {
  if (await serverUp()) return
  startCappedServer(password) || startPlainServer(password)
  for (let attempt = 0; attempt < 40; attempt++) {
    await wait(500)
    if (await serverUp()) return
  }
  throw new Error(`baton server did not start — see ${path.join(BATON_HOME, "server.log")}`)
}

/** Preferred: a transient systemd user service with a memory cap and auto-restart. */
function startCappedServer(password: string): boolean {
  if (process.env.BATON_NO_CAP || !has("systemd-run")) return false
  spawnSync("systemctl", ["--user", "reset-failed", SERVER_UNIT], { stdio: "ignore" })
  const result = spawnSync(
    "systemd-run",
    [
      "--user",
      `--unit=${SERVER_UNIT}`,
      "--collect",
      "-p",
      `MemoryHigh=${MEMORY_HIGH}`,
      "-p",
      `MemoryMax=${MEMORY_MAX}`,
      "-p",
      "MemorySwapMax=256M",
      "-p",
      "Restart=on-failure",
      ...Object.entries({ ...batonEnv, OPENCODE_PASSWORD: password }).flatMap(([key, value]) => ["-E", `${key}=${value}`]),
      OPENCODE,
      "serve",
      "--port",
      String(PORT),
    ],
    { encoding: "utf8" },
  )
  if (result.status === 0) return true
  console.warn("[baton] capped server failed to start, falling back:", (result.stderr ?? "").trim())
  return false
}

function startPlainServer(password: string): boolean {
  const log = openSync(path.join(BATON_HOME, "server.log"), "a")
  const child = spawn(OPENCODE, ["serve", "--port", String(PORT)], {
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, ...batonEnv, OPENCODE_PASSWORD: password },
  })
  child.unref()
  closeSync(log)
  return true
}

async function restart() {
  spawnSync("systemctl", ["--user", "stop", SERVER_UNIT], { stdio: "ignore" })
  spawnSync("systemctl", ["--user", "reset-failed", SERVER_UNIT], { stdio: "ignore" })
  await ensureServer(await ensurePassword())
  console.log("baton server restarted")
}

async function createSession(password: string, agent: string, title: string): Promise<string> {
  const response = await fetch(`${URL_}/api/session`, {
    method: "POST",
    headers: authHeaders(password),
    body: JSON.stringify({ location: { directory }, agent, title }),
  })
  if (!response.ok) throw new Error(`create session failed: ${response.status} ${await response.text()}`)
  const body = (await response.json()) as { data?: { id?: string } }
  if (!body.data?.id) throw new Error("create session returned no id")
  return body.data.id
}

async function removeSession(password: string, sessionID: string) {
  await fetch(`${URL_}/api/session/${encodeURIComponent(sessionID)}`, {
    method: "DELETE",
    headers: authHeaders(password),
  }).catch(() => undefined)
}

const authHeaders = (password: string) => ({
  "content-type": "application/json",
  authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
})

// --- terminal ---

function launchTmux(password: string, left: string, right: string) {
  if (!has("tmux")) {
    console.log("tmux not found — run each half yourself:")
    console.log(`  ${paneCommand(password, left, "baton-left")}`)
    console.log(`  ${paneCommand(password, right, "baton-right")}`)
    return
  }
  if (tmuxAlive()) {
    attach()
    return
  }
  run("tmux", ["new-session", "-d", "-s", TMUX_SESSION, "-c", directory, paneCommand(password, left, "baton-left")])
  run("tmux", ["split-window", "-h", "-t", TMUX_SESSION, "-c", directory, paneCommand(password, right, "baton-right")])
  run("tmux", ["select-layout", "-t", TMUX_SESSION, "even-horizontal"])
  // Let a click focus a pane (and reach the TUI), so both halves accept input.
  spawnSync("tmux", ["set-option", "-t", TMUX_SESSION, "mouse", "on"])
  // Keep opencode from renaming the panes, so they read "baton · left/right".
  spawnSync("tmux", ["set-option", "-t", TMUX_SESSION, "allow-rename", "off"])
  spawnSync("tmux", ["set-option", "-t", TMUX_SESSION, "automatic-rename", "off"])
  spawnSync("tmux", ["select-pane", "-t", `${TMUX_SESSION}.0`, "-T", "baton · left"])
  spawnSync("tmux", ["select-pane", "-t", `${TMUX_SESSION}.1`, "-T", "baton · right"])
  attach()
}

function attach() {
  if (process.env.BATON_NO_ATTACH) {
    console.log(`tmux session "${TMUX_SESSION}" is running — attach with: tmux attach -t ${TMUX_SESSION}`)
    return
  }
  spawnSync("tmux", ["attach", "-t", TMUX_SESSION], { stdio: "inherit" })
}

// Each pane carries baton's own config dir and its own TUI channel, so it never
// reads the user's config and the two panes never share client state.
const paneCommand = (password: string, sessionID: string, channel: string) =>
  [
    ...Object.entries(batonEnv).map(([key, value]) => `${key}=${shellQuote(value)}`),
    `OPENCODE_PASSWORD=${shellQuote(password)}`,
    `OPENCODE_TUI_CHANNEL=${channel}`,
    OPENCODE,
    `--server ${shellQuote(URL_)}`,
    `-s ${shellQuote(sessionID)}`,
  ].join(" ")

// --- misc ---

/**
 * Baton keeps all its state under its own home, so the current directory is only the
 * agents' working scope. Only "/" is refused: it is the machine root and not a project.
 */
function guardDirectory() {
  if (directory !== "/") return
  console.error(
    [
      "baton: refusing to run at / (the machine root).",
      "Pick a folder to pair — e.g. cd ~/your-project, then run `baton` again.",
    ].join("\n"),
  )
  process.exit(1)
}

function tmuxAlive() {
  return spawnSync("tmux", ["has-session", "-t", TMUX_SESSION]).status === 0
}

function run(cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, { encoding: "utf8" })
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${result.stderr ?? ""}`)
}

const has = (cmd: string) => spawnSync("which", [cmd], { stdio: "ignore" }).status === 0
const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function usage() {
  console.log("usage: baton [up|kill|status|auth|restart]")
  process.exit(1)
}

// Dispatch last: every const helper above must be initialized before the command runs.
if (command === "kill" || command === "down") await kill()
else if (command === "status") await status()
else if (command === "auth" || command === "login") await auth()
else if (command === "restart") await restart()
else if (command === "up" || command === "start") await up()
else usage()
