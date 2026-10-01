# Factory exceptions list and installation

## Exceptions list

Every place we use our own piece instead of Factory's, Mastra's or GitHub's (ADR 0009). Only
Todd adds or removes an entry. Anything custom that is not listed here is not approved.

| # | Exception | Gap it fills | Remove when |
|---|---|---|---|
| 1 | WorkOS cookie identity fix in `@mastra/auth-workos` 1.6.5 | Default platform sign-in rejects our self-hosted address; the WorkOS cookie path drops the organization ([#25252](https://github.com/mastra-ai/mastra/issues/25252)) | #25252 ships in a Mastra release |
| 2 | Factory wait watcher and Discord webhook | Stock Factory 0.17.2 shows waits in the web app but does not send phone and Windows alerts when Todd is away ([Mastra request #25378](https://github.com/mastra-ai/mastra/issues/25378)); public ntfy.sh exhausted its daily quota (42908), and the private ntfy PWA did not register desktop Web Push | Remove when Mastra adds its own alerts |
| 3 | Monday cost note, price table, and bounded trace retention (`ops/factory/monday-note*.mjs`, `ops/factory/price-table.mjs`, `ops/factory/mastra-traces.mjs`, `ops/factory/factory-cards.mjs`, `ops/factory/trace-retention.mjs`, `app/src/mastra/cost-note-auth.ts`, `app/src/mastra/observability-store.ts`, `app/src/mastra/observability-retention.ts`) — **approved for GitHub #180 (Todd, 2026-10-01, superseding #140)** | Factory 0.17.2 has no weekly cost summary with real what-you-pay rates per provider/model, and the observability store grew to 1.7 GB after about ten hours (change log, 2026-09-28). The note computes what Todd actually pays (single source of truth price table, step/model breakdown, effort alongside thinking tokens, card drivers, provider weekly totals, named gaps) and posts one public GitHub Issue (`factory:machine,cost-note`) per completed week; retention runs Mastra's supported DuckDB retention + CHECKPOINT on the framework's own daily schedule, from a size guard. Neither deletes rows or moves cards by hand. See **Monday note** and **Bounded trace storage** below | Remove when Factory ships its own weekly cost summary and bounded trace retention |

Approved by ADR 0009 but not built yet: the check that rejects unapproved custom machinery.
It gets its row when it is built.

## Framework map

What we needed, the framework feature that covers it, and the local source that proves it. Only
local sources (repository docs and pinned package paths) are cited; gaps are stated as gaps.

| Need | Framework feature | Local source |
|---|---|---|
| Weekly cost from traces | Authenticated Mastra observability light-list, light-timeline and single-span routes under `/api/observability/traces`; `CompositeAuth` keeps WorkOS sign-in and adds a GET-only `SimpleAuth` trace reader | `app/src/mastra/cost-note-auth.ts`; `app/cost-note-auth.test.mjs`; pinned `@mastra/core` server auth and observability route schemas |
| What-you-pay pricing per model/provider | Single source of truth price table (`ops/factory/price-table.mjs`) tracking fresh input, cached input, output rates, provider pay factors, source URLs, and checked dates | `ops/factory/price-table.mjs`; `docs/research/agent-cost-primary-sources.md` |
| Card steps, actors and effort | Factory `work_items.stage_history` (`by` / `exitedBy`) and `mastra_messages` phase signals (`Runtime: model=?, reasoning-setting=?`) | `@mastra/factory` `dist/storage/domains/work-items/base.d.ts` (`WorkItemRow`, `WorkItemStageEntry`, `isAgentActor`) |
| Card ↔ trace correlation | `work_items.sessions` maps session id → card; spans carry `sessionId`; step split correlated by `stage_history` timestamps | same `work-items/base.d.ts`; `@mastra/core` `LightSpanRecord`; `ops/factory/mastra-traces.mjs` |
| Publish the note | GitHub Issues REST API (`POST /repos/{owner}/{repo}/issues` with labels `factory:machine`, `cost-note`) | `ops/factory/monday-note-adapters.mjs`; [GitHub Issues REST API](https://docs.github.com/en/rest/issues/issues#create-an-issue) |
| Bound DuckDB storage | Mastra opt-in `retention` + `store.prune()`; DuckDB prunes observability spans and the documented `CHECKPOINT` reclaims the freed rows | `@mastra/duckdb` `dist/storage/index.d.ts` (`DuckDBStoreConfig.retention`, `prune()`); bundled `dist/docs/references/reference-storage-retention.md`; [Storage / retention](https://mastra.ai/docs/storage) |
| Run the prune on a schedule | Mastra workflow `schedule: { cron }` (the scheduler auto-registers the workflow's declarative schedule and fires it through the event processor) | `app/src/mastra/observability-retention.ts`; `app/observability-retention-schedule.test.mjs`; [Scheduled workflows](https://mastra.ai/docs/workflows/scheduled-workflows) |
| Enforce a byte budget | The guard around supported retention: tighter `PruneOptions.retention` + `CHECKPOINT`, failing closed when the disk lacks headroom | `app/src/mastra/observability-retention.ts`; `ops/factory/trace-retention.mjs`; [Storage / reclaiming disk](https://mastra.ai/docs/storage) |
| Default retention window | `DEFAULT_RETENTION` sets `observability.spans` maxAge 14d | `@mastra/code-sdk` `dist/utils/storage-maintenance.js` |
| Measure the store honestly | `statSync` on the DuckDB file + its `-wal`, the pair Mastra's own maintenance code weighs | `@mastra/code-sdk` `dist/utils/storage-maintenance.js` (`fileSizeWithWal`) |

**Gaps this card could not close through supported config (stated, not invented):**

- The supported DuckDB observability retention is wired in source
  (`app/src/mastra/observability-store.ts` + `app/src/mastra/observability-retention.ts`, composed
  in `app/src/mastra/index.ts`). It is **not live-verified**: no deploy has run the prune against the
  server's DuckDB file in this change, so the byte cap is the guard's behaviour and its real effect is
  measured on the server, not asserted here. `app/observability-retention-schedule.test.mjs` proves
  the framework registers the schedule and fires it into the configured prune target with the real
  `Mastra`/`Scheduler`; `ops/factory/trace-retention.test.mjs` pins the guard and the wired source.
- There is **no systemd trigger** for retention. The app's own Mastra scheduler is the only prune
  trigger, in the process that holds the DuckDB lock. This card removed the earlier
  `julia-factory-trace-retention.{service,timer}` duplicate, its `trace-prune-request.mjs` program
  and its signed `/julia/run-retention` route.
- Mastra's `prune()` is age-based and never reclaims disk, so it cannot enforce a byte budget on
  its own. The guard handles that: it measures the file + WAL and the free disk, applies a tighter
  supported `maxAge` when over budget, runs the documented DuckDB `CHECKPOINT`, and fails closed
  when there is not enough free disk to do so safely. See **Bounded trace storage**.
- Effort comes from the most recent Factory phase snapshot on the exact thread before the call.
  When neither the span nor that snapshot records effort, the step reports `no recorded effort`.
  Thinking tokens are part of total output tokens and are displayed separately, never billed twice.

## Monday note

Once a week, `ops/factory/monday-note-run.mjs` reads two sources and posts one plain summary for
Todd as a public GitHub Issue: Factory's own card records and Mastra's trace cost data.

- **Cards** come from `ops/factory/factory-cards.mjs` over the same read-only PostgreSQL route the
  wait watcher uses (`install-wait-alerts.sh`'s peer role; `factory-cards.sql` is read-only and
  scoped to `work_items`, retained `factory_run_bindings`, and phase signals in `mastra_messages`). Factory's `stage_history` gives each step's actor (`by` / `exitedBy`) and
  stage intervals (`enteredAt`/`exitedAt`).
- **Costs** come from authenticated Mastra light roots/timelines and individual model-inference
  spans. Aggregate generation/step totals are excluded when inference children exist, so token
  rates and long-context thresholds apply once per actual call. Step records and run IDs supply
  the model steps/run driver. Prompt bodies and tool schemas are discarded. The price table records provider rates,
  cache rates, source dates and payment factors. Direct DeepSeek peak/off-peak prices use the call's
  start time, including the verified October 1–7 holiday. An unknown price window, model or token
  count is a named gap; dollar amounts beside gaps are explicitly known subtotals.

Each card line carries every step with its actor, model breakdown, effort level beside thinking tokens,
the card's summed what-you-pay cost **including failed attempts**, and elapsed time. The card drivers
line highlights the primary cost and time drivers. Weekly provider totals summarize spend per provider,
and named gaps (e.g. missing tokens, unpriced models, unrecorded effort) are explicitly itemized. A quiet
week says so. Sessions run **outside Factory** — Codex, GPT, or Claude sessions started by hand — are not
Factory cards and are not counted; the note says so on its face.

When a card row is gone but Factory retains its run binding, the note uses that recorded UUID and
names the missing title, elapsed time and stage history. It never invents an issue number or a wait
count. Calls on this project's supervisor thread appear separately as project overhead.

Each week is `[from, to)`, computed from the switch-on Monday (`OBSERVABILITY_START`, 2026-09-28).
`completedWeeks` lists every full week, and the weekly job **backfills** each one that has no GitHub Issue
yet, oldest first, bounded per invocation. The dedupe cursor is GitHub Issues labeled `factory:machine`
and `cost-note`: a week is missing exactly when no issue carries its title. A card is named at most once
per note, and a trace is counted in exactly one note (the week it started in). A card accepted in an earlier
week still appears in the week its work ran: the note includes a card that entered the week **or** that has
cost/activity in it, and attributes to that card only the week's own traces and failed attempts.

`publishMondayNote({ note, issues })` posts one week's note as a GitHub Issue labeled `factory:machine`
and `cost-note` (retiring the earlier Discussion in the "Monday notes" category and Discord webhook).
The backfill posts each missing week. Because the issue carries the `factory:machine` label, it is public
without sign-in, accessible to Claude, and ignored by Factory intake. Discord and Discussions delivery are
retired.

Operator installation:

1. Install the app with `bash ops/factory/install.sh /var/lib/julia-factory/app`.
2. Run `sudo bash ops/factory/install-monday-note.sh /var/lib/julia-factory/app <PROJECT_ID>`.
   It installs root-owned job modules under `/opt/julia-factory-monday-note`, grants the existing
   publisher account SELECT on the three record tables, and enables the Monday timer. Re-run it after
   job updates. It preserves existing configuration and sends nothing during installation.
3. Provision one random `MONDAY_NOTE_TRACE_TOKEN` in both `/etc/julia-factory/factory.env` and
   `/etc/julia-factory-monday-note/config.env`, then restart the app. The supported auth composition
   restricts this token to observability GET routes. Keep the root-owned config mode 0640 and group
   `orchestrator-svc`. Never print tokens or place them in the repository or an issue.
4. Preview live data as the publisher account with `sudo -u orchestrator-svc node
   --env-file=/etc/julia-factory-monday-note/config.env
   /opt/julia-factory-monday-note/ops/factory/monday-note-run.mjs --dry-run
   --from 2026-09-28T00:00:00Z --to <UTC_END>`. Explicit windows are only accepted for dry runs.
5. Start `julia-factory-monday-note.timer`. It fires Mondays at 08:00 UTC and backfills completed
   weeks. Each invocation mints a fresh short-lived installation token through the existing
   publisher App credential; the Factory process never receives that signing key.

Delivery uses public GitHub Issues only. The original Factory intake rule already excludes the
`factory:machine` label; this change adds no duplicate intake filter. Wait-alert Discord delivery
below belongs to the separate wait watcher.

## Bounded trace storage

The observability store is DuckDB at
`/var/lib/julia-factory/.local/share/mastracode/observability.duckdb` (change log, 2026-09-28).
The **supported** way to keep it bounded is Mastra's own retention: construct the DuckDB store with
`retention: DEFAULT_RETENTION` and call `prune()` on a schedule (official docs:
[Storage / retention](https://mastra.ai/docs/storage) and
[Scheduled workflows](https://mastra.ai/docs/workflows/scheduled-workflows); the bundled
`reference-storage-retention.md` lists DuckDB support for observability spans, metrics, logs,
scores and feedback, and says Mastra never runs `prune()` for you).

That supported path is now wired in the app, with an explicit byte-budget guard around it:

- `app/src/mastra/observability-store.ts` composes the DuckDB observability domain over Factory's
  existing storage with `retention: DEFAULT_RETENTION`
  (`DuckDBStore({ id, path, retention })` + `MastraCompositeStore({ default, domains })`).
- `app/src/mastra/observability-retention.ts` declares a daily cron
  (`schedule: { cron: '0 4 * * *' }`) whose step runs `runObservabilityRetention`. Under budget it
  applies the supported standing retention with a bounded `maxRows`/`pauseMs`, so a large backlog
  drains over several days. Over budget it applies the tighter supported `1d` policy through
  `PruneOptions.retention`, then runs the documented DuckDB `CHECKPOINT` (through the store's own
  `DuckDBConnection.execute`) to reclaim the freed rows.
- `app/src/mastra/index.ts` composes both and hands the store to the scheduled step, including the
  checkpoint.

**Byte-budget behaviour, measured honestly.** `prune()` is age-based and, per Mastra's own docs, it
never reclaims disk, so it cannot enforce a byte cap by itself. The guard, not `prune()`, enforces
the budget:

1. Measure the DuckDB file + `-wal` and the free disk on that volume.
2. Under the 5 GB budget: apply the standing 14-day retention (routine).
3. Over budget and enough free disk for a checkpoint (`1.2x` store + 256 MB, the installed
   `@mastra/code-sdk` headroom formula): apply the 1-day retention, then `CHECKPOINT`; re-measure;
   if still over budget, fail closed (non-zero) and require operator action.
4. Over budget and too little free disk, or an unmeasurable free-space reading: fail closed
   **before** touching the store, so the disk cannot fill while reclaiming.

This is the "safe operation that fails before disk exhaustion" the review asked for. No direct DB
`DELETE` is issued anywhere; the only writes are Mastra's supported `prune()` and DuckDB's
documented `CHECKPOINT`. **Acceptance is not claimed from source**: whether the cap holds on the
1.7 GB/10 h server store is a live measurement an operator makes after deploy.

`ops/factory/trace-retention.mjs` is the measurable, read-only checker `planRetentionAction`:
`measureStore` stats the real DuckDB file and its `-wal` sidecar (the same pair Mastra's own
maintenance code weighs), `measureFreeBytes` reads the volume, and the plan classifies the store as
`routine-prune`, `emergency-prune`, or `fail-low-disk`. It **never deletes rows** and does not use an
injected storage fake. It is a hand diagnostic only; nothing schedules it.

**The Mastra schedule is the only prune trigger.** Declaring `schedule: { cron: '0 4 * * *' }` on
`observabilityRetentionWorkflow` makes the framework register a declarative schedule row when the
app boots; the framework's own `Scheduler` claims each due fire and runs the step through the event
processor, in the process that holds the DuckDB lock. There is no systemd unit for retention: the
earlier `julia-factory-trace-retention.{service,timer}` duplicate, its `trace-prune-request.mjs`
program and its signed `/julia/run-retention` route were removed. `app/observability-retention-schedule.test.mjs`
proves the registration, the fire and the reach into the configured prune target with the real
`Mastra`/`Scheduler`/schedule store, and asserts the generated `@mastra/deployer` server calls
`startWorkers()`.

Operator actions:

1. Retention runs on the app's own schedule; there is nothing to enable or check in systemd. The
   framework records each fire in the `schedules` storage domain (visible in Studio's Schedules
   view) and the app logs the per-table prune result at the 04:00 window.
2. Record the store size with
   `sudo -u julia-factory du -h /var/lib/julia-factory/.local/share/mastracode/observability.duckdb`.
   Read traces through Mastra's own API (`npx mastra api trace list --url <factory>`), never a
   hand-written DuckDB query.
3. If it is over budget on the server, report the measured size and the guard's action; do not add a
   bespoke delete or a second scheduler.

The guard decisions are covered by `ops/factory/trace-retention.test.mjs`; the scheduled reach into
the prune target by `ops/factory/app/observability-retention-schedule.test.mjs` and the wired source
by `ops/factory/app/observability-retention.test.mjs`.

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
A PR whose diff is over 180,000 characters is reviewed through the registered
`prReviewWorkflow`, which feeds the reviewer agent bounded file batches and
hands the criterion verdict only the batched findings -- never the whole diff
([Mastra workflows](https://mastra.ai/docs/workflows/overview)). The reviewer
refuses a changed head (checked before and after the batched review) or missing
criterion evidence. If the workflow skips a reviewable file (an unreviewed
deletion-only source change), the route fails closed: it can never return
APPROVE, and the verdict body names the unreviewed material. Files skipped by
the shared non-reviewable patterns (locks, binaries, build output, snapshots)
are recorded as findings with evidence but do not block approval. Mastra's
storage exporter records its spans with the Factory
traces. The Action never receives the DeepSeek key.
