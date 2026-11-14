/**
 * dsh-mobile-remote — browser half.
 *
 * Adds one global panel to the left sidebar (`sidebar.panellist` + the layout's
 * `main` keyed slot). The panel shows the current pairing code injected by the
 * Host, and can refresh it through the loopback-only Host endpoint.
 *
 * Plain module-loader factory: no build step, no React copy, no host DOM reads.
 */
window.__ModuleLoader__.load({
  id: 'dsh-mobile-remote',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    const NS = 'mobileRemote'
    const PANEL_ID = 'mobile-remote'
    const ENDPOINT = '/__dshm-local/pairing'
    const COMMAND = 'node ~/.dsh/profiles/desktop/node_modules/dsh-mobile-remote/scripts/pairing.mjs'

    const en = {
      panel: 'Mobile remote',
      title: 'Mobile remote',
      intro: 'The official DSH Web UI, continued from your phone over Tailscale. Pair once, then keep using the same live sessions.',
      code: 'Pairing code',
      expires: 'Expires',
      expired: 'Expired — refresh to get a new code',
      port: 'DSH port',
      copyCode: 'Copy code',
      copyCommand: 'Copy command',
      copyLink: 'Copy pairing page',
      openPairing: 'Open pairing page',
      openHome: 'Open home page',
      refresh: 'New code',
      refreshBusy: 'Refreshing…',
      copied: 'Copied',
      copyFailed: 'Copy failed; select the text manually.',
      refreshFailed: 'Could not refresh from this page. On the Mac run the terminal command below.',
      unavailable: 'Pairing details are not readable from this page. Open it in the Mac app, or run the terminal command below.',
      instructions: 'On the phone: connect Tailscale, open the pairing page, enter the 6-digit code, then open the home page. The login cookie lasts 7 days; restarting DSH requires pairing again.',
      commandHint: 'Terminal command (Mac)',
    }
    const zh = {
      panel: '手机远程',
      title: '手机远程',
      intro: '通过 Tailscale 在手机上继续使用官方 DSH，和电脑上的是同一个实时会话。配对一次即可。',
      code: '配对码',
      expires: '有效期至',
      expired: '已过期，点「换一个」获取新码',
      port: 'DSH 端口',
      copyCode: '复制配对码',
      copyCommand: '复制命令',
      copyLink: '复制配对页',
      openPairing: '打开配对页',
      openHome: '打开主页',
      refresh: '换一个',
      refreshBusy: '正在更换…',
      copied: '已复制',
      copyFailed: '复制失败，请手动选中文字。',
      refreshFailed: '此页面无法直接刷新，请在 Mac 终端运行下方命令。',
      unavailable: '这个页面读不到配对信息。请在 Mac 桌面端打开，或在终端运行下方命令。',
      instructions: '手机操作：先连上 Tailscale，打开配对页，输入上方 6 位口令，再打开主页。登录 cookie 有效 7 天；DSH 重启后需要重新配对。',
      commandHint: 'Mac 终端命令',
    }

    function readInjected() {
      const injected = typeof window !== 'undefined' ? window.__DSH_MOBILE_REMOTE__ : undefined
      if (injected === undefined || injected === null || typeof injected !== 'object') return undefined
      return injected
    }

    function pairingUrlOf(info) {
      if (info !== undefined && typeof info.pairingUrl === 'string' && info.pairingUrl.length > 0) return info.pairingUrl
      if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) return `${location.origin}/__dshm/pair`
      return '/__dshm/pair'
    }

    function homeUrlOf(info) {
      const pairing = pairingUrlOf(info)
      return pairing.replace(/\/__dshm\/pair$/, '/')
    }

    function formatLeft(expiresAt, now) {
      const expires = Date.parse(expiresAt)
      if (!Number.isFinite(expires)) return ''
      const seconds = Math.round((expires - now) / 1000)
      if (seconds <= 0) return ''
      const m = Math.floor(seconds / 60)
      const s = seconds % 60
      return `${m}:${String(s).padStart(2, '0')}`
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        try {
          const area = document.createElement('textarea')
          area.value = text
          area.style.position = 'fixed'
          area.style.opacity = '0'
          document.body.append(area)
          area.select()
          const ok = document.execCommand('copy')
          area.remove()
          return ok
        } catch {
          return false
        }
      }
    }

    async function loadPairing(refresh) {
      const url = `${ENDPOINT}${refresh ? '?refresh=1' : ''}`
      const response = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      const data = await response.json()
      if (typeof data.code !== 'string') throw new Error('missing code')
      return {
        pairingCode: data.code,
        pairingExpiresAt: data.expiresAt,
        pairingUrl: typeof data.pairingUrl === 'string' ? data.pairingUrl : undefined,
        port: data.port,
      }
    }

    const styles = `
      .dshm-rm-page{box-sizing:border-box;min-height:100%;padding:calc(var(--dsh-frame-top-clearance,48px) + 24px) 32px 64px;color:var(--dsw-alias-label-primary,#e8e8ea);background:var(--dsw-alias-bg-base,transparent);font-family:inherit}
      .dshm-rm-inner{max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:18px}
      .dshm-rm-title{margin:0;font-size:22px;font-weight:600;line-height:1.3}
      .dshm-rm-intro{margin:0;font-size:14px;line-height:1.6;color:var(--dsw-alias-label-secondary,#a9a9b0)}
      .dshm-rm-card{border:1px solid var(--dsw-alias-border-l2,#2c2c31);border-radius:14px;padding:22px 24px;background:var(--dsw-alias-bg-layer-1,#1b1b1e);display:flex;flex-direction:column;gap:14px}
      .dshm-rm-code-row{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap}
      .dshm-rm-label{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#77777f)}
      .dshm-rm-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:34px;font-weight:600;letter-spacing:.18em;color:var(--dsw-alias-label-primary,#e8e8ea)}
      .dshm-rm-meta{font-size:13px;color:var(--dsw-alias-label-secondary,#a9a9b0);display:flex;gap:18px;flex-wrap:wrap}
      .dshm-rm-warn{color:var(--dsw-alias-state-warn-primary,#d9a441)}
      .dshm-rm-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
      .dshm-rm-btn{appearance:none;border:1px solid transparent;border-radius:9px;padding:9px 14px;font:inherit;font-size:14px;line-height:1.2;cursor:pointer;background:var(--dsw-alias-interactive-bg-hover,#26262b);color:var(--dsw-alias-label-primary,#e8e8ea)}
      .dshm-rm-btn:hover{background:var(--dsw-alias-interactive-bg-active,#303038)}
      .dshm-rm-btn[data-primary='1']{background:var(--dsw-alias-button-primary-fill,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff)}
      .dshm-rm-btn[data-primary='1']:hover{background:var(--dsw-alias-button-primary-hover,#5c78ff)}
      .dshm-rm-btn:disabled{opacity:.55;cursor:default}
      .dshm-rm-toast{font-size:13px;color:var(--dsw-alias-state-success-primary,#5bc48d);min-height:1.2em}
      .dshm-rm-note{font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary,#a9a9b0)}
      .dshm-rm-command{display:flex;flex-direction:column;gap:8px}
      .dshm-rm-command code{display:block;white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.6;padding:12px 14px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,#141416);border:1px solid var(--dsw-alias-border-l2,#2c2c31);color:var(--dsw-alias-label-primary,#e8e8ea)}
      .dshm-rm-link{color:var(--dsw-alias-state-business-primary,#7aa2ff);text-decoration:none;font-size:14px}
      .dshm-rm-link:hover{text-decoration:underline}
      @media (max-width:640px){.dshm-rm-page{padding:calc(var(--dsh-frame-top-clearance,48px) + 12px) 16px 48px}.dshm-rm-card{padding:18px}.dshm-rm-code{font-size:30px}}
    `

    function MobileRemoteIcon({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': true, style: { display: 'block' },
      },
      h('rect', { x: 6.5, y: 2.5, width: 11, height: 19, rx: 3.2, stroke: 'currentColor', strokeWidth: 1.6 }),
      h('path', { d: 'M10.2 5.4h3.6', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      h('circle', { cx: 12, cy: 18.1, r: 1.05, fill: 'currentColor' }),
      h('path', { d: 'M8.9 11.4c1.7-1.7 4.5-1.7 6.2 0M10.5 13.7c.8-.8 2.2-.8 3 0', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }))
    }

    function MobileRemotePage({ t }) {
      const injected = readInjected()
      const [info, setInfo] = useState(injected)
      const [now, setNow] = useState(() => Date.now())
      const [toast, setToast] = useState('')
      const [notice, setNotice] = useState('')
      const [busy, setBusy] = useState(false)
      const toastTimer = useRef(0)

      useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000)
        let alive = true
        loadPairing(false).then((next) => {
          if (!alive) return
          setInfo(next)
          window.__DSH_MOBILE_REMOTE__ = next
        }).catch(() => { /* Host-injected snapshot is enough */ })
        return () => {
          alive = false
          window.clearInterval(timer)
          window.clearTimeout(toastTimer.current)
        }
      }, [])

      const flash = (message) => {
        setToast(message)
        window.clearTimeout(toastTimer.current)
        toastTimer.current = window.setTimeout(() => setToast(''), 1800)
      }

      const copy = async (value, message) => {
        if (typeof value !== 'string' || value.length === 0) return
        const ok = await copyText(value)
        flash(ok ? (message ?? t('copied')) : t('copyFailed'))
      }

      const refresh = async () => {
        if (busy) return
        setBusy(true)
        setNotice('')
        try {
          const next = await loadPairing(true)
          setInfo(next)
          window.__DSH_MOBILE_REMOTE__ = next
          flash(t('copied'))
        } catch {
          setNotice(t('refreshFailed'))
        } finally {
          setBusy(false)
        }
      }

      const code = typeof info?.pairingCode === 'string' ? info.pairingCode : ''
      const expiresAt = typeof info?.pairingExpiresAt === 'string' ? info.pairingExpiresAt : ''
      const left = formatLeft(expiresAt, now)
      const expired = left === ''
      const pairingUrl = pairingUrlOf(info)
      const homeUrl = homeUrlOf(info)

      return h(React.Fragment, null,
        h('style', null, styles),
        h('div', { className: 'dshm-rm-page' },
          h('div', { className: 'dshm-rm-inner' },
            h('h1', { className: 'dshm-rm-title' }, t('title')),
            h('p', { className: 'dshm-rm-intro' }, t('intro')),

            h('div', { className: 'dshm-rm-card' },
              code === ''
                ? h('p', { className: 'dshm-rm-note' }, t('unavailable'))
                : h(React.Fragment, null,
                    h('span', { className: 'dshm-rm-label' }, t('code')),
                    h('div', { className: 'dshm-rm-code-row' },
                      h('span', { className: 'dshm-rm-code' }, code),
                      h('button', {
                        className: 'dshm-rm-btn', type: 'button',
                        onClick: () => void copy(code, t('copyCode')),
                      }, t('copyCode'))),
                    h('div', { className: 'dshm-rm-meta' },
                      h('span', null, expired ? h('span', { className: 'dshm-rm-warn' }, t('expired')) : `${t('expires')}: ${left}`),
                      typeof info?.port === 'number' ? h('span', null, `${t('port')}: ${String(info.port)}`) : null),
                    h('div', { className: 'dshm-rm-actions' },
                      h('button', { className: 'dshm-rm-btn', type: 'button', disabled: busy, onClick: () => void refresh() },
                        busy ? t('refreshBusy') : t('refresh')),
                      h('button', { className: 'dshm-rm-btn', type: 'button', onClick: () => void copy(pairingUrl, t('copyLink')) }, t('copyLink')))),
              h('div', { className: 'dshm-rm-toast', role: 'status', 'aria-live': 'polite' }, toast),
              notice === '' ? null : h('p', { className: 'dshm-rm-note dshm-rm-warn' }, notice),
              h('p', { className: 'dshm-rm-note' }, t('instructions')),
              h('div', { className: 'dshm-rm-actions' },
                h('a', { className: 'dshm-rm-btn', 'data-primary': '1', href: pairingUrl, target: '_blank', rel: 'noreferrer' }, t('openPairing')),
                h('a', { className: 'dshm-rm-btn', href: homeUrl, target: '_blank', rel: 'noreferrer' }, t('openHome')))),

            h('div', { className: 'dshm-rm-card' },
              h('span', { className: 'dshm-rm-label' }, t('commandHint')),
              h('div', { className: 'dshm-rm-command' },
                h('code', null, COMMAND),
                h('button', { className: 'dshm-rm-btn', type: 'button', onClick: () => void copy(COMMAND) }, t('copyCommand'))),
              h('p', { className: 'dshm-rm-note' },
                h('a', { className: 'dshm-rm-link', href: pairingUrl, target: '_blank', rel: 'noreferrer' }, pairingUrl)))))
      )
    }

    return {
      NS,
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'mobile-remote: dictionaries')
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({ t }),
        }, MobileRemotePage))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: () => t('panel'),
          locale: NS,
        }, MobileRemoteIcon))
      },
    }
  },
})
