# Where agent work runs

## Standing decisions

- Run builds and reviews in the Claude cloud session by default. Todd's laptop has recurring memory problems; use it for coordination, not worker execution. Do not ask Todd to choose an environment for every card.
- Use OVH for checks that require the graph's actual server environment. A run already underway there may finish there; do not move an active run merely to apply this default.
- Follow an explicit environment or model choice in the current conversation. Requested models and efforts override the card's labels for that run. Do not substitute models or fall back to the laptop without Todd's approval.
- When adversarial review is requested, dispatch an adversarial reviewer; do not silently change the review role.

## Model availability

Todd confirmed on 2026-09-25 that Gemini 3.8 Flash at medium effort and GPT-6 Sol at medium effort both work in cloud. This records user-confirmed availability, not a locally tested installation procedure. These are available choices, not defaults for every card.

Use an established working route without repeating setup questions. If a real dispatch fails, investigate that route: record the runtime/version, exact model identifier, account type, and actual error. Availability in one app or environment does not prove availability in another. Verify unfamiliar invocation or update procedures against authoritative documentation or observed behavior; do not infer a required update from a third-party report alone.

Report a concrete blocker if it remains. Ask for a decision only when the requested route cannot be made to work and a substitution or environment change is needed. Respect approval-review blocks and report the rejected action and reason.

## Build and review workflow

Every build follows the repo's own skills. No dispatch brief, worker restriction, graph brief or coordinator shortcut overrides them; a brief that conflicts with them is written wrong and is corrected before dispatch.

- **Building: `.agents/skills/tdd/SKILL.md`**, with its `tests.md` and `mocking.md`. Agree the seams with Todd before any test is written. Work in vertical slices: one behavior test at an agreed seam, run it and show it fails because of the defect or missing behavior (a setup error, broken fake or unrelated failure is not a red step), then the minimal implementation, then run it and show it passes. Never write a test and the code it pins in the same worker run. Mock only at system boundaries (Linear, GitHub, workers, time).
- **When the worker cannot run commands** (headless Gemini, for one), the coordinator runs every red and green step between the worker's edits. The worker's brief asks for one test, or for the minimal code for one test, never both.
- **Guard check.** For each new guard, remove it and show its test fails, then put it back. Record the result.
- **Reviewing: `.agents/skills/code-review/SKILL.md`.** Run its Standards and Spec sub-agents separately, keep both reports verbatim, and do not merge or rerank them. This is in addition to any adversarial reviewer Todd asks for, never instead of it.
- **Evidence.** Record on the card the skill paths used, each meaningful red and green result, each guard check, and both code-review reports. Do not claim a workflow was followed without that evidence. A card moves to UAT only after the checks and reviews pass.

## Scope and acceptance

Review against the card's agreed acceptance criteria. Consolidate clarifications into existing outcome-based criteria where possible; do not add a checkbox for every edge case or optional improvement. Detailed recovery rules and test scenarios belong in the description. A real requirement failure remains a finding regardless of checkbox count.
