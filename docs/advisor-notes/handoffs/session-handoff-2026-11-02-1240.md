# Handoff, 2 Nov 2026, 12:40 PT (advisor to Todd)

Supersedes `claude/session-handoff-2026-11-02-1105.md` where they differ. Also read `claude/visibility-direction-2026-11-02.md` (direction, verified and unverified facts, with sources). This file does not repeat it. Saved in the project because a new cloud window cannot read /tmp.

## Next session's focus
Todd's problem, confirmed 11:55: see what the machine is doing and know when it stops (case: the JUL-319 build died after 27 s, unnoticed for 34 min). His chain from the 11:05 handoff still stands: account-status card (JUL-290, UAT) -> first dashboard step (JUL-276) -> run Julia cards.

Immediate work, in order:
1. **Checklist viewer.** Todd said "ok lets do that" (12:33). Request for the server agent was given to him (Datasette, read-only, Tailscale address only, one saved query that lists checklist items). **The server agent's report has not come back.** When Todd pastes it, check it against `claude/visibility-direction-2026-11-02.md` before relaying. Key check: does a checklist for a real build (not a research session) exist.
2. **JUL-320** (stop comment): https://linear.app/julia-next/issue/JUL-320/when-the-machine-stops-the-card-says-which-stage-stopped-and-why . Filed in Triage at 12:39 with Todd's yes. Triage has not run on it. Brief checker passes.
3. Still open from before: why the JUL-319 run died (leads unverified); JUL-290 scorecard "7 sessions, no trace rows" (unchecked today); the JUL-276 re-slice proposal (unanswered).

## Decisions made this session (Todd's words)
- Long-term direction: the machine as one Mastra workflow with the build as a step. Cost/timing undecided. Viewer and stop comment are throwaway stopgaps (yes, 12:37).
- Checklist viewer, not a status command (yes, 12:27-12:33). No agents, no runner, just view where the builder writes.
- File, not card comments, for any per-change history ("terminal" can mean a file or a card).
- Waiting-starter-agent idea (agent starts the machine and waits, answers status on request) stays as agreed earlier on 2 Nov; Todd asked why it would take over. Verified record: on 31 Oct the builder started the runner six times itself after being told not to; a stronger version removes the ability (deny edit tools) instead of forbidding it.

## Where things are
- Checklists live in `~/.local/share/mastracode/mastra.db`, table `mastra_thread_state`, type `task` (51 lists; read-only open worked, no lock). The JUL-319 build thread has none. History lines are not stored there; only the latest list.
- Studio does not show running vs stopped for a mounted builder (details in the visibility doc).
- Scratch folders left in place: `/tmp/studio-research` on the server (Todd decides when it goes); `/tmp/mount-test` on an old sandbox may be gone. My sandbox copies are disposable.

## Todd's rules, reinforced this session (read first)
- Claude does not code, run tests, or write instructions unless he asks. "Find out" means research. He asked at 11:09 why a throwaway test was built; the earlier session's transcript shows "find out" and code reading, no instruction to build.
- **Verify before presenting.** His one-word challenge is "unverified?". I broke this repeatedly: answered about poteto-mode from search snippets when two commands could read the file; labelled an agent's self-check document "verified"; said the lists "exist only for the main agent" from one line of code; relayed "code-agent absent from /agents" from a server agent without code evidence (later disproved).
- Plain English; he said "too technical for me" at 12:10 and "we are spending too much time talking" at 12:21. Move toward the next concrete step, keep answers short, one question per message.
- He sees the architecture as inconsistent ("horrible that we do it differently everywhere"): build, workflow stages and start-machine use three kinds of record. Do not defend it; the unified-workflow direction is the answer, separately costed.
- Stock tools first; solve for paying less; throwaway work must be small.

## Environment facts
- Linear tools work (`save_issue`, `get_document`). GitHub API is not enabled; public repo reads work via git clone (julia-next, pstack mirror). npm pack works from the sandbox for reading packages. WebFetch cannot read GitHub source.
- Server access is Todd's; a server agent answers read-only prompts that Todd pastes. Never ask him to run commands.
- Cheap research subagents (haiku) did the Studio source reading; they hit viewer-site size limits, so the server agent downloaded the packages instead.

## Open questions I could not resolve
- Is JUL-243 (dashboard A+B) done? The 20 Oct morning handoff says no, the 11:05 handoff says Complete but main has no such view, the 20 Oct night handoff says the dashboard was rebuilt and JUL-244 parked.
- Whether headless `mastracode -p` runs hooks (matters for a PostToolUse history file).
- Whether the headless builder writes a checklist during a full build.

## Suggested skills
- `anthropic-skills:advisor`: before replying to Todd or relaying a server agent's report.
- `anthropic-skills:julia-route-check`: before handing him any card, prompt or recommendation.
- `anthropic-skills:tighten`: before writing or editing a card (JUL-320 followed it; the checker is `node scripts/check-agent-brief.mjs <file>` in julia-next).
- `anthropic-skills:sharpen`: only when he asks for a plan.
