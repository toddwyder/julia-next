# #156 / #148: reliable Factory wait alerts

## Observed cause

The host received ntfy.sh HTTP 429 with code 42908, its daily message quota
rejection. The watcher logged 15 accepted messages that day; ntfy.sh documents
250 per visitor per day and IP-based visitor accounting. The other consumer of
that quota is unknown. Retrying against the same public quota cannot guarantee
a five-minute delivery.

## Framework map

| Need | Existing feature | Source |
| --- | --- | --- |
| Phone and Windows delivery | Self-hosted ntfy, Android app, PWA Web Push | https://docs.ntfy.sh/install/ and https://docs.ntfy.sh/config/#web-push |
| Public HTTPS | Tailscale Funnel on port 8443, alongside Factory on 443 | https://tailscale.com/docs/features/tailscale-funnel |
| Review handoff | Factory GitHub event rule and stock Review board | https://factory.mastra.ai/configure/boards-and-rules and installed @mastra/factory 0.17.2 source |

## Seams and checks

1. Configure ntfy from its official Ubuntu package with a loopback listener,
   Web Push, persistent state, default-deny access, anonymous read only for
   the existing random topic, and a dedicated local publisher token. Verify
   HTTPS, public write denial, authenticated noncached local publish, and
   repeat setup without key rotation.
2. At the watcher HTTP boundary, publish to loopback with the token, retain
   claim-before-send, and record only safe numeric HTTP/ntfy error codes.
   Tests exercise correct Click link, one accepted send, definite rejection
   without replay, uncertain timeout without replay, and legacy ledger rows.
   Remove the old public-origin retry schedule.
3. At Factory's supported GitHub rule boundary, move Factory-authored PRs
   directly into Reviewing on opening. Stock Review auto-start only starts a
   run after that phase transition. Typecheck and build the Factory app; verify
   the first natural Julia PR.
4. Keep the watcher gated until Todd subscribes the Android app and Windows
   PWA to the private origin. A later naturally occurring actionable Factory
   wait must reach both devices once with the correct link within five minutes.
   Do not manufacture a Factory question or count the origin diagnostic.

## Observability and rollout

The private SQLite ledger and journal retain wait kind, delivery status, and
numeric rejection codes without topic, token, wait key, or private link in
logs. The host change log distinguishes provisioning before PR review from
the later reviewed deployment. Keep #148 and #156 open until live two-device
acceptance, then close PR #157 and #156 with links to the replacement.
