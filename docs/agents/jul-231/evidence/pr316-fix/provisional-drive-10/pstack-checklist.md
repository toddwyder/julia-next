# JUL-232 Build-phase rehearsal marker: pstack checklist

## Playbook: Feature (adapted for single-file marker)

- [x] 1. `how` over affected subsystem. n/a: no subsystem; single marker file.
- [x] 2. `architect` for parallel design exploration. n/a: no design space; exact content specified by card.
- [x] 3. Throughput checkpoint.
  - Blocking first steps: create file with exact bytes; verify bytes.
  - Independent workstreams: n/a, single file.
  - Shared mutable state: n/a.
  - Smallest safe decomposition: one worker (this session) owns the diff directly.
- [x] 4. Delegate code-writing to subagent. Done via pstack coder (model-1, commandcode-free/reflection/beam:free). Subagent created BUILD-PHASE-REHEARSAL.txt with exact bytes and committed. Commit 2af6085. Earlier waiver was incorrect; corrected.
- [x] 5. Verify on matching surface: read file bytes, confirm exact content + one newline.
- [x] 6. Rebase into small ordered commits: one commit, single file.
- [x] 7. Distinct-model review handoff. Attempted via model-2 (deepseek/deepseek-v4.1-flash, configured interrogate reviewer). Refused by connection core: "Trial forbids nonzero model prices". Recorded as refused handoff, not a completed model-diverse review. Design is not contested (exact spec from card), so interrogate is not mandatory; verification performed by same-model checks (file bytes, commit stat, clean status).
- [x] 8. Opening a PR: open PR to main.
- [x] Retain evidence at .builder-home/pstack/.
