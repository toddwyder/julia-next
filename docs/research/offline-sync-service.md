# Which offline-sync service fits Julia?

Research for Linear JUL-32. Written 2026-09-15 from primary sources only (vendor docs, pricing
pages, licence files, GitHub and npm metadata). Every source was read on 2026-09-15; the
numbered references point to the list at the end. Where a vendor page does not say something,
this document says "not stated" rather than guessing. Plain-language glossary at the end.

## The short answer

**Recommended: PowerSync.** **Runner-up: ElectricSQL (with TanStack DB).**

An *offline-sync service* is the piece that keeps a full copy of Julia's data on each phone
and laptop, lets the app read and write that copy with no internet, and quietly merges the
copies when a connection comes back. ADR 0005 chose this category over Firebase; this note
picks the product.

Why PowerSync, in plain terms:

- **It does exactly the job ADR 0003 asked for, out of the box.** Each device gets a real
  database file (SQLite, the same small database engine phones use everywhere) stored inside
  the browser. Reads and writes work with no connection, and there is no stated limit on how
  long a device can stay offline. Every write goes into an upload queue that survives closing
  the browser. [4][5]
- **"Later change wins, per line" is its documented default.** PowerSync's own conflict page
  describes per-field last-write-wins as the standard pattern, with our own small backend
  function having the final say — which is where "deleting beats editing" gets written down.
  [6]
- **Google sign-in with a two-account allowlist is enforceable on the server.** PowerSync
  checks a signed token on every connection and can be told to accept tokens from an outside
  identity provider (its docs show this for Firebase; the same two settings — a public key
  address and an audience — apply to Google). Which rows a token may see is decided by a
  server-side rule; a token not on the list gets nothing. [7][8][9]
- **Tests fit the OVH runner.** The service is a Node program shipped as a Docker image and
  needs only a Postgres database beside it. No Java. [10][11]
- **Low lock-in.** Julia's data would live in an ordinary Postgres database that we own
  (Neon, which Vercel provisions for free); PowerSync only copies it outward. Exporting is a
  standard database dump. The client libraries are Apache-2.0; the server is
  source-available and becomes Apache-2.0 two years after each release. Stable since
  November 2023, releasing weekly as of September 2026. [2][3][12][13]

Its two weak spots, both fixable by a decision from Todd (see open questions):

- **Rehearsal copies.** The free plan allows two PowerSync instances, so only one rehearsal
  copy can exist at a time next to the real one. The command-line tool can create and destroy
  instances from CI, so an agent can do it — just not for several pull requests at once.
  Paid: $49/month plus $25 per extra instance. [1][14]
- **Free-plan sleep.** "Free projects are deactivated after 1 week of inactivity". What
  "deactivated" means and how reactivation works is not stated. A household that cooks every
  week would never trigger it; a two-week holiday might. [1]

Why ElectricSQL is the runner-up rather than the pick: it is Apache-2.0, older and more
starred, its cloud CLI is built for per-PR environments with automatic teardown, and its
pay-as-you-go plan is effectively $0 at household size. But Electric only syncs *reads*; the
offline *write* path is assembled from a second project (TanStack DB) whose durable storage
shipped as an **alpha** in March 2026, and every conflict rule is code we write ourselves.
That is more parts and more "rough edges agents would work around" — the thing ADR 0005 was
trying to avoid. [15][16][17][18][19]

Candidates that fell out for reasons stated by their own vendors:

- **InstantDB**: the team has joined OpenAI; new sign-ups are closed and all cloud apps shut
  down on 2027-08-31. Self-hosting needs a Java runtime with a 2 GB heap. [20][21]
- **Zero** (Rocicorp): "Zero does not support offline writes" and "is not designed for long
  periods offline". [22]
- **Replicache**: repository archived, read-only, on 2026-06-10. [23]
- **Triplit**: the company was acquired by Supabase on 2025-10-08; the last npm release was
  2025-07-31 and the last commit 2025-09-11. Licence AGPL-3.0. [24][25][26]

**Dexie Cloud** deserves a mention as the *simplest* option: a free plan for three people, Google
sign-in built in, per-property merging, and even built-in presence. It lost on three counts:
the server is closed source with no free local version for tests, creating a database is an
interactive command (bad for agents), and there is no documented way to stop strangers from
signing in (they would see nothing, but they would get an account). [27][28][29][30][31]

## Where no candidate was fully satisfactory

- **Criterion 4 (throwaway copy per PR)**: only Electric Cloud documents per-PR environments
  as a first-class feature. PowerSync can do it from CI but is capped at two instances on the
  free plan. Everyone else needs manual steps or a separate paid plan.
- **Criterion 7 (presence, "who's on which step")**: only InstantDB (leaving) and Dexie Cloud
  (via Yjs awareness) have it built in. With PowerSync or Electric it is modelled as ordinary
  synced rows ("device X is on step 3 of recipe Y"), which is a fine fit for two people but is
  a few seconds slower than a purpose-built presence channel.
- **"Deleting beats editing"**: no vendor documents this rule explicitly. With PowerSync and
  Electric it is one line in our own backend function; with Dexie Cloud and Jazz it is
  "not stated".

## Comparison table

Columns are the ticket's eight criteria. ✓ meets, ~ partly / with our own code, ✗ fails,
"n/s" = not stated by the vendor.

| Candidate | 1 Full copy, offline R+W | 2 Later-wins per line, silent | 3 Google + 2-account allowlist, server-side | 4 Per-PR throwaway copy | 5 Free at household size / if outgrown | 6 Tests on runner, no Java | 7 Presence | 8 Maturity, lock-in, export | Licence | Last release |
|---|---|---|---|---|---|---|---|---|---|---|
| **PowerSync** | ✓ SQLite in browser, persistent upload queue | ✓ per-field LWW documented default; delete rule in our backend | ✓ JWT via JWKS + audience; sync rule denies unlisted `sub`; writes via our function | ~ CLI creates/destroys instances from CI; free plan = 2 instances | ✓ Free: 500 MB, 2 GB/mo, 50 clients; sleeps after 1 week idle. Pro $49/mo | ✓ Docker: Node service + Postgres | ~ as synced rows | ✓ stable since 2023-11; data in our Postgres | Service FSL-1.1-ALv2; SDK Apache-2.0 | service v1.26.1 2026-09-11; web SDK 2.3.1 2026-09-10 |
| **ElectricSQL + TanStack DB** | ~ reads via Electric; durable local store + offline outbox from TanStack DB (persistence alpha 2026-03) | ~ all in our API | ✓ proxy verifies token, sets WHERE server-side; writes via our API | ✓ Cloud CLI: per-PR envs, auto teardown, JSON | ✓ PAYG $0 base, $1/1M writes, <$5 waived | ✓ Docker: Electric + Postgres (wal_level=logical) | ✗ n/s | ✓ since 2022, 10k stars; data in our Postgres | Apache-2.0 | client 1.5.28 2026-09-09 |
| **Dexie Cloud** | ✓ IndexedDB, background sync | ✓ per-property LWW; delete rule n/s | ~ Google OAuth built in; realm ACL server-side; no sign-in allowlist documented | ✗ `create` is interactive; delete has 1-month grace; 10 DBs free | ✓ Free: 3 users, 100 MB. Pro €0.12/user/mo | ✗ server closed; no free local server | ✓ Yjs awareness | ~ Dexie.js since 2014, Apache-2.0; server proprietary; CLI export zip/json | Client Apache-2.0; server proprietary | Dexie 4.4.6 / addon 4.4.15 2026-09-10 |
| **Jazz** | ✓ IndexedDB in SharedWorker, queued writes | ✓ per-field LWW with hybrid clock; delete rule n/s | ✓ external JWT via JWKS; permission rules on `iss`+`sub` | ~ app ID per env; programmatic creation n/s | ✓ usage-based with free allowances (v2); Starter $0 (v1) | ✓ `npx jazz-tools@alpha server --in-memory` | n/s | ✗ v2 is alpha (2.0.0-alpha.55), repo Jan 2026 | MIT (README); GitHub shows no SPDX | v1 0.20.19; v2 alpha.55; pushed 2026-09-15 |
| **Firestore** (baseline) | ✓ IndexedDB persistent cache; Chrome/Safari/Firefox | ~ `update()` merges fields; delete rule n/s | ✓ Google built in; rules on `request.auth.token.email` | ~ named DBs via CLI, but only one free per project | ✓ Spark: 1 GiB, 50k reads/day | ✗ emulator needs JDK 11+ | ✗ "doesn't natively support presence" | ~ since 2017; proprietary; export via GCS | SDK Apache-2.0; service proprietary | firebase 12.19.0 2026-09-09 |
| InstantDB | (not assessed further) | | | | ✗ sign-ups closed; cloud ends 2027-08-31 | ✗ JVM, 2 GB heap | ✓ built in | ✗ vendor leaving | Apache-2.0 | react 1.0.67 2026-08-31 |
| Zero | ✗ "does not support offline writes" | | | | | | | alpha per roadmap page | Apache-2.0 | 1.9.0 (npm) 2026-09 |
| Replicache | — | | | | | | | ✗ archived 2026-06-10 | roci.dev terms | 15.3.0 2026-05 |
| Triplit | ✓ IndexedDB/memory | ✓ property-level | n/s | n/s | n/s | ✓ Node server | n/s | ✗ dormant since 2025-09; acquired | AGPL-3.0 | 1.0.50 2025-07-31 |
| Turso (browser sync) | ~ OPFS; sync-browser is 0.1.5-pre | ✗ "last push wins", not per line | n/s (needs proxy) | ✓ 100 DBs free | ✓ Free 5 GB | ✓ single binary | ✗ | ✗ beta: "no durability guarantees" | MIT | sync-browser 0.1.5-pre.2 2026-03-31 |
| LiveStore | ~ event-sourced local SQLite | ~ event replay | n/s | n/s | needs Cloudflare/Electric/S2 backend | ~ | ✗ | ✗ 0.4/0.5-dev, "docs still work in progress" | Apache-2.0 | 0.4.0 2026-09-13 |
| Evolu | ✓ SQLite + CRDT | ✓ CRDT merge | ✗ identity is a mnemonic, not a Google account | n/s | self-host relay | ✓ | ✗ | ~ since 2022 | MIT | web 3.1.2 2026-09-06 |
| RxDB | ✓ (production storages are paid) | ~ you write the server | ~ you write the server | ~ | ✗ OPFS/IndexedDB storages Pro $99/mo | ✓ | ✗ | ✓ since 2016 | Apache-2.0 core; premium plugins | 17.5.0 2026-08-20 |
| Ditto | ✓ | n/s | n/s | n/s | ✓ Free: 10 devices, 2 GB | ✗ closed source | ✗ | ✗ closed, enterprise-oriented | proprietary | n/s |

## PowerSync

*What it is.* A sync layer that sits between a database we own (Postgres, MongoDB, MySQL,
SQL Server) and a SQLite copy inside each app. "The PowerSync Service replicates data from
your backend database, partitions it based on what data each user should receive, and streams
real-time updates to clients through the PowerSync client SDK." [4]

Facts:

- Client storage on the web is SQLite via wa-sqlite; the default IndexedDB file system
  persists across restarts, OPFS variants also persist, and an in-memory option exists for
  tests. Multiple tabs share one database through a shared web worker. "The SDK places every
  write to the SQLite database in an upload queue and uploads the queue to your backend when
  the user is connected." [5]
- Conflicts: "server-authoritative reconciliation"; "the developer's app backend therefore
  dictates how mutations from clients are processed". Documented default: "For multiple
  concurrent updates, the last update (as received by the server) to each individual field
  wins." Upload queue entries are PUT (new row), PATCH (id + changed columns), DELETE (id). [6]
- Auth: the service validates JWTs signed RS256/ES256/EdDSA (HS256 dev only); keys come from
  a JWKS URL or are pasted into the config; `sub` is the user ID; `aud` must match the
  configured audience; tokens must expire within 24 hours (60 minutes recommended). The
  Firebase page shows a third-party issuer being accepted with just a JWKS URI and an
  audience. [7][8]
- Access: parameter queries in sync rules use `request.user_id()` (the token's `sub`) and
  `request.jwt()`; "When a Parameter Query's WHERE condition excludes a user, that bucket
  yields no results for them." [9]
- Self-hosting: Docker image `journeyapps/powersync-service`; bucket storage is MongoDB or
  Postgres; one source connection per instance; config is YAML with `replication`, `storage`,
  `sync_config`, `client_auth`. Quick start is a Docker Compose stack, also set up by the
  CLI. [10][11]
- CLI: "create instances, deploy and pull config, run all Cloud commands";
  `powersync link cloud --create` and `powersync destroy`; a "Deploying From CI (e.g. GitHub
  Actions)" section. For self-hosted servers the CLI only offers a subset (status, schema). [14]
- Pricing (PowerSync Cloud): Free $0 — "Up to 2 GB data synced / month", "Up to 500 MB of
  data hosted on PowerSync Service", "Up to 50 peak concurrent clients", "Up to 2 PowerSync
  Service instances", "Free projects are deactivated after 1 week of inactivity". Pro from
  $49/month — 30 GB synced, 10 GB hosted, 1,000 clients, "2 included. Then $25pm per
  instance". Team from $599. Self-hosted Open Edition free. [1]
- On the free plan exceeding 50 clients returns HTTP 429 to new connections; existing ones
  keep syncing. [32]
- Licence: service repo is "Functional Source License, Version 1.1, with Apache License v2.0
  Future License (FSL-1.1-ALv2)" — internal use allowed, "Competing Use" (selling it as a
  service) forbidden, converts to Apache-2.0 two years after each release. The JavaScript SDKs
  are Apache-2.0. [2][3]
- Activity: service v1.26.1 released 2026-09-11, v1.26.0 2026-09-04, repo pushed 2026-09-15;
  `@powersync/web` 2.3.1 released 2026-09-10. v1.0 "officially out of beta. Production use
  cases are fully supported" on 2023-11-30. [3][12][13]
- Presence: no presence feature appears in the docs; the vendor's collaborative-editor demo
  models shared cursors as synced data. [33]

Against the criteria:

1. **Full copy, offline reads and writes, indefinitely.** Met. Julia's whole collection is
   small text, so the "sync everything in one bucket" shape is the simplest possible rule.
   No stated limit on offline duration; the queue lives in the browser's storage. [5]
2. **Later-wins per line, silent, delete beats edit.** Met with a rule we write once. Each
   ingredient line, step and list item is a row; PATCH carries only changed columns, and the
   server applies last-received-wins per field. "Deleting beats editing" is written in the
   upload function: apply DELETE, and ignore a PATCH whose row is gone. No conflict UI exists
   to remove. [6]
3. **Google sign-in, two-account allowlist, server-side.** Met. Two documented routes:
   (a) point PowerSync's JWKS URI at Google's public keys and set the audience to Julia's
   Google client ID, so the browser's Google ID token is the PowerSync token (this mirrors the
   Firebase page; our inference that Google's keys work the same way is not itself a vendor
   statement); or (b) the documented "custom" route, where a small Vercel function checks the
   Google token and mints a short PowerSync token. Either way the allowlist is a two-row
   `household_accounts` table in Postgres and one parameter query:
   `SELECT id AS account FROM household_accounts WHERE id = request.user_id()` — anyone else
   syncs nothing. Writes go through the same Vercel function, which checks the same table
   before touching Postgres. Both checks are on the server; the app never holds the list. [7][8][9]
4. **Rehearsal copy per PR.** Partly. The data half is free and automatic: Vercel's Neon
   integration "creates branch `preview/<git-branch>`" per preview deployment, and Neon's free
   plan allows 10 branches per project (note: Neon deletes the branch only when Vercel deletes
   the preview, six months by default, so the agent should delete branches explicitly). [34][35]
   The sync half is the constraint: an agent can run `powersync link cloud --create`, deploy
   sync rules, and `powersync destroy` from CI, but the free plan allows two instances, so at
   most one rehearsal copy exists at a time. [1][14]
5. **Cost.** Free plan covers a household many times over (a few hundred text recipes is
   well under 500 MB; two people are 2 of 50 clients). Risk: the one-week inactivity sleep
   (behaviour and reactivation not stated). If outgrown: Pro $49/month. [1]
6. **Tests on the runner.** Met. `docker compose` with `journeyapps/powersync-service` and a
   Postgres container (which can double as bucket storage); the web SDK has an in-memory
   file system for unit tests and there is a Node SDK for integration tests. No Java. [5][10][11][36]
7. **Presence.** Not built in. Model as a `device_presence` row per device (recipe, step,
   updated_at) synced like everything else. [33]
8. **Maturity and lock-in.** Stable since 2023-11, releases weekly, 723/382 stars on the two
   repos. Data is ours in Postgres; export is a `pg_dump` or a JSON endpoint. Licence risk is
   low: the SDK is Apache-2.0 and the service converts to Apache-2.0 on a rolling two-year
   basis. [2][3][12][13]

## ElectricSQL (with TanStack DB)

*What it is.* "a read-path sync engine for Postgres" that "syncs data out of Postgres into
local clients over HTTP using a primitive called a Shape". Writes are "patterns for writing
data back through your API". [15]

Facts:

- Write patterns documented: online writes; optimistic state (not persisted); "shared
  persistent optimistic state" (survives reloads); "through the database sync" (a shadow
  table in PGlite, an in-browser Postgres). [17]
- PGlite in the browser: "We would recommend using the IndexedDB VFS in the browser at the
  current time as the OPFS VFS is not supported by Safari." [37]
- TanStack DB 0.6 (2026-03-25) added SQLite-backed persistence in the browser as "the first
  *alpha* release of persistence". `@tanstack/offline-transactions` 1.0.56 (MIT, published
  2026-09-14) is "Offline-first transaction capabilities for TanStack DB" — a persistent outbox
  in IndexedDB with retry. TanStack DB core is 0.9.2, MIT. [18][19][38]
- Auth: "Shapes are just resources... You can authorise access to them exactly the same way
  you would any other web resource." Proxy pattern: your endpoint validates the user, sets the
  table and WHERE clause server-side, returns 401/403 otherwise. Gatekeeper pattern: a
  shape-scoped token. [16]
- Running locally: Docker image `electricsql/electric`, "any Postgres ... that has logical
  replication enabled", `wal_level=logical`, a provided `docker-compose.yaml`. Memory guidance
  not stated. [39]
- Electric Cloud pricing: Pay-as-you-go "$0/month base (under $5/month waived)", "$1 per 1M
  writes", "$0.10 per GB·month" retention, 10 databases; Pro $249/month; Scale $1,999/month;
  all plans "unlimited reads, egress, and fan-out". [40]
- Electric Cloud CLI: "full control over your Cloud resources, from provisioning Electric Sync
  sources and Electric Streams services to managing per-PR environments in CI/CD pipelines",
  automatic teardown when PRs close, JSON output, token auth for scripts. [41]
- Licence Apache-2.0; repo created 2022-06-01; 10,363 stars; pushed 2026-09-09;
  `@electric-sql/client` 1.5.28 published 2026-09-09. [42]
- Presence: not stated (a `y-electric` package exists for Yjs documents; awareness not
  stated). [42]

Against the criteria:

1. Partly. Reads sync well; a durable local copy plus offline writes requires TanStack DB's
   alpha persistence and the offline-transactions outbox, or PGlite (an entire Postgres in the
   browser, heavier than SQLite, and its fastest storage does not work on Safari). [17][18][37]
2. With our own code: every write lands in our API (a Vercel function) that applies per-field
   last-wins and delete-beats-edit in Postgres. Nothing is "silent" until we write it. [15][17]
3. Met, by our proxy: verify the Google token, look up the two-row allowlist, set the shape's
   WHERE clause server-side, 403 otherwise. [16]
4. Met and best in class: the CLI is designed for per-PR environments with teardown, plus the
   same Neon branch per preview. [34][41]
5. Met: effectively $0 (writes at household scale are far below $5/month). Needs a Postgres
   host (Neon free). [35][40]
6. Met: Electric + Postgres in Docker; no Java. Memory not stated. [39]
7. Not stated. Same "presence as rows" workaround as PowerSync.
8. Strong: Apache-2.0, four years old, very active; data in our Postgres. The lock-in risk
   moves to TanStack DB's young persistence layer. [18][42]

## Dexie Cloud

*What it is.* A hosted sync and auth server for Dexie.js, the long-standing IndexedDB
library. "Turn your App into a SaaS in minutes"; "used in production by multiple SaaS
companies". [31]

Facts:

- Conflicts: "If two different clients update the same property, the latest performed
  operation will overwrite the previous one" (client timestamps adjusted to server time).
  `update` operations on different properties coexist; `put` replaces whole objects.
  "Where-based modify- and delete-operations persist on the server until all clients have
  synced". [30]
- Auth: default email one-time-password; OAuth "Google, GitHub, Microsoft, Apple, Facebook,
  LinkedIn, Discord" configured in Dexie Cloud Manager with a redirect URI at
  `https://<your-db-id>.dexie.cloud/oauth/callback/google`; custom auth where "your
  existing server-side authentication server ... using your client_id and client_secret can
  request token from Dexie Cloud for the user you have already authenticated". Whether the
  default OTP login can be switched off is not stated. [27][28]
- Access control: realms ("an access controlled partition of data"), members, roles;
  private data is per user by default; a public realm `rlm-public` is visible to everyone.
  [29]
- CLI: `npx dexie-cloud create` "Interactive only"; `npx dexie-cloud delete <url>` marks a
  database for deletion "with a 1-month grace period"; `export` writes `.zip` or `.json`
  non-interactively; `whitelist` manages allowed web origins. REST API: records, users, blobs;
  no create/delete database. [43][44]
- Pricing: Free €0 — 3 production users, 50,000 evaluation users, 10 databases, 100 MB,
  10 connections; Pro €0.12 per user/month; self-hosted Business €3,495 one-time (binary,
  "no source code access"), Enterprise €7,995 (full source). [45]
- Presence: "Native Y.js integration" with "Awareness protocol support" via `y-dexie` plus the
  cloud addon. [31][46]
- Licence: Dexie.js and `dexie-cloud-addon` Apache-2.0; server proprietary. Dexie.js 4.4.6
  released 2026-09-10, repo since 2014-02, 14,579 stars; addon 4.4.15 published 2026-09-10. [47]

Against the criteria: 1 ✓; 2 ✓ (delete rule not stated); 3 partly — Google sign-in is
built in and household data is protected server-side by realm membership, but nothing
documented stops a third Google account from signing in and getting an empty private realm;
4 ✗ (interactive create, month-long delete); 5 ✓✓ (free for three people; €0.24/month if two
seats were ever charged); 6 ✗ (no free local server; tests could use Dexie with a fake
IndexedDB but could not exercise sync); 7 ✓; 8 mixed (client open, server closed, single
vendor, export is a readable zip/json).

## Jazz

*What it is.* "a local-first relational database with row-level permissions, real-time sync,
and offline support". The current site is "Announcing the Jazz v2 alpha!"; npm `jazz-tools`
has `latest` 0.20.19 (v1, "classic") and `alpha` 2.0.0-alpha.55. [48][49][50]

Facts:

- Sync: "In browser persistent mode, a dedicated worker hosts that local durable copy in
  IndexedDB"; writes "applied locally immediately"; on reconnect "queued writes are sent".
  Conflicts: "last-writer-wins (LWW) with deterministic hybrid logical clock ordering"; "If two
  peers update different fields, both changes can still be preserved". Deletes: not stated
  beyond "delete state" metadata. [51][52]
- Auth (v2): "Any provider that issues JWTs and exposes a JWKS endpoint will work"; "Jazz
  records the exact JWT `iss` and `sub` pair as the acting identity"; permissions can use
  `session.where(...)`. Google is not named; Clerk, Auth0, Firebase, Better Auth, WorkOS are.
  [53]
- Server: `npx jazz-tools@alpha server <APP_ID>`; `--in-memory` "data is lost when the process
  exits"; self-hosting supported; app IDs generated on the hosted cloud, unclaimed ones deleted
  after 14 days. [54]
- Pricing: v2 site lists compute "$0.039 per hour of 2GB RAM instance", storage "$0.45 per
  GB/month", egress "$0.09 per GB out", with "1GB RAM instance always included", "1GB/month
  included", "5GB/month included". Classic pricing: Starter $0 (10 GB, 100 MAU), Indie $4,
  Pro from $19. [49][55]
- Licence: README "Jazz is MIT licensed"; GitHub reports no SPDX identifier. Repo
  `garden-co/jazz2` created 2026-01-04, 190 stars, pushed 2026-09-15. [50][56]

Against the criteria: 1 ✓; 2 ✓ (delete rule n/s); 3 ✓ on paper (Google issues JWTs with a
JWKS endpoint; allowlist as a permission rule on `sub`), unverified in practice; 4 partly
(app ID per environment; programmatic creation n/s); 5 ✓; 6 ✓✓ (lightest local server of all);
7 n/s; 8 ✗ — v2 is an alpha with a new API on a nine-month-old repo, and v1 is the thing the
vendor is replacing. Too early to bet a restart on.

## Firebase Firestore (the baseline to beat)

Facts:

- Offline: "For the web, offline persistence is disabled by default"; IndexedDB; single- or
  multi-tab; `CACHE_SIZE_UNLIMITED` available; queued local changes sync on reconnect;
  "Offline persistence is supported only by the Chrome, Safari, and Firefox web browsers". [57]
- Updates: `update()` changes "only specified fields without overwriting the whole document";
  `set(..., {merge: true})` similar. [58]
- Auth: Google sign-in built in. Rules: `allow write: if request.auth.token.email ==
  "admin@example.com"`. Blocking sign-in itself needs "Firebase Authentication with Identity
  Platform". [59][60][61]
- Databases: "You can create multiple Cloud Firestore databases per project";
  `firebase firestore:databases:create` / `gcloud firestore databases delete`; "Cloud Firestore
  allows exactly one free database per project". [62][63]
- Free (Spark): "Stored data: 1 GiB", "Document reads: 50,000 per day", writes and deletes
  20,000 per day, "Outbound data transfer: 10 GiB per month". [63]
- Emulator: "Java: JDK version 11 or higher". [64]
- Presence: "Cloud Firestore doesn't natively support presence". [65]
- SDK `firebase` 12.19.0 released 2026-09-09, Apache-2.0; service proprietary. [66]

Against the criteria: 1 ✓ (ADR 0005 notes the rough edges); 2 partly (field merges; delete
rule n/s; "line as document" needed); 3 ✓ for data access; 4 partly (extra databases are not
free); 5 ✓; 6 ✗ (Java — the reason ADR 0005 moved away); 7 ✗; 8 proprietary, mature.

## Ruled out on the vendor's own statements

- **InstantDB.** "The Instant team is joining OpenAI." "New signups are closed"; existing
  users "must migrate away from Instant Cloud" within 12 months; "August 31st, 2027: All cloud
  apps will shut down". "All of Instant is open source" (Apache-2.0). Self-hosting: "On the 4 GB
  VPS from this guide, start with a 2 GB heap: ... JAVA_OPTS: -Xmx2g -Xms2g"; the repo is
  roughly half Clojure. It had the best presence API of the set ("an object that each peer
  shares with every other peer"). [20][21][67][68]
- **Zero.** "Zero does not support offline writes." "Zero is not designed for long periods
  offline." Offline writes: "it's not a priority right now". Roadmap page still reads "working
  toward a *beta* release of Zero late 2025 or early 2026"; npm `@rocicorp/zero` is 1.9.0,
  Apache-2.0, with 1.11 canaries tagged. [22][69][70]
- **Replicache.** "This repository was archived by the owner on Jun 10, 2026. It is now
  read-only." Rocicorp (2024-06-19): "We will continue maintaining Replicache while we build
  out Zero. Once Zero is generally available, we'll be encouraging Replicache users to
  migrate". npm licence field is "https://roci.dev/terms.html". [23][71][72]
- **Triplit.** Supabase, 2025-10-08: "Triplit joins Supabase"; the co-founder will work on
  "making Supabase an excellent partner to other syncing systems" and "further open-sourcing the
  Triplit codebase". Last npm release `@triplit/client` 1.0.50 on 2025-07-31 (AGPL-3.0-only);
  last commit 2025-09-11. On paper it fit well: "conflict resolution at the property level",
  "Offline-mode with automatic reconnection", pluggable IndexedDB / in-memory storage, a Node
  server. [24][25][26][73]

## Considered and set aside

- **Turso (browser sync).** Offline sync public beta (2025-03-31): "no durability guarantees,
  which means data loss is possible"; "not yet recommended for production use". Browser
  package `@tursodatabase/sync-browser` is 0.1.5-pre.2 (2026-03-31). Conflicts: "last push
  wins" — per push, not per line. Free plan is generous (100 databases, 5 GB) and would make
  per-PR copies trivial; revisit in a year. [74][75][76][77]
- **LiveStore.** Event-sourced local SQLite (every change is a logged event); 0.4.0 / 0.5.0-dev,
  Apache-2.0, "docs ... still work in progress"; needs a sync backend (Cloudflare Workers,
  ElectricSQL or S2). [78][79]
- **Evolu.** MIT, SQLite + CRDT, self-hosted relay; identity is a generated mnemonic
  (recovery phrase) per owner, not a Google account, so criterion 3 does not fit its model.
  [80][81]
- **RxDB.** Apache-2.0 core, but the production browser storages ("RxStorage OPFS",
  "RxStorage IndexedDB") are in the Pro tier at $99/month, and you supply the server. [82]
- **Ditto.** Closed source; Free plan 10 cloud device connections, 2 GB; enterprise-oriented.
  [83]
- **Convex, Supabase.** Optimistic updates only; not offline-first databases. [84]

## Open questions for Todd (for JUL-33)

1. **Accept PowerSync as the sync service?** (Runner-up Electric if not.) ADR 0005 would be
   amended with the name.
2. **One rehearsal copy at a time, or pay?** On PowerSync's free plan two instances exist:
   the real Julia and one rehearsal copy. Pull requests would take turns for their rehearsal
   (the runner already works one step at a time). The alternative is Pro at $49/month plus $25
   per extra instance. Which does he prefer?
3. **Is the free plan's one-week sleep acceptable?** If the household does not open Julia for
   a week, the sync service may be "deactivated" (exact effect and reactivation not stated).
   The app keeps working offline either way. Options: accept and ask PowerSync support what
   reactivation looks like; or a scheduled ping to keep it awake; or self-host the Open
   Edition somewhere other than the runner (which ADR 0005 says never hosts the app).
4. **Where does the Postgres live?** Neon via Vercel's marketplace is free and gives a data
   branch per preview automatically. Supabase is PowerSync's most-documented partner but is a
   second vendor with its own auth. Recommendation: Neon.
5. **Google sign-in route.** Google's token straight into PowerSync (fewer parts, hourly token
   refresh in the browser) or a tiny Vercel function that checks Google and mints a PowerSync
   token (the documented "custom" route, easier to reason about). This is a build-time detail
   an agent can decide, but Todd should know both exist.
6. **Presence as rows is enough?** "Who's on which step" would update within a few seconds
   through normal sync rather than instantly. Acceptable for two people?
7. **Backup and export (JUL-30).** With PowerSync the answer is "a plain database dump from
   Neon plus a JSON export button". Does that satisfy the export ticket, or should the export
   format be decided first?

## Glossary

- **Sync service / sync engine** — the software that keeps copies of the data on several
  devices the same, and merges changes made while offline.
- **SQLite** — a small, single-file database engine; here it runs inside the browser.
- **IndexedDB / OPFS** — two places a browser can store data on the device permanently.
- **Postgres** — a standard server database; Julia's "real" data would live in one we own.
- **Neon** — a hosted Postgres with a free plan and "branches" (cheap copies of the data).
- **JWT / JWKS** — a signed sign-in token, and the public address where its signature can be
  checked. Google issues JWTs when someone signs in.
- **`sub` / audience** — the user ID inside a token, and the "this token is for X" field.
- **Sync rules / parameter query** — PowerSync's server-side rule saying which rows a token
  may receive.
- **Last-write-wins (LWW), per field** — when two devices edit the same thing offline, the
  edit that reaches the server last is kept, decided separately for each field/line.
- **CRDT** — a data structure designed so concurrent edits always merge without a conflict
  screen.
- **Presence / awareness** — live "who is here, where" information that is not saved.
- **Docker image / Docker Compose** — a packaged program and a file that starts several of
  them together, used for tests on the runner.
- **Logical replication (`wal_level=logical`)** — a Postgres setting that lets a sync service
  watch for changes.
- **FSL (Functional Source License)** — source is public and free to use, but you may not
  resell it as a competing service; converts to Apache-2.0 after two years.
- **Apache-2.0 / MIT / AGPL-3.0** — open-source licences; the first two are permissive, AGPL
  requires publishing modifications of server code you run.
- **Alpha / beta** — vendor's own label for "not finished" software.

## Sources (all accessed 2026-09-15)

1. PowerSync pricing — https://www.powersync.com/pricing
2. PowerSync service LICENSE (FSL-1.1-ALv2) — https://github.com/powersync-ja/powersync-service/blob/main/LICENSE
3. GitHub API: powersync-ja/powersync-js (Apache-2.0, pushed 2026-09-15, releases 2026-09-10) and powersync-ja/powersync-service (releases v1.26.1 2026-09-11, v1.26.0 2026-09-04) — https://api.github.com/repos/powersync-ja/powersync-js , https://api.github.com/repos/powersync-ja/powersync-service/releases
4. PowerSync overview — https://docs.powersync.com/intro/powersync-overview
5. PowerSync JavaScript Web SDK (storage, VFS, multi-tab, upload queue) — https://docs.powersync.com/client-sdk-references/javascript-web
6. PowerSync: handling update conflicts — https://docs.powersync.com/usage/lifecycle-maintenance/handling-update-conflicts
7. PowerSync: custom authentication (JWT algorithms, JWKS, claims) — https://docs.powersync.com/installation/authentication-setup/custom
8. PowerSync: Firebase Auth (third-party JWKS + audience) — https://docs.powersync.com/installation/authentication-setup/firebase-auth
9. PowerSync: parameter queries — https://docs.powersync.com/usage/sync-rules/parameter-queries
10. PowerSync self-hosting: getting started — https://docs.powersync.com/self-hosting/getting-started
11. PowerSync self-hosting: service setup (storage, replication, config) — https://docs.powersync.com/self-hosting/installation/powersync-service-setup
12. PowerSync v1.0 stable release (2023-11-30) — https://www.powersync.com/blog/powersync-v1-0-stable-release
13. PowerSync service releases — https://github.com/powersync-ja/powersync-service/releases
14. PowerSync CLI (instances, deploy, CI) — https://docs.powersync.com/usage/tools/cli
15. Electric: introduction — https://electric.ax/docs/intro
16. Electric: auth guide (proxy, gatekeeper) — https://electric.ax/docs/guides/auth
17. Electric: writes guide (four patterns) — https://electric.ax/docs/guides/writes
18. TanStack DB 0.6 announcement (2026-03-25, persistence alpha) — https://tanstack.com/blog/tanstack-db-0.6-app-ready-with-persistence-and-includes
19. npm: @tanstack/offline-transactions 1.0.56 (MIT, 2026-09-14) — `npm view @tanstack/offline-transactions`
20. InstantDB announcement (joining OpenAI; shutdown dates) — https://www.instantdb.com/pricing
21. InstantDB self-hosting (JAVA_OPTS, 4 GB VPS) — https://www.instantdb.com/docs/self-hosting and https://www.instantdb.com/docs/self-hosting/vps
22. Zero: offline — https://zero.rocicorp.dev/docs/offline
23. GitHub: rocicorp/replicache (archived 2026-06-10) — https://github.com/rocicorp/replicache
24. Supabase blog: Triplit joins Supabase (2025-10-08) — https://supabase.com/blog/triplit-joins-supabase
25. npm: @triplit/client 1.0.50 (AGPL-3.0-only, 2025-07-31) — `npm view @triplit/client`
26. GitHub API: aspen-cloud/triplit (AGPL-3.0, last commit 2025-09-11) — https://api.github.com/repos/aspen-cloud/triplit/commits
27. Dexie Cloud: authentication — https://dexie.org/cloud/docs/authentication
28. Dexie Cloud: db.cloud.configure() — https://dexie.org/cloud/docs/db.cloud.configure()
29. Dexie Cloud: access control — https://dexie.org/cloud/docs/access-control
30. Dexie Cloud: consistency — https://dexie.org/cloud/docs/consistency
31. Dexie Cloud product page — https://dexie.org/cloud/
32. PowerSync usage and billing FAQ — https://docs.powersync.com/resources/usage-and-billing/usage-and-billing-faq
33. PowerSync blog: collaborative text editing (presence modelled as data) — https://www.powersync.com/blog/collaborative-text-editing-over-powersync
34. Neon: Vercel-managed integration (preview branches) — https://neon.com/docs/guides/vercel-managed-integration
35. Neon pricing (free plan) — https://neon.com/pricing
36. PowerSync Node.js SDK — https://docs.powersync.com/client-sdk-references/node
37. PGlite filesystems (IndexedDB, OPFS, Safari) — https://pglite.dev/docs/filesystems
38. npm: @tanstack/db 0.9.2 (MIT, 2026-09-14) — `npm view @tanstack/db`
39. Electric: installation (Docker, logical replication) — https://electric.ax/docs/guides/installation
40. Electric Cloud pricing — https://electric.ax/pricing
41. Electric Cloud CLI — https://electric.ax/cloud/cli
42. GitHub API: electric-sql/electric (Apache-2.0, created 2022-06-01, pushed 2026-09-09); npm @electric-sql/client 1.5.28 — https://api.github.com/repos/electric-sql/electric
43. Dexie Cloud CLI — https://dexie.org/cloud/docs/cli
44. Dexie Cloud REST API — https://dexie.org/cloud/docs/rest-api
45. Dexie Cloud pricing — https://dexie.org/cloud/pricing
46. y-dexie (Yjs, awareness) — https://dexie.org/docs/Y.js/y-dexie
47. GitHub API: dexie/Dexie.js (Apache-2.0, v4.4.6 2026-09-10); npm dexie-cloud-addon 4.4.15 — https://api.github.com/repos/dexie/Dexie.js
48. Jazz docs home — https://jazz.tools/docs
49. Jazz home (v2 alpha, pricing) — https://jazz.tools/
50. npm: jazz-tools dist-tags (latest 0.20.19, alpha 2.0.0-alpha.55) — `npm view jazz-tools dist-tags`
51. Jazz: how sync works — https://jazz.tools/docs/concepts/how-sync-works
52. Jazz: local-first data model — https://jazz.tools/docs/concepts/local-first-data-model
53. Jazz: auth provider integration — https://jazz.tools/docs/recipes/auth/auth-provider-integration
54. Jazz: server setup — https://jazz.tools/docs/getting-started/server-setup
55. Jazz classic pricing — https://classic.jazz.tools/pricing
56. GitHub: garden-co/jazz README (MIT) and API for garden-co/jazz2 — https://github.com/garden-co/jazz , https://api.github.com/repos/garden-co/jazz2
57. Firestore: enable offline data — https://firebase.google.com/docs/firestore/manage-data/enable-offline
58. Firestore: add data / update fields — https://firebase.google.com/docs/firestore/manage-data/add-data
59. Firebase Auth: Google sign-in on web — https://firebase.google.com/docs/auth/web/google-signin
60. Firebase security rules and auth — https://firebase.google.com/docs/rules/rules-and-auth
61. Firebase Auth blocking functions (Identity Platform) — https://firebase.google.com/docs/auth/extend-with-blocking-functions
62. Firestore: manage databases — https://firebase.google.com/docs/firestore/manage-databases
63. Firestore pricing (free quota, one free database) — https://firebase.google.com/docs/firestore/pricing
64. Firebase Local Emulator Suite prerequisites — https://firebase.google.com/docs/emulator-suite/install_and_configure
65. Firestore presence solution — https://firebase.google.com/docs/firestore/solutions/presence
66. GitHub API: firebase/firebase-js-sdk (release firebase@12.19.0 2026-09-09); npm firebase 12.19.0 Apache-2.0 — https://api.github.com/repos/firebase/firebase-js-sdk/releases
67. GitHub API: instantdb/instant languages (Clojure) — https://api.github.com/repos/instantdb/instant/languages
68. InstantDB: presence and topics — https://www.instantdb.com/docs/presence-and-topics
69. Zero: roadmap — https://zero.rocicorp.dev/docs/roadmap
70. npm: @rocicorp/zero 1.9.0 (Apache-2.0); GitHub tags zero/v1.11.0-canary.* — `npm view @rocicorp/zero`, https://api.github.com/repos/rocicorp/mono/tags
71. Rocicorp blog: Retiring Reflect (2024-06-19) — https://rocicorp.dev/blog/retiring-reflect
72. npm: replicache 15.3.0 (licence "https://roci.dev/terms.html") — `npm view replicache`
73. Triplit README — https://raw.githubusercontent.com/aspen-cloud/triplit/main/README.md
74. Turso: offline sync public beta (2025-03-31) — https://turso.tech/blog/turso-offline-sync-public-beta
75. Turso: in the browser (2025-10-08) — https://turso.tech/blog/introducing-turso-in-the-browser
76. Turso sync docs ("last push wins") — https://docs.turso.tech/sync ; npm @tursodatabase/sync-browser 0.1.5-pre.2 (MIT, 2026-03-31)
77. Turso pricing — https://turso.tech/pricing
78. LiveStore docs — https://docs.livestore.dev/
79. GitHub API: livestorejs/livestore (Apache-2.0, v0.5.0-dev.0 2026-08-24); npm @livestore/livestore 0.4.0 — https://api.github.com/repos/livestorejs/livestore
80. Evolu home — https://www.evolu.dev/
81. Evolu docs (owners, mnemonic) — https://www.evolu.dev/docs and https://www.evolu.dev/docs/local-first
82. RxDB premium — https://rxdb.info/premium/
83. Ditto pricing — https://www.ditto.com/pricing
84. Convex: optimistic updates — https://docs.convex.dev/client/react/optimistic-updates
85. Firebase emulator / ADR context: docs/adr/0005-technical-foundation.md and docs/research/orca-ovh.md (branch research/orca-ovh) in this repo.
