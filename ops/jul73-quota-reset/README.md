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
thread for the live install record.
