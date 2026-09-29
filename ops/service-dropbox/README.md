# service-dropbox -- the one-time code drop box (JUL-72, JUL-77)

Todd's browser, over Tailscale only, pastes raw tokens -- Sentry, Supabase, PowerSync, Axiom
(JUL-72), plus DeepSeek and a Linear personal API key (JUL-77) -- straight into their
protected files on the server. No code value ever passes through Linear, email, or an agent
chat -- see JUL-71's readiness review and JUL-72 for why.

Not every field is readable by the same account. `write-secret.sh` chowns each field's file to
the group named in `dropbox.mjs`'s `FIELD_GROUPS`:

| Field | Readable by |
| --- | --- |
| sentry, supabase, powersync, axiom, linear | `orchestrator-svc` only |
| linear-app-id, linear-app-secret (the controller's own Linear identity, JUL-98) | `orchestrator-svc` only |
| deepseek | `runner` AND `orchestrator-svc`, via a dedicated `deepseek-readers` group (builder backup + `orchestrator-deepseek` route) |
| commandcode | `runner` AND `orchestrator-svc`, via a dedicated `commandcode-readers` group (Pi route, same shape as deepseek, plus a coordinator-run probe) -- JUL-98, Todd's 13:43Z Decision (Command Code GOAT reviewer trial) |

`runner` is never added to the `orchestrator-svc` group itself -- that would let it read every
orchestrator-only field (including `linear`), not just the fields it's meant to hold.

## Architecture

`dropbox.mjs` runs as its own dedicated system account, `dropbox-svc` -- not `runner`, not
`orchestrator-svc`. It never has write access
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
   the builder that reads `deepseek` (JUL-77).
3. **JUL-77 / JUL-79:** create the `deepseek-readers` group and add both accounts to it -- this
   is a field two different accounts must read, so it gets its own group rather than widening
   either account's existing one. (A `zai-readers` group existed for GLM until JUL-93 removed it.)
   **JUL-98, 13:43Z Decision:** the same reasoning gives Command Code its own `commandcode-readers`
   group -- do both in the same pass. After adding members, restart both
   Orca daemons (a daemon's supplementary groups are fixed at start):
   ```
   for g in deepseek-readers commandcode-readers; do
     groupadd "$g"
     usermod -aG "$g" runner
     usermod -aG "$g" orchestrator-svc
   done
   ```
   **Do not restart either Orca daemon while any worker is running** (Todd, 2026-09-22) -- a
   daemon restart tears down every terminal it owns mid-work, the same way the 06:41Z GPU crash
   did (see the coordinator runbook's account of that incident). Check `orca orchestration
   worker-list` / `orca terminal list` on both environments first, and if `commandcode-readers`
   is the only thing waiting on a restart, hold it until the run in progress (JUL-98 step 6 round
   4, as of this Decision) has landed its review.
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

## Command Code as the reviewer's Pi provider (JUL-98, Todd's 15:01:54Z Decision)

`run-pi-seat.mjs`'s `reviewer-backup` and `reviewer-shadow-flash` seats route through Command
Code's OpenAI-completions-compatible endpoint, not DeepSeek's native API -- the GOAT reviewer
trial (13:43Z Decision), moved off Codex-as-primary-reviewer as soon as the probe on JUL-98
proved Command Code returns real token counts, not after step 6 merges.

This needs a provider entry in `runner`'s own Pi config, **not tracked by `~/.pi/agent/`** (that
directory is Pi's own state, per-account and per-host, the same reason `dropbox.env` isn't
committed). The canonical shape lives in this repo instead, so it survives a fresh `runner`
account or a rebuilt box:

```
sudo -u runner mkdir -p /home/runner/.pi/agent
sudo -u runner cp ops/service-dropbox/pi-models.commandcode.json /home/runner/.pi/agent/models.json
```

(If `runner` ever needs another custom provider beside this one, merge the two files' `providers`
objects by hand -- this command overwrites, it doesn't merge.)

The `apiKey` field is `"$COMMANDCODE_API_KEY"` -- an environment-variable reference Pi resolves
at request time, never a literal secret, so this file carries nothing sensitive and is safe to
commit. `run-pi-seat.mjs` supplies that variable from the drop box's `commandcode` field the same
way every other seat's secret reaches its child process: in `env`, never argv (see
`buildPiSpawnSpec`).

**The model ids are namespaced**, confirmed live against Command Code's own `/models` listing:
`deepseek/deepseek-v4-pro` and `deepseek/deepseek-v4-flash`. The bare `deepseek-v4-pro` id (the
native-DeepSeek spelling `builder-backup` still uses) fails on this endpoint with `400
unsupported_model` -- the two providers are not interchangeable by model id.

## Why a dedicated account, and why a sudo helper instead of direct writes

Same-UID processes can read each other's environment and open files via
`/proc/<pid>/`. `dropbox-svc` briefly holds up to eight raw
tokens and secrets per request; if it also owned the destination files, any bug or compromise in
this ~250-line HTTP handler would have direct write access to every one of those accounts'
credential stores, not just `orchestrator-svc`'s.
Routing every write through one fixed, root-owned, single-purpose helper script means the actual
privileged operation (write + chown + chmod under `/etc/orca-runner/dropbox-secrets/`) has a
blast radius of one file, one field name, one behavior -- reviewable in the 20 lines of
`write-secret.sh`, not the whole HTTP server.
