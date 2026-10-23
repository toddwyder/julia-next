# JUL-232 build checklist

## Feature playbook steps

- [x] 1. `how` over the affected subsystem. skip: no subsystem; single marker file.
- [x] 2. `architect` for parallel design exploration. skip: no design; trivial file creation.
- [x] 3. Write the throughput checkpoint as four todo items.
- [x] 4. Delegate code-writing to a subagent. skip: single mechanical file; owned directly with review separation via byte verification.
- [x] 5. Verify on the matching surface. Verified exact bytes with od.
- [x] 6. Rebase into small, ordered commits. Single commit.
- [x] 7. If the design is contested, `interrogate` before shipping. skip: no contested design.
- [x] 8. Run Opening a PR. skip: PR out of scope per card.

## Throughput checkpoint

- Blocking first steps. Read saved card and confirm exact requested bytes.
- Independent workstreams. None beyond the single file.
- Shared mutable state. Worktree HEAD only; one writer.
- Smallest safe decomposition. One commit with one file.
