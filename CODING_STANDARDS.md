# Coding standards

- Read the framework's official docs before coding; post a framework map (need → framework feature → docs link) on the card.
- Start from the framework's own example and change as little as possible.
- Run `npm run lint:framework`. Hand-built progress files, retry or wait loops, and controller code over 400 lines need an ESLint skip comment with a reason and docs link, and must be listed on JUL-115.
- Use the built-in feature of Factory, Mastra, or GitHub before building a workaround. If one is missing, state the gap, docs checked, and consequence to Todd before changing code.
- When review identifies a rule that should apply to all future code, fix it and add one plain line here in the same PR.
