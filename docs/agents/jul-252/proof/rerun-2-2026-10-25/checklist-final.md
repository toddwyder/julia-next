# JUL-252 Evidence review: poteto-mode Feature playbook

- [x] 1. `how` over the affected subsystem. done: read ops/build-runner worker.mjs, pstack-session.mjs, jobs.mjs, adapter.mjs, machine-settings.json, scripts/linear-cli.mjs, path-forward.md and GLOSSARY.md directly (subsystem small enough for one reader).
- [x] 2. `architect` for parallel design exploration. done: one shape chosen in the main session (a transition table plus a playbook registry in one pure module); recorded in decisions.tsv. skip of parallel runners: budget, see decisions.tsv.
- [x] 3. Throughput checkpoint.
  - [x] Blocking first steps. done: data shape fixed before delegation (VERDICTS, STAGES table, PLAYBOOK_STEPS registry).
  - [x] Independent workstreams. n/a: one module, one test file and one worker hook share the same types.
  - [x] Shared mutable state. n/a: pure functions; the only state is the stage in the job snapshot.
  - [x] Smallest safe decomposition. done: one DeepSeek coder owns the diff because the module and its test are coupled.
- [x] 4. Delegate code-writing to the configured feature model. done: commandcode/deepseek/deepseek-v4.1-flash implemented evidence-review.mjs, its test and the worker hook.
- [x] 5. Verify on the matching surface. done: node --test ops/build-runner/test/*.test.mjs run in this worktree.
- [x] 6. Small ordered commits. skip: the host commits the candidate as one build commit.
- [x] 7. `interrogate` before shipping. done: panel review of the changed files by anthropic/claude-haiku-5-5 and commandcode/deepseek/deepseek-v4.1-flash.
- [ ] 8. Run **Opening a PR**. out of scope: the host owns publishing.

## Task-specific
- [x] Pure evidence-review module with three verdicts, different-company reviewer pick, stage table and playbook guard.
- [x] Worker refuses a run whose checklist follows a different playbook than its stage needs.
- [ ] Real reviewer dispatch after every finished build and Linear state moves. not done: see decisions.tsv.
- [ ] End-to-end proof on a real card. not done: needs the dispatch hookup and a Linear Remediation state check.
