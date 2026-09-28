# AGENTS.md

This file provides guidance to coding agents working in this repository, including Mastra
Factory's build sessions. How card work runs is in `docs/agents/work-execution.md`.

## Building a card

1. Follow the approved plan. Build test-first with `.agents/skills/tdd/SKILL.md`: one behaviour
   test at a seam the plan names, shown failing, then the minimal code, then the full suite green.
2. Add the lasting observability the plan names (logs and measurements that stay in the code),
   not temporary debugging.
3. Follow [CODING_STANDARDS.md](CODING_STANDARDS.md). When a review sends work back for something that should apply to
   all future code, fix it and add one plain line to `CODING_STANDARDS.md` in the same pull
   request.
4. The pull request description starts with a plain-language **Try it** section for Todd: what
   changed and the steps to follow on the rehearsal copy. No code, logs or technical tools in it.

## Use the product, not a workaround

Use the built-in feature of Factory, Mastra, or GitHub for anything they already do. Before any
custom script, workaround, or change to Mastra's code, stop and state the gap, the docs checked
(with links), and what breaks without it; Todd decides. Approved pieces are listed in
`ops/factory/README.md`.

## Framework-first rules (JUL-116)

1. Read the framework's official docs before writing code, and post a framework map (need → framework feature → docs link) on the card.
2. Start from the framework's own example and change as little as possible.
3. `npm run lint:framework` must pass. Hand-built progress files, retry or wait loops, and controller code over 400 lines are refused unless skipped with an ESLint comment that gives a reason and a docs link, and listed on JUL-115.
4. Before proposing to build anything, name the existing tools checked and why they don't fit.
