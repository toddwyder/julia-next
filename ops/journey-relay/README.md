# journey-relay -- the trusted Axiom-delivery boundary

Builders (agent worktrees on the runner) must never hold the Axiom
credential. This relay is the one process that does.

## One-time placement (root, on the runner -- not in chat, not in this repo)

1. Create a dedicated system account for the relay, distinct from the
   `runner` builder account: `useradd --system --no-create-home --shell
   /usr/sbin/nologin axiom-relay`.
2. Install the relay code outside any repo checkout, owned by that account:
   `mkdir -p /opt/orca-runner/journey-relay && chown axiom-relay:axiom-relay
   /opt/orca-runner/journey-relay && chmod 750 /opt/orca-runner/journey-relay`,
   then copy `relay.mjs` in with the same ownership.
3. Create the dataset and an ingest-only token in the existing Axiom
   account, scoped to that dataset only (not a full-access API token).
4. `install -m 0440 -o root -g axiom-relay /dev/null /etc/orca-runner/journey-axiom.env`
   then fill it in from ops/journey-relay/journey-axiom.env.example with the
   real dataset name and token. Never commit this file.
5. `cp ops/journey-relay/journey-relay.service /etc/systemd/system/`
6. `systemctl daemon-reload && systemctl enable --now journey-relay`
7. `curl -s -X POST http://127.0.0.1:8943/events -H 'content-type: application/json' -d '{"event":"journey-relay.smoke-test","attempted":"install check","reason":"verifying the relay is up","context":"manual"}'`
   should return `{"sent":true,...}`.

## Why a dedicated account, not the runner account

Same-UID processes on Linux can read each other's environment via
/proc/<pid>/environ. If the relay ran as `runner` -- the same account every
builder worktree runs under -- a builder could read the Axiom token
straight out of the relay's own environment. The dedicated `axiom-relay`
system account (no login shell, no home directory) keeps the credential
out of reach of builder code without reusing root.
