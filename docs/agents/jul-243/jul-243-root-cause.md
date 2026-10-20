# JUL-243 root-cause analysis

Date: 2026-10-19  
Scope: evidence-only diagnosis of PR #301 at `8368117fe7d2f25d0280deb1a8fa7727acfca467`; no product, tracker, branch, PR, or server changes.

## Evidence and closure condition

The examined checkout was exactly `8368117fe7d2f25d0280deb1a8fa7727acfca467`, with no tracked worktree changes. The immediate reason JUL-243 could not close was the required independent gate: Antigravity resolved `gemini-4-argon-high` in `.artifacts/jul-243-gemini-review/agy-round2.log:131-144`, and conversation `7767f605-ea37-4620-acee-521ac965f340` ended `VERDICT: FAIL`. The model, maker, candidate, five blocking findings, and exhausted round are recorded in [PR #301's Gemini comment](https://github.com/toddwyder/julia-next/pull/301#issuecomment-6274487766). ADR 0012 says a failed review returns the candidate for repair and forbids merge until it is accepted (`docs/adr/0012-review-uat-merge-order.md:9-14`).

The ordinary checks were not a red-capable signal for these defects: JUL-243 passed 17/17 and the full package passed 148 tests with one expected skip, while Gemini still found blocking behavior. A minimized read-only harness against the branch reproduced two findings together:

```text
running: true
updatedAt: 2026-10-19T14:59:50.000Z     # the new turn began 10 seconds ago
action.outcome: failed                   # the command envelope said “Process exited with code 0”
status: looks-stuck
statusDetail: Looks stuck: no new action for 298 min.
```

The fixture's successful command output contained the text `{"exit_code":1}`. `failed()` searched the whole output for that substring before reading the real `Process exited with code 0` envelope (`ops/mastra-agents/reviewer/src/mastra/agent-activity.ts:87-96`). The status calculation then preferred the old action time over the new turn's `updatedAt` (`agent-activity.ts:206-214`). This is the same failure mechanism as Gemini findings P1 and P3.

## 1. Findings grouped by underlying cause

### A. Primary root cause: one inferred state model was built over records that do not share a state contract

Most of Gemini's functional findings are not unrelated bugs. They are different consequences of the design stated at the top of the Framework Map: “provider records as the source of truth” projected through one normalization boundary (`docs/agents/jul-243-framework-map.md:1-3`). The same map then admits that the Codex and CommandCode record formats have no published API page and are only fixture-pinned (`jul-243-framework-map.md:12`).

The normalizer had to infer facts the source artifacts did not guarantee:

- **Success/failure** was inferred by regex over arbitrary tool output (`agent-activity.ts:87-96`). This caused Gemini P1.
- **Action meaning** was inferred from tool names and command text (`agent-activity.ts:55-74`). This caused generic or wrong labels in Gemini P5.
- **Current turn and liveness** were inferred from the last visible transcript entries, writer-lock filenames, IDE heartbeat files, and editor processes (`agent-activity.ts:99-110`; `control-server.ts:79-90,132-155`). This caused Gemini P3 and P4.
- **Current inactivity** was inferred from the newest completed action across the whole session, not a provider-defined active-turn clock (`agent-activity.ts:206-214`). This caused the reproduced 298-minute false stuck state.
- **Card identity** was inferred by scanning user-role text for the first issue identifier (`agent-activity.ts:40-52,113-139`). The round-1 review already demonstrated that injected repository instructions could supply the wrong identifier; the repair only special-cased two observed prefixes.
- **Complete history** was inferred from a 256 KiB head plus 2 MiB tail, dropping the middle of larger records (`agent-activity.ts:20-38`). That conflicts with the coding standard that a classification reads the whole record (`CODING_STANDARDS.md:44`) and underlies Gemini P2/P3.

These are separate observable bugs—each has a different trigger—but they mostly share one cause: Julia treated persistence/debug artifacts as a cross-provider event and lifecycle API. Every new provider shape or lifecycle edge therefore became another heuristic in the Julia normalizer.

### B. Secondary root cause: retention was coupled to live-card discovery and browser polling

Gemini P2 is a second design-level cause, related to but distinct from parsing. `discoverAgentDashboard()` first filters Codex files to IDs with a current writer lock, then retains only the records discovered from that active set (`control-server.ts:168-176`). That function runs inside `getAgentCards()`, which is called by `GET /julia-control/api/agents` and cached for 25 seconds (`control-server.ts:200-214`; `control-page.ts:98-99`). Therefore the code itself establishes all three facts Gemini cited:

1. no dashboard request means no Codex ingestion;
2. a session whose lock disappears before the next poll is excluded from retention;
3. an upsert replaces the stored normalized record with whatever bounded window was read (`agent-activity.ts:237-243`).

The Framework Map claimed that the table retained Codex detail across restarts and that retention did not determine live membership (`jul-243-framework-map.md:22`), but the implementation fed retention from the live-membership filter. That contradiction is direct evidence of the retention failure; it does not depend on interpreting the proof artifact's action counts.

### C. Test-model cause: fixtures encoded the assumptions instead of challenging provider lifecycle semantics

The tests were green because they mostly constructed the same simplified shapes the parser expected:

- The CommandCode lifecycle test calls the same completed `tool_result` fixture with `processRunning=false` and expects false, then with `processRunning=true` and expects true (`test/jul-243.test.ts:47-65`). The latter assertion demonstrates Gemini P4: a finished tool result is considered running whenever the editor process remains alive.
- The CommandCode discovery test explicitly expects only the newest of two sessions in a workspace (`jul-243.test.ts:82-103`), matching the production `paths.find(...)` collapse at `control-server.ts:152`; it cannot catch concurrent agents being omitted.
- Failure tests use clean synthetic envelopes or bare marker strings (`jul-243.test.ts:144-197`). They do not include a successful envelope whose stdout contains failure-looking source text, the exact P1 trigger.
- The retention test inserts a record directly and reopens the database (`jul-243.test.ts:280-293`). The dashboard retention test keeps the writer lock present for the entire test (`jul-243.test.ts:295-318`). Neither drives the unpolled or lock-removed lifecycle in P2.
- The source-combination test supplies a synthetic Mastra trace and hand-built Codex/CommandCode JSONL (`jul-243.test.ts:250-277`). It proves schema translation for those fixtures, not live-provider semantics.

This is why adding tests after the first review increased the count from 13 to 17 without creating a signal that went red on Gemini's final findings.

### D. Separate findings: UI fidelity, documentation, proof completeness, and diagnosability

These do not all derive from the private-record design:

- **Phone UI fidelity is a separate implementation defect.** The approved mockup uses short `2:44` times, the copy “From the tools' own records,” an outcome-bearing action list, and “Show all 46 actions.” The implementation uses locale times such as `11:14 AM` in a fixed 56 px column, says “From the tools owned records,” and slices at ten actions without the mockup's disclosure (`control-page.ts:93-99`). The OVH screenshot visibly wraps `11:14 AM` onto two lines; `browser.json` records the same text. This is Gemini P5's presentation component.
- **Framework Map citations were independently defective.** Gemini S1 found that the cited Mastra page did not contain the named “Storage exporter” section and the cited Zod README did not document the named object operations (`jul-243-framework-map.md:7,14`). That violates `CODING_STANDARDS.md:37`; it is a readiness/documentation failure, not a session-parser bug.
- **Root-cause logging was independently insufficient.** CommandCode inspection preserves an error as `cause` (`control-server.ts:132-155`), but the server log emits only the wrapper message (`control-server.ts:215-216`). This is Gemini S2's diagnosability component.
- **Proof coverage was independently incomplete.** The Linear pre-plan comment required live records from all three sources and both status labels. OVH `server.txt` and `browser.json` prove one real Codex process, one writer lock, one `Working` card, server retention, HTTP 200, and no console errors; they do not prove a live CommandCode card, live Mastra card, or a real `Looks stuck` transition. The proof was real but narrower than the promised proof story.

## 2. What each source officially provided versus what the branch assumed

### Codex

**Officially provided:** The installed CLI exposes `codex agents` (“Browse all agent sessions on the shared local app-server daemon”) and `codex app-server`, including a generated protocol schema. OpenAI describes app-server as a documented client protocol for creating threads, starting turns, receiving events, and controlling lifecycle; the official integration material says `turn/completed` carries a status and only `completed` means success ([Codex app-server documentation](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server); [Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)). Codex also documents lifecycle hooks for runtime events. These are explicit vendor surfaces; the branch's Framework Map did not cite them.

**What the code relied on without a documented guarantee:** The branch recursively reads `~/.codex/sessions`, assumes exact JSONL types and payload fields (`session_meta`, `response_item`, `event_msg`, `function_call_output`, `task_complete`, `turn_aborted`), identifies active sessions by matching JSONL paths to filenames under `~/.codex/thread-writer-locks`, and parses free-form output text for outcome and action meaning (`agent-activity.ts:99-139`; `control-server.ts:65-90,168-175`). The Framework Map itself says those record formats have no published API page (`jul-243-framework-map.md:12`). Nothing cited by the branch guarantees lock naming, transcript event shapes, flat ordering, output prose, or that a bounded head/tail view is sufficient for lifecycle classification.

### CommandCode

**Officially provided:** CommandCode does document durable append-only JSONL sessions at `~/.commandcode/projects/<project-slug>/<session-id>.jsonl`, but it explicitly says entries form a tree rather than a flat list ([Sessions & Checkpoints](https://commandcode.ai/docs/sessions)). It also documents deterministic lifecycle surfaces: `SessionStart`, `PreToolUse`, `PostToolUse`, and `Stop` hooks with stable `session_id`, `transcript_path`, canonical tool IDs/inputs, and tool responses ([Hooks](https://commandcode.ai/docs/hooks)); its Mods API documents run/turn/session/tool events, including `run_end`, `turn_end`, `tool_completed`, `tool_errored`, `session_start`, and `session_shutdown` ([Mods](https://commandcode.ai/docs/mods)).

**What the code relied on without a documented guarantee:** The parser flattens all session messages and treats the last serialized role as lifecycle state (`agent-activity.ts:143-174`), despite the official tree model. It uses undocumented `~/.commandcode/ide/*.json` fields (`pid`, `ideName`, `timestamp`, `workspaceFolders`) and the editor process—not an agent run—as the liveness authority, then selects at most one session path per project with `paths.find(...)` (`control-server.ts:132-155`). It assumes exact `message.content` parts and interprets arbitrary tool-result content using the same regex as Codex. The Framework Map acknowledges there is no published API page for those provider record formats (`jul-243-framework-map.md:12`). Official docs also cover headless sessions, while the code requires an IDE record, matching Gemini P4's missing headless/CLI case.

### Mastra

**Officially provided:** Mastra officially provides observability traces/spans and `MastraStorageExporter`; the installed `@mastra/observability` README says the exporter persists tracing events to configured Mastra storage for Studio (`node_modules/@mastra/observability/README.md:15-33`). Installed docs describe traces and storage (`@mastra/core/dist/docs/references/docs-studio-observability.md:10,52-73,97-105`), and the versioned public storage declarations expose `listTraces()` and `getTrace()`. The Framework Map accurately identifies that stock capability and separately notes that programmatic trace reading lacks a dedicated installed documentation page (`jul-243-framework-map.md:7-8`).

**What the code relied on beyond that guarantee:** Persistence and retrieval use the stock surface (`initialization.ts:90-103,151-176`), so Mastra is not the main source of Gemini's failures. The Julia projection still assigns product semantics: card ID from trace name/metadata, action membership from three selected `spanType` strings, failure from status text/error presence, running from absence of `endedAt`, and role/model/stage/round from optional metadata (`agent-activity.ts:177-191`). Those mappings are Julia conventions, not evidence that Mastra defines JUL-243's “running,” “same failure,” or card identity. The tests prove a real persisted workflow trace exists (`jul-243.test.ts:321`) but use a synthetic trace to prove the dashboard mapping (`jul-243.test.ts:250-277`), and OVH proof contains no live Mastra card.

## 3. Card and triage contribution

Yes. The card was structurally formatted as an Agent Brief and Todd resolved the only explicit numerical decision—15 minutes or three identical failures—in a Linear comment. Those were not the cause. The causal card defects were unresolved interface and lifecycle semantics that the admission comment treated as settled.

1. **It named artifacts, not contracts.** The card's “Key interfaces” are “Codex session records,” “CommandCode session records,” “Mastra records,” and “server-side Codex detailed run records” ([Linear JUL-243](https://linear.app/julia-next/issue/JUL-243/card-2-dashboard-a-b)). It never defines what each source guarantees about a running session, active turn, completion, concurrency, failure, or action identity. The Framework Map later admits two formats had no published API page. The repository glossary defines an Unknown as a relied-on fact that cannot be cited and says it is settled by research or a prototype before triage (`GLOSSARY.md`, “Unknown”). That did not happen for the native-provider contracts.
2. **“Keep detailed run records” had no retention semantics.** The card does not say whether “detailed” means raw provider records or normalized summaries, whether completed sessions must be captured, whether ingestion must occur without an open dashboard, or how full history survives large files. The implementation selected “normalized active records observed during dashboard polling,” which Gemini P2 showed is materially narrower.
3. **“One card per running agent” did not define running per provider.** It left multi-turn resumptions, in-flight calls, completed tool results, concurrent agents in one workspace, headless runs, and editor-versus-agent process identity unresolved. Gemini P3/P4 are exactly those missing semantics expressed as code failures.
4. **“What it actually did” did not define provenance or classification.** The card did not specify whether the list comes from lifecycle events, transcript persistence, Git, or a combination; how outcomes are determined; or how provider-specific tool names become user labels. The mockup says “From the tools' own records,” while the implementation inferred labels and outcomes from transcript strings.
5. **Mockup scope and proof scope were not made congruent.** “Match the attached approved phone mockup” appears as one acceptance criterion, while `Out of scope` says none. The mockup includes checklist, spend/allowance, active time, context/compaction, show-all behavior, outcomes, and source composition beyond the short text criteria. The implementation delivered a subset. Separately, the pre-plan's finish condition required real live records from all three named sources and both statuses, but the final OVH proof showed only one real Codex `Working` card (`.artifacts/jul-243-server-proof/browser.json`; `ovh-dashboard-phone.png`).

The admission failure was therefore not that the card lacked the standard headings. It was that research findings which should have remained Unknowns were converted into implementation assumptions: “provider records as source of truth,” unpublished formats accepted as fixture-pinnable, and a single normalization model assumed to mean the same thing across three runtimes.

## Conclusion

JUL-243 did not fail because OVH was unavailable or because the dashboard could not render. OVH showed the exact candidate, a real Codex PID and writer lock, HTTP 200, a populated card, retained data, and a clean console (`server.txt`; `browser.json`). It failed because that successful slice could not establish the required cross-provider semantics. Gemini found deterministic counterexamples in the normalization, liveness, and retention model; the existing tests encoded rather than challenged those assumptions; the proof exercised only the Codex happy path; and the independent gate correctly kept PR #301 open after the final permitted round.

## For Todd

Most failures came from treating three tools' saved files as one reliable live-agent API.
Codex and CommandCode files exposed history, but the code guessed running state, failures, and actions from undocumented details.
Mastra had a real trace API and was the least problematic source.
The card left “running,” “detailed retention,” and “what it did” undefined for each tool, even though triage called them settled.
The dashboard worked on OVH for one Codex happy path, but that could not prove the broader card.
