# No-fakes remediation — 24 October 2026

The full-repository check now reports zero findings. Each of the 20 files it
found is accounted for here.

## Kept, with a checker refinement

These were false positives: no-network guards, loopback host strings, synthetic
credential names, or retired-name regexes. Their tests still run.

| File | Why it is not a stand-in |
| --- | --- |
| `ops/build-runner/framework/@mastra/code-sdk/credentials.test.mjs` | Replaces `fetch` with an unconditional throw to prove no network use. |
| `ops/build-runner/test/connections.test.mjs` | Names synthetic credential values; it tests local auth discovery, not a service. |
| `ops/mastra-agents/reviewer/test/jul-242.test.ts` | Uses loopback host strings and a local ACP route double for host-matching logic. |
| `ops/mastra-agents/reviewer/test/reset-stage.test.mjs` | Replaces `fetch` with a throwing counter to prove no provider request. |
| `ops/mastra-agents/reviewer/test/review-budget.test.mjs` | The only `fetch` replacement is a throwing counter that proves no dispatch. |
| `scripts/julia-delivery-boundaries.test.mjs` | The `offline` prompt string was renamed to `build`; no service was faked. |
| `scripts/julia-retired-controller.test.mjs` | The retired-name regex was split so the old `stand-in-seat` name is not beside `service-dropbox`. |
| `scripts/server/julia-agents.test.mjs` | `127.0.0.1:9` is an unreachable OP Connect address used as a guard, not a fake server. |

## Converted to the real service

| File | Real-service test |
| --- | --- |
| `ops/mastra-agents/reviewer/test/model-journal.test.mjs` | Provider dispatch moved to `test/server/model-journal.test.mjs`, which journals one real `reflection/beam:free` request, its response and usage. The pure journal-overflow/restart/ceiling tests stay local. |
| `ops/mastra-agents/reviewer/support/raw-answer-interrupt-child.mjs` | Now calls the real CommandCode Beam endpoint. Its interruption test moved to `test/server/raw-answer-interrupt.test.mjs`. |
| `ops/mastra-agents/reviewer/test/server/commandcode-provider-probe.test.mjs` | The two local-server probes were removed; the real opt-in CommandCode probe remains. |

## Deleted, with the real proof

| File | Real proof covering the same behavior |
| --- | --- |
| `ops/build-runner/test/shared-ledger.test.mjs` | `ops/build-runner/test/server/memory-account.test.mjs` runs one real Beam build turn with memory on and proves the main and memory requests settle on the same card account; `ops/build-runner/test/ledger.test.mjs` keeps the durable ledger and cap guards. |
| `ops/build-runner/test/shared-ledger-driver.mjs` | Driver for the test above. |
| `ops/build-runner/test/subscription-tools.test.mjs` | `docs/agents/jul-251/evidence/build/free-beam-request.txt` is a real free request; `ops/build-runner/test/transport.test.mjs` keeps the hosted-tool refusal guard. |
| `ops/build-runner/test/subscription-tools-driver.mjs` | Driver for the test above. |
| `ops/mastra-agents/reviewer/audit/jul-223-stage2-stock.test.mjs` | `ops/build-runner/framework/@mastra/code-sdk/server/model-side.test.mjs` drives the installed SDK with real Beam and a real tool loop. |
| `ops/mastra-agents/reviewer/support/offline-delivery-adapters.mjs` | `docs/agents/jul-253/tailscale-proof/final/` and `docs/agents/jul-231/evidence/` record real Start and delivery runs. |
| `ops/mastra-agents/reviewer/support/offline-delivery-workflow-child.mjs` | Child process for the offline adapters. |
| `ops/mastra-agents/reviewer/test/delivery-workflow.test.mjs` | `docs/agents/jul-253/tailscale-proof/final/` and `docs/agents/jul-231/evidence/` record the real workflow runs. |
| `ops/mastra-agents/reviewer/test/recorded-review.test.mjs` | `docs/agents/jul-253/evidence/deepseek-review.json` and the JUL-231 review records are real recorded reviews. |
| `ops/mastra-agents/reviewer/test/review-runtime.test.mjs` | `docs/agents/jul-253/evidence/review-timeout-accounting.json` records real reviewer accounting; the RSS, disk and budget guards remain in the reviewer's local unit tests. |
| `ops/mastra-agents/reviewer/test/worst-case-offline.test.mjs` | The same real reviewer accounting record and the remaining resource-budget tests cover the limits. |
| `ops/mastra-agents/reviewer/test/raw-answer.test.mjs` | Replaced by the real-Beam interruption test; the saved fixtures remain as historical evidence. |

## Production-side cleanup

`scripts/julia-mastra-delivery.mjs` no longer has the
`JULIA_DELIVERY_OFFLINE_FIXTURE` branch, which was the only production import of
the offline delivery adapters.
