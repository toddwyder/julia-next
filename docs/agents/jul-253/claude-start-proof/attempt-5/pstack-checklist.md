# JUL-262 build checklist

Feature playbook steps, as run.

1. [x] `how` over the affected subsystem. Ran as a read-only DeepSeek investigation (`commandcode/deepseek/deepseek-v4.1-flash`, "how explorer" line). Finding: the marker has no in-repo consumer. The only mentions are card and evidence text under `docs/agents/jul-253/`.
2. [x] `architect` for parallel design exploration. Two runners: `anthropic/claude-haiku-5-5` and `commandcode/deepseek/deepseek-v4.1-flash`. Both agreed the shape is minimal. Adopted: a commit-scoped path-set check (`git diff-tree`). Rejected: a hash pin, because the byte compare already covers content.
3. [x] Throughput checkpoint.
   - Blocking first steps: clean-tree and marker-absent check, done before the write.
   - Independent workstreams: n/a, single file.
   - Shared mutable state: n/a, one writer, no shared path.
   - Smallest safe decomposition: one coder, one file. Two reviews run in parallel and read only.
4. [x] Code-writing delegate on the configured feature model (`commandcode/deepseek/deepseek-v4.1-flash`). First attempt FAILED: the sandbox blocked writes to `/tmp`, so it produced nothing. Second attempt PASSED: it wrote `.builder-home/pstack/coder/JUL-253-START-PRACTICE-4.txt`, 39 bytes, cmp-identical to HEAD. Shape: a constant string and one write, no branching. Interrupted-run note: the first attempt is not counted as the coder run.
5. [x] Verify on the matching surface. Committed blob at HEAD: 39 bytes, `cmp` against the marker plus LF identical, commit path set exactly `A JUL-253-START-PRACTICE-4.txt`.
   - Review handoff of the actual changed file (`.builder-home/pstack/review/handoff.diff`, `handoff.tsv`): both configured panel models received the diff and returned PASS. `anthropic/claude-haiku-5-5` is the different-model review. `commandcode/deepseek/deepseek-v4.1-flash` is a same-model check, since it wrote the file.
   - Earlier reviews only pointed at the file path and are superseded by this handoff.
6. [x] Small ordered commits. One commit: `bdcccd2`, marker only. Verified nonempty and single-file.
7. [x] `interrogate`: n/a, not contested. The two architect runners agreed on the shape, and the card fixes the bytes. Reason recorded here, not a skip of a contested design.
8. [x] Opening a PR: out of scope. The card forbids publishing the marker, the host owns publishing, and AGENTS.md's PR rule conflicts with the card. Open question flagged to Todd. No branch exists (HEAD is detached), so no push was made.

Out of scope for this session, per the card: Start page, browser, servers, Tailscale, the ledger, earlier practice cards, accounting, and the cap.

Evidence:
- `.builder-home/pstack/decisions.tsv` (append-only corrections below the original rows)
- `.builder-home/pstack/coder/JUL-253-START-PRACTICE-4.txt` (coder output, gitignored)
