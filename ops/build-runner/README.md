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

The JSON receipt contains the result and durable card account. Production settings name one shared `ledgerPath` outside job worktrees. Every role, retry and restarted run uses that card-keyed SQLite account. The ceiling is $2 across the whole card, including subscription requests at API prices. Concurrent requests reserve against the same balance. Missing usage retains the reservation and blocks further priced work. A host recovering a timed-out operation may call `CardLedger.chargeUnknownMaximum(id)`. It charges that entire reservation without releasing funds and labels actual usage unknown; the account can then spend only its unchanged remainder. The maximum charge is final and cannot be replaced by a later settlement. Positive charges settle normally; a reported charge above its configured reservation records the actual cost and stops the account.

Change `roles`, `providers` and `models` in settings to change routes. Provider keys belong in runtime environment sources named by `credentialEnv`. The adapter captures those values, clears the process environment, and supplies the stock runtime custom-provider source. Settings contain no key values. Production `authPath` points to one stock Mastra `AuthStorage` file outside builder workspaces. The stock store owns OAuth use and renewal. Run `node ops/build-runner/connections.mjs login ops/build-runner/machine-settings.json openai-codex` for ChatGPT device authorization, or replace `openai-codex` with `anthropic` for Claude's hosted paste-code flow. Only account approval needs Todd. `connections.mjs status` with the same settings path prints sign-in booleans without credentials. A saved sign-in alone does not prove a model request.

Each model entry identifies an exact endpoint, wire model, protocol, input bound, output bound and published rate source. Rates are USD per million tokens for uncached input, output including reasoning, cache reads and cache writes. `chat`, `responses` and `messages` select protocol handling. Unsupported routes and missing prices are refused. Exact metadata and credential-refresh URLs may appear in `networkAllow`; their bodies cannot contain inference fields. Form-encoded refresh requests are supported.

Reservations use the full provider context bound and enforced output maximum at the highest configured tier and cache rates. Models with an `inputTokenCountEndpoint` instead obtain an exact provider input count before reserving. Missing or invalid counts refuse generation. Sol uses the documented public OpenAI token-count endpoint; support for that endpoint with Mastra's legacy stock subscription token must be proved live. A local tokenizer estimate is insufficient. Settlement applies the published price tier to actual usage. Settings cite prices and bounds. Unsupported media, hosted tools, nonstandard service tiers and cache-write TTLs outside the configured rate are refused. Claude uses the stock conversation cache TTL of one hour and its published one-hour rates. Local fixtures prove accounting behavior, not live provider bounds or subscription eligibility.

Stock Auto observational memory uses the stock local store, 30000-token observation threshold, 40000-token reflection threshold and stock buffering. Set `memory` to `false` to disable observational memory while retaining ordinary stock history. Local embedding assets must already be present in the adapter home's stock `.cache/mastra/fastembed-models` cache. Network downloads fail closed until their exact asset routes are explicitly configured. The proof reused the installed stock cache.

Builder file tools use the contained stock filesystem. Every stock sandbox process passes through the Landlock launcher with a clean environment. Python 3, Linux Landlock ABI 3 or later, and a supported CPU architecture are required. Nested commands inherit the restriction. Failure to install it refuses the command. This provides functional file isolation under the accepted ubuntu administrator risk.

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

The control page posts its saved initialization result to the separate runner's `POST /jobs`. `GET /jobs` and `GET /jobs/:runId` return the persisted job. A duplicate Start returns the same saved job. The worker uses the saved card, orchestrator and coder selections in one Mastra Code session, then saves `ready-for-review` after its internal review, proof and candidate checks pass.

Set `BUILD_RUNNER_JOBS_DIR`, `BUILD_RUNNER_REPO`, `BUILD_RUNNER_SETTINGS` and `BUILD_RUNNER_PORT`, then launch `jobs.mjs` through `scripts/julia-agents.mjs`. Set the control service's `JULIA_BUILD_RUNNER_URL` to that runner. The exact server units used for JUL-231 are under `docs/agents/jul-231/server/`. The two services have separate lifetimes.

`machine-settings.json` selects Sol as orchestrator and DeepSeek as coder. `pstack-models.md` assigns ordinary coding and swarm work to DeepSeek, hardest work to Sol, and panels to one of each. An explicit machinery run uses the configured Beam model for its roles and self-check. A same-model machinery self-check is never independent review. These settings govern machine sessions; they do not alter the current Codex chat's settings.

Run the real browser/server Proof with the installed candidate services.

```sh
node ops/build-runner/proof/start.mjs \
  http://127.0.0.1:43126/julia-control http://127.0.0.1:43127 \
  julia-jul231-control.service docs/agents/jul-231/evidence/server-proof-20261023
```
