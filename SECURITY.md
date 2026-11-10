# Security

This plugin exposes an **owner-level** DSH session to a phone/tablet over Tailscale.
Treat the phone and its browser cookie like a shell password for the Mac.

## Design boundaries

- No public listener: the DSH web server stays on `127.0.0.1`; the plugin only
  points `tailscale serve --https=443` at it. Funnel is never used.
- Authentication remains the official DSH launch-token → signed cookie flow.
  The plugin only adds a short-code pairing page (`/__dshm/pair`, 30 min TTL,
  single use, 10 attempts) and a 0600 pairing file (`$DSH_HOME/mobile-remote.json`).
- The plugin serves only two static skin files and injects CSS/JS/meta into the
  official index; it does not proxy API traffic and does not bypass Host/Origin
  checks.
- Deployment still requires `connection.trustedHosts` to contain the tailnet
  authority so the official Host/Origin fence accepts the phone.

## Recommended hardening

- Tailscale ACL: only the phone device may reach this Mac on tcp:443.
- Enable device approval and keep Funnel disabled (remove the `funnel` node
  attribute from the policy if it is granted).
- Keep `cookieMaxAgeDays` small (7 by default in the example patch).
- Run `node scripts/check-exposure.mjs` periodically.
- Revoke a lost phone: clear Safari data, delete the browser-session credential
  record in `~/.dsh/.credentials.yaml`, restart the Host, remove the device from
  the Tailscale admin console.

## Reporting

Open a GitHub issue without secrets (no token URLs, no pairing files, no tailnet
details you consider private).
