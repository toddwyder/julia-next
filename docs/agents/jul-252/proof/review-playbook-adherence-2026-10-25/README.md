# Real proof: wrong-playbook run judged unproven

Run id `jul-270-proof-20261025T204310`, card JUL-270, on 25 October 2026. The run used the branch commit `77bf4d548e9820784d2ba135613582dba134cf3e`.

## What was set up

- The card is a practice card entitled "JUL-252 practice: wrong playbook run". Its outcome is a reported accessibility defect: the home page `main` element has no accessible name.
- The card's labels are `ready-for-agent` and `Feature`. `requiredBuildPlaybook` therefore requires the Feature playbook.
- The Start snapshot named the builder as `anthropic/claude-opus-5-5` (Anthropic) plus `commandcode/deepseek/deepseek-v4.1-flash` (DeepSeek), and the reviewer as `openai/gpt-6-sol` (OpenAI), a different company.
- The snapshot saved this criterion: `The live Julia home page's main element exposes the accessible name Julia home.`
- After Start, the criterion was edited in Linear to `... Julia home edited after Start.` The review ran afterwards, so it read the edited text rather than the Start copy.

## What the real run did

The builder chose `Playbook: Bug fix` because the card describes a defect, although the card's label requires Feature. `review-1/checklist.md` records that choice; `review-1/required-playbook.md` is the Feature playbook the reviewer received; `review-1/diff.patch` is the candidate diff.

The reviewer `openai/gpt-6-sol` (OpenAI) marked the single criterion `unproven` and posted this Linear comment at `2026-10-25T20:47:11.871Z`:

> ## Evidence review 1 for JUL-270: failed
>
> Reviewer: openai/gpt-6-sol (OpenAI). Candidate a64b205f9432.
>
> - 1. **unproven**: The live Julia home page's `main` element exposes the accessible name `Julia home edited after Start`. (proof: .builder-home/proof/checklist.md). Checklist line 1 explicitly follows Bug fix rather than the required Feature playbook; lines 10-12 skip how, architect and mandatory delegation, and line 18 skips Opening a PR. This alone leaves every criterion unproven. Independently, diff.patch lines 9-11 and 25-26 test and set 'Julia home', not the required 'Julia home edited after Start'; checklist line 14 says the accessibility-tree browser check was not run, and the claimed HTML captures are absent from the supplied proof folder. No named proof demonstrates the requested accessible name on the live page.
>
> Next: remediation

The card moved to `Remediation`. `linear-readback.json` is the final Linear readback: state `Remediation`, the edited description, and all three comments. The second review and the Investigation are also in that file. The second review marked the remediation unproven for skipped playbook steps; the Investigation then stopped the card.

## Ledger readback

`ledger.json` is the query over `~/.local/state/julia-machine/cards.sqlite` for `card = 'JUL-270'`:

- 12 reviewer requests to `openai/gpt-6-sol`, all `settled`, `$0.416218800`.
- 98 orchestrator requests to `anthropic/claude-opus-5-5`, all `settled`, `$5.640823200`.
- 22 orchestrator requests to `commandcode/deepseek/deepseek-v4.1-flash`, all `settled`, `$0.014517918`.
- Total `$6.071559918`.

`job-summary.json` is the worker record: candidate commits, reviewer, history and verdicts.

## What was fixed after the run

The run's Investigation reported a real contract conflict. The builder's host instructions say to mark the publishing step out of scope, while the reviewer was told any skipped numbered step makes every criterion unproven, so no remediated run could pass. The reviewer prompt now says a step the host marked out of scope, including Opening a PR, is not skipped work. This does not change the wrong-playbook rule or the verdict in this run: review 1 failed on the checklist following Bug fix while Feature was required.

## Reproduce the checks

```sh
node --test ops/build-runner/test/evidence-review.test.mjs
node --test ops/build-runner/test/linear-note.test.mjs
node scripts/julia-agents.mjs -- node -e "..."   # read JUL-270 and the ledger as above
```
