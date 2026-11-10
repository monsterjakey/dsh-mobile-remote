# Changelog

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
