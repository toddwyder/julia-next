# JUL-203 installation evidence (2026-10-09)

Outcome: installation prepared; acceptance is blocked on actual Claude Code and
OMP canonical loading proof. Review is reserved for Gemini at Todd's request.

## Revision and scope

Working branch: `jul-197-comprehensive-ci-gate-cleanup` (the current branch Todd
instructed the implement skill to use).
Base: `164be44a818a84e5bf73089b9a03a0a9635fb223`.
Candidate: the commit adding this record; identify it with
`git log -1 --format=%H -- .artifacts/jul-203/verification.md`.

Upstream: `backnotprop/pstack`, commit
`3a604672c46cd8187d2b19980eae0a34f9f91138`.
[File manifest, immutable hashes, and reproduction](../../.agents/skills/PSTACK-SOURCE.md).
The original MIT license is retained alongside that manifest.

Exactly four skill directories, three required generator references, license,
and provenance were installed. All seven upstream skill/resource blobs and the
license compare equal in the source checkout, working tree, and Git index.
`git add -f --` selected only those nine installation files despite the local
`.git/info/exclude` entry for `.agents/`; the exclusion was not changed.

To repeat the content proof, for every manifest entry compare:

```text
git -C <pinned-source-checkout> rev-parse HEAD:<upstream-path>
git hash-object <installed-path>
git rev-parse :<installed-path>
```

All eight comparisons passed (exit 0). The last command checks staged inclusion;
after commit use `git rev-parse HEAD:<installed-path>` instead.

## Harness proof and limitation

- Codex: this active Codex session explicitly read each installed
  `.agents/skills/<name>/SKILL.md` with its shell tool. The four names, complete
  contents, and byte hashes were read; no workflow was executed. This proves
  explicit file access, not refreshed automatic skill discovery.
- Claude Code: `claude --version` exited 0, version `2.1.284`. These four names
  are absent from the inspected project `.claude/skills` and user Claude skill
  locations. No actual Claude skill load/read was demonstrated.
- OMP: `Get-Command omp` failed with CommandNotFoundException. The inspected
  project/user OMP/Pi locations do not contain these four skills. The WSL check
  `wsl --exec sh -lc 'command -v omp'` also found no executable. No certified OMP
  route or actual OMP skill load/read was demonstrated.
- `codex --version` exited 0 (`codex-cli 0.160.1`); Node `v24.14.1`.
- A targeted check found no copies of these four names in inspected project
  `.claude`, `.codex`, `.pi`, `.omp` skill locations or their user counterparts,
  user `.agents/skills`, and user Claude `synced`. It does not certify unlocated
  plugin/provider routes.
- Linear reads show JUL-190, JUL-191, and JUL-192 Complete; their returned cards
  have no comments or attached evidence identifying the certified routes.
  Those cards were not changed. The actual base still has separate older
  `.agents`/`.claude` collections, so broad cleanup was not inferred.

No new harness, skill tree, hook, controller, memory feature, scheduled audit,
model substitution, or model call was added. No Factory or runner work occurred.

## Validation

- `node --test scripts/line-endings.test.mjs scripts/agent-docs.test.mjs`:
  exit 0; 9 passed.
- `npm run lint:framework`: exit 0; existing linter reports no graph/langgraph.
- `node --test --test-timeout=120000 'scripts/*.test.mjs'`: exit 1;
  905 tests: 885 passed, 6 failed, 14 skipped, 0 cancelled; 300.8 seconds.
  Raw local output: `.artifacts/jul-203/full-suite.tap` (retained outside commit).
  SHA-256: `b914f353f51624abf2890f3f374b8c2e6c6715738b597c27ad6edb80fe83cb03`.
  Failures in unchanged test/runtime files:
  `scripts/bad-submissions.test.mjs` (Windows absolute ESM URL),
  `scripts/controller-main.test.mjs` (expected read-only rejection absent),
  two `ops/factory/app/local-sandbox.test.mjs` tests (bwrap unavailable on win32),
  `ops/factory/skills.test.mjs` (existing duplicate `ask-matt`), and
  `scripts/test-wrappers.test.mjs` (older wrapper coverage assertion).
  No green full-suite claim is made.
- `node --test --test-name-pattern='each project skill' ops/factory/skills.test.mjs`:
  exit 1; confirmed the failure names the older `ask-matt` duplicate, not a
  newly installed Pstack skill. No remediation outside this slice was attempted.
- Typechecking: not applicable to unchanged Markdown/text skill installation;
  there is no root typecheck script. No artificial unit tests were added.

## Acceptance and next slice

Source integrity/provenance and Git inclusion pass. Actual access across all
three harnesses remains unproved, so JUL-203 is not complete and JUL-204 must not
start on this handoff. Installation exclusions pass: no unrelated skill,
maintenance/generation invocation, infrastructure, or broad migration.
Historical GitHub #197 and JUL-192 remain untouched.

Recover the already-certified harness routes and perform read-only actual skill
loading before resuming acceptance. Do not install another harness or expand the
slice. Once JUL-203 passes and Todd starts JUL-204, its exact generator entry is
`.agents/skills/create-verification-skill/SKILL.md`; the reference examples are
in its `references/feature-map-example/` directory. A fresh-context handoff is
saved at `%TEMP%/JUL-203-handoff.md` using the existing handoff convention.
