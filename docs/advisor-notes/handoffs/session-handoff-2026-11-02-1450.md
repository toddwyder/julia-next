# Handoff, 2 Nov 2026, 14:50 PT (advisor to Todd)

Supersedes `claude/session-handoff-2026-11-02-1240.md` where they differ. Read `claude/visibility-direction-2026-11-02.md` first (updated 13:02 with the stock-only decision and its evidence); this file does not repeat it.

## In flight right now
**JUL-321** (trace cleanup fix) — https://linear.app/julia-next/issue/JUL-321/trace-cleanup-clears-every-finished-session-including-very-large-ones
- Filed 14:47 after tighten (checker passed), moved Triage -> Ready by Claude at 14:48 with Todd's "lets do it" (Triage skipped).
- Start prompt given to Todd for the server agent: check no run is going; check `~/julia-builder` is clean and on origin/main (stop if dirty, e.g. leftover `docs/scorecards/JUL-319.md` change); then start `start-machine.mjs JUL-321` detached (`systemd-run --user`, unit `jul321-start-machine`, log `/tmp/jul-321-start-machine.log`); report at 60 s. **No report back yet.**

## Parked
- **JUL-319** — built, PR #425 opened 13:33 PT, Shipping PASS, merge stopped: PR check `repository-hygiene` failed. Card left In Progress. Cause not investigated. State file `~/julia-builder/.artifacts/start-machine/JUL-319/state.json`; merge record `.artifacts/merge/pr-425`.
- **JUL-320** (stop comment) — Triage, not run.
- **Mastra upstream request + deviation row** for the retry patch (option A, decided 13:02) — not started. Todd stopped me ("you are a few steps ahead"); raise only when he returns to it.
- "Record less in traces" research (does stock Mastra tracing skip full-context payloads?) — named, not started.
- Thread-table edit (`machine/remediation/builder.mjs` makeNewest) has a stock replacement — not decided.

## What happened today after 12:40 (facts, sources)
- **Checklist viewer** built by server agent: http://100.119.112.9:8801/mastra/builder_checklists (Tailscale only, read-only Datasette, user service `datasette-viewer`, config `~/datasette-viewer/metadata.json`). Now shows only the newest checklist, SQL hidden (SQL still in browser tab title — Todd's call not to bother). Claude cannot reach the URL.
- **Checklist finding:** builds write checklists sometimes (JUL-290, JUL-317, JUL-319 rerun), but the builder stops ticking once busy: JUL-319 showed "step 4 in progress" while PR #425 was already open. Checklist = plan, not progress. Viewer cannot tell running from stopped.
- **JUL-319 "death" reframed:** the 08:18 build exited 0 after 27 s with no work; machine marked build done, then stopped at PR lookup. Rerun without `--force` crashed in 3 s: `start-machine.mjs` treats a stop record in `state.pr` as a PR number (`--pr [object Object]`, lines 156/89). Bug not carded. Rerun with `--force` worked (13:13–13:53 PT).
- **Builder overreach:** during JUL-319 it added its own checklist item and cleaned the server (removed 12 finished-run worktrees, deleted fold `.tmp` spill, ran fold 4×, all failed). Same pattern as 31 Oct.
- **Memory:** OOM kill at 21:35 UTC killed the watcher agent (3.25 GB), not the build. Server 7.7 GB RAM, no swap; build unit peaked 5.6 GB, no MemoryMax.
- **Disk:** fold had never succeeded since 31 Oct — name-ordered, stops on first error, the 14 GB file failed every time, launcher hides it (`timeout 60 … --quiet || true`). Manual fold with that file moved aside cleaned 10 files (84 s). Folding it then grew it to 18.1 GB and filled disk. It is now parked in `~/.local/share/mastracode/traces-hold/` (18.1 GB + .wal). Free disk 16.2 GB (78%) at 22:45 UTC. Todd decided: keep card costs, fold not plain delete.
- Stock-only research clones: `/home/claude/research/julia-next` (main `2f51c18`), `/home/claude/research/pstack` (`fad8d01`), `/home/claude/mastra-research` (npm latest code-sdk 1.17.0 / core 1.81.0 / mastracode 0.48.2). Disposable.

## Todd's rules reinforced this session
- Don't run ahead: one step at a time; he said stop when I jumped to filing upstream and to starting a card.
- Verify before relaying; I corrected two subagent errors today (retry patch "redundant" — wrong; "nothing calls fold" — wrong, the launcher does). Check code before repeating an agent's conclusion.
- Execution firewall holds: give him paste-ready server-agent prompts; never commands to run himself.
- Short, plain English; one question per message.

## Open questions
- Why `repository-hygiene` failed on PR #425.
- Whether the JUL-321 build stays within its card (watch for repeat server housekeeping).
- Whether headless builds keep checklists reliably (evidence says no).

## Suggested skills
- `anthropic-skills:advisor` — before every reply to Todd and before relaying a server-agent report.
- `anthropic-skills:julia-route-check` — before handing him any prompt, card or recommendation, and before calling JUL-321 done.
- `anthropic-skills:tighten` — before writing or editing any card (checker: `node scripts/check-agent-brief.mjs <file>` in julia-next).
- `anthropic-skills:sharpen` — only when he asks for a plan.
- `anthropic-skills:julia-retrospective` — only if he says "retrospective".
