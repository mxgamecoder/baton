#!/usr/bin/env node
// baton's npm launcher.
//
// The real baton is a self-contained folder (compiled launcher + its own OpenCode
// binary + plugin). Shipping ~180 MB per platform through npm is not practical, so
// this package is a thin installer: on first run it downloads the bundle for this
// platform once, caches it under ~/.baton/runtime, then execs the real binary.
//
// Nothing else is needed — no bun, no node after install, no separate opencode.

const { spawn } = require("node:child_process")
const { createHash } = require("node:crypto")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")

// The bundle this launcher installs. Bump together with the artifacts on the
// download host; the npm version can move independently.
const RUNTIME = "0.4.6"
const BASE = process.env.BATON_DOWNLOAD_BASE || "https://media.lumorapp.name.ng/baton"

const PLATFORM = (() => {
  const platform = process.platform === "win32" ? "windows" : process.platform
  if (platform === "windows" && process.arch === "x64") return "windows-x64"
  if (platform === "linux" && process.arch === "x64") return "linux-x64"
  return undefined
})()

async function main() {
  if (!PLATFORM) {
    fail(
      `baton has no build for ${process.platform}-${process.arch} yet.\n` +
        `Builds exist for: windows-x64, linux-x64.\n` +
        `You can still download a bundle from ${BASE}/`,
    )
  }

  const name = `baton-${RUNTIME}-${PLATFORM}`
  const home = process.env.BATON_RUNTIME_HOME || path.join(os.homedir(), ".baton", "runtime")
  const root = path.join(home, RUNTIME)
  const binary = path.join(root, name, process.platform === "win32" ? "baton.exe" : "baton")

  if (!fs.existsSync(binary)) await install(root, name)

  const child = spawn(binary, process.argv.slice(2), {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
    windowsHide: false,
  })
  child.on("error", (error) => fail(`could not start baton: ${error.message}`))
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else process.exit(code ?? 1)
  })
}

async function install(root, name) {
  const url = `${BASE}/${name}.zip`
  const tmp = path.join(os.tmpdir(), `${name}-${process.pid}.zip`)

  process.stderr.write(`baton: first run — downloading ${name} (about 110 MB)\n`)

  try {
    const response = await fetch(url, { redirect: "follow" })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    const bytes = Buffer.from(await response.arrayBuffer())

    const expected = await fetch(`${url}.sha256`)
      .then((res) => (res.ok ? res.text() : undefined))
      .catch(() => undefined)
    if (expected) {
      const actual = createHash("sha256").update(bytes).digest("hex")
      if (!actual.startsWith(expected.trim().split(/\s+/)[0])) {
        throw new Error("checksum mismatch — download again")
      }
    }

    await fsp.writeFile(tmp, bytes)

    // adm-zip handles both platforms; no unzip/tar binary is required.
    const AdmZip = require("adm-zip")
    await fsp.mkdir(root, { recursive: true })
    new AdmZip(tmp).extractAllTo(root, true)

    if (process.platform !== "win32") {
      await fsp.chmod(path.join(root, name, "baton"), 0o755).catch(() => {})
      await fsp.chmod(path.join(root, name, "opencode"), 0o755).catch(() => {})
    }
    process.stderr.write("baton: ready\n")
  } catch (error) {
    fail(
      `could not install baton: ${error.message}\n` +
        `Download it manually from ${BASE}/${name}.zip and unzip it anywhere.`,
    )
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {})
  }
}

function fail(message) {
  process.stderr.write(`baton: ${message}\n`)
  process.exit(1)
}

main()
