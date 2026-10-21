# Drive browser callback recovery — 21 October 2026

User reported `127.0.0.1 refused to connect` inside the remote browser. Maker self-check: the browser tab was on the Google OAuth callback at loopback port 53682, with authorization query values withheld. The recorded authorization PID 161192 had exited; no callback listener remained. The remote desktop HTTPS/WebSocket route itself returned a real RFB 003.008 handshake.

Admin commands actually run:

- Python read `/tmp/julia-drive-authorize-start.py`, wrote `/tmp/julia-drive-authorize-restart.py`, adding an output-file starting offset and reading only new bytes when extracting the private authorization link. Result: success. This prevents reuse of an earlier link from the append-only private output.
- `python3 /tmp/julia-drive-authorize-restart.py`. Result: exit 0; started PID 162168 using the existing private configuration and `rclone authorize drive [REDACTED CONFIGURATION BLOB] --auth-no-open-browser`. Captured the new URL privately; no secret or authorization URL printed.
- Node/Playwright connected with `chromium.connectOverCDP('http://127.0.0.1:9337')`, selected the existing loopback callback page, read the private authorization URL from `/home/ubuntu/.local/state/julia-drive-setup/authorize-browser-url.private`, called `page.goto` with `waitUntil: 'domcontentloaded'` and a 20-second timeout, brought the page forward, and disconnected. Result: exit 0; actual destination hostname `accounts.google.com`. No consent button clicked.
- `ss -ltnp | rg '53682'`. Result: exit 0; `rclone` PID 162168 listening on `127.0.0.1:53682`.

This verifies the restarted callback listener and reopened Google page, not completed authorization. Google account approval remains with Todd. Existing configuration, requested `drive.file` scope and browser profile were reused. No service deployment or restart occurred.

## Authorization completion

Todd reported success. Python inspected the private output without printing values and verified an encoded authorization result. The token had not yet been saved to the remote. After reading installed `rclone config update --help`, `rclone config --help` and `rclone about --help`, Python decoded that result privately and ran `rclone config update julia-evidence token [REDACTED TOKEN] config_refresh_token false --non-interactive` with captured, withheld output. Exit 0. Python set `/home/ubuntu/.config/rclone/rclone.conf` to mode 0600 and read back that a nonempty token was saved (value withheld).

Python then ran `rclone about julia-evidence: --json` with output captured privately. Exit 0; returned valid JSON quota information. This is a maker self-check of actual authenticated Drive access. No Drive files were created or changed by this check. Authorization is now complete.
