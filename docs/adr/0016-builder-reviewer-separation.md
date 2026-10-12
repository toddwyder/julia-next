# 0016. Builder and reviewer agent separation under delivery runner orchestration

Date: 2026-10-12

Status: Proposed

## Context

Automated card implementation requires autonomous code development paired with independent adversarial
verification to maintain quality without requiring human code reviews for every machine step.

## Decision (Agent Design Choice)

1. **Two agents:** Implement two distinct Mastra agent roles:
   - **Builder:** Reads repository code, writes changes, runs tests, and commits to its own branch.
   - **Reviewer:** Operates read-only against the pinned candidate commit using immutable Git tools.
2. **Provider independence:** The reviewer must use a model from a different maker than the builder.
3. **Strict operational boundary:** Neither agent may merge pull requests, create Linear tickets, or
   delete files outside authorized scratch directories.
4. **Runner orchestration:** The outer delivery runner owns sequencing, state persistence, locks, worker
   lifecycle, and start/spend authorization. Any condition requiring human intervention parks the card
   with a visible reason.

## Consequences

- Prevents builder self-review bias by enforcing adversarial review from an independent model.
- Retains human authority over ticket creation, merge decisions, and final acceptance.
