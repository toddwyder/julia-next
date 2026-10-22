# Live rules repair — 22 October 2026

Todd’s 21 October 21:03 instructions authorize moving the final rules and records to main through one PR, restoring Dashboard C to its Dashboard-only tip, and deleting superseded branches.

The rules are byte-for-byte those at 6b63d8f. This branch starts at main 1c6777f and carries the three rules changes plus the cleanup records. Original cleanup tip 0f1a953 is retained in ancestry. No Dashboard C source is included.

After merge, /home/ubuntu/julia-next is checked out on main, making the existing ~/.codex/rules/repository.rules symlink read main. Compare live bytes against git show main:.codex/rules/repository.rules and run the CLI policy check. Restore Dashboard C to 92f28f5, its exact pre-rules tip, by deleting and recreating only that branch after confirming the observed remote fb27092. This explicitly requested history correction preserves all four Dashboard commits. Delete the two superseded ops branches and this PR branch after merge.

Preflight: Codex 0.163.0; installed execpolicy check --help; gh 2.45.0 and installed pr create/merge/checks help; repository lockfiles are unchanged. No model calls, installs, updates, service changes or Windows delivery. Permanent machine prerequisites untouched. Unit/integration proof is the real policy parser and allow result in evidence/deploy-policy.json; browser and product journeys do not apply. This is repository policy relocation, not deployment. Live machine readback is maker self-check.

A checkout collision came from untracked diagnosis files already identical to main. Only byte-identical copies were removed so Git could restore its tracked files. No differing files were removed.

CI round 1 exposed stale documentation assertions already on main: they required the stop-rule prose replaced by PR311. Real local reproduction failed two cases. The smallest reversible correction updates those assertions to main’s binding problem/stop rule and the pre-plan pointer; all six documentation cases then pass. No policy text changed. Evidence retains both outputs. Independent initial review pinned 7e825ea passed Standards and found no premerge Spec defects; the assertion correction receives a follow-up review.
