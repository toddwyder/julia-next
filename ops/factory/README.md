# Factory exceptions list and installation

## Exceptions list

Every place we use our own piece instead of Factory's, Mastra's or GitHub's (ADR 0009). Only
Todd adds or removes an entry. Anything custom that is not listed here is not approved.

| # | Exception | Gap it fills | Remove when |
|---|---|---|---|
| 1 | WorkOS cookie identity fix in `@mastra/auth-workos` 1.6.5 | Default platform sign-in rejects our self-hosted address; the WorkOS cookie path drops the organization ([#25252](https://github.com/mastra-ai/mastra/issues/25252)) | #25252 ships in a Mastra release |
| 2 | Factory wait watcher and Discord webhook | Stock Factory 0.17.2 shows waits in the web app but does not send phone and Windows alerts when Todd is away ([Mastra request #25378](https://github.com/mastra-ai/mastra/issues/25378)); public ntfy.sh exhausted its daily quota (42908), and the private ntfy PWA did not register desktop Web Push | Remove when Mastra adds its own alerts |
| 3 | Monday note and trace-retention check (`ops/factory/monday-note*.mjs`, `ops/factory/mastra-traces.mjs`, `ops/factory/factory-cards.mjs`, `ops/factory/trace-retention.mjs`) — **proposed; awaiting Todd's approval** | Factory 0.17.2 has no weekly cost summary, and the observability store grew to 1.7 GB after about ten hours (change log, 2026-09-28). The note posts one Discussion in the "Monday notes" category and notifies Todd; the retention check measures the DuckDB store and reports when it is over budget or unbounded. Neither deletes rows or moves cards by hand. See **Monday note** and **Bounded trace storage** below | Remove when Factory ships its own weekly cost summary and bounded trace retention |

Approved by ADR 0009 but not built yet: the check that rejects unapproved custom machinery.
It gets its row when it is built.

## Framework map

What we needed, the framework feature that covers it, and the local source that proves it. Only
local sources (repository docs and pinned package paths) are cited; gaps are stated as gaps.

| Need | Framework feature | Local source |
|---|---|---|
| Weekly cost from traces | Mastra full observability route `GET /api/observability/traces` (the CLI's `mastra api trace list --verbose --url <factory>` route; the non-verbose `/light` route omits cost) | `mastra@1.31.3` `dist/index.js` "api trace" command; `@mastra/core` observability route schema; `docs/research/mastra-intended-use-audit.md` |
| Cost per model span | `attributes.costContext.estimatedCost` on model-generation spans | `@mastra/core` `observability/types/metrics.d.ts` (`CostContext`) and `types/tracing.d.ts` |
| Card steps and actors | Factory `work_items.stage_history` (`by` / `exitedBy`) | `@mastra/factory` `dist/storage/domains/work-items/base.d.ts` (`WorkItemRow`, `WorkItemStageEntry`, `isAgentActor`) |
| Card ↔ trace correlation | `work_items.sessions` maps session id → card; spans carry `sessionId` | same `work-items/base.d.ts`; `@mastra/core` `LightSpanRecord`) |
| Publish the note | GitHub Discussions GraphQL API (the repo's injected-fetch provider pattern) | `scripts/linear-cli.mjs` (`linearGraphQL` seam); `ops/factory/monday-note-adapters.mjs` |
| Notify Todd | Discord channel webhook, `?wait=true` | installed `ops/factory/wait-alerts.py`; `ops/factory/README.md` *Discord delivery* |
| Bound DuckDB storage | Mastra opt-in `retention` + `store.prune()`; DuckDB prunes observability spans | `@mastra/duckdb` `dist/storage/index.d.ts` (`DuckDBStoreConfig.retention`, `prune()`); bundled `dist/docs/references/reference-storage-retention.md`; [Storage](https://mastra.ai/docs/storage) |
| Run the prune on a schedule | Mastra workflow `schedule: { cron }` (the scheduler fires the workflow's step) | `app/src/mastra/observability-retention.ts`; [Scheduled workflows](https://mastra.ai/docs/workflows/scheduled-workflows) |
| Default retention window | `DEFAULT_RETENTION` sets `observability.spans` maxAge 14d | `@mastra/code-sdk` `dist/utils/storage-maintenance.js` |
| Measure the store honestly | `statSync` on the DuckDB file + its `-wal`, the pair Mastra's own maintenance code weighs | `@mastra/code-sdk` `dist/utils/storage-maintenance.js` (`fileSizeWithWal`) |

**Gaps this card could not close through supported config (stated, not invented):**

- The supported DuckDB observability retention is wired in source
  (`app/src/mastra/observability-store.ts` + `app/src/mastra/observability-retention.ts`, composed
  in `app/src/mastra/index.ts`), but it is **not live-verified**: no deploy has run the daily prune
  against the server's DuckDB file in this change. The read-only check therefore still **fails
  closed** until the deployed process declares the retention in place (the shipped
  `julia-factory-trace-retention.service` sets `MASTRACODE_DUCKDB_RETENTION=1`) and reports the
  store as unbounded rather than printing a false all-clear. `ops/factory/trace-retention.test.mjs`
  pins the wired source and this fail-closed behaviour.
- There is no supported API that lists a card's model cost directly; cost is correlated from the
  trace `sessionId` against `work_items.sessions`. A trace whose session matches no card is
  reported as uncorrelated, never guessed onto one.

## Monday note

Once a week, `ops/factory/monday-note-run.mjs` reads two sources and posts one plain summary for
Todd: Factory's own card records and Mastra's trace cost data.

- **Cards** come from `ops/factory/factory-cards.mjs` over the same read-only PostgreSQL route the
  wait watcher uses (`install-wait-alerts.sh`'s peer role; `factory-cards.sql` is read-only and
  scoped to `work_items`). Factory's `stage_history` gives each step's actor (`by` / `exitedBy`).
- **Costs** come from `ops/factory/mastra-traces.mjs` over Mastra's own observability route
  (`GET /api/observability/traces`, the full route the CLI's
  `mastra api trace list --verbose` uses). The reader never queries DuckDB by hand, pages through
  the store, and fails closed on any unexpected shape instead of reporting `$0.00`.

Each card line carries every step with its actor, the card's summed trace cost **including failed
attempts**, and how long it took. Whether every step after Todd's Intake tap was done by Factory
or by hand is read from the actors, not agent narrative (CONTEXT.md "Done by Factory"). Cost that
cannot be matched to a card in the week is summed on its own "Not matched to a card" line, so it
is auditable and never folded onto the wrong card or silently dropped. A quiet week says so.
Sessions run **outside Factory** — Codex, GPT, or Claude sessions started by hand — are not Factory
cards and are not counted; the note says so on its own face.

Each week is `[from, to)`, computed by `previousWeekWindow` from the switch-on Monday
(`OBSERVABILITY_START`, 2026-09-28). Before the first Monday after switch-on there is no completed
week, so no note is produced for that partial slice; the first note is minted on the first Monday
after switch-on and its one full week covers every card since observability started. Later notes
cover one week each, and a card or trace is counted in exactly one note. A costed span lands on
exactly one step, so nothing is double-counted.

`publishMondayNote({ note, discussions, notifications })` posts the note as a GitHub Discussion in
the **Monday notes** category and tells Todd through the Discord wait-alert webhook. A run for a
week that already has its Discussion posts and notifies nothing, so a repeated timer fire cannot
send the note twice. Discussions are not ingested by Factory, so the note never lands in Intake.

Operator actions (nothing is sent by this repository):

1. Install the programs into the app with the normal installer
   (`bash ops/factory/install.sh /var/lib/julia-factory/app`).
2. Run the one-time root setup once:
   `sudo bash "$(pwd -P)/ops/factory/install-monday-note.sh" /var/lib/julia-factory/app <PROJECT_ID>`.
   It installs both timers and writes a mode-0640 placeholder
   `/etc/julia-factory-monday-note/config.env` with **empty** token and webhook values. The Monday
   note service stays inert while that file is empty (its unit has
   `ConditionPathExists=/etc/julia-factory-monday-note/config.env`), so installing sends nothing.
3. Add the GitHub Discussions token (a token that can create discussions in the repo's **Monday
   notes** category) and the Discord channel webhook URL to that root-owned config, then
   `sudo systemctl start julia-factory-monday-note.timer`. Never put either value in an issue, a
   log, or the repository.
4. Preview a week without posting: `sudo -u julia-factory /usr/bin/node
   /var/lib/julia-factory/app/ops/factory/monday-note-run.mjs --dry-run`. It reads both sources and
   prints the note.

## Bounded trace storage

The observability store is DuckDB at
`/var/lib/julia-factory/.local/share/mastracode/observability.duckdb` (change log, 2026-09-28).
The **supported** way to keep it bounded is Mastra's own retention: construct the DuckDB store with
`retention: DEFAULT_RETENTION` and call `prune()` on a schedule (official docs:
[Storage / retention](https://mastra.ai/docs/storage) and
[Scheduled workflows](https://mastra.ai/docs/workflows/scheduled-workflows); the bundled
`reference-storage-retention.md` lists DuckDB support for observability spans, metrics, logs,
scores and feedback, and says Mastra never runs `prune()` for you).

That supported path is now wired in the app:

- `app/src/mastra/observability-store.ts` composes the DuckDB observability domain over Factory's
  existing storage with `retention: DEFAULT_RETENTION`
  (`DuckDBStore({ id, path, retention })` + `MastraCompositeStore({ default, domains })`).
- `app/src/mastra/observability-retention.ts` declares a daily cron
  (`schedule: { cron: '0 4 * * *' }`) whose step calls the same store's supported `prune()` with a
  bounded `maxRows`/`pauseMs`, so a large backlog drains over several days.
- `app/src/mastra/index.ts` composes both and hands the store to the scheduled step.

`ops/factory/trace-retention.mjs` is the measurable, read-only check: `measureStore` stats the
real DuckDB file and its `-wal` sidecar (the same pair Mastra's own maintenance code weighs), and
`checkTraceStore` fails when the store is over budget **or** when the deployed process has not
declared the supported DuckDB retention in place. It **never deletes rows** and does not use an
injected storage fake. A small file with no declared DuckDB retention is reported as not ok, never
as a false all-clear.

Operator check (read-only):

1. Run `sudo systemctl status julia-factory-trace-retention.timer`; the daily timer runs
   `trace-retention.mjs`, which exits non-zero when the store is over budget or unbounded, so the
   failure shows in the journal. Inspect with
   `sudo journalctl -u julia-factory-trace-retention.service`.
2. On demand, record the store size with
   `sudo -u julia-factory du -h /var/lib/julia-factory/.local/share/mastracode/observability.duckdb`.
   Read traces through Mastra's own API (`npx mastra api trace list --url <factory>`), never a
   hand-written DuckDB query.
3. If it is over budget, report it; do not add a bespoke delete. The supported remediation is the
   DuckDB `retention` + `prune()` path above.

The scheduled prune is wired in the app and its test runs in CI
(`ops/factory/app/observability-retention.test.mjs` via Node's built-in type stripping); the
read-only size check is wired into CI (`ops/factory/trace-retention.test.mjs`) and into the daily
timer.

## Installation

Approved exception #1 restores the pinned `@mastra/auth-workos` 1.6.5 cookie
identity fix described in [mastra-ai/mastra#25252](https://github.com/mastra-ai/mastra/issues/25252).
It is the only installed Mastra package code change. See
`docs/agents/factory-platform-auth-change-log.md` for the complete change list.

When replacing the ntfy watcher, stop its timer before copying the new watcher:
`sudo systemctl stop julia-factory-wait-alerts.timer`. The new service uses a
separate `discord-ready` gate; old ntfy subscription markers cannot enable it.
After the normal `install.sh` below, re-run `install-wait-alerts.sh` to install
the new unit and restart the timer. It preserves the existing config and
delivery ledger. Remove the old `subscribed` and `subscribed-self-hosted`
markers, add the Discord webhook URL to the config, then create `discord-ready`.
Check `systemctl status julia-factory-wait-alerts.timer` afterward.

Run installation as the dedicated Factory service user:

```sh
bash /path/to/julia-next/ops/factory/install.sh /var/lib/julia-factory/app
```

The installer copies `ops/factory/app/{package.json,package-lock.json,tsconfig.json}`,
`ops/factory/app/src/mastra/{index,local-sandbox}.ts`, and the two project overrides in
`ops/factory/app/src/mastra/public/factory-skills/{factory-plan,factory-review}/SKILL.md`
into the service directory before `npm ci`; it never copies `.env`, databases or
runtime workspaces. The versioned lockfile pins the deployed dependencies; it does
not upgrade them. Factory 0.17.2 loads project-local `factory-skills` before its
bundled skills; Mastra's build places the overrides under `.mastra/output/factory-skills`.
After installing and restarting, verify precedence in Factory's Settings › Skills
or a fresh bound session; a staged build alone proves packaging, not live activation.
The Factory UI is supplied by Mastra's build, not committed as generated assets. The WorkOS
patch checks version and original SHA-256 and rejects unexpected files. It applies
before build and checks the copied deployment dependency afterward. Repeat
application is safe. Back up the service directory before a live install and
restart the service only after checks succeed.

**Issue #146 deployment gate:** The local-provider configuration requires native
`bubblewrap` with `nativeSandbox.allowNetwork: true`. Todd approved general internet
access on 2026-09-28; the earlier Git-only egress restriction was withdrawn.
Before merging, check `bwrap` as the service user, back up the service install, use
the installer above, restart the service, and prove the installed Factory session
runs isolated commands. Independently verify harmless canaries exist at protected
file/key/database/secret locations outside the sandbox, then prove each is denied
inside. Prove a disposable Git fetch/commit/push using Factory's intended short-lived
Git credentials, and record commands/results and accepted network scope in the
change log and PR. Roll back if the service fails to start or isolation is bypassed;
never print key or database contents. #144 owns the retired Orca reachability check
and does not block #146.

The installer runs `workos-cookie-identity.check.mjs` against both package copies.
Its fixture checks one membership, an explicit organization choice, and no
membership without using a real account.

Remove the exception when #25252 ships in a Mastra release. Review that release,
remove this patch and installer hook, then reinstall and build from the lockfile.

Personal and factory-wide observer/reflector settings select `deepseek/deepseek-flash`
(2026-09-28), with `DEFAULT_OM_MODEL_ID` set to the same model in the environment. Mastra
observability (traces and metrics, DuckDB) is on; see the change log.
The organization has a normal OpenAI Codex OAuth connection and a direct
DeepSeek API-key connection. There is no model package patch.

The dedicated `julia-factory` account also needed a Git commit identity. GitHub's
API confirmed this installation's bot identity; its normal Git configuration is:

```sh
git config --global user.name 'julia-factory-todd-wyder[bot]'
git config --global user.email '334524704+julia-factory-todd-wyder[bot]@users.noreply.github.com'
```

Run these only as the dedicated service account. They persist for fresh
sandboxes and do not authorize publishing. Removal is `git config --global
--unset user.name` and the corresponding `user.email` command for that account.

Factory **0.17.2** scans both `.claude/skills` and `.agents/skills` as local
sources. The earlier package patch selecting one root was removed so WorkOS is
the only Mastra code exception. Skill-loading repair is separate work.

The supported GitHub event-rule overrides in `app/src/mastra/index.ts` keep
machine issues and publisher App PRs off Factory's Work and Review boards.
Known machine source numbers are explicitly excluded; new machine issues use
the `factory:machine` GitHub label when created. If an existing issue gets the
label later, remove its existing Factory card through the Work card delete
action. Factory-authored Julia PRs enter Reviewing
directly so Review auto-start can run. Remove these rules when stock Factory
supports source filters and automatic Review entry for trusted authoring PRs.

The server's previous `postinstall` pointed at a machine-specific patch copy.
The repository manifest removes that hook; **always use this installer**, never
run `npm ci` alone on the service directory: the installer applies the approved
patch after install and again to Mastra's built output and runs both regressions.
No additional Mastra package code is changed. Factory uses its installed boards
and normal model and GitHub connections.

## Wait-alert watcher

The normal installer copies `wait-alerts.py` and `wait-alerts.sql` into the app.
Run the one-time root setup after the normal install:

From the root of a reviewed checkout owned by the operator, run:

```sh
sudo bash "$(pwd -P)/ops/factory/install-wait-alerts.sh" \
  /var/lib/julia-factory/app \
  49b0ea94-d24b-43d7-8ce1-618cb61c5188 \
  user_01M3HB0CKYTK5V2DXGTZ4PA3B8 \
  https://julia-factory.tail91f394.ts.net
```

The setup creates a PostgreSQL peer role with SELECT only on the tables the
watcher needs. Its query runs in a read-only transaction. The watcher writes
only its own SQLite delivery ledger in `/var/lib/julia-factory-wait-alerts`;
it never changes Factory records, answers questions, or moves cards. A
wait means a session question, a plan waiting for review, an unresolved
supervisor finding, or a Triage card labeled `status: needs approval`.
Automation run suggestions, other decisions, and mentions are excluded.
The watcher claims each wait's stable key before posting to a dedicated Discord
channel webhook. It uses Discord's `wait=true` response to record the confirmed
message ID. A timeout, HTTP 5xx, or interrupted send has an uncertain outcome
and is never replayed. A non-rate-limit HTTP 4xx rejection records only the
numeric status in the private ledger and journal and makes the systemd run fail
visibly. Historical attempted and rate-limited ntfy rows are never replayed.
A Discord HTTP 429 means no message was posted; the watcher keeps that wait
pending and uses Discord's `Retry-After` time before another attempt. It also
retries a DNS failure or refused TCP connection after one minute, because the
message never reached Discord. The one-minute timer remains enabled across
Factory restarts and reboots. Never publish ledger keys, links, or the webhook
URL in an issue or log.

### Discord delivery

Discord's [incoming webhooks](https://docs.discord.com/developers/resources/webhook#execute-webhook)
post to one channel without a bot or paid service. Create a webhook for a
private text channel Todd can access on Windows and Android. Set that channel's
[notification override](https://support.discord.com/hc/en-us/articles/215253258-Notifications-Settings-101)
to **All messages** on both devices, enable mobile push, and leave the server
unmuted. Keep the Discord desktop app running for Windows alerts. Discord may
delay mobile push while the desktop is active; its **Push Notification Inactive
Timeout** controls that behavior. The watcher includes the Factory link in the
message and disables mentions from untrusted card titles. Discord returns one
message for each new wait; the watcher does not post a staged Factory question
to test delivery.

The webhook URL belongs in `/etc/julia-factory-wait-alerts/config.json`
(root-owned, group `julia-factory`, mode `0640`) under `discord_webhook_url`.
Use the URL Discord provides, beginning with `https://discord.com/api/webhooks/`.
The watcher accepts only that host and endpoint shape. After confirming the
channel's notification settings and a successful webhook metadata lookup,
create `/etc/julia-factory-wait-alerts/discord-ready` as root, then start
`julia-factory-wait-alerts.service`. Keep the old ntfy markers absent; they do
not enable Discord delivery. Once a real wait reaches both devices, disable
the retired ntfy service and remove its port 8443 Funnel route.

Inspect current waits without publishing:

```sh
sudo -u julia-factory python3 /var/lib/julia-factory/app/ops/factory/wait-alerts.py --dry-run
```

## Cross-maker PR reviewer

The reviewer is based on Mastra's Apache-2.0 `template-github-review-agent`
at commit `15f09d4e6fe2230153e1c4551a72250b1b5c009e`. Its agents, workflow,
GitHub readers, workspace skills, and observational memory live in
`app/src/mastra/reviewer/`. A signed GitHub `pull_request_target` action calls
the app's supported `registerApiRoute` endpoint. The action submits a
commit-bound GitHub review as `github-actions[bot]`, the accepted reviewer
identity for this project. It checks out only the base branch and never
executes PR code.

The service needs `DEEPSEEK_API_KEY` and `JULIA_REVIEW_ROUTE_SECRET`. Set the
same route secret as a GitHub Actions repository secret. Optional
`JULIA_REVIEWER_MODELS` is an ordered comma-separated list of Mastra
`provider/model` IDs, starting with `deepseek/deepseek-v4-pro`;
`JULIA_BUILDER_MODEL` defaults to `openai/gpt-6-sol`. Startup rejects any
reviewer model from the builder's provider. Observational memory uses
`deepseek/deepseek-v4-flash`. Add `github-actions[bot]` to
`MASTRACODE_GITHUB_AUTHORIZED_BOTS` so Factory's GitHub rule forwards a
requested change to its Work session. GitHub Actions must allow approval
reviews in this repository's workflow permissions.

The route reads only public Julia-next PRs and their linked GitHub issues. A
PR must say `Closes #N`; the issue must have an Acceptance criteria checklist.
The reviewer refuses a changed head or missing criterion evidence. Mastra's
storage exporter records its spans with the Factory traces. The Action never
receives the DeepSeek key.
