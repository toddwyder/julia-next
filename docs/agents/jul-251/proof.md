# JUL-251 proof

The adapter is `ops/build-runner/adapter.mjs`. Its owning installation pins SDK 1.14.0 in its own lockfile. It is the only production SDK importer. The household application and delivery orchestration are outside this change.

| Acceptance criterion | Evidence | Result |
| --- | --- | --- |
| Stock routing and settings-selected roles | `evidence/build/free-beam-request.txt`, `ops/build-runner/settings.json` | Real Beam request returned JUL251_OK. An Ornith attempt and a settings-only Beam selection show route changes without provider branches in core. |
| Durable shared accounting for every request | `evidence/build/all-local-green.txt`, `evidence/build/memory-final.txt`, `evidence/build/restart-live.txt` | Real stock observer, reflector and actor attempts share one ledger. A fresh process reads the same three zero-cost rows. Subprocess races and uncertain exits retain reservations. |
| Unknown prices, ceiling and unknown usage | `ops/build-runner/test/transport.test.mjs`, `ops/build-runner/test/ledger.test.mjs` | Real local HTTP arrivals prove no dispatch for unpriced, over-cap and previously unknown paid requests. Free missing usage settles zero. Paid missing usage refuses its result and blocks later priced attempts. |
| Credentials outside builder commands and files | `evidence/build/live-credential-boundary.txt`, `ops/build-runner/test/review-regressions.test.mjs` | Direct and nested command probes cannot read credential files or inherited secrets while the adapter's real free request succeeds. Symlink cases are rejected or denied. |
| Stock Auto memory active | `evidence/build/memory-final.txt`, `evidence/build/memory-off.txt` | Real observation, normal-turn reflection and exact-word recall pass after removing raw history. Memory-off creates no OM engine and sends no memory request. |

The missing-usage requirement has a timing distinction. A missing response field can only be discovered after the first request. The adapter refuses that response and refuses later priced requests before sending them. It does not claim to detect absent response usage before sending its first request.

The real memory fixture repeats the real generated observation to cross the stock reflection threshold. It does not lower thresholds, replace Auto selection, fabricate model responses or claim a natural long conversation. The stock local embedding cache was copied into the isolated proof home. Earlier failed manual-reflection attempts are retained as negative evidence; none dispatched Google inference.

The real provider model is published as free at [CommandCode pricing](https://commandcode.ai/pricing), checked 22 October 2026. All recorded real requests and the fresh ledger readback remain $0. Paid accounting cases use a local HTTP fixture only. No live subscription, live paid route or renewal is claimed.

The full framework suite passed 17 tests with zero skips through `scripts/julia-agents.mjs`. `evidence/build/framework-full-2.txt` retains the run. The first baseline failed because root ESLint was absent; restoring the committed root dependencies fixed the fixture without weakening its assertion. The first full-suite attempt used an unsuitable ledger path directly in `/tmp`; the corrected isolated subdirectory avoided scanning unrelated temporary directories.

The SDK retry fixture returns HTTP 503 once, then success. Both arrivals must have separate ledger entries. The independent review found four defects, all fixed with regression checks in the final candidate. See [review findings](review.md) and the mutation report in `evidence/build/mutations.json` for guard failures and restored checks.

The trial model configuration makes all review roles inherit the builder's signed-in model. The design judge and code reviewer were fresh agents of that model. They are not different-maker adversarial review. The comment review found no comments or suppressions to remove.

The sandbox makes the shared worktree gitdir read-only. Delivery commands use `GIT_DIR=.julia/git` with local metadata and shared read-only objects. The original `.git` pointer and shared refs were left intact. The PR branch is still `hybrid/pstack-trial` on GitHub.
