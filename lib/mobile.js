/**
 * dsh-mobile-remote — mobile behaviour patch, loaded into the official Web UI
 * by the Host plugin (see lib/index.js). No secrets, no network calls.
 *
 * 0.2.2 additions:
 *   - only activate on phones / viewports up to 1024px (large tablets keep the
 *     official desktop layout, which avoids skin-induced layout surprises);
 *   - `?dshm=off` escape hatch to A/B test the official UI without the skin;
 *   - a touch scroll rescue: if a swipe on the conversation produces no native
 *     scroll (iOS Safari sometimes swallows it, especially when the message
 *     list is following the live tail), move the scroller manually and nudge
 *     the official follow-tail handler with a synthetic wheel event;
 *   - publish the composer height as `--dshm-composer-h`.
 */
const VERSION = '0.2.2'

const query = new URLSearchParams(location.search)
const hash = location.hash
const SKIN_KEY = 'dshm-skin'
try {
  if (hash.includes('dshm-off')) localStorage.setItem(SKIN_KEY, 'off')
  else if (hash.includes('dshm-on')) localStorage.setItem(SKIN_KEY, 'on')
} catch {
  /* localStorage may be unavailable in private mode */
}
const storedSkin = (() => {
  try { return localStorage.getItem(SKIN_KEY) } catch { return null }
})()
const forcedOff = query.get('dshm') === 'off' || hash.includes('dshm-off') || (hash.includes('dshm-on') ? false : storedSkin === 'off')
const isNarrow = () => window.matchMedia('(max-width: 1024px)').matches
const isPhoneUA = () => /iPhone|iPod|Android.*Mobile|Mobile.*Safari/i.test(navigator.userAgent)
const isTabletUA = () => /iPad|Tablet|PlayBook|Silk/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isTouchTablet = () => navigator.maxTouchPoints > 0 && window.matchMedia('(min-width: 1025px)').matches && window.matchMedia('(max-width: 1600px)').matches

function markMobile() {
  if (forcedOff) return false
  if (!isNarrow() && !isPhoneUA()) return false
  // Large tablet layouts keep the official desktop UI.
  if (window.matchMedia('(min-width: 1025px)').matches) return false
  document.documentElement.classList.add('dshm-mobile')
  return true
}

function syncViewport() {
  const vv = window.visualViewport
  if (vv === null || vv === undefined) return
  const root = document.documentElement
  root.style.setProperty('--dshm-vvh', `${Math.round(vv.height)}px`)
  root.style.setProperty('--dshm-vv-top', `${Math.round(vv.offsetTop)}px`)
  const keyboardOpen = vv.height < window.innerHeight * 0.75
  root.classList.toggle('dshm-kb', keyboardOpen)
}

function composerCandidate() {
  return (
    document.querySelector('[class*="composerSeat"]') ??
    document.querySelector('[class*="composerStack"]') ??
    document.querySelector('textarea, [contenteditable="true"]')
  )
}

function scrollComposerIntoView() {
  const node = composerCandidate()
  if (node === null) return
  try {
    node.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'smooth' })
  } catch {
    node.scrollIntoView(false)
  }
}

/** Find the nearest vertical scroller for an event target. */
function findScroller(node) {
  let element = node instanceof Element ? node : null
  while (element !== null && element !== document.body && element !== document.documentElement) {
    const style = getComputedStyle(element)
    if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 12) return element
    element = element.parentElement
  }
  return document.querySelector('[class*="scrollBody"]')
}

/**
 * iOS Safari scroll rescue.
 * Tracks one-finger swipes on the conversation. If the finger moved but the
 * scroller did not (native scroll swallowed / follow-tail snap-back), it
 * scrolls manually, then nudges the official follow-tail handler with a
 * synthetic wheel event so it does not immediately re-pin to the bottom.
 */
function installScrollRescue() {
  let gesture = null
  document.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length !== 1) return
      const scroller = findScroller(event.target)
      if (scroller === null) return
      gesture = { scroller, startY: event.touches[0].clientY, startTop: scroller.scrollTop, moved: false }
    },
    { passive: true, capture: true },
  )
  document.addEventListener(
    'touchmove',
    (event) => {
      if (gesture === null || event.touches.length !== 1) return
      if (Math.abs(event.touches[0].clientY - gesture.startY) > 8) gesture.moved = true
    },
    { passive: true, capture: true },
  )
  document.addEventListener(
    'touchend',
    (event) => {
      const current = gesture
      gesture = null
      if (current === null || !current.moved) return
      const touch = event.changedTouches[0]
      if (touch === undefined) return
      const deltaY = touch.clientY - current.startY
      if (Math.abs(deltaY) < 24) return
      const scroller = current.scroller
      const nativeDelta = Math.abs(scroller.scrollTop - current.startTop)
      if (nativeDelta >= 2) return // native scrolling worked
      // Native scroll did not move: move it ourselves (finger down => up).
      const target = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, current.startTop - deltaY * 1.2))
      try {
        scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -deltaY, bubbles: true, cancelable: true }))
      } catch {
        /* synthetic wheel is best-effort */
      }
      scroller.scrollTop = target
      // If the UI re-pins to the tail almost immediately, scroll once more.
      window.setTimeout(() => {
        if (Math.abs(scroller.scrollTop - target) > 48) scroller.scrollTop = target
      }, 120)
    },
    { passive: true, capture: true },
  )
}

function installComposerHeightTracking() {
  const publish = () => {
    const composer = document.querySelector('[class*="composerSeat"]')
    if (composer === null) return
    document.documentElement.style.setProperty('--dshm-composer-h', `${Math.round(composer.getBoundingClientRect().height)}px`)
  }
  publish()
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(publish)
    const target = document.querySelector('[class*="composerSeat"]')
    if (target !== null) observer.observe(target)
    // The composer node can be replaced when a session opens; re-observe lazily.
    const timer = window.setInterval(() => {
      const current = document.querySelector('[class*="composerSeat"]')
      if (current !== null && current !== target) {
        try { observer.disconnect() } catch { /* ignore */ }
        observer.observe(current)
        publish()
        window.clearInterval(timer)
      }
    }, 2000)
  }
}

/**
 * Floating up/down controls as a last-resort rescue when iOS Safari refuses a
 * touch scroll. Buttons scroll the conversation by ~80% of its viewport and
 * nudge the official follow-tail handler with a synthetic wheel event.
 */
function installScrollControls() {
  if (document.querySelector('.dshm-scrollctl') !== null) return
  const box = document.createElement('div')
  box.className = 'dshm-scrollctl'
  box.dataset.visible = '0'
  const up = document.createElement('button')
  up.type = 'button'
  up.textContent = '↑'
  up.title = '向上翻页'
  const down = document.createElement('button')
  down.type = 'button'
  down.textContent = '↓'
  down.title = '回到底部'
  box.append(up, down)
  document.body.append(box)

  const scroller = () => document.querySelector('[class*="scrollBody"]')
  const nudge = (dy) => {
    const sc = scroller()
    if (sc === null) return
    try {
      sc.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true }))
    } catch {
      /* best effort */
    }
    const max = sc.scrollHeight - sc.clientHeight
    if (dy < 0) sc.scrollTop = Math.max(0, sc.scrollTop - sc.clientHeight * 0.8)
    else sc.scrollTop = max
  }
  up.addEventListener('click', () => nudge(-1))
  down.addEventListener('click', () => nudge(1))

  const refresh = () => {
    const sc = scroller()
    if (sc === null) {
      box.dataset.visible = '0'
      return
    }
    const max = sc.scrollHeight - sc.clientHeight
    box.dataset.visible = max > 60 ? '1' : '0'
    up.disabled = sc.scrollTop <= 2
    down.disabled = sc.scrollTop >= max - 2
  }
  refresh()
  document.addEventListener('scroll', refresh, { passive: true, capture: true })
  window.setInterval(refresh, 1500)
}

function installKeyboardHandling() {
  const vv = window.visualViewport
  if (vv !== null && vv !== undefined) {
    vv.addEventListener('resize', syncViewport, { passive: true })
    vv.addEventListener('scroll', syncViewport, { passive: true })
  }
  window.addEventListener('resize', syncViewport, { passive: true })
  window.addEventListener('orientationchange', syncViewport, { passive: true })
  syncViewport()

  document.addEventListener(
    'focusin',
    (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (!target.matches('textarea, input, [contenteditable="true"]')) return
      window.setTimeout(scrollComposerIntoView, 60)
      window.setTimeout(scrollComposerIntoView, 320)
    },
    { passive: true },
  )
}

function boot() {
  document.documentElement.dataset.dshmSkin = forcedOff ? 'off' : 'auto'
  if (markMobile()) {
    installKeyboardHandling()
    installScrollRescue()
    installComposerHeightTracking()
    installScrollControls()
    document.documentElement.dataset.dshmMobile = VERSION
    console.debug(`[mobile-remote] skin ${VERSION} active`)
    return
  }
  // Large touch tablets keep the official desktop layout, but still get the
  // scroll rescue controls (iOS Safari can swallow touch scrolling there too).
  if (!forcedOff && isTouchTablet()) {
    document.documentElement.classList.add('dshm-tablet')
    installScrollRescue()
    installComposerHeightTracking()
    installScrollControls()
    console.debug(`[mobile-remote] tablet scroll rescue ${VERSION} active`)
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true })
} else {
  boot()
}

window.__dshmMobile = {
  version: VERSION,
  isMobile: () => document.documentElement.classList.contains('dshm-mobile'),
  disable: () => document.documentElement.classList.remove('dshm-mobile'),
}
