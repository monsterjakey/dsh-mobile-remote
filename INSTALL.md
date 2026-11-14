> 中文说明见 [README.zh-CN.md](README.zh-CN.md)。

# dsh-mobile-remote

A small **[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin** that gives the official DSH Web UI a phone/tablet skin and a one-time pairing flow, so you can continue the **same live DSH session** from your iPhone or iPad over [Tailscale](https://tailscale.com).

- No second DSH instance, no data sync: the phone is another window into the DSH running on your Mac.
- No public listener, no third-party relay: the DSH web server stays on `127.0.0.1`; the plugin points `tailscale serve` at it.
- Authentication stays the official launch-token → signed-cookie flow; the plugin only adds a short-code pairing page.
- Unofficial community project, MIT licensed. Not affiliated with DeepSeek.

## How it works

```
iPhone / iPad Safari
  │  https://<this-mac>.<tailnet>.ts.net   (Tailscale: WireGuard + HTTPS, tailnet only)
  ▼
tailscaled on the Mac (tailscale serve --https=443 → 127.0.0.1:<DSH port>)
  ▼
The same DSH Host the desktop app is running
  ├─ official Web UI (index / assets / API / WebSocket)
  └─ dsh-mobile-remote plugin:
       · injects viewport/safe-area meta + /__dshm/mobile.css|js
       · serves /__dshm/pair (6-digit code, 30 min, single use)
       · writes ~/.dsh/mobile-remote.json (0600: token URL + pairing code)
       · reconciles `tailscale serve` after every boot and every 5 minutes
```

The desktop Host binds an OS-assigned port on each launch; the plugin re-points
`tailscale serve` to the current port, retries at 2/5/10/20/40 s after boot, and
keeps a 5-minute reconciliation loop, so sleeping the Mac or restarting the app
does not strand the phone on a stale port.

## Features

- Phone/tablet skin scoped to `html.dshm-mobile` — desktop UI unaffected.
- `#dshm-off` / `#dshm-on` switch for A/B testing (persisted in localStorage).
- Pairing page with short code; token never leaves the Mac.
- Automatic tailnet URL detection (`tailscale status --json`) and serve refresh.
- Touch scroll rescue for iOS Safari + optional floating ↑/↓ page buttons.
- `scripts/check-exposure.mjs`: verifies Funnel is off, Serve is tailnet-only,
  Tailscale SSH is off, and the Serve target matches the current DSH port.
- `scripts/setup-profile.mjs`: computes your tailnet hostname, backs up the
  profile patch, and writes the required deployment entries.

## Requirements

- DeepSeek Harness Desktop `0.2.2.x` (`dsh.compatibility.dsh = ">=0.2.2-0 <0.3.0"`).
- The Mac and the phone logged into the **same tailnet**.
- Tailscale **HTTPS certificates** enabled for the tailnet (admin console → DNS),
  and the `tailscale` CLI available (`/usr/local/bin/tailscale` by default).
- Tailscale app on the phone.

## Install (from a clone)

```bash
git clone <this-repo> dsh-mobile-remote
cd dsh-mobile-remote

DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
"$DSH" plugin --profile desktop add -w "link:$PWD"

# Computes your tailnet host, backs up the profile patch, writes:
#   connection.trustedHosts, mobile-remote.publicBaseUrl/autoServe
node ~/.dsh/profiles/desktop/node_modules/dsh-mobile-remote/scripts/setup-profile.mjs
```

Restart DSH Desktop once, then on the phone:

1. Open `https://<this-mac>.<tailnet>.ts.net/__dshm/pair`
2. Enter the `pairingCode` from `~/.dsh/mobile-remote.json`
3. Afterwards bookmark `https://<this-mac>.<tailnet>.ts.net/` (cookie lasts 7 days)

Other install shapes:

- Tarball: `"$DSH" plugin --profile desktop add -w file:/path/to/dsh-mobile-remote-0.2.3.tgz`
- GitHub: `"$DSH" plugin --profile desktop add -w github:<owner>/dsh-mobile-remote`

The deployment entries added by `setup-profile.mjs` live in
`~/.dsh/profiles/desktop/cordis.patch.yml` (the bundle itself is self-contained).

## Troubleshooting

iPhone/pad cannot reach DSH:

```bash
node ~/.dsh/profiles/desktop/node_modules/dsh-mobile-remote/scripts/check-exposure.mjs
```

- If it reports `serve target port X != DSH port Y`:
  `tailscale serve --bg --https=443 <Y>` (the plugin also retries automatically).
- Make sure Tailscale on the phone is connected and **Use Tailscale DNS** is on
  (otherwise `*.ts.net` names do not resolve).
- Keep the Mac awake (`caffeinate`) for long sessions.

Layout/scroll issues: append `#dshm-off` to the URL to disable the mobile skin
and compare with the official layout; `#dshm-on` restores it.

## Uninstall

```bash
DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
"$DSH" plugin --profile desktop remove -w dsh-mobile-remote
# remove the "dsh-mobile-remote setup" block from
# ~/.dsh/profiles/desktop/cordis.patch.yml
rm -f ~/.dsh/mobile-remote.json
tailscale serve reset   # only if you have no other serve configuration
```

## Security

This plugin gives a paired phone **owner-level** access to the DSH on your Mac:
the agent can run shell commands and read/write files. Keep the phone locked,
keep Funnel disabled, and restrict the tailnet with an ACL that only allows your
phone to reach this Mac on `tcp:443`. See [SECURITY.md](SECURITY.md) and
[INSTALL.md](INSTALL.md).

## License

MIT. See [LICENSE](LICENSE). DeepSeek and DeepSeek Harness are trademarks of
their respective owners; this is an independent community project.

---

## Receiver notes (tarball / other machine)

After installation and `setup-profile.mjs`, restart DSH Desktop and pair with the
six-digit code from `~/.dsh/mobile-remote.json`. The plugin only works inside the
same tailnet; nothing is exposed to the public internet.

## Pairing code expired

Use `scripts/pairing.mjs` to print or rotate the code (`--refresh`); in 0.2.3+ expired/used codes rotate automatically when `/__dshm/pair` is opened. Start the Tailscale app first if the phone cannot connect.
