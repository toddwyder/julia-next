# service-dropbox -- the one-time code drop box (JUL-72)

Todd's browser, over Tailscale only, pastes four raw tokens (Sentry, Supabase, PowerSync, Axiom)
straight into their protected files on the server. No code value ever passes through Linear,
email, or an agent chat -- see JUL-71's readiness review and JUL-72 for why.

## Architecture

`dropbox.mjs` runs as its own dedicated system account, `dropbox-svc` -- not `runner`, not
`orchestrator-svc`, same isolation reasoning as `ops/journey-relay/`. It never has write access
to the destination secret files itself: it can only invoke `write-secret.sh` (installed
root:root, 0700) via a narrowly scoped NOPASSWD sudoers rule that names that exact path. The
helper reads the value from stdin (never argv) and is the only thing that ever writes or chowns
a file under `/etc/orca-runner/dropbox-secrets/`.

The box is armed once, uses a 24-hour window, and turns itself off (refuses further `/save`
calls and serves an "off" page) the moment a save is submitted OR the window elapses, whichever
comes first. Re-arming for a future sitting is a local-only CLI command
(`node dropbox.mjs --rearm`), never a network-reachable endpoint.

## One-time placement (root, on the server -- not in chat, not in this repo)

1. Create the dedicated service account:
   ```
   useradd --system --no-create-home --shell /usr/sbin/nologin dropbox-svc
   ```
2. Make sure `orchestrator-svc` exists (it already does, per JUL-61) -- it is the *reader* of the
   secrets this box writes, never the writer.
3. Create the secrets directory, owned so only root can create files in it and only
   `orchestrator-svc` can read what's placed there:
   ```
   mkdir -p /etc/orca-runner/dropbox-secrets
   chown root:orchestrator-svc /etc/orca-runner/dropbox-secrets
   chmod 0750 /etc/orca-runner/dropbox-secrets
   ```
4. Install the code, owned by root (dropbox-svc must not be able to edit its own helper script):
   ```
   mkdir -p /opt/orca-runner/service-dropbox
   cp dropbox.mjs write-secret.sh /opt/orca-runner/service-dropbox/
   chown -R root:root /opt/orca-runner/service-dropbox
   chmod 0700 /opt/orca-runner/service-dropbox/write-secret.sh
   chmod 0644 /opt/orca-runner/service-dropbox/dropbox.mjs
   ```
5. Grant dropbox-svc the one narrow sudo rule it needs, nothing more:
   ```
   echo 'dropbox-svc ALL=(root) NOPASSWD: /opt/orca-runner/service-dropbox/write-secret.sh' \
     > /etc/sudoers.d/dropbox-svc-write-secret
   chmod 0440 /etc/sudoers.d/dropbox-svc-write-secret
   visudo -c   # verify the file parses before trusting it
   ```
6. State directory (armed/used tracking, not secret -- just timestamps):
   ```
   mkdir -p /var/lib/dropbox-svc
   chown dropbox-svc:dropbox-svc /var/lib/dropbox-svc
   chmod 0750 /var/lib/dropbox-svc
   ```
7. `install -m 0440 -o root -g dropbox-svc /dev/null /etc/orca-runner/dropbox.env`, then fill it
   in from `dropbox.env.example` with this host's real Tailscale IP
   (`tailscale ip -4`). Never commit this file.
8. `cp dropbox.service /etc/systemd/system/`
9. `systemctl daemon-reload && systemctl enable --now dropbox`
10. From another Tailscale-connected device (not the public internet):
    `curl -s http://<tailscale-ip>:8945/` should return the form page. From outside Tailscale,
    the same address must be unreachable (connection refused/timeout, not just a 403) -- this is
    a network-layer property of binding to the Tailscale interface only, verify it live once
    after install.

## Re-arming for a later sitting

Once used (or after 24 hours), the box is off. To use it again for a future round of codes:
```
sudo -u dropbox-svc node /opt/orca-runner/service-dropbox/dropbox.mjs --rearm
```

## Why a dedicated account, and why a sudo helper instead of direct writes

Same reasoning as `ops/journey-relay/README.md`: same-UID processes can read each other's
environment and open files via `/proc/<pid>/`. `dropbox-svc` briefly holds up to four raw bearer
tokens per request; if it also owned the destination files, any bug or compromise in this
~250-line HTTP handler would have direct write access to `orchestrator-svc`'s credential store.
Routing every write through one fixed, root-owned, single-purpose helper script means the actual
privileged operation (write + chown + chmod under `/etc/orca-runner/dropbox-secrets/`) has a
blast radius of one file, one field name, one behavior -- reviewable in the 20 lines of
`write-secret.sh`, not the whole HTTP server.
