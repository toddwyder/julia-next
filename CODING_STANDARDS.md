# Coding standards

- Read the framework's official docs before coding; post a framework map (need → framework feature → docs link) on the card.
- Start from the framework's own example and change as little as possible.
- Run `npm run lint:framework`. Hand-built progress files, retry or wait loops, and controller code over 400 lines need an ESLint skip comment with a reason and docs link, and must be listed on JUL-115. A test waits on the framework's own completion signal (a terminal event), never by polling a value; use the test runner's own timeout as the bound.
- A classification or verdict over a record reads the whole record, never a filtered view built for display (for example, "Done by Factory" reads every card step, not only the week's visible steps). A review verdict likewise accounts for every changed file: a file the reviewer skipped is named with evidence, and a skipped reviewable file fails the verdict closed rather than being dropped. Every changed reviewable file must be named in the review result; a file absent from both the reviewed and skipped lists fails the verdict closed.
- A verdict or approval over a mutable revision re-reads the revision after the deciding agent (and any batched reviewer) finishes, not only before it starts, so a change landed mid-decision cannot be approved under a stale result.
- A bounded prompt batch checks each individual item against the batch budget, not only the running total: an item too large to fit is never placed in a batch that exceeds the bound; it is marked unreviewed and fails the verdict closed with evidence.
- Use the built-in feature of Factory, Mastra, or GitHub before building a workaround. If one is missing, state the gap, docs checked, and consequence to Todd before changing code.
- A production check must measure the real artifact (a real file, a real API), never an injected fake; if the supported config cannot control the artifact, prove that and fail closed instead of reporting success.
- Never render an unknown measurement as zero (a missing cost is not `$0.00`); fail the report closed and let a real numeric zero stay zero.
- A scheduled operational action must run the real supported feature, not a read-only check behind a flag that claims the feature is configured.
- When review identifies a rule that should apply to all future code, fix it and add one plain line here in the same PR.
- The install file list must carry every app source module the entry point imports (transitively), and a test must prove a clean install leaves no unresolved local import before `check`/`build`.
