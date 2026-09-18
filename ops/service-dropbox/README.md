# service-dropbox -- the one-time code drop box (JUL-72, JUL-77)

Todd's browser, over Tailscale only, pastes raw tokens -- Sentry, Supabase, PowerSync, Axiom
(JUL-72), plus DeepSeek, Z.ai, and a Linear personal API key (JUL-77) -- straight into their
protected files on the server. No code value ever passes through Linear, email, or an agent
chat -- see JUL-71's readiness review and JUL-72 for why.

Not every field is readable by the same account. `write-secret.sh` chowns each field's file to
the group named in `dropbox.mjs`'s `FIELD_GROUPS`:

| Field | Readable by |
| --- | --- |
| sentry, supabase, powersync, axiom, linear | `orchestrator-svc` only |
| deepseek | `runner` only (the builder needs it to run at all) |
| zai | `runner` AND `orchestrator-svc`, via a dedicated `zai-readers` group |

`runner` is never added to the `orchestrator-svc` group itself -- that would let it read every
orchestrator-only field (including `linear`), not just the two it's meant to hold.

## Architecture

`dropbox.mjs` runs as its own dedicated system account, `dropbox-svc` -- not `runner`, not
`orchestrator-svc`, same isolation reasoning as `ops/journey-relay/`. It never has write access
to the destination secret files itself: it can only invoke `write-secret.sh` (installed
root:root, 0700) via a narrowly scoped NOPASSWD sudoers rule that names that exact path. The
helper reads the value from stdin (never argv) and is the only thing that ever writes or chowns
a file under `/etc/orca-runner/dropbox-secrets/`.

The box is armed once, uses a 24-hour window, and turns itself off (refuses further `/save`
calls and serves an "off" page) once every field is received OR the window elapses, whichever
comes first. Every field stays replaceable while the box is on: a new value pasted over a
received field overwrites it (`write-secret.sh` moves the new file over the old one, so no copy
of the old value is kept), and a blank box leaves the saved value alone. Re-arming for a future sitting is a local-only CLI command
(`node dropbox.mjs --rearm`), never a network-reachable endpoint.

## One-time placement (root, on the server -- not in chat, not in this repo)

1. Create the dedicated service account:
   ```
   useradd --system --no-create-home --shell /usr/sbin/nologin dropbox-svc
   ```
2. Make sure `orchestrator-svc` and `runner` both exist (they already do, per JUL-61) --
   `orchestrator-svc` is the *reader* of most of these secrets, never the writer; `runner` is
   the builder that reads `deepseek` and `zai` (JUL-77).
3. **JUL-77 only:** create the `zai-readers` group and add both accounts to it -- this is the
   only field two different accounts must read, so it gets its own group rather than widening
   either account's existing one:
   ```
   groupadd zai-readers
   usermod -aG zai-readers runner
   usermod -aG zai-readers orchestrator-svc
   ```
4. Create the secrets directory. Every field's *file* is chmod 0440 to its own owning group
   (see the table above), but the *directory* itself needs `+x` (traverse, not list) for every
   account that reads anything inside it -- `runner` included, since JUL-77 added fields it
   must reach. Group-list access (`orchestrator-svc`, via the group read bit) still exposes only
   filenames, never contents:
   ```
   mkdir -p /etc/orca-runner/dropbox-secrets
   chown root:orchestrator-svc /etc/orca-runner/dropbox-secrets
   chmod 0751 /etc/orca-runner/dropbox-secrets
   ```
5. Install the code, owned by root (dropbox-svc must not be able to edit its own helper script):
   ```
   mkdir -p /opt/orca-runner/service-dropbox
   cp dropbox.mjs write-secret.sh /opt/orca-runner/service-dropbox/
   chown -R root:root /opt/orca-runner/service-dropbox
   chmod 0700 /opt/orca-runner/service-dropbox/write-secret.sh
   chmod 0644 /opt/orca-runner/service-dropbox/dropbox.mjs
   ```
6. Grant dropbox-svc the one narrow sudo rule it needs, nothing more:
   ```
   echo 'dropbox-svc ALL=(root) NOPASSWD: /opt/orca-runner/service-dropbox/write-secret.sh' \
     > /etc/sudoers.d/dropbox-svc-write-secret
   chmod 0440 /etc/sudoers.d/dropbox-svc-write-secret
   visudo -c   # verify the file parses before trusting it
   ```
7. State directory (armed/used tracking, not secret -- just timestamps):
   ```
   mkdir -p /var/lib/dropbox-svc
   chown dropbox-svc:dropbox-svc /var/lib/dropbox-svc
   chmod 0750 /var/lib/dropbox-svc
   ```
8. `install -m 0440 -o root -g dropbox-svc /dev/null /etc/orca-runner/dropbox.env`, then fill it
   in from `dropbox.env.example` with this host's real Tailscale IP
   (`tailscale ip -4`). Never commit this file.
9. `cp dropbox.service /etc/systemd/system/`
10. `systemctl daemon-reload && systemctl enable --now dropbox`
11. From another Tailscale-connected device (not the public internet):
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
environment and open files via `/proc/<pid>/`. `dropbox-svc` briefly holds up to seven raw
bearer tokens per request; if it also owned the destination files, any bug or compromise in
this ~250-line HTTP handler would have direct write access to every one of those accounts'
credential stores, not just `orchestrator-svc`'s.
Routing every write through one fixed, root-owned, single-purpose helper script means the actual
privileged operation (write + chown + chmod under `/etc/orca-runner/dropbox-secrets/`) has a
blast radius of one file, one field name, one behavior -- reviewable in the 20 lines of
`write-secret.sh`, not the whole HTTP server.
