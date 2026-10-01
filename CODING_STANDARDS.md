# Coding standards

Post-build reviewer guidance. The reviewer checks the completed change and records evidence tied
to the change, or explains why a check does not apply; missing evidence is not a pass.

## Reviewer checks

1. **unit tests** — meaningful behavior and regression coverage for affected code through appropriate interfaces. Check the assertions actually detect the relevant failure; mocked provider responses alone cannot prove provider behavior.
2. **integration tests at affected boundaries** — exercise the changed component, storage, service, or model-provider contract across the relevant boundary, preferring existing deterministic fixtures or record/replay. Do not require production credentials or uncontrolled paid calls.
3. **end-to-end for the changed journey** — verify the affected user journey through the assembled test application with test data, including relevant failure paths, tied to the reviewed revision. Todd's live UAT does not substitute for this check.
4. **a clean browser console** — during the affected journey, no unexpected console errors or unhandled failures. Changes with no browser surface may be marked not applicable with a reason.
5. **logging good enough to find a root cause** — lasting logs/measurements identify the failing operation and useful context, connect related events, and expose no secrets. Inspect failure-path evidence; temporary debugging or a silent non-zero exit is insufficient.

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
