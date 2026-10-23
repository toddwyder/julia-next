# JUL-251 follow-up scoped correctness review

This is an actionable review of concurrent working files, not a final-head verdict. No repository edits, commits, provider calls, or pushes were made by this reviewer.

## Latest recheck

Rechecked the latest working candidate based on HEAD 95184190afd474fa2a2acbbfc5fd04040d36801e. No new concrete correctness finding in the scoped worker or maintenance implementation. This remains a working-tree review, not a final candidate-identity verdict.

The earlier nested browser owner finding is closed. `runOwnedTests` now runs browser tests in the owning directory with owner-relative paths. CI installs each browser owner's lockfile and Chromium structurally. A real nested Playwright fixture and the installation-routing regression both pass.

One known correction remains pending outside the originally scoped file set at review time. Root `playwright.config.mjs` still limits testDir to `.agents/skills/verify-julia/tests`, preventing a newly added root-owned browser test elsewhere from running. The parent identified this independently and the CI owner is correcting discovery. This report does not count that known pending correction as a newly found issue.

## Fixed during review

P1. A server worker crash after creating its SHA directory left `result.json` absent. Both repeated calls reproduced ENOENT and polling stopped before later candidates. The maker changed `ops/server-tests/worker.mjs` to recognize live ownership and retain/archive interrupted claims before rerunning. I reread that change and reran the two worker tests. Both passed, including the dead-claim regression. This finding is closed on the current working version.

## Outcome observations

The maintenance observer discovers verification skills through their own feature-map structure. The first-parent cursor and per-merge records suppress repeat launches, while the GitHub associated-PR lookup covers squash/rebase merges. `blocked` now writes its retained single-line report and invokes the stable vault-wrapper/Linear CLI notification route outside the sandbox. Failed notification retries on later no-merge polls. Delivered markers are recovered through comment readback, and the real Linear CLI returns the expected comment identity shape. Helper fixtures cover delivery, retry, and recovery without posting actual comments. The earlier local-file-only limitation is closed.

The maintenance sandbox mounts product source and sibling skills read-only and allows the target skill directory and disposable runtime outputs. The controller checks modified paths before publishing a changed result. The clean fixture proof does not exercise the changed publication branch or the real verify-julia map. Those limits are correctly described in the maintenance README.

## Checks performed

`node --test ops/server-tests/test/worker.test.mjs ops/verification-maintenance/test/observer.test.mjs scripts/test-owners.test.mjs` passed all six tests on the first inspected version. After the crash fix, `node --test ops/server-tests/test/worker.test.mjs` passed both tests. A manual interrupted-claim fixture reproduced ENOENT on two successive attempts before the fix. Latest combined routing/worker/observer run passed all 12 tests. The separate real Bubblewrap product-write rejection test also passed. Static inspection covered worker receipt SHA matching, ownership discovery, service/timer wiring, merge cursor/dedup, changed/clean/blocked handling, and publication scope.

Prove It Works shaped the direct interrupted-claim replay and rerun of the real worker tests. Make Operations Idempotent shaped the crash-point check against persisted claims. Both principle leaf skills were read this session.

## Separate no-comments pass

Yes... Ha ha ha... Yes!

Scope was ops/server-tests, ops/verification-maintenance, scripts/test-owners.mjs, scripts/await-server-tests.mjs, and .github/workflows/ci.yml. The exact comment-sicko reference prompt was read and applied as a separate fresh pass. Latest scoped executable code, including the new notification helper and helper fixtures, contains no explanatory comments, commented-out code, lint suppressions, TypeScript suppressions, or constraint comments to flag. Markdown headings and URLs in documentation/fixtures are not code comments.

Touched files: none. Deletion count: 0. MUST KILL flags: none. Restored comments: none. Reruns: none. Application-code edits: none. Architect sketch: not applicable. Encoding offers, encodings, unenforced constraints, and other open comment work: none.
