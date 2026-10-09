# 0009. Deliver Julia cards through Mastra Factory

Date: 2026-09-26, revised 2026-09-29

Status: superseded and retired on 2026-10-09. Factory's operating resources and repository source
were removed; this ADR remains as historical context only.

Factory's Intake receives GitHub issues. Todd starts a card there; Factory plans, builds,
opens a pull request, and reviews it. Factory's Work and Review boards and Needs attention
list show progress. The plan and review are recorded with the pull request. CI runs on GitHub.

The repository uses Factory's supported `factory-skills/` overrides for planning and review.
Build sessions follow `AGENTS.md` and `CODING_STANDARDS.md`. Factory's current review can
record a verdict as a pull request comment and label; it does not supply a GitHub approval or
required status check.

Todd's 2026-09-29 decision removes the pre-merge product acceptance step. He tests Julia
changes on the live app after merge. If he rejects a change, revert the merge and return the
card to Factory.

For Julia cards, Factory's reviewer merges the PR after its review passes and CI is green.
Factory's Review card then reaches Done, which is Todd's handoff for live UAT. No
pre-merge product approval is required.

The laptop operator maintains Factory, server, repository, and GitHub setup. It does not
build, review, move, or merge Factory cards by hand or use Factory's GitHub credentials.
Setup and documentation pull requests are handled through the publisher App at their
reviewed head.

Use Factory, Mastra, and GitHub's built-in features before adding custom machinery. The
approved exceptions in `ops/factory/README.md` record the pieces currently needed.
