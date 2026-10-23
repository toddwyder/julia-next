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

The JSON receipt contains the result and the durable card account. `cards.sqlite` belongs in the same state directory for every process serving that card. Reopening it retains settled costs, unresolved reservations and stops. The production adapter refuses every nonzero model price during this $0 trial. A positive provider cost field durably stops all subsequent requests, including free requests and metadata calls.

Change `roles`, `providers` and `models` in settings to change routes. Provider keys belong in runtime environment sources named by `credentialEnv`. The adapter captures those values, clears the process environment, and supplies the stock runtime custom-provider source. Settings contain no key values. An optional `authPath` points to an existing stock Mastra `AuthStorage` file outside the builder workspace for API keys or subscription sign-ins. The stock store owns OAuth use and renewal. No live subscription sign-in or renewal was performed for this card.

Each model entry identifies an exact endpoint, wire model, protocol, input bound, output bound and published rate source. Rates are USD per million tokens for uncached input, output including reasoning, cache reads and cache writes. `chat`, `responses` and `messages` select protocol handling. Unsupported routes and missing prices are refused. Exact metadata and credential-refresh URLs may appear in `networkAllow`; their bodies cannot contain inference fields. Form-encoded refresh requests are supported.

Paid reservations use the full configured maximum input and enforced maximum output at the highest applicable rates. This can reject a request that would have been cheap. Before enabling paid use outside this trial, settings must cite provider-enforced bounds and correct published rates for that exact model. Unsupported paid media are refused. Local paid protocol fixtures prove accounting behavior without spending money; they do not establish any live paid provider's bounds.

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

`machine-settings.json` selects Beam for both machinery roles. Its configured DeepSeek helper is refused by the connection core's active zero-spend trial policy before upstream dispatch. `pstack-models.md` records Todd's normal Sol/DeepSeek split; it does not alter Codex's settings.

Run the real browser/server Proof with the installed candidate services.

```sh
node ops/build-runner/proof/start.mjs \
  http://127.0.0.1:43126/julia-control http://127.0.0.1:43127 \
  julia-jul231-control.service docs/agents/jul-231/evidence/server-proof-20261023
```
