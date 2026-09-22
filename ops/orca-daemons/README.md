# Orca daemon GPU crash

One persistent fix so far, added by hand from a laptop session (see
`docs/agents/jul43-coordinator-runbook.md`). Not installed by any sudo rule
or graph action — an env-file/unit change is always a laptop-session edit,
never something the controller or a coordinator does.

## `--disable-gpu` — both Orca daemons crash under Xvfb without it

**Why:** both Orca daemons (`orca-server.service` as `runner`,
`orca-server-orchestrator.service` as `orchestrator-svc`) run headless under
Xvfb (a virtual X server with no real GPU/DRI device). Electron's GPU
process still tries to initialize hardware acceleration there, fails, and
brings the whole process down with it:

```
[...] FATAL:content/browser/gpu/gpu_data_manager_impl_private.cc:416] GPU process isn't usable. Goodbye.
Orca serve exited via SIGILL.
```

systemd's `Restart=on-failure` (`RestartSec=5`) brings the daemon back
within seconds, so this was easy to miss — but a daemon restart **kills
every terminal it owns**, mid-work, with no chance for whatever coordinator
or builder was running to report anything. Found live 2026-09-22 (JUL-98)
when it killed a coordinator and a builder simultaneously; confirmed with
`journalctl` back to server boot that the identical signature had already
fired at least six times before that, unrecorded, since 2026-09-17.

**What it does:** adds `--disable-gpu` to `ORCA_SERVE_ARGS` in each
daemon's env file. This is a standard Chromium/Electron switch — `orca
serve --help` doesn't list it, but Electron parses it before handing the
rest of argv to the app, so it's accepted silently. Verified live: `orca
serve --disable-gpu` (foreground, throwaway port) starts cleanly under the
same Xvfb display, with none of the GPU-process error lines that precede
every crash above.

**Source of truth:** `orchestrator-svc.orca-server.env` and
`runner.orca-server.env` in this directory are the exact files installed
at `/etc/orchestrator-svc/orca-server.env` and `/etc/orca-runner/orca-server.env`
respectively.

### Verify it's active

```sh
sudo systemctl is-active orca-server.service orca-server-orchestrator.service
sudo journalctl -u orca-server.service -u orca-server-orchestrator.service --since <fix time> --no-pager | grep -i 'SIGILL\|GPU process'
```

The second command should return nothing from after the fix was applied —
the crash signature should not recur.

### Reapply on a rebuilt server

Copy this directory's two files to their `/etc/...` paths above (owner
`root:root` or `root:<service group>` matching the existing file, mode
`0644`), then `sudo systemctl restart orca-server.service
orca-server-orchestrator.service`.

### Undo

Remove ` --disable-gpu` from `ORCA_SERVE_ARGS` in both files and restart
both services. Not expected to be needed — the flag only disables
hardware-accelerated rendering, which a headless terminal server never
uses anyway.
