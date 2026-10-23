# JUL-251 design cross-judgment

Both candidates inherit the parent model under the $0 trial. This is independent cross-judgment, not different-maker review.

Scores: 0 = absent/unworkable, 1 = plausible with unresolved proof, 2 = strong design supported by installed-source evidence.

| Criterion | A | B | Reason |
|---|---:|---:|---|
| Stock routing and memory preservation | 0 | 1 | A explicitly cannot cover internally resolved models. B preserves stock construction, pending live local interception of main, observer, reflector and retries. |
| Per-attempt retry accounting | 1 | 2 | A's model hook has correct granularity where installed but incomplete reach. B reserves at final fetch dispatch, including each transport retry. Must prove no bypass or hidden redirect dispatch. |
| Enforceable predispatch bound | 2 | 2 | Both require conservative full-context reservation plus provider-enforced output bound, integer arithmetic and durable uncertainty. Provider limits remain evidence requirements, not assumptions. |
| Credential isolation feasibility | 1 | 1 | A names isolation without implementation; B specifies a separate uid unavailable in this harness. Landlock ABI4 offers a plausible filesystem boundary, but requires command/nested-command/parent-process credential probes. Environment filtering alone is insufficient. |
| Small public API and settings-only changes | 2 | 2 | Both hide lifecycle/accounting. B also derives SDK provider configuration from one settings source; changes to roles/model mappings must preserve stock memory Auto semantics. |
| Total | 6/10 | 8/10 | B is the viable prototype base, conditional on interception and isolation learning tests. |

## Synthesis

Use B as the base. Graft A's explicit admission that normalized model wrapping cannot cover the stock factory, its exact resolver evidence, and the reserved/settled/unknown model. Preserve one ledger owner and one production SDK importer. Free attempts may be represented as settled zero with optional usage rather than introducing a parallel accounting path, provided missing paid usage cannot become zero.

Replace B's unavailable separate-uid launcher with an empirically proven Landlock command launcher. If Landlock cannot protect worker credentials and sensitive process access for every command path, report that isolation is unproven and do not claim acceptance. No speculative uid/sudo/bwrap dependency.

## Red-flag screen

Neither public API is shallow: runCard owns a meaningful full operation. B's protocol parsing duplicates provider knowledge, but keeps wire formats private and does not leak them to callers. Keep protocol-specific maximum and settlement logic together; avoid separate generic selector/config layers that let settings encode arbitrary parsing programs. Do not maintain a second provider/role list. Do not add public reserve/settle APIs, controller-usage accounting, or a second inference path. A model hook and transport ledger in parallel would create two ways to account for one request.

## Gates before implementation claims

1. Local installed-SDK learning test must show main, stock observer, stock reflector and forced retries all hit the guard installed before import; verify non-streaming and streaming paths in scope.
2. Unknown inference destinations and redirects must fail closed before dispatch; authentication/catalog exceptions must not admit inference bodies.
3. Landlock credential probe must cover direct commands, nested shells, worker files, environment and sensitive process paths; builder must not be able to weaken the sandbox.
4. Paid limit proof requires exact provider-enforced input/output bounds including reasoning/cache categories. Free live evidence cannot establish paid-provider limits.
5. First-response missing usage can only be detected after dispatch; acceptance should prove refusal of its result and all subsequent paid dispatches. Preexisting uncertainty separately proves nothing is sent.
6. Persist the trial $0 ceiling independently of the card $1 implementation. Any positive live readback stops work.

Verdict: choose B with A's durable uncertainty and source-backed coverage findings. Proceed to the bounded local prototype; do not describe the proposed fetch and Landlock boundaries as proven until the gates pass.
