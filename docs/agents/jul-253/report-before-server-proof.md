> Historical report, superseded by report.md. Its Windows Proof gate was incorrect.

# JUL-253 — stock subscriptions and the card budget

Source candidate: pushed commit `a25dcbd91c53a264207d31bc0992a6cf5bff641b`, [PR 322](https://github.com/toddwyder/julia-next/pull/322). Both stock sign-ins are saved. No API key or new counting credential is needed. The card remains Implementation; no merge, full Windows Proof pass, or delivery through the pending adapted runner is claimed.

## Observed behavior

The maker drove the stock SDK in an isolated scratch workspace on this exact candidate. Each provider used its workspace tool to create `connection-proof.txt`; the proof read the actual file and asserted the literal `JUL253_BUILD_OK` plus newline, then asserted the final reply `JUL253_CONNECTION_OK`. Each completed with two accounted requests:

| Connection | API-rate budget debit | Evidence |
| --- | --- | --- |
| ChatGPT / GPT-6 Sol | 13,467,200 nano-dollars | [Sol build](evidence/final-sol-build.json) |
| Claude Pro / Haiku 5.5 | 3,787,640 nano-dollars | [Claude build](evidence/final-claude-build.json) |
| CommandCode / DeepSeek | 3,756,012 nano-dollars | [CommandCode build](evidence/final-commandcode-build.json) |

These are maker behavior proofs, not independent review. They prove real subscription access and tool-backed artifact creation, rather than only a successful sign-in or model reply. No alternate Claude connection was used.

## Counting and accounting

Todd's later 23 October decision is: “No key. Find a way to count tokens that costs nothing and needs no new credential, such as a local tokenizer or an estimate.” It supersedes the initial exact-counter prerequisite. The public count endpoint rejected the legacy ChatGPT token with HTTP 401. Neither another credential nor a different inference provider was substituted.

Paid production routes now count locally over the complete serialized request, including tools. Sol uses pinned, bundled `js-tiktoken` 1.0.21/o200k_base with a 2x multiplier and 4096 framing tokens. DeepSeek and Claude use twice the UTF-8 byte count plus 4096. Sol's configured output limit is 4096. These are padded estimates, not a claimed exact Sol tokenizer mapping or a mathematical guarantee about provider-side framing. The initial full stock Sol proof reserved 29,734 estimated input tokens; its reported input was 10,224 and settlement was $0.020538.

The shared SQLite account remains keyed by card across roles, concurrent requests, jobs and restarts. A request reserves against the remaining $2 before dispatch; retries make separate reservations. Actual reported categories settle at published API prices and applicable context tiers. Hidden prior-response/conversation state and unsupported media are refused. Reported input above its local estimate settles actual cost, stops the account and prevents later work. An unforeseen provider underestimate can already have incurred cost; the implementation does not hide that limitation or claim retrospective prevention. The ledger/stop tests prove the reservation policy, not an exact provider token bound.

Unknown outcomes retain their maxima. The host can consume the full held maximum, preserving UNKNOWN actual usage; that charge is final and cannot be refunded by later settlement. Native parent-chat usage is not visible in this machine ledger and is not claimed as counted. These are conservative budget debits, not an assertion about provider invoices.

## Repairs and discrimination

The first live stock Sol request exposed an unpriced hosted `web_search` default. The adapter now uses the installed SDK's documented `disabledTools` option. Its guard still rejects other paid hosted tools. The stock-adapter regression failed with zero dispatches before the repair, then passed with local function tools and no hosted tools.

After local counting admitted inference, the stock Codex endpoint returned completed SSE without a Content-Type header. The accounting parser had tried JSON, obscuring successful model completion. A real minimal probe returned the expected marker and complete usage; [the captured stream](evidence/codex-full-stream.txt) and [offline replay](evidence/codex-usage-replay.mjs) isolate the cause. The parser now uses the outgoing streaming flag when the response header is absent, and still requires a completed stream and usage. The new regression failed before that fix and passed afterward.

All 66 runner tests pass. All 53 mutation probes caught their injected defects, including removing local estimates, padding, underestimate stopping, hidden-context refusal, the missing-header SSE fallback and hosted-search removal. Sources were restored; the final suite passed. [Suite](evidence/local-count-suite.txt), [mutation results](evidence/local-count-mutations/mutations.json), [exact source and proof identity](evidence/local-count-source-identity.json). Framework lint passed with its disclosed legacy graph-only scope; it does not independently lint the runner. Earlier root and learning results remain historical evidence. Exact-head CI is recorded below when complete.

## Retained failed attempts

The initial HTTP 401 attempts dispatched no inference and booked no cost. A very conservative UTF-8 full-SDK proof had unrecorded usage because of the parser failure; its 771,070,000 nano maximum was permanently consumed, never refunded. A diagnostic output limit of one was rejected because the provider minimum is 16; its 6,955,000 nano maximum was also permanently consumed. Later minimal probes captured authoritative completed usage (20 input, nine output, zero cache); their outstanding UNKNOWN reservations were reconciled at 130,000 nano each before any maximum recovery. Those are known-usage settlements, not reversals of final maximum charges. [Diagnostic record](evidence/codex-rejection-probe.jsonl), [usage record](evidence/codex-usage-probe.jsonl), [stream record](evidence/codex-stream-probe.jsonl), [reconciliation](evidence/codex-stream-reconciliation.json).

Earlier timed-out, all-reasoning and rejected reviewer attempts remain in evidence and are never called passes. The first final local-count review exhausted its output on reasoning and supplied no visible report. Its successful HTTP response is not a review verdict. The larger funded retry uses the same chosen reviewer and same card ledger, within the separate $1 reviewer limit.

## Windows Proof and finish line

The [verify-machine skill](/home/ubuntu/julia-next/.agents/skills/verify-machine/SKILL.md) requires Doctor before a feature drive; its feature map requires a passing Doctor. The exact-head Doctor was executed here. It exits zero but reports `ok: false`, because its five Windows permanent-prerequisite paths are absent on this Linux server. That is **not** a pass or evidence that anything is missing from Todd's laptop. No permanent part was changed. [Doctor](evidence/final-machine-doctor.json).

This session exposes no authenticated reverse laptop route or machine connector; ubuntu has no SSH client configuration. The required Windows journey cannot be driven from this session's existing paths. [Access readback](evidence/windows-proof-access.json). No adapted `$init` delivery or retired Factory route was started. Full machine Proof and its dependent merge remain unverified; Todd's authorization to build and the saved subscription connections persist. The card is not parked and is not Complete.

## Final independent review and budget

The completed [DeepSeek review](local-count-review.md) found no new code blocker in local estimation or stream compatibility. It inspected all supplied delta code and the mutation source and recorded the five standards checks. Overall acceptance remains **INCONCLUSIVE / NOT APPROVED** because full Windows Proof is unavailable. Its two traces are static, not executed by the reviewer. It explicitly retained the estimate/absolute-cap limitation. It noted two nonblocking evidence weaknesses: the OpenAI guide in the Claude/DeepSeek estimate-source fields documents counting limitations rather than the UTF-8 implementation (the version-matched Node Buffer source is supplied in the final framework map), and collapsed parse/HTTP detail means generalized failure-root-cause logging is not fully proven. No unsupported claim of an independent integration execution is made.

The final review receipt books 1,773,192,128 nano-dollars ($1.773192128), holds zero and leaves 226,807,872 nano-dollars of the original $2. Of that booking, 1,392,770,600 nano-dollars are final conservative UNKNOWN maximum charges, not known provider usage. The remaining 380,421,528 nano-dollars derive from recorded usage. Reviewer debits total 851,134,632 nano-dollars, within the separate $1 reviewer cap. [Receipt](evidence/local-count-review-retry.json). No increase or refund was used.

## Exact-head CI and final readback

All required CI checks passed on source `a25dcbd91c53a264207d31bc0992a6cf5bff641b`: package-tests, web, server-tests and checks. [CI run](https://github.com/toddwyder/julia-next/actions/runs/40031954054), [raw checks](evidence/local-count-final-ci.json), [final readback](evidence/local-count-final-readback.json). The maker rehashed every recorded runner source file after review and CI: no proof-source mismatch, tracked diff empty. This is a self-check. CI success does not replace the unavailable Windows Proof or constitute merge approval.
