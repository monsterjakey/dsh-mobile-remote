#!/usr/bin/env node
/**
 * Show (or rotate) the dsh-mobile-remote pairing code.
 *
 *   node scripts/pairing.mjs            # print the current 6-digit code
 *   node scripts/pairing.mjs --refresh  # mint a new code immediately
 *   node scripts/pairing.mjs --json     # machine-readable output
 *
 * Talks to the plugin's loopback-only endpoint (127.0.0.1); never touches the
 * tailnet route. If the running plugin is older than 0.2.3 the endpoint does
 * not exist, so it falls back to reading ~/.dsh/mobile-remote.json and tells
 * you to restart DSH once.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = new Set(process.argv.slice(2))
if (args.has('--help') || args.has('-h')) {
  console.log('usage: node scripts/pairing.mjs [--refresh] [--json]')
  process.exit(0)
}
const refresh = args.has('--refresh')
const asJson = args.has('--json')

const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const recordPath = join(dshHome, 'mobile-remote.json')

function warnTailscale() {
  const run = spawnSync('tailscale', ['status'], { encoding: 'utf8', timeout: 8000 })
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
  if (run.error !== undefined || run.status !== 0 || /Tailscale is stopped/i.test(output)) {
    console.error('warning: Tailscale looks stopped; start the Tailscale app before pairing.')
  }
}

function readRecord() {
  try {
    return JSON.parse(readFileSync(recordPath, 'utf8'))
  } catch {
    return undefined
  }
}

const record = readRecord()
if (record === undefined || typeof record.port !== 'number') {
  console.error(`cannot read pairing state at ${recordPath}; start DSH Desktop first.`)
  process.exit(1)
}

warnTailscale()

let payload
try {
  const url = `http://127.0.0.1:${String(record.port)}/__dshm-local/pairing${refresh ? '?refresh=1' : ''}`
  const response = await fetch(url, { signal: AbortSignal.timeout(4000) })
  if (response.ok) payload = await response.json()
} catch {
  payload = undefined
}

if (payload === undefined) {
  // Old plugin (pre-0.2.3): the endpoint is absent. The file still has the
  // code generated at boot; --refresh needs a DSH restart to take effect.
  const code = typeof record.pairingCode === 'string' ? record.pairingCode : undefined
  payload = {
    code,
    expiresAt: record.pairingExpiresAt,
    pairingUrl: record.publicBaseUrl ? `${record.publicBaseUrl}/__dshm/pair` : undefined,
    port: record.port,
    stale: true,
    refreshRequested: refresh,
  }
}

if (asJson) {
  console.log(JSON.stringify(payload, undefined, 2))
  process.exit(payload.code === undefined ? 1 : 0)
}

if (payload.code === undefined) {
  console.error('no pairing code available; restart DSH Desktop once, then rerun this script.')
  process.exit(1)
}

console.log(`pairing code : ${payload.code}`)
if (payload.expiresAt !== undefined) {
  const expires = new Date(payload.expiresAt)
  console.log(`expires      : ${expires.toLocaleString()} (${expires.toISOString()})`)
}
if (payload.pairingUrl !== undefined) console.log(`pairing page : ${payload.pairingUrl}`)
if (payload.stale === true) {
  console.log('note         : the running plugin is older than 0.2.3; restart DSH Desktop once to enable automatic rotation.')
  if (refresh) console.log('note         : --refresh will take effect after that restart.')
}
