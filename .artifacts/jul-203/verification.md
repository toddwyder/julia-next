# JUL-203 installation evidence (2026-10-09)

Outcome: installation prepared; acceptance is blocked on actual Claude Code and
OMP canonical loading proof. Review is reserved for Gemini at Todd's request.

## Revision and scope

Working branch: `jul-197-comprehensive-ci-gate-cleanup` (the current branch Todd
instructed the implement skill to use).
Base: `164be44a818a84e5bf73089b9a03a0a9635fb223`.
Installation candidate: `b108104ee4adb36dc62ec5d518cf226186b593c6`.
This continuation changes only evidence; identify its commit with
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
  route or actual OMP skill load/read was demonstrated. These lookup failures do
  not establish that no OMP installation exists elsewhere.
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

## Bounded route recovery (continuation)

Todd clarified that Complete status alone is not certification. Continuation
started at the installation candidate above, with authorization to search
existing artifacts, handoffs, run records, and GitHub history. No new model call,
harness installation, source repair, runner change, or verification workflow was
started. JUL-192 was not reopened or changed; JUL-204 was not advanced.

### Recovered Claude evidence

All paths in this paragraph are under `C:/Dev/julia-next-jul196-proof`:
`.julia/runs/proof.mjs` uses the existing `productionLauncher` and explicitly
requests `.agents/skills/implement/SKILL.md`.
`.julia/runs/JUL-196-approved.json` saves Claude Code / Anthropic / `opus` /
high / native connection. `.julia/runs/claude-result.json` records exit 0 and
observed `claude-opus-5-5`, Anthropic, Claude Code. Tool-use metadata extracted
from that record shows a Read of
`C:/Dev/julia-next-jul196-proof/.agents/skills/implement/SKILL.md` with a
non-error, nonempty tool result. Conversation prose was not ingested or copied.
The existing launcher source at `scripts/julia-delivery-runner.mjs:75` resolves
the installed native Claude executable, avoiding the Windows npm-shim EINVAL;
line 127 preserves the saved model/effort and explicit tool permissions.
`.julia/runs/direct-claude.mjs` names that native executable at
`%APPDATA%/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe`.

This establishes a **historical explicit canonical-read route for implement**,
not current loading of the four Pstack skills or a three-harness certification.
`%TEMP%/jul-196-steps1-6-handoff.md` indexes the successful bounded proof and
explicitly says it does not complete JUL-196. The later acceptance report below
records quota-blocked Claude integrations, so historical success is not a
current connection pass.

### Recovered Codex evidence

Under the same proof checkout:
`.julia/steps7-8/codex-deepseek/live-codex-result.json` records status 0.
`.julia/steps7-8/codex-deepseek/candidates/ee5eb8228793a3dfc5883d6a5929f65786148b08/live-codex-evidence/real-proof-codex-build.json`
records native Codex, saved `gpt-6.1-sol` / OpenAI / high, stage `finished`, and
second runner exit 0. Its `nativeAtKill`/`nativeAfter` metadata records
`canonicalSavedRead: true` for the original and resumed native sessions, with
observed provider/model/effort matching those choices. The reviewer is explicitly
`fixture-reviewer` / `scripted-stand-in`. No Codex conversation transcript was
read. `.julia/steps7-8/codex-deepseek/acceptance-report.md` distinguishes this
real builder proof from fixture review and uncompleted acceptance.

This is **historical canonical implement/saved-input access**, not proof that
Codex, Claude, and OMP all load the current four skill copies. The active Codex
session's current skill catalog also lists the four installed names at this
repository's `.agents/skills`; that discovery does not fill the other routes.

### Matrix and OMP gap

No JUL-192 matrix or JUL-190/JUL-191-specific proof artifact was located.
Fresh reads of JUL-190, JUL-191, JUL-192, and JUL-196 returned no comments,
attachments, or linked documents supplying certification. JUL-196 is Ready and
still states JUL-192 certification is needed before real Julia delivery.

`C:/Dev/jul202-evidence/review-handoff.md:34` explicitly distinguishes OMP adapter
fixtures from live provider proof; line 40 leaves JUL-192 certification as a
separate parent obligation.
`C:/Dev/jul202-evidence/gemini-review-record.md:16` likewise leaves saved-route
connection proof and tool certification to JUL-196/JUL-192.
These records do not establish an OMP route.

The bounded search covered the JUL-196 proof checkout's run/evidence records,
its OS-temp handoffs, nearby JUL-201/JUL-202 evidence, inspected project/user
skill locations, local/global CLI locations, npm cached `@oh-my-pi` and
`@mariozechner/pi-coding-agent` package locations, local Git history, and GitHub
issue/PR searches for JUL-190/191/192/196 and shared skills. No relevant cached
OMP package or registered OMP connector was found. This is a search boundary,
not a universal absence claim.

GitHub related runner work includes
[PR 270](https://github.com/toddwyder/julia-next/pull/270),
[PR 272](https://github.com/toddwyder/julia-next/pull/272), and
[PR 273](https://github.com/toddwyder/julia-next/pull/273).
They are not substituted for harness certification. A loose JUL-190 search
also returned [historical PR 191](https://github.com/toddwyder/julia-next/pull/191);
its body contains no exact JUL-190/JUL-192 reference and it is unrelated Factory
work. No tracker or GitHub issue was created or mutated as a substitute.

### Retained artifact fingerprints

SHA-256 fingerprints below tie this finding to existing bytes; artifacts were
read-only and not rewritten. Paths remain local for the next context.

| Existing path | SHA-256 |
| --- | --- |
| `C:/Dev/julia-next-jul196-proof/.julia/runs/proof.mjs` | `e2c34f0059086acf868038ba20d7970f53421ac764725f143ec1073a786e43e8` |
| `C:/Dev/julia-next-jul196-proof/.julia/runs/JUL-196-approved.json` | `1a88655ee7629c836e0cd3bfb0a85bbb34d80bfc93cf643f34241f37b1d5904c` |
| `C:/Dev/julia-next-jul196-proof/.julia/runs/claude-result.json` | `aeb70d83daf1fb8e5c4820df78caeb3f57f9d55093de13da90a3c90588c72c01` |
| `C:/Dev/julia-next-jul196-proof/.julia/steps7-8/codex-deepseek/candidates/ee5eb8228793a3dfc5883d6a5929f65786148b08/live-codex-evidence/real-proof-codex-build.json` | `94a003e19a2ca064962796cbfc21c9611be678fd4b2caa0d46d6160bfcda2be2` |
| `C:/Dev/jul202-evidence/review-handoff.md` | `a20c81d49123490398fb3f6fa4f372535f1715030f0a8ee88848b7f0cc75a9fc` |
| `C:/Dev/jul202-evidence/gemini-review-record.md` | `9ff3b783b521a0bd90c92ea1e759f29e479d85df9ea5923ef4bf1ce8208cc6fa` |

Outcome: historical Claude/Codex routes were partially recovered; the complete
certification and OMP evidence remain unlocated. **Canonical harness-access
acceptance is NOT proved. JUL-203 stays parked.** No route is invented, no
harness installed, no migration undertaken, and no next slice started.
Continuation validation is limited to the evidence change; prior full-suite
results above remain unchanged and are not represented as a fresh passing run.

Continuation checks: `git diff --check` exited 0;
`node --test scripts/line-endings.test.mjs` exited 0 (2 passed, 0 failed).
No skill or runtime file changed, so the historical broad suite was not repeated.
