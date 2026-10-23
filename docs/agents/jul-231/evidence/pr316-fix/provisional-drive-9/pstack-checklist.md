# JUL-232 Feature checklist

Feature playbook steps, copied verbatim, with skip reasons where a dimension does not apply.

1. `how` over the affected subsystem.
   skip: no subsystem; the change is a single marker file with no code path or runtime behavior.
2. `architect` for parallel design exploration.
   skip: no types, signatures, or module structure; a single literal file has no design space.
3. Write the throughput checkpoint as four todo items.
   - Blocking first steps. Read the saved card and confirm exact required bytes and sole-output constraint.
   - Independent workstreams. n/a: single file, no fan-out; one writer.
   - Shared mutable state. n/a: no shared state; file is independent of product code.
   - Smallest safe decomposition. One writer owns the whole change because there is nothing to split.
4. Delegate code-writing to a subagent using the configured feature model with a specific scope and success criteria.
   done: delegated creation of BUILD-PHASE-REHEARSAL.txt to a subagent with exact byte spec.
5. Verify on the matching surface.
   done: read file bytes and compare to approved content; git diff stat checked.
6. Rebase into small, ordered commits. Stack follow-ups.
   done: single commit containing only BUILD-PHASE-REHEARSAL.txt.
7. If the design is contested, `interrogate` before shipping.
   skip: no design to contest; literal marker content fixed by card. Distinct-model review handoff completed separately below.
8. Run Opening a PR.
   skip: no GitHub remote or gh auth in this isolated worktree; card lists pull requests as out of scope. Candidate commit e1d73f5 remains on detached HEAD.

## Additional mandatory steps

- no-comments review: skip: marker file contains no comments or code; nothing to scan.
- distinct-model review handoff: done: fresh model-1 reviewer verified all five acceptance criteria and returned PASS with git evidence; commit e1d73f5.
