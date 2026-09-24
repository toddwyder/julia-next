# julia-runner -- the minimal runner on the server (JUL-122)

`scripts/julia-minimal-runner.mjs` takes one card through Gemini, the tests, a DeepSeek review
and a PR. On the OVH server its jobs run in separate accounts (Todd, 24 Sep):

| Job | Account | Holds |
| --- | --- | --- |
| The runner: state, commits, Linear comments, the publisher | `orchestrator-svc` | the Linear app credential, at run time only |
| Gemini: edits files, runs no command | `gemini-worker` | its own agy sign-in; no groups, no service keys |
| Test worker: lint, suite, seam tests; no model | `julia-tester` | nothing |
| DeepSeek review | `runner` | the Command Code key (as today) |
| Publisher: push and open the PR | `orchestrator-svc` | the GitHub App (as today) |

The runner starts each worker only through `sudoers` in this folder: one fixed command per
account, with the worker's input on stdin and an environment of `PATH` and `LANG` only.

## The Linear credential: systemd-creds

The runner's Linear identity is the "Julia controller" OAuth app. Its client id and secret are
encrypted with `systemd-creds` under the host key (`/var/lib/systemd/credential.secret`, root
only; this server has no TPM). `systemd-run` decrypts them into a credentials directory that only
the runner's own process can read, and the runner reads them in-process
(`readAppCredential` in `scripts/julia-minimal-runner-adapters.mjs`). Root can decrypt them;
that limit is accepted (Todd, 24 Sep). The values never appear in a command line, prompt, log,
Git, a PR or Linear.

## One-time setup (as `ubuntu`, with sudo)

1. Accounts and the worktree group:
   ```
   sudo useradd --system --create-home --shell /usr/sbin/nologin gemini-worker
   sudo useradd --system --create-home --shell /usr/sbin/nologin julia-tester
   sudo groupadd julia-runner-work
   for u in orchestrator-svc gemini-worker julia-tester; do sudo usermod -aG julia-runner-work "$u"; done
   ```
2. Folders. `/srv/julia-runner` belongs to `orchestrator-svc`; worktrees are group-shared:
   ```
   sudo install -d -o orchestrator-svc -g julia-runner-work -m 0750 /srv/julia-runner
   sudo install -d -o orchestrator-svc -g julia-runner-work -m 2770 /srv/julia-runner/worktrees
   sudo -u orchestrator-svc git clone -q /srv/orchestrator-svc/julia-next /srv/julia-runner/repo
   ```
3. The credential, straight from the drop box into systemd-creds (the value is never shown):
   ```
   sudo systemd-creds setup
   for f in linear-app-id linear-app-secret; do
     sudo systemd-creds encrypt --name="$f" "/etc/orca-runner/dropbox-secrets/$f.env" "/etc/credstore.encrypted/julia-runner-$f.cred"
   done
   sudo chmod 0600 /etc/credstore.encrypted/julia-runner-*.cred
   ```
4. The worker code, root-owned, mirroring the repo layout, copied from a checkout of the
   reviewed commit:
   ```
   for f in ops/julia-runner/run-gemini.mjs ops/julia-runner/run-tests.mjs scripts/julia-minimal-runner-checks.mjs \
            ops/service-dropbox/run-pi-seat.mjs ops/service-dropbox/read-secret.mjs; do
     sudo install -D -o root -g root -m 0644 "$CHECKOUT/$f" "/opt/julia-runner/$f"
   done
   sudo install -o root -g root -m 0440 "$CHECKOUT/ops/julia-runner/sudoers" /etc/sudoers.d/julia-runner
   sudo visudo -c
   ```
5. Gemini for `gemini-worker`: the agy binary in `~gemini-worker/.local/bin/agy`, an agy
   `settings.json` whose `permissions.allow` is empty, and **Todd's one-time sign-in** in that
   account.

## Running a card

```
sudo systemd-run --uid=orchestrator-svc --gid=orchestrator-svc --pipe --wait --collect \
  --working-directory=/srv/julia-runner/repo \
  -p LoadCredentialEncrypted=linear-app-id:/etc/credstore.encrypted/julia-runner-linear-app-id.cred \
  -p LoadCredentialEncrypted=linear-app-secret:/etc/credstore.encrypted/julia-runner-linear-app-secret.cred \
  /usr/bin/node /srv/julia-runner/code/scripts/julia-minimal-runner.mjs JUL-NN --base <origin/main commit>
```

Without the two `LoadCredentialEncrypted` lines the runner stops at once with "the Linear app
credential is not available".
