# Windows runner regression gate

Local and CI command: `node scripts/julia-runner-suite.mjs`.
Inventory without executing tests: `node scripts/julia-runner-suite.mjs --list`.
JUL-197's stable `julia-init-windows` job uses the same command and routing;
Factory, database, web, docs-policy and baseline retain their existing commands.

## Discovery and shared safety

The gate recursively discovers `*.test.mjs` named `julia-init*`, `julia-delivery*`,
`julia-graph-model*`, `julia-minimal-runner*` or `julia-runner*`, and every MJS test
under `ops/julia-runner/`. New tests in these families need no registration.
Tests elsewhere that import those modules, `delivery-tool-settings` or
`ops/julia-runner/` are also included. CI conservatively routes new MJS test paths
to Windows, except tests with existing focused Factory, web-script or policy
ownership. Keep new runner regressions beside their behavior in those families.

The shared script tests are included explicitly:

| Tests | Protection/dependency |
| --- | --- |
| `delivery-tool-settings` | Saved model/company, thinking and connection choices |
| `acceptance-check` | Whole acceptance/evidence contract used by JUL-122 |
| `linear-cli` | Intake/credential handling, with fixture HTTP responses |
| `effort`, `seat-labels`, `seat-table` | Model selection and company independence |
| `service-dropbox-run-agy-seat`, `service-dropbox-run-pi-seat`, `service-dropbox-read-secret` | Existing worker transport, parsing and secret boundaries; fixtures only |
| `verify-reviewer-worktree` | Review cannot silently alter the candidate |
| `line-endings`, `no-personal-paths`, `personal-paths` | Portable source and safe configuration |
| `ci-routing` | Gates for runner, shared paths and multi-domain changes |

The seat-table and service-dropbox wrappers remain: they execute shared tests in
`graph/` and `ops/service-dropbox/` once, rather than discovering those copies
again. `julia-runner-suite.test.mjs` proves new/nested/unwrapped discovery,
archive separation, space-containing paths, inherited test-context isolation,
failure propagation, empty-suite refusal and the CI command contract.
The command prints every selected file, then Node's full results including skip
reasons and counts. Failures return nonzero; there is no baseline-failure waiver.

## Non-runner tests and removed duplicates

Factory's directly owned tests remain under `ops/factory/` and its JUL-197 Linux
gate with existing package/lockfile setup: workflows, skills, trace retention,
local sandbox, observability retention/scheduling, review batching and installer.
PostgreSQL coverage remains in the database gate. Other existing Factory tests
(upgrade, sandbox cleanup and wait alerts) retain their historical/manual scope;
this change neither deletes them nor claims they ran. Web/browser and docs/policy
checks keep their existing gates. Retired graph/controller tests remain historical
checks outside this required runner gate, including the separate JUL-199 import
and JUL-200 checkout failures. No shared runner test was deleted.

Removed exactly:

- `scripts/factory-tests.test.mjs`: duplicate Factory-only import wrapper; its
  four imported tests remain directly owned by the existing Factory gate.
- `scripts/test-wrappers.test.mjs`: obsolete monolithic-CI wrapper assumption;
  active runner discovery/routing regressions replace it. It recursively treated
  saved proof copies and directly gated Factory tests as missing wrappers.

There are no tracked redundant archived test copies in the source candidate.
`.julia/` proof/evidence copies are preserved, not source tests to delete or run.
Discovery also avoids `.git`, `node_modules`, `.next`, `.mastra`, `.artifacts`,
`test-results` and `playwright-report`, which contain generated/vendor artifacts.
No historical JUL-196 evidence is changed or attributed to this revision.

## Provider and platform limits

Three real Claude checks now require `JUL196_CLAUDE_REAL_PROOF=1`; the existing
Codex proof requires `JUL196_CODEX_REAL_PROOF=1`. These flags require separate
operator authorization. Ordinary local/CI runs disclose these four checks as
unexecuted opt-ins. Claude's existing quota-blocked flag remains supported.
Linux process-group/subreaper/systemd and POSIX-mode cases retain explicit Windows
skip reasons. Fixture passes do not prove a provider connection or independent
review. Historical provider results stay tied to their original revisions.

Interruption fixtures copy the tracked `.claude/skills/implement/SKILL.md` into
their disposable canonical worker path; a clean checkout does not depend on the
historical proof machine's untracked `.agents` alias. This does not change the
production launcher's skill path or authorization.

## Framework map

| Need | Existing feature and official reference |
| --- | --- |
| Portable explicit discovery and file execution | [Node test runner](https://nodejs.org/download/release/latest-jod/docs/api/test.html#running-tests-from-the-command-line): pass filenames to `node --test`; no shell expansion or new dependency |
| Visible opt-in/platform exclusions | Node's test `skip` option and spec reporter, retaining test names/reasons/counts |
| Focused Windows gate | [GitHub job conditions](https://docs.github.com/en/enterprise-cloud@latest/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions), reusing JUL-197's route and job identity |

Windows verification results and raw outputs are recorded separately for the
checked JUL-198 revision. A local Windows pass is not an observed GitHub CI run
or permission to start delivery, review with a provider, merge or deploy.
