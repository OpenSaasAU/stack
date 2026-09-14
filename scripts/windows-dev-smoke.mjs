#!/usr/bin/env node

// Narrow smoke test for issue #1219: proves `opensaas dev`, given no
// command, actually starts `next dev` on Windows — the two spawn defects
// the issue fixes (PATH casing, launching the `.cmd` shim) previously left
// the app child never running at all. Run from an example project's
// directory with DATABASE_URL already set to a reachable Postgres.

import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const cliBin = path.join(here, '..', 'packages', 'cli', 'bin', 'opensaas.js')
const url = 'http://localhost:3000'
const timeoutMs = 180_000
const pollIntervalMs = 2_000

const child = spawn(process.execPath, [cliBin, 'dev'], { stdio: 'inherit' })

let exited = false
let exitCode = null
child.once('exit', (code) => {
  exited = true
  exitCode = code
})

const deadline = Date.now() + timeoutMs
let ready = false
while (!ready && !exited && Date.now() < deadline) {
  await delay(pollIntervalMs)
  try {
    const response = await fetch(url)
    if (response.status < 500) ready = true
  } catch {
    // Not listening yet.
  }
}

if (exited) {
  console.error(`opensaas dev exited before ${url} answered (code ${String(exitCode)}).`)
  process.exit(exitCode ?? 1)
}

if (!ready) {
  console.error(`Timed out waiting for ${url} to answer.`)
  child.kill()
  process.exit(1)
}

console.log(`${url} answered — next dev started under opensaas dev.`)
child.kill()
process.exit(0)
