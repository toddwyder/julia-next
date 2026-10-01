---
name: code-standards
description: Code quality standards and style guide for reviewing pull requests
version: 1.0.0
metadata:
  tags:
    - code-review
    - quality
    - style
---

# Code Standards Review

When reviewing code, follow this structured process:

## Step 1: Critical Issues

Check for issues that MUST be fixed before merging:

- Logic bugs and incorrect behavior
- Missing error handling for failure cases
- Race conditions or concurrency issues
- Unhandled edge cases (null, undefined, empty arrays, boundary values)
- Breaking API changes without migration path

## Step 2: Code Quality

Evaluate overall code quality:

- Functions should do one thing and be reasonably sized (< 50 lines preferred)
- Avoid code duplication — look for repeated patterns that should be abstracted
- Use descriptive, meaningful names for variables, functions, and types
- Prefer explicit types over `any` in TypeScript
- Ensure proper use of async/await (no floating promises, proper error propagation)

## Step 3: Style Guide Conformance

Check against the style guide in `references/style-guide.md`:

- Naming conventions
- Code organization and import ordering
- Comment quality (explain "why", not "what")

## Step 4: Linting Flags

Flag these patterns:

- `var` usage (should be `const` or `let`)
- Leftover `console.log` or `debugger` statements
- Commented-out code blocks
- Magic numbers without named constants
- `TODO` or `FIXME` comments without issue references

## The five reviewer checks

Record evidence tied to the change for each check, or explain why it does not apply; missing evidence is a finding.

1. **unit tests** — meaningful behavior/regression coverage through appropriate interfaces.
2. **integration tests at affected boundaries** — exercise the changed component/storage/service/provider contract across the boundary.
3. **end-to-end for the changed journey** — the affected user journey through the assembled test app with test data, including failure paths.
4. **a clean browser console** — no unexpected console errors/unhandled failures (no browser surface: mark not applicable).
5. **logging good enough to find a root cause** — lasting logs/measurements identify the failing operation and context without exposing secrets.

## Output Format

Structure your feedback as:

1. **Summary**: 1-2 sentence overview of the changes and overall quality
2. **Critical Issues**: Must-fix problems with file path and line numbers
3. **Suggestions**: Improvements that would make the code better
4. **Positive Notes**: Good patterns and decisions worth acknowledging
