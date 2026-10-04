# Factory storage operations

This is the operating process for the self-hosted Factory on the 72 GB OVH
root disk. The Factory operator owns the checks and cleanup. This runbook
records the **manual procedure in use now**. An hourly host-side monitor has
been written and syntax/threshold-tested on the target host, but its
notification timer is **not installed or enabled**. Trace retention is also
not installed. Do not treat either proposed control as active.

## Current baseline

On 2026-09-29, the observability DuckDB file was 15.3 GB and Factory sandboxes
used about 12 GB. Free disk space was 8.8 GB (88% used). Removing Git-ignored
`node_modules` from three completed, unused sandboxes restored free space to
**14 GB (82% used)**. The sandboxes' source and Git state were left intact, and
Factory remained active. The [live trace audit](../../docs/research/factory-cost-metric-live-check-2026-09-29.md)
records what is in DuckDB.

## Capacity rule

Check the **free bytes on `/`**, not just percent used. These thresholds leave
room for a new sandbox, package installation, trace writes, and a database
checkpoint:

| Free space | Action |
| --- | --- |
| 15 GB or more | Normal operation. Record daily trend. |
| 10–15 GB | One new Factory card at a time. Review completed sandbox caches after each card. |
| 5–10 GB | Do not start a new card. Recover space from verified completed sandboxes and check trace growth. Notify Todd. |
| Less than 5 GB | Pause new Factory work. Preserve the live database and WAL. Recover space or expand/offload storage before resuming. Notify Todd immediately. |

The 10/15 GB thresholds are operating margins, not measured Factory limits.
Revisit them after several cards of observed peak disk use.

## Routine

1. **Daily, and before starting a card:** record free bytes on `/`, DuckDB and
   WAL bytes, total sandbox bytes, and the change since the prior check. Check
   that `julia-factory-trial.service` is active. The read-only commands
   `df -h /`, `stat` on the two observability files, and
   `du -sh /var/lib/julia-factory/sandboxes` have been used on this host. Run
   protected-file checks as `julia-factory` or through `sudo`. The prepared
   hourly deterministic host timer can replace the manual check only after the
   outbound alert payload and destination are authorized; until then, it
   remains disabled.
2. **At card retirement:** delete a whole sandbox only when all three gates
   pass. Log the session, decision, and reason.

   - **Idle:** no process runs in the root and no file is open there. Check
     again immediately before deletion.
   - **Clean Git state:** tracked files are unchanged. Ignored files must be
     only in the named dependency/build/cache allow-list (`node_modules`,
     `.cache`, `.next`, `.npm`, `.pnpm-store`, `build`, `dist`) or Factory
     working folders. Factory's own working folders do not block deletion
     whether ignored or untracked: `.artifacts/` (all subfolders), `.julia/`,
     `test-results/`, and `__pycache__/` (including untracked python bytecode
     such as `ops/julia-runner/__pycache__/`). Loss of their contents is
     accepted. Any changed tracked file (even under `.artifacts/`), other
     untracked file, non-allowlisted ignored file, submodule, Git LFS
     pointer, or symlink pointing outside the root fails this gate and keeps
     the sandbox.
   - **Recoverable content:** every commit is on a GitHub branch, or every file
     post-image (or deletion) from an otherwise-unbranched commit appears
     somewhere in `origin/main` history for that path. An unknown answer fails.

   Resolve the absolute, symlink-free immediate child of
   `/var/lib/julia-factory/sandboxes` and remove only that root. A failed check
   or removal keeps it.

   **Retirement hook (stock `teardownCommand`):** Factory invokes
   `projectRepository.teardownCommand` inside the repository checkout
   (`entry.workdir`) upon session retirement (`@mastra/factory`
   `dist/sandbox/session-retirement.js`). The retirement hook is:

   ```sh
   node ops/factory/sandbox-cleanup.mjs --session-root .. \
     --log /var/lib/julia-factory/sandbox-cleanup.ndjson
   ```

   **One-day re-test:** Sandboxes kept at retirement are re-tested 24 hours
   later. Run the re-test daily:

   ```sh
   node ops/factory/sandbox-cleanup.mjs --retest \
     --sandbox-root /var/lib/julia-factory/sandboxes \
     --log /var/lib/julia-factory/sandbox-cleanup.ndjson
   ```

   Kept roots whose `retryAt` timestamp has elapsed are evaluated again. If a
   sandbox now passes, it is deleted (when `--allow-delete` is enabled) or
   logged as `would-delete`. Any sandbox that still fails is logged with a
   refreshed `retryAt` and printed to stderr with its failed gate and reason.

   **Dry-run audit over all sandboxes:**

   ```sh
   node ops/factory/sandbox-cleanup.mjs --all \
     --sandbox-root /var/lib/julia-factory/sandboxes \
     --log /var/lib/julia-factory/sandbox-cleanup.ndjson
   ```

   Do not enable deletion (`--allow-delete`) until the approved exceptions-list
   entry and the operator's live dry-run evidence exist.
3. **Weekly:** review sandbox sizes and identify completed sandboxes with
   repeatable caches. Review DuckDB growth and trace completeness. Decide
   whether the current free-space trend can accommodate another week of work.
   Record actions and before/after sizes in an operations log.
4. **Monthly:** review whether the 72 GB disk is still adequate. If the trace
   database or normal card volume requires more space than the operating
   margin, enlarge the volume or move archived traces off the root disk. Do
   not rely on repeated emergency cleanup as the capacity plan.

## Trace retention change

The installed Mastra version supports `excludeSpanTypes`; its documentation
shows `MODEL_CHUNK` and `MODEL_STEP` as low-detail candidates. Before changing
production tracing, run one representative card with the proposed filter and
verify model-generation, token, cache, and cost metrics still join to the work
item. Only then enable the filter for new traces. Set a retention period and
archive the small accounting records needed for cost comparisons before
removing old raw spans. The retention period is **not chosen or enforced yet**;
it depends on measured growth after filtering and how long debugging traces are
needed.

Do not delete the live DuckDB file or its WAL. DuckDB documents that `VACUUM`
does not reclaim deleted disk space; deleting old rows followed by `CHECKPOINT`
can reclaim some space. Full compaction needs a new database file, which cannot
safely be created on the current root disk while only 14 GB is free and the
existing file is 15.3 GB. Arrange external or expanded capacity before
attempting that operation.

## Recovery check

After any cleanup or storage change, record free bytes and file sizes again,
confirm `julia-factory-trial.service` is active, and verify a new completed
card still produces the model metrics used in the cost audit. If the cleanup
fails to restore at least 10 GB free, keep new cards paused and expand/offload
storage before continuing.
