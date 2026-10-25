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

The JSON receipt contains the result and durable card account. Production settings name one shared `ledgerPath` outside job worktrees. Every role, retry and restarted run uses that card-keyed SQLite account. The ceiling is $10 across the whole card, counted from settled actual usage at published API prices, including subscription requests. The ledger records each request's maximum only to recover an unknown outcome; the maximum does not gate dispatch. Missing usage retains that maximum and blocks further priced work. A host recovering a timed-out operation may call `CardLedger.chargeUnknownMaximum(id)`. It charges that entire maximum without releasing funds and labels actual usage unknown; the account can then spend only its unchanged remainder. The maximum charge is final and cannot be replaced by a later settlement. Positive charges settle normally, including a settled cost above the recorded maximum. After a settlement makes the card's actual spend exceed $10, the ledger persists a stop and later requests are refused; the request that crossed the cap completes. A card may override its ceiling under `cardCeilings` in machine settings; `null` removes the money stop for that card, and a positive nano-dollar value moves it. JUL-252 carries `null` for the 25 October full-cost run.

Change `roles` and `providers` in production machine settings to change routes. Provider keys belong in runtime environment sources named by `credentialEnv`. The adapter captures those values, clears the process environment, and supplies the stock runtime custom-provider source. Settings contain no key values. Production `authPath` points to one stock Mastra `AuthStorage` file outside builder workspaces. The stock store owns OAuth use and renewal. Run `node ops/build-runner/connections.mjs login ops/build-runner/machine-settings.json openai-codex` for ChatGPT device authorization, or replace `openai-codex` with `anthropic` for Claude's hosted paste-code flow. Only account approval needs Todd. `connections.mjs status` with the same settings path prints sign-in booleans without credentials. A saved sign-in alone does not prove a model request.

Production machine settings do not carry a hand-written model list. `catalogue.mjs` reads the models.dev catalogue for Anthropic, OpenAI and CommandCode, adds CommandCode's own `/provider/v1/models` list and published pricing rows for models models.dev lacks, and refuses a model with no published price. The Start page offers only those three providers, filtered to the subscriptions that are signed in and the CommandCode key that is present. The worker hydrates `settings.models` and the CommandCode provider's model list from that catalogue before dispatch. Claude's stock conversation cache writes one-hour entries, priced at twice the published input rate; models.dev's five-minute write rate is not substituted. The configured request output bound is 8192 tokens from the published maximum.

Each hydrated model entry identifies an exact endpoint, wire model, protocol, input bound, output bound and published rate source. Rates are USD per million tokens for uncached input, output including reasoning, cache reads and cache writes. `chat`, `responses` and `messages` select protocol handling. Unsupported routes and missing prices are refused. Exact metadata and credential-refresh URLs may appear in `networkAllow`; their bodies cannot contain inference fields. Form-encoded refresh requests are supported.

Each request records its configured bounds and the enforced output maximum at the highest configured price tier and cache rates for unknown-outcome recovery. Paid production routes use free local estimates over the complete serialized request, including tools: Sol and Claude use bundled `js-tiktoken` 1.0.21/o200k_base with a 2x multiplier and 4096 framing tokens; DeepSeek uses twice the UTF-8 byte count plus 4096. These are deliberately padded estimates, not exact provider counts or a mathematical guarantee of server-side framing. They need no network or new credential. Media and implicit prior-response/conversation state are refused; callers must supply text context explicitly. The cap counts settled actual spend, so a worst-case maximum above the remaining balance does not refuse dispatch. Settlement always uses reported token usage and published API prices. Reported input above its estimate settles actual cost. After a settlement makes actual spend exceed $10, the card stops and later requests are refused. Unknown outcomes retain their recorded maximum. An unexpected provider overrun can already have incurred cost; stopping prevents subsequent spending and does not rewrite the actual amount.

An optional `inputTokenCountEndpoint` remains supported for deployments with suitable credentials. The public OpenAI count endpoint rejected the legacy stock ChatGPT token with HTTP 401. Todd's 23 October decision authorizes a free local tokenizer or estimate instead of another credential. The native Codex stream can omit Content-Type; the guard uses the outgoing stream flag to recognize it and still requires completed usage. Unsupported media, hosted tools, nonstandard service tiers and cache-write TTLs outside configured rates refuse dispatch. Claude retains the stock one-hour cache rate. Local fixtures prove accounting behavior; real subscription proof is recorded separately.

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
