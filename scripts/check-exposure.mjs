#!/usr/bin/env node
/**
 * Local exposure self-check for dsh-mobile-remote.
 *
 * Verifies, without printing the pairing token:
 *   - Tailscale Funnel is not allowed/enabled;
 *   - Serve exposes only the DSH port on the tailnet;
 *   - Tailscale SSH is not enabled on this Mac;
 *   - lists online tailnet devices (so you can spot unexpected ones);
 *   - reports the pairing-file state and code TTL.
 *
 * Usage: node scripts/check-exposure.mjs
 * Exit code 1 when a critical exposure is found.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const bin = process.env.TAILSCALE_BIN && process.env.TAILSCALE_BIN.length > 0 ? process.env.TAILSCALE_BIN : '/usr/local/bin/tailscale'
const run = (args) => spawnSync(bin, args, { encoding: 'utf8', timeout: 20000 })
const critical = []
const warnings = []

let serveConfig
const funnel = run(['funnel', 'status', '--json'])
if (funnel.error === undefined && funnel.status === 0 && typeof funnel.stdout === 'string') {
  try {
    serveConfig = JSON.parse(funnel.stdout)
    const allow = serveConfig?.AllowFunnel ?? {}
    if (typeof allow === 'object' && Object.keys(allow).length > 0) critical.push(`Funnel is enabled for: ${Object.keys(allow).join(', ')}`)
  } catch {
    warnings.push('could not parse funnel status JSON')
  }
} else {
  warnings.push('could not run `tailscale funnel status --json`')
}

const serve = run(['serve', 'status'])
if (serve.status === 0) {
  const text = serve.stdout ?? ''
  for (const line of text.split('\n')) if (/funnel|public/i.test(line)) critical.push(`serve line mentions public exposure: ${line.trim()}`)
  console.log('serve status:\n' + text.trim())
} else warnings.push('could not run `tailscale serve status`')

const prefs = run(['debug', 'prefs'])
if (prefs.status === 0) {
  try {
    const p = JSON.parse(prefs.stdout)
    if (p.RunSSH === true) critical.push('Tailscale SSH is enabled on this node (`RunSSH: true`)')
    if (p.ShieldsUp === true) warnings.push('ShieldsUp is enabled; inbound tailnet traffic is blocked (remote access will not work)')
  } catch { warnings.push('could not parse tailscale prefs') }
}

const status = run(['status', '--json'])
if (status.status === 0) {
  try {
    const j = JSON.parse(status.stdout)
    const rows = []
    const self = j.Self ?? {}
    rows.push({ name: self.HostName, os: self.OS, ips: (self.TailscaleIPs ?? []).filter((i) => i.includes(':') === false), online: true, self: true })
    for (const p of Object.values(j.Peer ?? {})) {
      rows.push({ name: p.HostName, os: p.OS, ips: (p.TailscaleIPs ?? []).filter((i) => i.includes(':') === false), online: p.Online === true })
    }
    console.log('\ntailnet devices:')
    for (const r of rows) console.log(`  ${r.online ? 'online ' : 'offline'}  ${String(r.os).padEnd(7)} ${(r.ips || []).join(',')}  ${r.name}`)
    const expected = (process.env.EXPECTED_REMOTE_IPS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    if (expected.length > 0) {
      for (const r of rows) {
        if (!r.self && r.online && !r.ips.some((ip) => expected.includes(ip))) warnings.push(`online device not in EXPECTED_REMOTE_IPS: ${r.name} (${r.ips.join(',')})`)
      }
    }
  } catch { warnings.push('could not parse tailscale status JSON') }
}

const pairingFile = join(process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), '.dsh'), 'mobile-remote.json')
if (existsSync(pairingFile)) {
  try {
    const j = JSON.parse(readFileSync(pairingFile, 'utf8'))
    console.log('\npairing file:')
    console.log(`  port: ${j.port}`)
    console.log(`  publicBaseUrl: ${j.publicBaseUrl ?? '(none)'}`)
    console.log(`  pairingCode: ${j.pairingCode ? 'present' : 'expired/missing'} | expires: ${j.pairingExpiresAt ?? 'n/a'}`)
    let servePort
    for (const [key, web] of Object.entries(serveConfig?.Web ?? {})) {
      if (!key.endsWith(':443')) continue
      const proxy = web?.Handlers?.['/']?.Proxy
      if (typeof proxy === 'string') {
        try { servePort = Number(new URL(proxy).port) } catch { servePort = undefined }
      }
    }
    if (servePort === undefined) warnings.push('tailscale serve has no HTTPS proxy target; iPhone cannot reach DSH')
    else if (j.port !== undefined && servePort !== j.port) {
      critical.push(`serve target port ${servePort} != DSH port ${j.port}; fix with: tailscale serve --bg --https=443 ${j.port}`)
    }
  } catch { warnings.push('pairing file exists but is unreadable') }
} else {
  warnings.push(`pairing file missing: ${pairingFile}`)
}

console.log('')
if (critical.length > 0) {
  console.error('CRITICAL:')
  for (const item of critical) console.error(`  - ${item}`)
}
if (warnings.length > 0) {
  console.log('warnings:')
  for (const item of warnings) console.log(`  - ${item}`)
}
if (critical.length === 0) console.log('OK: no Funnel and no Tailscale SSH exposure detected.')
process.exit(critical.length > 0 ? 1 : 0)
