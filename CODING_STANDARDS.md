# Coding standards

- Read the framework's official docs before coding; post a framework map (need → framework feature → docs link) on the card.
- Start from the framework's own example and change as little as possible.
- Run `npm run lint:framework`. Hand-built progress files, retry or wait loops, and controller code over 400 lines need an ESLint skip comment with a reason and docs link, and must be listed on JUL-115.
- Use the built-in feature of Factory, Mastra, or GitHub before building a workaround. If one is missing, state the gap, docs checked, and consequence to Todd before changing code.
- A production check must measure the real artifact (a real file, a real API), never an injected fake; if the supported config cannot control the artifact, prove that and fail closed instead of reporting success.
- Never render an unknown measurement as zero (a missing cost is not `$0.00`); fail the report closed and let a real numeric zero stay zero.
- A scheduled operational action must run the real supported feature, not a read-only check behind a flag that claims the feature is configured.
- When review identifies a rule that should apply to all future code, fix it and add one plain line here in the same PR.
- The install file list must carry every app source module the entry point imports (transitively), and a test must prove a clean install leaves no unresolved local import before `check`/`build`.
