# Coding standards

Post-build reviewer guidance. The reviewer checks the completed change and records evidence tied
to the change, or explains why a check does not apply; missing evidence is not a pass.

For a Julia user-facing change, independently inspect the behavior artifacts from the applicable
`.agents/skills/verify-julia/SKILL.md` recipe. The launch and Doctor records must identify the
reviewed candidate (commit and dirty-tree SHA-256), and the artifacts must show the actions,
observed results, command exit codes, console outcome, and post-cleanup readback. A source change
after proof makes it stale. Missing, failed, unavailable, stale, or candidate-mismatched proof
fails the review closed; do not infer success from a builder summary or label unavailable evidence
not applicable. Mark not applicable only when the change has no relevant user-facing behavior, and
give the reason.

## Build

Build test-first with `.claude/skills/tdd/SKILL.md`.

## Reviewer checks

1. **unit tests** — meaningful behavior and regression coverage for affected code through appropriate interfaces. Check the assertions actually detect the relevant failure; mocked provider responses alone cannot prove provider behavior.
2. **integration tests at affected boundaries** — when a connection between two services is built or changed, test it against the real service; do not substitute a fake or stand-in for that test. Every integration test joins the regression suite, and the whole suite runs on every pull request, which cannot merge until it passes.
3. **end-to-end for the changed journey** — when the change has a user-facing surface, inspect the actual behavior evidence for the affected journey end to end, including relevant failure paths, tied to the reviewed candidate identity. Confirm the launch/Doctor commit and dirty-tree digest match the reviewed tree and that the saved commands and results passed. Missing, failed, unavailable, stale, or mismatched proof fails closed; Todd's live UAT and a builder's unverified “tests pass” statement do not substitute. A change with no user-facing surface is marked not applicable with a reason.
4. **a clean browser console** — during the affected journey, no unexpected console errors or unhandled failures. Changes with no browser surface may be marked not applicable with a reason.
5. **logging good enough to find a root cause** — lasting logs/measurements identify the failing operation and useful context, connect related events, and expose no secrets. Inspect failure-path evidence; temporary debugging or a silent non-zero exit is insufficient. Each connection between services records its own trace; a connection whose trace shows errors or calls to the wrong account fails.

## Framework and design (reviewer checks)

- Read the framework's official docs before coding and post a framework map (need → framework feature → docs link) on the card.
- Start from the framework's own example and change as little as possible.
- Run `npm run lint:framework`. Hand-built progress files, retry or wait loops, and controller code over 400 lines are refused unless skipped with an ESLint comment that gives a reason and docs link, and listed on JUL-115.
- Use the built-in feature of Factory, Mastra, or GitHub before building a workaround; if one is missing, state the gap, the docs checked, and the consequence.

## Integrity (reviewer checks that protect approval and merge)

- A classification or verdict reads the whole record, never a filtered view built for display. A review verdict accounts for every changed file; a skipped reviewable file fails the verdict closed.
- A verdict or approval over a mutable revision re-reads the revision after the deciding agent finishes, so a change landed mid-decision cannot be approved under a stale result.
- A bounded prompt batch checks each individual item against the batch budget; an oversized item fails the verdict closed with evidence.
- A production check measures the real artifact, never an injected fake; an unknown measurement is not reported as zero.
- A scheduled operational action runs the real supported feature, not a read-only check behind a flag that claims the feature is configured.
- The install file list carries every app source module the entry point imports, and a clean-install check proves no unresolved local import before `check`/`build`.
