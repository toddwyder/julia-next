# JUL-223 stage two: off-the-shelf audit (brief for Codex, 12 Oct 2026)

Stage one is accepted by Todd at `629b2ef1`. This stage is an **audit only**:
don't build the minimum reviewer (that's stage three), and don't start JUL-196.
No paid calls, no push. Commit locally.

## The rule being applied (Todd, 12 Oct)
Off-the-shelf first. For each custom piece, find out whether stock Mastra (or a
stock dependency already installed) does the job. If it does, the verdict is
"use stock" and the custom code is marked for deletion in stage three. If it
doesn't, the piece stays custom only with a written record of which stock
feature was tried, how, and exactly why it fails.

## How to check
- Docs first: use the version-matched docs bundled in the installed packages
  (`node_modules/@mastra/*/dist/docs`). Otherwise use the official `llms.txt`
  index and fetch only the page you need, never `llms-full.txt`. Cite the exact
  page for every verdict.
- "Tried" means more than read. Where the docs leave doubt, run a small **free,
  offline** test: a stand-in or mock model, no provider call. Commit it under a
  clearly named audit folder.
- Earlier verdicts don't carry forward automatically. Several rejections in
  the design doc were judged against routes that stage one deleted. For
  example, structured output was rejected because "the Step 3b provider route
  does not enforce it," and that route no longer exists. Re-check each one
  against the current route: a Mastra `Agent` through the existing CommandCode
  connection.
- Check whether the installed `@mastra/core` (`^1.75.0`) is current. If a newer
  stable release adds a relevant stock feature, say so. Don't upgrade in this
  stage.

## Pieces to audit
1. **Recording engine and report adapter** (`recording-engine.mjs`,
   `reviewer-report.mjs`). Stock candidates: structured output (including
   structured output combined with tools), output processors, and tool schemas
   with Mastra's tool-error loop.
2. **Pre-call spending limit** (not built yet; needed by Todd's decision 2).
   Stock candidates: `maxSteps`, token-limit or cost processors, and any stock
   budget or stop condition. Requirement: refuse a provider call **before** it
   would cross the per-review cost or time limit, with no dependency on any
   database.
3. **Model log**: every prompt, reply, tool call and token usage, written once
   per run. Stock candidates: model-level observability with internal spans
   off, exporters that write to a file, the AI SDK's request/response hooks,
   and agent `onStepFinish`/`onFinish` callbacks. Requirement: bounded size, no
   database, and a failure can't block or erase a verdict.
4. **Runner and the four terminal states** (PASS, FAIL, INCONCLUSIVE,
   SYSTEM_ERROR). Stock candidate: Mastra workflows: step results, error
   handling, `suspend`/`resume`, and snapshots. Say which parts JUL-196 should
   take over and which, if any, must stay custom.
5. **Smaller pieces**: the word-for-word quote check (`quote-check.mjs`),
   raw-answer-before-parse capture, interruption evidence, cost arithmetic
   (`commandcode-cost.mjs`), the read-only Git tools, and the derived `maxSteps`
   formula.
6. **Anything else custom** under `ops/mastra-agents/reviewer/src`, or in the
   reviewer path of the runner, that isn't listed above.

## Deliverables
1. **For Todd, one page in plain English**, a table with one row per piece:
   what it does (one line), the stock option checked, and the verdict (**use
   stock** / **keep custom** / **stock plus a small custom part**), with the
   reason in one line. No file names or code terms in this table.
2. **Technical appendix** in the design documentation: for each piece,
   the doc page cited, the test run (if any) and its result, and for every
   keep-custom verdict the exact gap.
3. **What changes for stage three**: which custom files are marked for deletion,
   and what stock configuration replaces them.

Claude checks the audit on the laptop, including re-running the audit tests,
before Todd sees it.
