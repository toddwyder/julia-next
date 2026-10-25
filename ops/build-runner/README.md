# Run one card role

Install the pinned SDK in this directory from its own lockfile.

```sh
npm ci --prefix ops/build-runner
```

Create a builder working directory and a separate private state directory. Run the adapter in its own process through the existing credential bootstrap.

```sh
mkdir -p /tmp/julia-card/workspace /tmp/julia-card/state
node scripts/julia-agents.mjs -- node ops/build-runner/adapter.mjs \
  JUL-251 /tmp/julia-card/workspace /tmp/julia-card/state \
  ops/build-runner/settings.json 'Reply with a greeting. Do not use tools.'
```

The JSON receipt contains the result and durable card account. Production settings name one shared `ledgerPath` outside job worktrees. Every role, retry and restarted run uses that card-keyed SQLite account. Money never stops a card. The ledger records each request's maximum only to recover an unknown outcome, and records settled actual usage at published API prices, including subscription requests. `snapshot().spendByModel` reports spend per model. A host recovering a timed-out operation may call `CardLedger.chargeUnknownMaximum(id)`. It charges that entire maximum and labels actual usage unknown. The maximum charge is final and cannot be replaced by a later settlement. A settled cost above the recorded maximum is ordinary accounting. There is no cap, stop row or priced-accounting block.

Change `roles` and `providers` in production machine settings to change routes. Provider keys belong in runtime environment sources named by `credentialEnv`. The adapter captures those values, clears the process environment, and supplies the stock runtime custom-provider source. Settings contain no key values. Production `authPath` points to one stock Mastra `AuthStorage` file outside builder workspaces. The stock store owns OAuth use and renewal. Run `node ops/build-runner/connections.mjs login ops/build-runner/machine-settings.json openai-codex` for ChatGPT device authorization, or replace `openai-codex` with `anthropic` for Claude's hosted paste-code flow. Only account approval needs Todd. `connections.mjs status` with the same settings path prints sign-in booleans without credentials. A saved sign-in alone does not prove a model request.

Production machine settings do not carry a hand-written model list. `catalogue.mjs` reads the models.dev catalogue for Anthropic, OpenAI and CommandCode, adds CommandCode's own `/provider/v1/models` list and published pricing rows for models models.dev lacks, and refuses a model with no published price. The Start page offers only those three providers, filtered to the subscriptions that are signed in and the CommandCode key that is present. The worker hydrates `settings.models` and the CommandCode provider's model list from that catalogue before dispatch. Claude's stock conversation cache writes one-hour entries, priced at twice the published input rate; models.dev's five-minute write rate is not substituted.

Each hydrated model entry identifies an exact endpoint, wire model, protocol, input bound, output bound and published rate source. Rates are USD per million tokens for uncached input, output including reasoning, cache reads and cache writes. `chat`, `responses` and `messages` select protocol handling. The request carries the model's published output maximum; there is no separate 8,192-token cap. An unpriced hosted tool call is refused. Requests that are not model calls pass through without a separate provider allowlist. Provider errors are retried after a pause (`providerRetry` in settings); after the last attempt the build pauses as provider-down.

The machine no longer plans before pstack. One pstack session runs with a 15-minute inactivity watchdog and a 100-turn limit. A command is killed after 15 minutes with no output. Every pstack helper gets 100 steps. The host does not require a coder helper, a two-model review panel or a machinery self-check. A missing checklist or a build with no real change is reported unproven and routed to Remediation by the evidence review. A runaway at the turn limit or a provider that stays down sets the job to `paused`, keeps its worktree and thread, records a note for the Linear card, and can be continued with `POST /jobs/:runId/continue`. Pressing Start on a card whose last run failed archives the old job directory and starts a fresh run.

Each request records its configured bounds and the enforced output maximum at the highest configured price tier and cache rates for unknown-outcome recovery. Settlement always uses reported token usage and published API prices. There is no local input estimate and no token-count request. Media, hosted tools, service tiers and cache-write TTLs are not refused as a whole request; an unpriced hosted tool call alone is refused. Unknown outcomes retain their recorded maximum; the card continues and the spend is reported.

The native Codex stream can omit Content-Type; the guard uses the outgoing stream flag to recognize it and still requires completed usage. Claude retains the stock one-hour cache rate. Local fixtures prove accounting behavior; real subscription proof is recorded separately.

Stock Auto observational memory uses the stock local store, 30000-token observation threshold, 40000-token reflection threshold and stock buffering. Set `memory` to `false` to disable observational memory while retaining ordinary stock history. Local embedding assets must already be present in the adapter home's stock `.cache/mastra/fastembed-models` cache. Network downloads fail closed until their exact asset routes are explicitly configured. The proof reused the installed stock cache.

Builder file tools use the contained stock filesystem. Every stock sandbox process passes through the Landlock launcher. The launcher keeps the filesystem fence and allows outbound network so a builder can install packages from the standard package registry. Commands receive only the keys named by `builderEnvKeys` in settings (CommandCode by default); machine-only keys such as `LINEAR_API_KEY`, `SENTRY_AUTH_TOKEN` and `AXIOM_TOKEN` are refused even if named. A missing command key fails that one command and the build continues. The machine keeps the keys that move cards or change production.

Run local accounting, protocol, command and SDK retry checks from the repository root.

```sh
node --test ops/build-runner/test/*.test.mjs
node ops/build-runner/proof/mutations.mjs
```

The mutation command temporarily edits guards and restores them in `finally`. Run it with exclusive access to the checkout. Its committed report records each selected failing test and the final restored green run.

Run the real memory proof through the credential bootstrap with a prepared stock embedding cache in the state home.

```sh
node scripts/julia-agents.mjs -- node ops/build-runner/proof/memory.mjs \
  /tmp/julia-memory-proof ops/build-runner/settings.json
```

The proof forces one observation through the public stock API. It repeats that real observation as fixture input until it crosses the unchanged reflection threshold, then drives a normal Auto turn. It verifies a reflection generation and recall after deleting the source message. This proves the real memory operations, rather than a natural long conversation reaching those thresholds.

## Start a saved card

The control page posts its saved initialization result to the separate runner's `POST /jobs`. `GET /jobs` and `GET /jobs/:runId` return the persisted job. A duplicate Start returns the same saved job. `POST /jobs/:runId/continue` restarts a paused job in its retained worktree. The Start form chooses Orchestrator, Coder and Reviewer. The Reviewer must come from a different company than the Orchestrator and the Coder, and the three choices are remembered in the browser. The worker uses the saved card and the three selections, then saves `ready-for-review` after the run. A missing checklist or an empty candidate is recorded as unproven for the evidence review rather than failing the job.

The build's checklist names its playbook. The evidence review runs in the same process, one runner at a time. Before each review round it reads the card's current title, text and labels from Linear, not the copy saved at Start. The reviewer is the first `reviewers` entry in machine settings that is signed in and comes from a company other than every builder model. It gets the adversarial-review skill, no helpers, and an export of the candidate commit with the proof under `.builder-home/proof/`, including the required playbook's text, the run's checklist and the candidate diff. It writes `.builder-home/review/verdicts.json`. The worker gives each acceptance criterion proven, unproven or wrong thing tested. A `proven` verdict with no existing proof file counts as unproven. A run whose checklist follows a different playbook, or whose work skips its steps, gets every criterion unproven. A step the host has taken out of scope, such as publishing, does not count as skipped. The verdicts are posted to the Linear card. A first failure moves the card to Remediation and runs one Bug fix round, then a fresh review. A second failure runs an Investigation, posts its root cause and stops the card (`failed`, `error.stopped`). A pass saves `ready-for-review` with `result.review`.

Set `BUILD_RUNNER_JOBS_DIR`, `BUILD_RUNNER_REPO`, `BUILD_RUNNER_SETTINGS` and `BUILD_RUNNER_PORT`, then launch `jobs.mjs` through `scripts/julia-agents.mjs`. Set the control service's `JULIA_BUILD_RUNNER_URL` to that runner. The server units and their controller live under `ops/build-runner/systemd/`.

`machine-settings.json` selects Claude as orchestrator and DeepSeek as coder. `pstack-models.md` assigns ordinary coding and swarm work to DeepSeek, hardest work and judgment to Claude, and panels to one of each. An explicit machinery run uses the configured Beam model for its roles and self-check. A same-model machinery self-check is never independent review. These settings govern machine sessions; they do not alter the current Codex chat's settings.

Run the real Claude subscription proof for the catalogue's Opus 5.5 and Sonnet 5.5 entries. It writes the offers and both settled ledger requests to the proof path.

```sh
node scripts/julia-agents.mjs -- node ops/build-runner/proof/subscription-models.mjs \
  docs/agents/model-catalogue-2026-10-24/proof/subscription-requests.json
```

Run the real browser/server Proof with the installed candidate services.

```sh
node ops/build-runner/proof/start.mjs \
  http://127.0.0.1:43126/julia-control http://127.0.0.1:43127 \
  julia-jul231-control.service docs/agents/jul-231/evidence/server-proof-20261023
```
