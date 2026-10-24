# Machine services from main

`julia-machine-control.service` and `julia-machine-runner.service` run from the
checkout named in the controller config. The checkout's `main` branch tracks
`origin/main`. State paths stay outside the checkout.

`julia-machine-main.timer` checks main every minute through the installed
`server-main.mjs` controller. It advances the checkout only to a merge commit or
a commit GitHub identifies as a merged PR to main. Direct pushes alone do not
advance it. An update installs the three runtime owners' locked dependencies and
restarts the configured services. A failed install or restart leaves a pending
record in Git metadata so the next poll retries it.

Install the controller at `~/.local/lib/julia-machine/server-main.mjs` and these
four units at `~/.config/systemd/user/`. The controller reads
`~/.config/julia-machine/config.json`:

```json
{
  "checkout": "/home/ubuntu/julia-machine-main",
  "repository": "https://github.com/toddwyder/julia-next.git",
  "githubRepository": "toddwyder/julia-next",
  "branch": "main",
  "services": ["julia-machine-runner.service", "julia-machine-control.service"],
  "evidenceDirectory": "/home/ubuntu/.local/state/julia-machine/deployments",
  "healthChecks": ["http://127.0.0.1:43127/health", "http://127.0.0.1:43126/julia-control"]
}
```

The observer lock lives at `~/.local/state/julia-machine/update.lock`. Create that
directory before starting the timer. Use signed-in GitHub access. Service child
commands resolve secrets through the checkout's `julia-agents.mjs`.

On each main update the observer records the running service PIDs, the actual
entrypoint process arguments and working directory, the main commit and upstream,
HTTP health statuses, and the configured service states under `evidenceDirectory`.
