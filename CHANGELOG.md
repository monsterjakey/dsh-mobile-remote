# Changelog

## 0.2.3

- Pairing codes rotate automatically: opening `/__dshm/pair` after a code
  expired or was used mints a fresh code and republishes
  `~/.dsh/mobile-remote.json`, so an expired code no longer requires a DSH
  restart.
- New loopback-only endpoint `/__dshm-local/pairing` and helper script
  `scripts/pairing.mjs`:
  - `node scripts/pairing.mjs` prints the current code/expiry/pairing URL;
  - `node scripts/pairing.mjs --refresh` rotates it immediately;
  - non-loopback requests are rejected with 403.
- Docs: "pairing code expired" section, plus the iPhone Duo landscape section
  and preview screenshot.

## 0.2.2

- Mobile skin is limited to phones and viewports <= 1024px; large tablets keep
  the official desktop layout (with scroll rescue only).
- Removed the global button-size override; touch targets now only affect app
  chrome (header / composer), not message content.
- Flex `min-height: 0` + conversation `overscroll-behavior: contain` fixes for
  conversation squeeze; composer height capped (`62dvh`) and scrollable.
- Touch scroll rescue: when iOS Safari swallows a swipe, the conversation is
  scrolled manually and the follow-tail handler is nudged with a synthetic wheel.
- Floating up/down scroll buttons on touch devices.
- `#dshm-off` / `#dshm-on` skin switch (persisted in localStorage).
- Serve reconciliation: retry at 2/5/10/20/40s after boot and every 5 minutes,
  so a stale `tailscale serve` target can no longer strand the phone.
- Added `scripts/check-exposure.mjs` and `scripts/setup-profile.mjs`.

## 0.2.0

- First public bundle-ready version: `dsh.bundle.patch`, pairing page, automatic
  tailnet URL detection and `tailscale serve` refresh.

## 0.1.0

- Initial experimental plugin: injected mobile skin + pairing file.
