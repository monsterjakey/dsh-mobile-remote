/**
 * dsh-mobile-remote — mobile skin + pairing helper for the official DSH Web UI.
 *
 * It does NOT proxy and does NOT change DSH auth. It only:
 *   1. injects a mobile skin (CSS/JS) into the official Web UI index, scoped to
 *      `html.dshm-mobile` so desktop browsers are unaffected;
 *   2. serves the skin assets from `/__dshm/*` on the existing `webServer`;
 *   3. exposes `/__dshm/pair`: a short-code page that redirects the phone into
 *      the official launch-token exchange, so the token never leaves the Mac;
 *   4. writes the authenticated launch URL to `$DSH_HOME/mobile-remote.json`
 *      (mode 0600) for manual/AirDrop pairing;
 *   5. points `tailscale serve --https=443` at this process's web-server port
 *      on every boot (the desktop Host uses an OS-assigned port), using the
 *      tailnet DNS name discovered from `tailscale status --json` unless
 *      `publicBaseUrl` is configured.
 *
 * Deployment requirement (user profile patch, not part of this bundle):
 *   `connection.trustedHosts` must contain the tailnet authority, because the
 *   official Host/Origin fence then accepts the phone's requests.
 *
 * @module dsh-mobile-remote
 */
import { spawnSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Stable Cordis plugin name. */
export const name = 'mobile-remote'

/** Services required before this plugin activates. */
export const inject = ['webServer', 'connection']

const ASSET_ROOT = dirname(fileURLToPath(import.meta.url))

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

/** Only these skin files are exposed from `/__dshm/`. */
const ASSETS = new Set(['mobile.css', 'mobile.js'])

/** Pairing page/short code policy. */
const PAIRING_TTL_MS = 30 * 60 * 1000
const PAIRING_MAX_ATTEMPTS = 10

function dshHome() {
  return process.env.DSH_HOME && process.env.DSH_HOME.length > 0
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
}

function pairingPath() {
  return join(dshHome(), 'mobile-remote.json')
}

function tailscaleBin(config) {
  return typeof config.tailscaleBin === 'string' ? config.tailscaleBin : '/usr/local/bin/tailscale'
}

/**
 * Inject mobile-only head tags into the official index HTML.
 * Runs through `webServer.tapIndex`, i.e. it is applied to the same index the
 * official frontend-static fallback serves, after normal boot rows.
 * @param html raw index.html
 * @returns the transformed document
 */
function mobileHead(ctx, config, html) {
  const viewport = /<meta\s+name=["']viewport["'][^>]*>/i
  // Expose a read-only pairing snapshot to the authenticated page so the
  // client-side "Mobile remote" panel can render the current code without an
  // extra request. The launch token is NOT included here; only the short-lived
  // single-use pairing code, which is worthless without tailnet access.
  let pairingSnapshot = ''
  try {
    const previous = pairingState
    let pairing = ensurePairingState()
    if (previous !== pairing || pairing.used) {
      pairingState = null
      pairing = ensurePairingState()
      publishPairing(ctx, config)
    }
    const base = publicBaseUrl(config)
    const snapshot = {
      pairingCode: pairing.code,
      pairingExpiresAt: new Date(pairing.expiresAt).toISOString(),
      pairingUrl: base === '' ? undefined : `${base}/__dshm/pair`,
      port: ctx.webServer.port,
    }
    const payload = JSON.stringify(snapshot).replace(/</g, '\\u003c')
    pairingSnapshot = `<script>window.__DSH_MOBILE_REMOTE__=${payload}</script>`
  } catch (error) {
    console.error(`[mobile-remote] pairing snapshot failed: ${String(error instanceof Error ? error.message : error)}`)
  }

  const skin = [
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
    '<meta name="theme-color" content="#151517">',
    pairingSnapshot,
    '<link rel="stylesheet" href="/__dshm/mobile.css">',
    '<script type="module" src="/__dshm/mobile.js"></script>',
  ].join('')

  // viewport-fit=cover is required for env(safe-area-inset-*) on iOS.
  const fitted = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
  let out = html
  if (viewport.test(out)) out = out.replace(viewport, fitted)
  else out = out.replace(/<head(\s[^>]*)?>/i, (open) => `${open}${fitted}`)

  return out.replace(/<\/head>/i, `${skin}</head>`)
}

/**
 * Serve one skin asset. The route is public, like the official static assets;
 * it carries no application data.
 * @param req node request
 * @param res node response
 */
function serveAsset(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    res.end()
    return
  }
  const pathname = decodeURIComponent((req.url ?? '/').split('?')[0])
  const file = pathname.slice('/__dshm/'.length)
  if (!ASSETS.has(file)) {
    res.writeHead(404)
    res.end()
    return
  }
  let body
  try {
    body = readFileSync(join(ASSET_ROOT, file))
  } catch {
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
    'content-length': String(body.length),
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  res.end(body)
}

/** Pairing state for this process: short code + rate limit + TTL. */
let pairingState = null

/**
 * Create (or refresh) the one-time pairing code for this process.
 * @returns pairing state with a 6-digit code and its expiry
 */
function ensurePairingState() {
  if (pairingState !== null && pairingState.expiresAt > Date.now()) return pairingState
  pairingState = {
    code: String(randomInt(0, 1_000_000)).padStart(6, '0'),
    expiresAt: Date.now() + PAIRING_TTL_MS,
    attempts: 0,
    used: false,
  }
  return pairingState
}

/** Cached tailnet authority detection (`undefined` = not attempted yet). */
let detectedPublicBase

/**
 * Resolve the advertised public root: explicit config first, then the node's
 * own tailnet DNS name from `tailscale status --json`.
 * @param config plugin config
 * @returns `https://<node>.<tailnet>.ts.net` or `''`
 */
function publicBaseUrl(config) {
  if (typeof config.publicBaseUrl === 'string' && config.publicBaseUrl.length > 0) {
    return config.publicBaseUrl.replace(/\/+$/, '')
  }
  if (detectedPublicBase !== undefined) return detectedPublicBase
  if (config.autoDetectPublicUrl === false) return ''
  const run = spawnSync(tailscaleBin(config), ['status', '--json'], { encoding: 'utf8', timeout: 15000 })
  if (run.error === undefined && run.status === 0 && typeof run.stdout === 'string') {
    try {
      const parsed = JSON.parse(run.stdout)
      const dnsName = parsed?.Self?.DNSName
      if (typeof dnsName === 'string' && dnsName.length > 0) {
        detectedPublicBase = `https://${dnsName.replace(/\.$/, '')}`
        return detectedPublicBase
      }
    } catch {
      // fall through: retry on the next reconcile tick
    }
  }
  console.warn('[mobile-remote] could not detect the tailnet DNS name; will retry; set publicBaseUrl in plugin config to skip detection')
  return ''
}

/**
 * The tokenized launch URL the official connection service would hand to a
 * browser.
 * @param ctx plugin context
 * @param config plugin config
 * @returns `{ origin, localUrl, tokenUrl, token, publicBase }`
 */
function launchUrls(ctx, config) {
  const origin = ctx.webServer.getOrigin()
  const localUrl = ctx.connection.authenticatedUrl(origin)
  const publicBase = publicBaseUrl(config)
  const tokenUrl = publicBase === '' ? localUrl : localUrl.replace(origin, publicBase)
  return { origin, localUrl, tokenUrl, token: new URL(localUrl).searchParams.get('token') ?? '', publicBase }
}

/**
 * Write the authenticated launch URL and the current pairing code to a 0600
 * file. The token stays on this machine; only the owner can read the file.
 * @param ctx plugin context
 * @param config plugin config
 */
function publishPairing(ctx, config) {
  const { localUrl, tokenUrl, publicBase } = launchUrls(ctx, config)
  const pairing = ensurePairingState()
  const record = {
    schemaVersion: 1,
    publicBaseUrl: publicBase === '' ? undefined : publicBase,
    localUrl,
    tokenUrl,
    pairingCode: pairing.code,
    pairingExpiresAt: new Date(pairing.expiresAt).toISOString(),
    pairingLimit: PAIRING_MAX_ATTEMPTS,
    port: ctx.webServer.port,
    updatedAt: new Date().toISOString(),
  }
  const file = pairingPath()
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, `${JSON.stringify(record, undefined, 2)}\n`, { mode: 0o600 })
  chmodSync(file, 0o600)
  console.log(`[mobile-remote] pairing file written to ${file}`)
  return record
}

/** The configured HTTPS serve port. */
function serveHttpsPort(config) {
  return Number.isInteger(config.serveHttpsPort) ? config.serveHttpsPort : 443
}

/**
 * Read the current `tailscale serve` proxy target port for the HTTPS listener,
 * or undefined when no config exists / the CLI is unavailable.
 * @param config plugin config
 * @returns the local port currently served, or undefined
 */
function serveTargetPort(config) {
  const run = spawnSync(tailscaleBin(config), ['serve', 'status', '--json'], { encoding: 'utf8', timeout: 15000 })
  if (run.error !== undefined || run.status !== 0 || typeof run.stdout !== 'string') return undefined
  try {
    const configJson = JSON.parse(run.stdout)
    const suffix = `:${String(serveHttpsPort(config))}`
    for (const [key, web] of Object.entries(configJson?.Web ?? {})) {
      if (!key.endsWith(suffix)) continue
      const proxy = web?.Handlers?.['/']?.Proxy
      if (typeof proxy === 'string') {
        try {
          const url = new URL(proxy)
          return url.port === '' ? undefined : Number(url.port)
        } catch {
          return undefined
        }
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

/**
 * Point `tailscale serve --https=<port>` at this process's actual web-server
 * port. The desktop Host binds an OS-assigned port on every launch, so the
 * plugin refreshes the serve target after each boot instead of relying on a
 * fixed port in the profile.
 * @param ctx plugin context
 * @param config plugin config
 * @returns true when the serve command succeeded
 */
function runServe(ctx, config) {
  if (config.autoServe === false) return false
  const port = ctx.webServer.port
  if (typeof port !== 'number') return false
  const httpsPort = serveHttpsPort(config)
  const run = spawnSync(tailscaleBin(config), ['serve', '--bg', `--https=${String(httpsPort)}`, String(port)], {
    encoding: 'utf8',
    timeout: 15000,
  })
  if (run.error !== undefined || run.status !== 0) {
    const detail = run.error !== undefined ? run.error.message : (run.stderr ?? '').trim() || `exit ${String(run.status)}`
    console.error(`[mobile-remote] tailscale serve failed: ${detail}`)
    return false
  }
  console.log(`[mobile-remote] tailscale serve --https=${String(httpsPort)} -> 127.0.0.1:${String(port)}`)
  return true
}

/**
 * Reconcile the Tailscale serve target and the pairing file with this process's
 * actual state. Safe to call repeatedly (boot retries and a periodic tick).
 * @param ctx plugin context
 * @param config plugin config
 */
function reconcile(ctx, config) {
  try {
    const port = ctx.webServer.port
    if (typeof port !== 'number') return
    if (config.autoServe !== false) {
      const target = serveTargetPort(config)
      if (target !== port) runServe(ctx, config)
    }
    let record
    try {
      record = JSON.parse(readFileSync(pairingPath(), 'utf8'))
    } catch {
      record = undefined
    }
    const base = publicBaseUrl(config)
    const stale = record === undefined || record.port !== port || (base !== '' && record.publicBaseUrl !== base)
    if (stale) publishPairing(ctx, config)
  } catch (error) {
    console.error(`[mobile-remote] reconcile failed: ${String(error instanceof Error ? error.message : error)}`)
  }
}

/**
 * Pairing page: phone opens `https://<tailnet-host>/__dshm/pair`, types the
 * short code read from the desktop pairing file, and gets a same-origin
 * redirect into the official token exchange. The token itself never leaves
 * the Mac and is never shown in the UI.
 * @param ctx plugin context for the pairing check
 * @param config plugin config used for the authority check
 * @param req node request
 * @param res node response
 */
/**
 * Pairing page: phone opens `https://<tailnet-host>/__dshm/pair`, types the
 * short code read from the desktop pairing file, and gets a same-origin
 * redirect into the official token exchange. The token itself never leaves
 * the Mac and is never shown in the UI.
 * @param ctx plugin context for the pairing check
 * @param config plugin config used for the authority check
 * @param req node request
 * @param res node response
 */
function servePairingPage(ctx, config, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    res.end()
    return
  }
  const publicBase = publicBaseUrl(config)
  if (publicBase !== '') {
    let expectedHost = ''
    try {
      expectedHost = new URL(publicBase).host
    } catch {
      expectedHost = ''
    }
    const host = String(req.headers.host ?? '')
    if (expectedHost !== '' && host !== expectedHost) {
      res.writeHead(404)
      res.end()
      return
    }
  }

  // ensurePairingState() mints a fresh code automatically when the previous
  // one expired; republish the pairing file so `cat ~/.dsh/mobile-remote.json`
  // never shows a stale code.
  const previous = pairingState
  let pairing = ensurePairingState()
  if (previous !== pairing) publishPairing(ctx, config)

  const url = new URL(req.url ?? '/', 'http://x')
  const code = (url.searchParams.get('code') ?? '').trim()
  const refuse = (status, message) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px -apple-system;background:#151517;color:#eee;padding:24px">${message}</body>`)
  }

  // A used code means this phone already paired, or a new device needs to pair
  // again. Rotate instead of asking for an app restart.
  if (pairing.used) {
    pairingState = null
    pairing = ensurePairingState()
    publishPairing(ctx, config)
    return refuse(
      200,
      '配对码已更新。请在电脑上重新读取 <code style="color:#fff">pairingCode</code>（推荐运行 <code style="color:#fff">node scripts/pairing.mjs</code>）后刷新本页。',
    )
  }
  if (pairing.attempts >= PAIRING_MAX_ATTEMPTS) return refuse(429, '尝试次数过多。请在电脑上重新读取配对码后重试。')

  if (code === '') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px -apple-system;background:#151517;color:#eee;padding:24px">
<h3 style="font-weight:600">在电脑上读取配对码</h3>
<p style="color:#aaa;line-height:1.5">在 Mac 终端执行 <code style="color:#fff">cat ~/.dsh/mobile-remote.json</code>，把 <code style="color:#fff">pairingCode</code> 填到下面：</p>
<form method="get" action="/__dshm/pair" style="display:flex;gap:8px">
<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="6 位数字" style="flex:1;font-size:18px;padding:12px;border-radius:10px;border:1px solid #333;background:#222;color:#fff">
<button style="font-size:16px;padding:12px 18px;border-radius:10px;border:0;background:#4d6bfe;color:#fff">配对</button>
</form></body>`)
    return
  }

  pairing.attempts += 1
  if (code !== pairing.code) return refuse(403, '配对码不正确，请重试。')

  pairing.used = true
  const { token } = launchUrls(ctx, config)
  res.writeHead(303, { location: `/?token=${encodeURIComponent(token)}`, 'cache-control': 'no-store' })
  res.end()
}

/**
 * Loopback-only pairing helper: print or rotate the current code without
 * touching the Tailscale route. Other tailnet devices get 403.
 * @param ctx plugin context
 * @param config plugin config
 * @param req node request
 * @param res node response
 */
function serveLocalPairing(ctx, config, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    res.end()
    return
  }
  const address = req.socket?.remoteAddress ?? ''
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('local only')
    return
  }
  const url = new URL(req.url ?? '/', 'http://x')
  const refresh = url.searchParams.get('refresh') === '1'
  const previous = pairingState
  let pairing = ensurePairingState()
  const rotated = previous !== pairing || refresh || pairing.used
  if (refresh || pairing.used) {
    pairingState = null
    pairing = ensurePairingState()
  }
  if (rotated) publishPairing(ctx, config)
  const base = publicBaseUrl(config)
  const payload = {
    code: pairing.code,
    expiresAt: new Date(pairing.expiresAt).toISOString(),
    attempts: pairing.attempts,
    used: pairing.used,
    port: ctx.webServer.port,
    pairingUrl: base === '' ? '/__dshm/pair' : `${base}/__dshm/pair`,
  }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  res.end(`${JSON.stringify(payload)}\n`)
}

/**
 * Mount the mobile skin, pairing helper and Tailscale serve refresh.
 * @param ctx plugin context carrying `webServer` and `connection`
 * @param config `{ publicBaseUrl?, autoDetectPublicUrl?, autoServe?, serveHttpsPort?, serveReconcileIntervalMs?, tailscaleBin? }`
 */
export function apply(ctx, config = {}) {
  // Prefix routes match `${path}` itself or `${path}/…`; do not include a
  // trailing slash here (that would require a double slash to match).
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: '/__dshm', handler: serveAsset }),
    'mobile-remote: skin assets',
  )

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: '/__dshm/pair', handler: (req, res) => servePairingPage(ctx, config, req, res) }),
    'mobile-remote: pairing page',
  )

  ctx.effect(() => ctx.webServer.tapIndex((html) => mobileHead(ctx, config, html)), 'mobile-remote: index head')

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: '/__dshm-local/pairing', handler: (req, res) => serveLocalPairing(ctx, config, req, res) }),
    'mobile-remote: local pairing endpoint',
  )

  /** Timers owned by this plugin instance (boot retries + periodic reconcile). */
  const timers = new Set()
  const schedule = (fn, delayMs) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      fn()
    }, delayMs)
    timer.unref?.()
    timers.add(timer)
    return timer
  }
  const clearTimers = () => {
    for (const timer of timers) {
      clearTimeout(timer)
      clearInterval(timer)
    }
    timers.clear()
  }
  ctx.effect(() => () => clearTimers(), 'mobile-remote: serve reconcile timers')

  const announce = () => {
    reconcile(ctx, config)
    // The Tailscale daemon can still be reconnecting right after a wake or
    // app launch; retry at boot, then keep a slow periodic reconciliation so
    // a missed one-shot serve update can never strand the phone on a stale
    // port again.
    for (const delayMs of [2000, 5000, 10000, 20000, 40000]) schedule(() => reconcile(ctx, config), delayMs)
    const intervalMs = Number.isInteger(config.serveReconcileIntervalMs) ? config.serveReconcileIntervalMs : 300000
    if (intervalMs > 0) {
      const interval = setInterval(() => reconcile(ctx, config), intervalMs)
      interval.unref?.()
      timers.add(interval)
    }
  }

  const loader = ctx.get('loader')
  if (loader === undefined) {
    announce()
  } else {
    loader.await().then(announce).catch((error) => {
      console.error(`[mobile-remote] loader failed before pairing: ${String(error instanceof Error ? error.message : error)}`)
    })
  }
}
