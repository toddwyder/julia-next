# JUL-252 Evidence review

Playbook: Feature

## Feature playbook steps
- [x] 1. `how` over the affected subsystem. done: read worker.mjs, jobs.mjs, adapter.mjs, pstack-session.mjs, builder-boundary.mjs, catalogue.mjs (company field), build-client.ts, control-page.ts, scripts/linear-cli.mjs, scripts/check-no-fakes.mjs, path-forward.md evidence-check and failures sections.
- [x] 2. `architect` for parallel design exploration. done: candidate A in .builder-home/pstack/design.md; candidate B from anthropic/claude-haiku-5-5 (stage records per process) and from commandcode/deepseek/deepseek-v4.1-flash (queued stage jobs); synthesized A with grafts.
- [x] 3. Write the throughput checkpoint as four todo items.
  - [x] Blocking first steps. done: data shapes and flow table fixed in design.md before code.
  - [x] Independent workstreams. done: n/a: one coupled change in ops/build-runner, worker wiring depends on the pure modules.
  - [x] Shared mutable state. done: worker.mjs and job.json have one writer; stages run sequentially, one runner open at a time.
  - [x] Smallest safe decomposition. done: one coder owns the diff because worker.mjs wiring and the modules share signatures.
- [ ] 4. Delegate code-writing to a subagent using your configured feature model.
- [ ] 5. Verify on the matching surface.
- [ ] 6. Rebase into small, ordered commits. Stack follow-ups.
- [ ] 7. If the design is contested, `interrogate` before shipping.
- [ ] 8. Run **Opening a PR**. skip: out of scope, the host owns publishing the parent PR.

## Task todos
- [ ] Panel review of actual changed files by anthropic/claude-haiku-5-5 and commandcode/deepseek/deepseek-v4.1-flash.
- [ ] GLOSSARY.md, path-forward.md, ADR 0024.
