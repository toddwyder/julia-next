# journey-relay -- the trusted Axiom-delivery boundary

Builders (agent worktrees on the runner) must never hold the Axiom
credential. This relay is the one process that does.

## One-time placement (root, on the runner -- not in chat, not in this repo)

1. Create the dataset and an ingest-only token in the existing Axiom
   account, scoped to that dataset only (not a full-access API token).
2. `install -m 0400 -o root -g root /dev/null /etc/orca-runner/journey-axiom.env`
   then fill it in from ops/journey-relay/journey-axiom.env.example with the
   real dataset name and token. Never commit this file.
3. `cp ops/journey-relay/journey-relay.service /etc/systemd/system/`
4. `systemctl daemon-reload && systemctl enable --now journey-relay`
5. `curl -s -X POST http://127.0.0.1:8943/events -H 'content-type: application/json' -d '{"event":"journey-relay.smoke-test","attempted":"install check","reason":"verifying the relay is up","context":"manual"}'`
   should return `{"sent":true,...}`.

## Why root, not the runner account

Same-UID processes on Linux can read each other's environment via
/proc/<pid>/environ. If the relay ran as 'runner' -- the same account every
builder worktree runs under -- a builder could read the Axiom token
straight out of the relay's own environment. Running the relay as root
(the only other account on this box today) keeps the credential out of
reach of builder code. A dedicated low-privilege service account would be
cleaner than reusing root; that's future work, not this ticket -- see
JUL-59.
