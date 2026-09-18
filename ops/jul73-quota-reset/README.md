# JUL-73 quota-reset acceptance re-run

A one-time systemd timer, installed live on the server (not by CI or any script in this repo --
see the runbook), that fires exactly once, 15 minutes after the Codex account behind
`orchestrator-svc` resets its usage cap. It finishes the one JUL-73 acceptance leg the quota wall
blocked: proving a codex-vendor orchestrator can complete a real wake and post to Linear through
`julia-run.mjs` itself.

- `jul73-quota-reset.timer` -- `OnCalendar=` a fixed absolute date, so it can only ever fire once.
- `jul73-quota-reset.service` -- oneshot; `sudo -u orchestrator-svc`s into
  `scripts/jul73-quota-reset-run.mjs` (in the live checkout, not a copy here), then its
  `ExecStopPost=` lines remove both unit files and disable the timer regardless of the run's
  outcome -- a failed acceptance re-run still leaves no stray timer, and the failure itself is
  posted to Linear by the script's own closer step before the unit disappears.

Installed by hand as `ubuntu` (root): copy both files into `/etc/systemd/system/`,
`systemctl daemon-reload`, `systemctl enable --now jul73-quota-reset.timer`. See JUL-73's Linear
thread for the live install record, and `docs/agents/jul43-coordinator-runbook.md`'s "Second
vendor on the orchestrator seat" section for the wider Codex-quota context.

**Hard precondition: this commit must already be on `origin/main` before 19:43 UTC.**
`ExecStart` runs `/srv/orchestrator-svc/julia-next/scripts/jul73-quota-reset-run.mjs` straight out
of the live, read-only checkout (root-owned, `550`/`440`, hard-reset to `origin/main` every 15
minutes -- see the runbook's checkout-sync section). If this branch hasn't merged by the time the
timer fires, `node` exits with a module-not-found, `ExecStopPost` still removes the units, and
nothing is posted anywhere -- silently, since the mechanical script never got far enough to reach
its own closer step. Confirm the merge landed (and the checkout synced) well before the fire time.

**If the box is down at fire time:** `Persistent=false` means the run is simply skipped, not
queued -- there is nothing to "catch up" to twice for a one-shot. The unit files are left in place
(their own `ExecStopPost` never runs), so `systemctl list-timers` will still show
`jul73-quota-reset.timer` afterward; that is the sign this needs a manual re-check rather than an
assumption the run happened.

**If nothing appears on Linear after the fire time:** the mechanical script logs to stderr/stdout,
which journald keeps searchable by unit name even after the unit files are removed --
`journalctl -u jul73-quota-reset.service --since "2026-09-19 19:40 UTC"`.
