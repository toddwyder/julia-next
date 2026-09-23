# Orca daemon GPU crash

One persistent fix so far, added by hand from a laptop session (see
`docs/agents/server-runbook.md`). Not installed by any sudo rule
or graph action — an env-file/unit change is always a laptop-session edit,
never something the controller or a coordinator does.

## `LIBGL_ALWAYS_SOFTWARE=1` — both Orca daemons crash under Xvfb without it

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

**What it does, and a wrong first attempt that's worth recording.** The
first attempt added `--disable-gpu` (a standard Chromium/Electron switch)
to `ORCA_SERVE_ARGS`. That crash-looped the daemon outright with `Unknown
flag --disable-gpu for command: serve` — the systemd unit's `ExecStart`
runs `/usr/bin/orca-ide`, a thin wrapper script
(`/opt/Orca/resources/bin/orca-ide`) that runs `serve` with
`ELECTRON_RUN_AS_NODE=1` in **Node-only mode** ("CLI commands run in
Electron's Node mode and must never initialize Chromium", per the
wrapper's own comment) and validates argv against a strict whitelist
before ever reaching the actual Electron/Chromium instance that `serve`
spawns internally as a subprocess. No CLI flag can reach that inner
instance at all, by design.

The real fix is an **environment variable**, not a CLI flag, because it
reaches the inner Electron instance the way argv cannot:
`LIBGL_ALWAYS_SOFTWARE=1` forces Mesa's software OpenGL renderer
(`llvmpipe`), so Chromium's GPU process gets a working software GL
context under Xvfb instead of failing to find real hardware and taking
the whole process down. Verified live: `orca serve` (foreground, throwaway
port) through the **actual wrapper** (`/usr/bin/orca-ide`, matching the
systemd `ExecStart` exactly) starts cleanly with this env var set and no
CLI flags added, versus reproducing the crash reliably without it.

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
the crash signature should not recur. Proven live 2026-09-22: both daemons
restarted clean (`NRestarts=0`, stable), and the crash signature does not
appear in `journalctl` from the restart timestamp onward.

### Reapply on a rebuilt server

Copy this directory's two files to their `/etc/...` paths above (owner
`root:root` or `root:<service group>` matching the existing file, mode
`0644`), then `sudo systemctl restart orca-server.service
orca-server-orchestrator.service`.

### Undo

Remove the `LIBGL_ALWAYS_SOFTWARE=1` line from both files and restart both
services. Not expected to be needed — software rendering costs nothing on
a headless terminal server that was never using hardware acceleration
anyway (it was crashing trying to reach it).
