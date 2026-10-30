# 0026. A card pull request needs an independent shipping verdict on its head before CI goes green

Date: 2026-10-30

Status: Accepted

Todd's order for a card is build, independent PASS, UAT, land. Nothing enforced the middle step. The
Feature playbook ends at opening a pull request, and pstack's independent verifier lives in the
Shipping playbook, which nothing ran before UAT. A card could reach Todd's UAT with no check by an
agent that did not write the code.

## Decision

CI refuses green on a card pull request until a shipping verdict covers the pull request's current
head commit. The gate is `scripts/check-shipping-verdict.mjs`, run by the `shipping-verdict` job and
required by the aggregate `checks` job in `.github/workflows/ci.yml`. A missing verdict is red. A
FAIL verdict is red. Only a PASS for every acceptance criterion on the current head is green, all on
the real GitHub pull request.

A card pull request is a pull request that names a card. The title decides, because that is where a
pull request states what it delivers; then a lone `Card: JUL-n` line of the body, then a
`runner/card-<n>` branch, then a JUL id in the branch name. Reading one source keeps a slice titled
(JUL-290) on a branch cut from JUL-276's work as JUL-290, and keeps a body that mentions another card
in prose from naming one. A plan, retro or correction branch (`plan/`, `retro/`, `correct/`) names
the card it is about without delivering it, so the gate passes it: a plan for JUL-276 cannot satisfy
JUL-276's acceptance criteria. Engineering pull requests name no card and pass without a verdict.

## The verdict

The verdict is a comment on the pull request holding one fenced json block:

```json
{"juliaShippingVerdict":1,"card":"JUL-000","head":"<head commit>","verdict":"PASS","builder":"<model>","verifier":"<model>","criteria":[{"criterion":"<the card's words>","verdict":"PASS","note":"<what the verifier saw>"}]}
```

The verifier is an agent that did not write the code. It runs the change the way Todd uses it, the
way the Shipping playbook's step 1 says, and records PASS or FAIL per acceptance criterion of the
card with a note saying what it saw.

The gate fails, naming every gap, unless the newest verdict on the current head:

1. matches the pull request's card;
2. names a builder and a verifier that differ;
3. for a PASS, lists criteria and marks every one PASS with a note;
4. for a FAIL, is a red gate that lists the failed criteria and their notes.

The gate reads the pull request and its comments from the API on every run, not the event payload,
so a push after a PASS turns the gate red again. This follows `CODING_STANDARDS.md`: a verdict over a
mutable revision re-reads the revision after the deciding agent finishes.

## What the gate cannot judge

- Whether the verdict names every criterion the card has. The gate sees the pull request, not the
  Linear card. The evidence review (JUL-252) reads the card and holds that line.
- Whether the verifier really differs from the builder. Every machine pull request arrives from one
  GitHub account (toddwyder), so GitHub login cannot separate them. The record declares both, and the
  gate judges the declaration.

## Consequences

A card pull request with no verdict, a verdict on an older head, a FAIL verdict, or a verdict that
names the builder as its own verifier is red in CI. A FAIL sends the card back to the build with the
reason. A second FAIL stops the card with a root cause, as the delivery flow already says. Todd is
asked for UAT only after a PASS.

The first real PASS arrives from the first card build that runs a verifier. Until then card pull
requests stay red, which is the intended state.

This gate enforces the existing step; it does not replace the evidence review, which judges whether
the evidence is right, and it does not replace UAT.
