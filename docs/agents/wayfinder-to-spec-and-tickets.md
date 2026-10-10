# From Julia's Wayfinder map to manageable specs and tickets

Use this guide when turning [Julia restart: chart the way to a v1 spec](https://linear.app/julia-next/issue/JUL-5) into buildable work. Copy the prompts below into a session opened in `C:\Dev\julia-next`. Replace text in square brackets before sending.

This guide records Todd's requirements for planning and verification. It does not install Pstack, change skill templates, implement completion enforcement, create tracker cards, or authorize delivery.

## 1. Choose one useful group of work

Wayfinder decision cards are source material for specs. Several decisions can feed one spec, and a shared decision can apply to several specs. You do not need a spec or implementation ticket for each decision card.

Keep the map and its completed decisions as the reference library. Group specs around things a household member wants to accomplish. These are candidate boundaries to refine against the codebase, not an approved build order:

| Candidate spec | Behavior it could cover |
| --- | --- |
| Collect and find recipes | Entry, URL/text import, clipper, cookbook import, editing, library search, nutrition |
| Plan a meal and shop | Menus, scaling, shopping list, staples, voice add |
| Prepare and cook together | Prep lists, cook mode, timers, co-cook behavior |
| Create recipes in the Lab | Sparks, variations, chat, riffs |
| Share and protect the collection | Sharing, backup, export, restore |

Sign-in, household ownership, offline behavior, installation, vintage design, observability, and verification are shared requirements. Allocate necessary enabling work explicitly; do not assume another spec will provide it. A broad group can become multiple specs if its journeys do not fit together well.

Fully specify and ticket the next group you intend to build. Keep later work as a short roadmap until its turn. A coverage table should show which required v1 behaviors belong to the current spec and which remain for later, so deferring work does not silently drop it.

Specs are documents; reserve implementation cards for buildable work. Linear owns requirements, acceptance criteria, and card status; GitHub owns code, PRs, and CI. Any local spec draft must have an explicit authoritative Linear document or card when published, rather than becoming a competing requirements copy.

## 2. Apply these requirements to every spec and implementation ticket

### Observability and regression coverage

- **Sentry:** unexpected failures carry enough context to identify the affected journey and diagnose the failing operation.
- **Axiom:** significant operations, outcomes, and failures produce structured events. Related events share an operation identifier. Every connection between services has a trace showing the intended service and account.
- **Integration tests:** identify every seam the change crosses, including component, storage, sync, and external-service boundaries. Cover observable contracts and relevant failure cases. Connections between services are tested against the real service, as required by [CODING_STANDARDS.md](../../CODING_STANDARDS.md); mocked responses alone do not prove that connection works.
- **Verification:** Proof decides done; tests guard; live alarms catch the rest.
  - A change is done only when an agent has driven the journeys it touches on the real app and saved evidence of actions, results and side effects. Passing tests alone never count.
  - The every-change CI gate has a 10-minute limit: logic checks, real-service seam checks against the free Firebase test project, and deterministic checks on sample inputs. Over 10 minutes, cut or move checks; don’t add machines.
  - Paid AI-model checks run only when the code that calls the model changes.
  - Physical-phone and browser-extension checks run on Todd’s laptop as builder proof, only when that code changes.
  - Every preview gets a two-minute smoke check of the core journeys.
  - Prove only the journeys a change touches. No permanent all-journey browser suite.
  - Every test must be able to fail and must catch something no other test catches. Delete the rest.
- **Runtime dependencies:** for server or database work, include a runtime dependency matrix naming each boundary, the deployed principal (service identity), backing store/API, read/write mode, test fixture, and deployed proof command. Follow [work-execution.md](work-execution.md).
- **Telemetry proof:** exercise the relevant success and controlled failure paths and inspect the actual expected telemetry. Use an isolated verification environment and identify its build. Record concrete events and error expectations; adding logging calls alone is insufficient. Keep secrets and personal data out of telemetry and evidence.

### Pstack verification only

Pocock's workflow remains responsible for planning, specs, tickets, TDD, and code review. Adopt only Pstack's verification capabilities: `create-verification-skill` establishes Julia's project-local `verify-julia` skill; `maintain-verification-skill` keeps that skill and its feature map accurate. This guide does not authorize adopting Pstack's other workflows, model choices, or delegation defaults.

Every implementation ticket must require:

- Use Julia's `verify-julia` skill to demonstrate the feature works through the actual user or service path.
- Verify actual behavior and relevant side effects, including relevant failure paths. Passing tests alone is insufficient proof.
- Capture evidence of successful verification, linked from the PR and Linear card. Identify the tested revision, environment, device where relevant, actions, expected results, observed results, and artifact locations.
- Add or update the feature in the verification map, including its relevant entry points, prerequisites, drive steps, and observable success criteria.
- Preserve repeatable verification for future use: reuse or extend commands, scripts, fixtures, and cleanup steps; ensure evidence survives cleanup.
- Reuse existing verification methods. Extend them within the feature ticket when needed. Do not create separate verification tickets unless a missing capability requires PM triage. Prepare the gap and detailed triage brief for Todd's approval before creating a new card.

**Completion rule: A feature cannot be declared complete without demonstrated proof that it works.** Unavailable verification is an unresolved requirement, not a pass. A refactor proves the affected behavior remains correct; a service or machine change proves its actual artifact and side effects even when it has no UI.

The Pstack feature map describes how to prove behavior; it is not another issue backlog. Automated regression tests preserve repeatable checks, while runtime evidence proves the reviewed build actually behaves as intended. Both are required where applicable.

### Review and UAT

The reviewer records evidence for the five checks in [CODING_STANDARDS.md](../../CODING_STANDARDS.md), or explains why a check does not apply. Review checks the proof itself, its relevant side effects and telemetry, the updated verification map, and its match to the reviewed revision. An evidence link by itself is insufficient. Relevant changes after verification require fresh proof.

Todd tests the Vercel preview before merge using the card's household-facing UAT steps. Agent verification and regression coverage do not replace Todd's UAT.

## 3. Paste this when you run `$to-spec`

Choose the group and its intended outcome first. For example: “Collect and find recipes; I can keep a recipe, find it later, and read it offline.” Run this in the planning session, retaining context through the ticket breakdown where practical.

```text
$to-spec

Read docs/agents/wayfinder-to-spec-and-tickets.md and apply all of its shared
observability, regression, Pstack-verification-only, review, and UAT requirements.
Follow my standing instructions and the current AGENTS.md where older skill or
tracker documents conflict.

Use JUL-5, "Julia restart: chart the way to a v1 spec", as the source map.
Read the relevant decision bodies, resolution comments, glossary, ADRs, and
current codebase. Resolve superseded decisions using the current instructions;
report any unresolved product conflicts rather than silently choosing.

Draft ONLY this spec:
Name: [SPEC NAME]
Household outcome: [WHAT I WILL BE ABLE TO DO]

Combine the relevant decisions into complete user journeys. State scope,
out-of-scope work, shared requirements, dependencies, enabling work, and
assumptions. Include a coverage table linking the source decisions and showing
what is covered here versus deferred to a named later group. Do not omit required
v1 behavior or re-interview me about decisions already settled in the sources.

For each journey, name the device, observable success criteria, relevant failure
cases, side effects, Sentry/Axiom expectations, test seams, regression coverage,
and repeatable verify-julia proof. Identify existing methods to reuse. Include
the runtime dependency matrix where server or database work is involved.

If verify-julia or a needed method is missing, record the exact capability gap
and its effect on readiness. Describe proposed proof as proposed; do not claim
it has run or that completion enforcement already exists.

Present the spec as a document draft for review. Highlight unresolved decisions
and new test seams needing agreement. Do not create tracker issues, change the
Wayfinder cards, install tools, start implementation, or start delivery.
```

Review the outcome, scope, coverage table, enabling work, and proof plan. Settle any remaining questions before ticketing. Record the accepted spec's document reference and revision so a fresh session can retrieve it.

## 4. Paste this when you run `$to-tickets`

Use the accepted spec, not the entire Wayfinder map. Ask for the smallest practical set of complete slices. Each slice must be independently demoable or verifiable and fit a single fresh agent context. There is no mandatory ticket count; merging unrelated work merely to reduce the count creates oversized cards.

```text
$to-tickets [ACCEPTED SPEC DOCUMENT REFERENCE]

Read the full accepted spec and its relevant comments. Read
docs/agents/wayfinder-to-spec-and-tickets.md and apply all shared requirements.
Follow my standing instructions and the current AGENTS.md over older skill or
tracker instructions.

Propose the fewest complete, demoable or verifiable vertical slices that each
fit one fresh agent context. Keep UI, storage/API behavior, tests, observability,
and verification together in each relevant slice. Account for enabling work
and genuine blockers. Ticket only this spec; leave later specs as roadmap work.

For each proposed slice show its title, delivered behavior, covered spec
criteria, out-of-scope work, and blockers by proposed title. Include concrete
acceptance criteria for Sentry, Axiom, integration tests at every affected seam,
the required regression suite, verify-julia execution, actual side effects,
captured evidence, verification-map updates, repeatability, and preview UAT.
Include runtime dependency details where applicable. Carry the completion rule
into every implementation brief: no feature is complete without demonstrated
proof that it works.

Reuse existing verification methods and extend them within the implementation
slice. Identify any missing capability needing PM triage; do not create a
separate verification ticket yourself.

Present the breakdown for granularity review. Once the breakdown is settled,
use Pocock's triage workflow to prepare a detailed triage brief for each proposed
new issue, using .agents/skills/triage/AGENT-BRIEF.md and this guide. Include
category, current and desired behavior, key interfaces, acceptance criteria,
scope, existing implementation/prior rejection checks, dependencies, and any
remaining readiness gaps. Return the briefs to me for approval before creation.

This is draft and triage work only. Do not create tracker issues, assign new
issue numbers, add issue/dependency links as a substitute for triage, modify
existing cards, or start implementation. Use titles to describe proposed
dependencies until the briefs are approved and the cards exist.
```

Review the breakdown before approving the triage briefs. Every new issue needs this pre-creation triage, including tickets produced by `$to-tickets`; Todd's standing rule overrides the skills' default “already agent-ready” exception. Brief approval is separate from approval to start a build.

After reviewing the final briefs, use this if you want the cards created:

```text
I approve the final triage briefs titled [EXACT TITLES]. Create only those
implementation cards in Linear using the approved briefs and accepted spec.
Wire only the approved native dependencies after the cards exist. Link the
authoritative spec and retain all verification and UAT acceptance criteria.
Leave the cards in Backlog; this authorizes creation, not implementation.
Do not create additional cards or change the Wayfinder decision cards.
```

## 5. Before implementation begins

The intended adapted JUL-122 runner and `$init` wrapper are pending implementation and verification. Its complete test suite must pass on Todd's Windows laptop before it is used for delivery. Factory remains paused. This guide does not authorize starting either route.

Pstack verification setup must establish a usable `verify-julia` skill and feature map. Use existing harnesses first; execute the generated skill end to end and confirm its evidence survives cleanup before relying on it. An unexecuted generated skill remains a draft. Handle a missing setup capability within already authorized adoption work, or prepare a PM triage brief if separate work is needed.

For the requirements to persist beyond these prompts, adoption work should connect this guide to project instructions, spec/ticket templates, reviewer instructions, and the adapted runner's completion checks. Those checks should require revision-matched proof and a reviewer verdict; a file's presence alone cannot establish that a feature works. These are implementation requirements, not capabilities this document installs.

## Example of sufficient proof

For “save a recipe,” drive the save through Julia's interface, inspect the expected stored record, reopen the recipe, and exercise relevant offline/sync behavior. Observe the expected Axiom events and a controlled failure's Sentry report. Preserve revision-matched evidence, reusable checks, regression tests, and the feature-map steps. Then Todd follows the card's preview UAT steps before merge.

## References

- [Julia restart map](https://linear.app/julia-next/issue/JUL-5)
- [Current project instructions](../../AGENTS.md), [coding standards](../../CODING_STANDARDS.md), and [execution route](work-execution.md)
- [Pstack: create-verification-skill](https://github.com/backnotprop/pstack/blob/main/skills/create-verification-skill/SKILL.md)
- [Pstack: maintain-verification-skill](https://github.com/backnotprop/pstack/blob/main/skills/maintain-verification-skill/SKILL.md)
- [Pstack: prove-it-works principle](https://github.com/backnotprop/pstack/blob/main/skills/principle-prove-it-works/SKILL.md)
