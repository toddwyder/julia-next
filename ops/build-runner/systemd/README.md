# Machine services from main

`julia-machine-control.service` and `julia-machine-runner.service` use the standalone
`/home/ubuntu/julia-machine-main` checkout. Its `main` branch tracks `origin/main`.
The initialization database and existing jobs remain at their original state paths.
The current JUL-231 services continue using the PR checkout until PR #316 merges.
The generic services take over only after that merge.

`julia-machine-main.timer` checks main every minute through the installed
`server-main.mjs` controller. It advances the checkout only to a merge commit or
a commit GitHub identifies as a merged PR to main. Direct pushes alone do not
advance it. An update installs the three runtime owners' locked dependencies and
restarts the two services. A failed install or restart leaves a pending record in
Git metadata so the next poll retries it.

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
  "activationPullRequest": 316,
  "legacyServices": ["julia-jul231-runner.service", "julia-jul231-control.service"],
  "evidenceDirectory": "/home/ubuntu/.local/state/julia-machine/deployments",
  "healthChecks": ["http://127.0.0.1:43127/health", "http://127.0.0.1:43126/julia-control"]
}
```

The observer lock lives at `~/.local/state/julia-machine/update.lock`. Create that
directory before starting the timer. Use the existing signed-in GitHub access.
Service child commands resolve secrets through the checkout's `julia-agents.mjs`.

If main does not yet contain an entrypoint, its launcher fails and reports the
service as unavailable. In particular, main at `a451f73` predates JUL-231's
`ops/build-runner/jobs.mjs`. The new build journey becomes available only after
JUL-231 merges. Candidate Proof uses separate temporary units and state.

Enable only `julia-machine-main.timer` before merge. Its activation PR setting
keeps the current services running until GitHub confirms PR #316 merged to main.
The first transition targets PR #316's exact merge commit, even if later merges
have reached main. On that merge the observer updates the checkout, installs dependencies, disables
and removes the two JUL-231 units, and enables and starts the generic services.
It records each running service PID plus the actual entrypoint process arguments
and working directory, the main commit
and upstream, HTTP health statuses, and the removed units' `not-found` state under `evidenceDirectory`.
The existing database, jobs and evidence stay in place.
