# 0009. Deliver Julia cards through Mastra Factory

Date: 2026-09-26, revised 2026-09-29

Status: accepted. Factory replaced the Pydantic graph as the route for Julia cards.

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

GitHub repository auto-merge is enabled. It still requires a merge condition and must be
selected for each pull request. No supported configuration currently arms Julia pull requests
automatically after CI and Factory's review, so this part of the route remains open in #139.

The laptop operator maintains Factory, server, repository, and GitHub setup. It does not
build, review, move, or merge Factory cards by hand or use Factory's GitHub credentials.
Setup and documentation pull requests are handled through the publisher App at their
reviewed head.

Use Factory, Mastra, and GitHub's built-in features before adding custom machinery. The
approved exceptions in `ops/factory/README.md` record the pieces currently needed.
