# JUL-254 feature build checklist

- [x] 1. `how` over the affected subsystem. Skip: the only affected repository output is a new root-level marker file; `git ls-tree HEAD` confirms it is absent. The Start request that launched this session is host-owned evidence.
- [x] 2. `architect` for parallel design exploration. Skip: no code crosses a function boundary, and the card fixes both the file name and exact bytes. The data shape is one UTF-8 text file, not a stateful model.
- [x] 3. Write the throughput checkpoint as four todo items.
  - [x] Blocking first steps. Check the base tree is clean and the marker is absent before writing.
  - [x] Independent workstreams. n/a: one new file and one candidate commit; independent reviews follow the write.
  - [x] Shared mutable state. n/a: one worker owns the sole repository file; reviewers only read it.
  - [x] Smallest safe decomposition. One DeepSeek coding worker writes the fixture; two independent model reviews inspect the resulting committed bytes.
- [x] 4. Delegate code-writing to a subagent using the configured feature model with a specific scope. DeepSeek wrote the sole 41-byte file; parent independently verified its bytes.
- [ ] 5. Verify on the matching surface.
- [ ] 6. Rebase into small, ordered commits. Stack follow-ups.
- [ ] 7. If the design is contested, `interrogate` before shipping.
- [ ] 8. Run Opening a PR. Skip: the host owns publication of the parent PR and this saved-card session owns Build only.

## Review and proof

- [ ] Run `/no-comments` before review.
- [ ] Obtain successful reviews of the actual changed files from both Sol and DeepSeek.
- [ ] Read exact marker bytes from the candidate commit and confirm it is the sole repository change.
- [ ] Confirm clean worktree and retain a factual decision trail.
