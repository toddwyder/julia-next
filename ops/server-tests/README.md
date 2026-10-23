# Server-owned tests

The server runs tests found under a `server` directory by `scripts/test-owners.mjs`.
The nearest owning package and lockfile decide which dependencies are installed.
The worker observes open same-repository PR heads and main through signed-in GitHub.
Each SHA has a separate checkout, install, test log and result under
`~/.local/state/julia-server-tests/`.

The worker runs server tests through `scripts/julia-agents.mjs` and publishes
`result.json` and `server-tests.log` at `refs/notes/julia-server-tests/<SHA>`.
The GitHub Actions `server-tests` job waits for this exact SHA's result.
The receipt ref changes neither the product branch nor the PR head.
`flock` and the systemd oneshot service serialize pollers. Completed candidates
are not rerun on subsequent polls. A failed candidate remains failed; a corrected
head gets its own run.

The service uses a copied worker at `~/.local/lib/julia-server-tests/worker.mjs`.
Its configuration is `~/.config/julia-server-tests/config.json`:

```json
{
  "repository": "https://github.com/toddwyder/julia-next.git",
  "githubRepository": "toddwyder/julia-next",
  "state": "/home/ubuntu/.local/state/julia-server-tests"
}
```

Install the checked-in service and timer in `~/.config/systemd/user/`, run
`systemctl --user daemon-reload`, then
`systemctl --user enable --now julia-server-tests.timer`.
Read results with `journalctl --user -u julia-server-tests.service` and the
SHA's state directory. No provider or GitHub credentials are copied into config.
