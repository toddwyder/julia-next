# JUL-253

- [x] Read the live card, its comments, the 23 October approved plan, and current main.
- [x] Isolate the work from the existing dirty checkout.
- [x] Trace the deployed runner, settings, credential store and stock login implementation.
- [x] Check installed Node, SDK and lockfile versions and required key presence without printing credentials.
- [ ] Complete Todd's stock ChatGPT and Anthropic account authorizations. Blocked on an account action.

## Feature playbook

1. `how` over the affected subsystem. Pending after credential preflight; the path trace is a maker self-check, not the skill's delegated explanation.
2. `architect` for parallel design exploration. Pending after credential preflight.
3. Write the throughput checkpoint as four todo items.
   - Blocking first steps. Todd's subscription authorizations are missing.
   - Independent workstreams. No implementation fan-out started before credential preflight passed.
   - Shared mutable state. The existing checkout remains untouched; this work has its own branch and worktree.
   - Smallest safe decomposition. Resolve the required account action, then design and build the connection and accounting changes together.
4. Delegate code-writing to a subagent using your configured feature model. Pending after preflight and design.
5. Verify on the matching surface. Pending; live Claude Pro and ChatGPT requests have not run.
6. Rebase into small, ordered commits. Stack follow-ups. Pending implementation.
7. If the design is contested, `interrogate` before shipping. Pending implementation.
8. Run **Opening a PR**. Pending implementation, review and Proof.

## Remaining card work

- [ ] Replace the zero-spend trial rules with the $2 aggregate per-card accounting policy, subscriptions included.
- [ ] Record source-backed model prices and request bounds in settings.
- [ ] Configure and prove the agreed Sol/DeepSeek/Beam split.
- [ ] Run a real Claude Pro request through the stock route. Report failure without an alternative connection.
- [ ] Record the settled Claude ADR with the required sources.
- [ ] Run independent review, server Proof and exact-candidate CI, then finish delivery.
