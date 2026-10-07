# Factory exceptions and installation

## Exceptions list

Every custom piece is recorded here. Only Todd adds or removes an entry.

| # | Exception | Gap it fills | Remove when |
|---|---|---|---|
| 1 | WorkOS cookie identity fix | Self-hosted sign-in gap | Mastra fixes it |
| 2 | Factory wait watcher and Discord webhook | Factory has no phone/desktop alert | Factory adds alerts |
| 3 | Safe sandbox retirement evaluator and cleanup | Factory leaves completed local-sandbox workspaces | Factory provides safe lifecycle cleanup |
| 4 | **Proposed, awaiting Todd's approval (#211):** structured issue-cost snapshot | Retention needs a durable issue-cost ledger | Factory provides one |
| 5 | Web Push device signup and reusable sender (#199) | Stock Factory sends no browser-device notices | Factory provides authenticated device notifications |

## Framework map

| Need | Framework feature | Local source |
|---|---|---|
| Bound DuckDB storage | `DuckDBStore` retention and `prune()` | `@mastra/duckdb`; `app/src/mastra/observability-retention.ts` |
| Scheduled retention | Mastra declarative workflow schedule | `app/observability-retention-schedule.test.mjs` |
| Byte budget | supported retention plus DuckDB `CHECKPOINT` | `ops/factory/trace-retention.mjs` |
| Default retention | `DEFAULT_RETENTION` | `@mastra/code-sdk` `storage-maintenance` |
| Authenticated signup route | Mastra `registerApiRoute` / `requiresAuth` | `@mastra/core/server`; `app/src/mastra/push-routes.ts` |
| Device enrollment and notification | Browser Push API / Service Worker | https://developer.mozilla.org/en-US/docs/Web/API/Push_API; `app/src/mastra/push-routes.ts` |
| Best-effort offline hold | Web Push TTL (RFC 8030 §5.2) | https://datatracker.ietf.org/doc/html/rfc8030#section-5.2; `app/src/mastra/push-sender.ts` |

The supported retention path is wired in `app/src/mastra/observability-store.ts` and
`app/src/mastra/observability-retention.ts`. It is the only prune trigger: there is no systemd
retention unit. The guard measures `observability.duckdb` and its WAL, never deletes rows directly,
and fails closed when safe reclamation cannot be established. See
`docs/research/mastra-intended-use-audit.md` for the framework audit.

## Installation

Run the reviewed installer as the authorized operator:

```sh
bash /path/to/julia-next/ops/factory/install.sh /var/lib/julia-factory/app
```

The installer copies app sources and Factory plan/review skill overrides, preserves service secrets
and runtime data, runs `npm ci`, typecheck and build, restarts the service, and verifies `BUILD_COMMIT`.
Factory 0.19.1 loads project-local `factory-skills` before bundled skills.

### Web Push (#199)

The authorized laptop operator (not a Factory sandbox agent) provisions a VAPID keypair and a
separate random 32-byte AES key outside Git, then applies `ops/factory/push.migration.sql` to the
existing Factory PostgreSQL database **before** enabling the feature. The migration creates
`factory_push_subscriptions` and `factory_push_deliveries` with narrow SELECT/INSERT/UPDATE grants
to the `julia-factory` role; verify those grants and the service role's ability to read/write both
tables. It does not alter the wait watcher or its Discord ledger. Back up before migration;
disabling the feature is reversible by removing `WEB_PUSH_*` settings and reinstalling the previous
app commit; retain the tables until delivery records are no longer needed.

Store these settings only in the protected host service environment (never in Git, CLI arguments,
issue comments, or logs): `WEB_PUSH_PUBLIC_KEY` (base64url VAPID public key),
`WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` (a `mailto:` contact or HTTPS URL),
`WEB_PUSH_ENCRYPTION_KEY` (base64 of exactly 32 random bytes),
`WEB_PUSH_RECIPIENT_USER_ID` (Todd's authenticated Factory user ID, not an email address), and
`WEB_PUSH_ALLOWED_ORIGINS` (comma-separated HTTPS origins for the device push services, checked
against Todd's actual subscriptions). Only that user may enroll devices or receive sends. `DATABASE_URL` and `MASTRACODE_PUBLIC_URL` must also be set;
the Factory must run with authenticated WorkOS sign-in, not `MASTRACODE_AUTH_DISABLED=1`.
**Keep the encryption key:** losing or rotating it without re-enrolling devices makes stored
subscriptions undecryptable. The public VAPID key is displayed on the authenticated signup page;
the private keys never reach the browser.

Install using the command above and verify active `julia-factory-trial.service`, its
`BUILD_COMMIT`, the authenticated `/web/push/signup` page, worker scope `/web/push/`, and two
separately enrolled subscriptions (Todd grants browser permission once on Android and once on
Windows). From the installed app directory, an authorized operator can send a controlled notice
as the service account with its protected environment, passing one JSON object on **stdin**:

```sh
printf '%s\n' '{"line":"Factory test notice","link":"https://FACTORY_ORIGIN/factories/PROJECT_ID/","eventKey":"manual-test-unique-key"}' | sudo systemd-run --pipe --wait --collect -p User=julia-factory -p Group=julia-factory -p WorkingDirectory=/var/lib/julia-factory/app -p EnvironmentFile=/etc/julia-factory/factory.env /usr/bin/node --experimental-strip-types --import ./register-typescript-esm.mjs push-send.mjs
```

Replace the example origin and project path with the actual Factory link before invoking it;
never put secrets or private device endpoints in the JSON or command log. The sender logs only
opaque device ID, hashed event key, and `accepted` (push service accepted), `rejected` (known
non-acceptance with bounded retry on a later invocation), `expired` (subscription disabled), or
`unresolved` (unknown outcome, never automatically replayed). A push-service acceptance is not
a confirmed on-device receipt, and the requested 86400-second TTL does not guarantee display.
Inspect redacted ledger state after sending/restart; Todd must separately confirm the exact line
and link displayed on **both** devices before checking the live UAT box. The October 6 parked
access note remains in effect until that confirmation. See `docs/agents/server-runbook.md` for
the authorized host access route; the Factory builder must not use SSH or sudo.

## Bounded trace storage

Mastra retention uses `DEFAULT_RETENTION` and the app's daily scheduled workflow. The read-only
`ops/factory/trace-retention.mjs` checker measures the real DuckDB artifact; it does not delete
data. No custom weekly reporting timer or notification service remains.
