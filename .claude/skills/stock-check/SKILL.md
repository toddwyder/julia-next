---
name: stock-check
description: Check an issue against stock Mastra before anyone builds it. Use when an issue or plan is about to go to a builder, or when work on an issue keeps failing review.
---

# Stock check

Read one issue. For every job it asks for, find how Mastra does that job, in the version we run and in the latest release, and say whether the issue's way is **stock** or a **deviation**. Read only: change no code, settings, issues or servers.

Vocabulary: `CONTEXT.md` (Model job, Builder, Reviewer helper, Connection). Model choices are settings, never repository text.

## Steps

1. **Jobs.** Read the issue and its parent. List every job it asks for in one plain line each ("set the builder model for one project", "switch to a backup when credits run out"). Done when every acceptance line and every work item maps to a job.

2. **Versions.** Read the pinned versions from `ops/factory/app/package.json` (or `package-lock.json`). Get the latest with `npm view <package> version`. Download both copies to a scratch folder with `npm pack <package>@<version>` and unpack them. Packages: `@mastra/factory`, `@mastra/code-sdk`, `@mastra/core`, plus any other `@mastra/*` package the jobs touch. Done when both versions of each are unpacked locally.

3. **Evidence per job.** For each job, search the installed-version package for the feature that does it, and read Mastra's docs (the Mastra docs MCP server when available; otherwise https://mastra.ai/llms.txt and https://factory.mastra.ai). Record:
   - **Pinned:** the feature, with `package@version path:line` you actually opened, or "Mastra has nothing" with what you searched.
   - **Latest:** the same for the latest release; note anything new or changed.
   - **Wiring:** how Factory actually uses it at runtime, traced through the code, not inferred from the docs (example: Factory skips model packs for card sessions in `session/model-pack-hydration.js`).
   Done when every job has a pinned answer backed by a real `path:line`. A claim without an opened `path:line` is marked **unverified**, never stated as fact.

4. **Verdict per job.** One of:
   - **Stock**: the issue uses Mastra's own feature the supported way.
   - **Deviation**: the issue builds or bypasses something Mastra provides (for example a raw database write where Factory has an update operation). Name the stock way.
   - **Upgrade**: the latest release provides it or removes our deviation. Name the release and what changed.
   - **Custom**: Mastra has nothing in either version. Say what was searched and what the smallest custom piece would be.

5. **Open choices.** List the design decisions the issue leaves open that a builder would otherwise guess (for example "how is a model's company known?"). Mark each **technical** or **product**.

6. **Report.** Post one comment on the issue:
   - a table: job, verdict, pinned evidence, latest evidence, stock way;
   - the open choices;
   - the unverified claims, if any;
   - two final lines headed `For Todd:`: what this means for the issue, and whether any product choice needs him.
   Done when every job from step 1 appears in the table.
