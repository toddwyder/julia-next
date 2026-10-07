# Spec: Factory route

Milestone: **Factory route**. Decisions: `docs/adr/0009-mastra-factory.md`. Audit behind them:
`docs/research/mastra-intended-use-audit.md`. Setup already done on JUL-184 (memory model, traces,
Auto-approve plans, Vercel sign-in, public repository).

## Problem Statement

Todd wants Julia built by agents he can trust without reading code. Twice before, agents said the
delivery route worked while they were quietly driving cards by hand, building workarounds, or
ignoring how the products are meant to work. Todd could not tell from a pull request. Stock
Mastra Factory now carries a card from issue to merge, but none of Julia's own rules are in it
yet: test-first on agreed seams, lasting observability, a reviewer from a different model maker,
Todd's approval as the only way to merge, and locks that stop agents going around the product.
Without those, the next card can go wrong the same way, and Todd would not know.

## Solution

Factory's standard board runs every card, and Julia's rules go into Factory's supported places:
its planning and review instructions, a separate cross-maker review agent built from Mastra's own
example, and GitHub's own branch rules. Todd starts a card with one tap, tries the rehearsal copy,
and approves or requests changes in one sentence; approval merges. Locks, not habits, stop agents
merging or building workarounds, and Todd's assurance comes from Factory's own records and
independent audits, never from an agent's report. A weekly summary shows what each card cost.

## User Stories

1. As Todd, I want every card to wait in Intake until I tap it, so that nothing is built that I did not choose.
2. As Todd, I want an issue opened by an agent or a stranger to wait in Intake too, so that nothing fixes itself without me.
3. As Todd, I want the plan approved automatically, so that I am never asked to judge a technical plan.
4. As Todd, I want every plan to name the seams and the failing tests written first, so that each card is built test-first.
5. As Todd, I want every plan to name the lasting observability the change adds, so that later problems are diagnosed from evidence.
6. As Todd, I want the plan saved in the pull request, so that the reviewers can check the work against it.
7. As the builder, I want the repo's Pocock skills and `AGENTS.md` loaded in my session, so that I build the Julia way without being told each time.
8. As the builder, I want one short plain-language "Try it" section at the top of my pull request, so that Todd knows what to try on the rehearsal copy.
9. As Todd, I want Factory's review to check the work against the coding standards and the card, so that both "built right" and "built the right thing" are covered.
10. As Todd, I want a second reviewer from a different model maker to try to break the work against every acceptance criterion, so that one model does not mark its own homework.
11. As Todd, I want the second reviewer's model and backups to be settings I can name in a sentence, so that I can change models without code.
12. As Todd, I want either reviewer's "Request changes" to go back to the builder automatically, so that I only see work that has passed both.
13. As the builder, I want a review that finds a rule for all future code to lead me to add one line to the coding standards in the same pull request, so that the standards grow from real reviews.
14. As Todd, I want GitHub to ask for my review only once the checks and both reviews are green, so that I am never the first to find a broken build.
15. As Todd, I want the rehearsal copy's link on the pull request to open without a sign-in, so that trying it is one tap.
16. As Todd, I want my Approve to merge the work automatically, so that approving is accepting.
17. As Todd, I want "Request changes" with one sentence to send the work back to the builder, so that sending back is as easy as approving.
18. As Todd, I want GitHub to refuse any merge without my approval and green checks, whoever tries it, so that no agent or script can merge around me.
19. As Todd, I want only me able to change the exceptions list, so that an agent cannot approve its own workaround.
20. As Todd, I want a required check to reject any pull request that adds custom machinery not on the exceptions list, so that workarounds are caught before they land.
21. As Todd, I want agents outside Factory to be unable to move cards, use Factory's GitHub keys, or merge, so that the first trial cannot repeat.
22. As Todd, I want an agent that thinks Factory cannot do something to stop and show me the gap and the Mastra docs it checked, so that I decide on every exception.
23. As Todd, I want each card to show whether every step was done by Factory or by me, from Factory's own records, so that I can tell when someone went around the product.
24. As Todd, I want an independent audit against Mastra's documentation after setup and after the first three cards, so that subtler misuse is caught.
25. As Todd, I want Factory's board and its Needs attention list to show me progress, so that I can tell a slow card from a dead one.
26. As Todd, I want a weekly summary of what each card cost in model spend and how long it took, so that I can reduce costs with data.
27. As Todd, I want the weekly summary to reach my phone as a GitHub notification without landing in Intake, so that it never looks like work to start.
28. As Todd, I want Mastra's traces for every agent step, so that failures and costs are read from evidence, not from agent narrative.
29. As Todd, I want to open Mastra's Studio to see traces and memory, so that I can check what an agent actually did.
30. As an operator agent, I want the Factory project's own source kept in this repository, so that every change to Factory's setup has history and review.
31. As an operator agent, I want CI to run only the checks that matter for the current code, so that runs are fast and a retired graph test cannot block every pull request.
32. As Todd, I want one saved structured cost record for each completed Factory or laptop issue, including per-model cost and tokens, stages, waits, rescues, fallback marks and named gaps, so that a later Monday note can use durable evidence after raw traces are retired. The record is idempotent; an unmatched review remains an unmatched cost, never a guessed issue match. See GitHub #196 (approved design, 2026-10-02) and #211 (first slice).

## Implementation Decisions

- **Factory project in the repo.** The Factory app's own source (its entry file, package manifest
  and lock file, skill overrides) is versioned in this repository beside the install files. The
  install procedure deploys it to the server; the server copy is never edited by hand again. Today
  it lives only on the server with no history.
- **Skill overrides, not a custom board.** Override Factory's bundled `factory-plan` and
  `factory-review` skills through Factory's supported `factory-skills/` folder. The plan override
  adds the required seams-and-tests section and observability section and keeps Factory's own
  structure and terminal transition. The review override runs Pocock `code-review` (Standards and
  Spec) against `CODING_STANDARDS.md`, the card and the saved plan, and keeps Factory's verdict
  behaviour (a plain comment where GitHub forbids an app reviewing its own pull request). The
  build step remains stock but follows the plan's named repository skill: only `implement` for a
  feature card, which already runs TDD at the plan's seams and one `code-review`;
  `diagnosing-bugs`, then `code-review`, for a defect card.
- **Coding standards.** Start `CODING_STANDARDS.md` with a short seed taken from the existing
  framework-first rules; it grows only through review send-backs.
- **Cross-maker review agent.** Built from Mastra's `template-github-review-agent`, keeping its
  workspace skills and observational memory, with its model and ordered backups as settings
  (DeepSeek to start; always a different maker than the builder). The template is chat-based: it
  neither reacts to pull requests nor posts GitHub reviews on its own. The ticket must find
  Mastra's own supported way to trigger it on a pull request and post a real GitHub review under
  its own GitHub App identity, trusted through Factory's `MASTRACODE_GITHUB_AUTHORIZED_BOTS`, so
  Factory's existing rule sends "Request changes" to the builder. If Mastra has no supported way,
  the agent stops and brings Todd the gap as a proposed exception.
- **GitHub side.** A branch ruleset on `main`: pull request required, Todd's approval required,
  required status checks (CI, publisher check, unapproved-machinery check), no bypass. Auto-merge
  enabled on the repository. Code owners: Todd owns the exceptions list and the Factory ops
  folder. CI moves the publisher check to GitHub's runners, cancels superseded runs, skips
  documentation-only changes where safe, and stops running the retired Pydantic graph's tests.
- **Locks for agents outside Factory.** Deny rules in the Claude Code and Codex settings checked
  into this repository: no moving Factory cards, no use of Factory's GitHub App keys, no merging.
- **Unapproved-machinery check.** A small required CI check that fails when a pull request adds a
  change to Mastra package code, a card-moving or merging script, or another custom piece in the
  Factory ops area that has no row on the exceptions list. It goes on the exceptions list itself.
- **Monday note.** One small weekly program reads Factory's own records (card moves and who made
  them) and Mastra's cost data, and posts a plain summary as a GitHub Discussion in a "Monday
  notes" category. Discussions are not ingested by Factory, so the note never lands in Intake, and
  Todd's phone is notified. Per card it shows cost, time, and whether every step was done by
  Factory or by Todd. It goes on the exceptions list.
- **Studio.** Open Mastra Studio against the self-hosted Factory by Mastra's documented route,
  behind Factory's existing sign-in.
- **Sandbox.** Factory's docs recommend a cloud sandbox; ours runs agent commands on the server.
  Not changed here; recorded for a later decision.

## Testing Decisions

- A good test checks what someone outside can see: a card's result in Factory and on GitHub, or a
  program's output for given input. Never how the pieces work inside.
- **Real cards prove the route** (Todd, 2026-09-28). A piece counts as done when a real card goes
  through and the result shows where Todd would look: the saved plan with its seams and
  observability sections, both reviews on the pull request, a "Request changes" that returns to
  the builder, the review request reaching Todd only after green, and auto-merge after his
  approval. No fake Factory or GitHub is built.
- **The two programs of our own** (unapproved-machinery check, Monday note) get normal automated
  tests at their one entry point, with sample inputs: a pull request diff for the check, sample
  Factory records and cost data for the note. Prior art: the `scripts/*.test.mjs` suites run by
  `node --test`.
- Rules and permissions are proven by trying the forbidden action once and showing it refused:
  a merge without Todd's approval, an edit to the exceptions list by someone else, a denied
  command in an agent session.

## Out of Scope

- Julia features. Each gets its own spec and milestone later, written from the Linear library.
- Mastra evals, per-card model choice, extra agent roles, and phone alerts for stuck cards
  (deferred by ADR 0009 until real use calls for them).
- Moving to a cloud sandbox.
- Cancelling the old graph's Linear cards (done once these tickets exist, as ADR 0009 says).

## Further Notes

- Every ticket in this milestone is built through Factory, as real cards. Operator agents only do
  what Factory cannot do to itself (server installs and GitHub settings), and each such step is
  recorded in `docs/agents/factory-platform-auth-change-log.md`.
- The independent audit after setup runs once the first ticket has merged.
