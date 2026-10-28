# Retro notes — 22 Oct 2026 (Claude's running notes)

Running notes for the next retro. Facts from today, each with what happened and why it matters.

## Implementation and testing (Todd: must change once the machine works)

- **Tests that prove nothing.** Many tests passed without proving their guard until someone deliberately broke the guard. Learning tests depended on how one model worded its tool calls: Beam omitted a required argument and the push test "failed" for the wrong reason; MiniMax's free window ended and seven cases failed. Fixed mid-card by testing framework facts directly, with no model in the loop.
- **Review blurred and runaway.** Code review (Pocock `/code-review`, once at the end of `implement`, run by the builder's own helpers) and adversarial review (pstack, independent reviewer, max two rounds) were never kept apart. Claude wrote "real review uses DeepSeek" into the cards and rules; Codex then sent code review to DeepSeek repeatedly as full-branch packets (370–400K tokens each), costing about $0.84 on one plumbing card. Todd's reviewer for adversarial review is Gemini. Nothing enforces the two-round limit until the runner owns it.
- **Heavy proof for small work.** Plumbing cards picked up formal verification, full machine Proof and multi-model review. A lot of process for small changes.

## Claude's own failures

- **Took Codex's reports as gospel.** Laptop admission, the operator-only lockdown, signed-in billing pages, cost receipts: each time Claude solved for Codex's stated blocker instead of asking whether it was real or a design flaw. Codex moves work it could do itself onto Claude or Todd.
- **Fix after fix.** Each blocker got new machinery (helpers, accounts, gates, a spending proxy idea) instead of asking whether it blocked the first working run. Todd had to stop it repeatedly.
- **Decided risk for Todd.** Accepted risks and added rules without asking what Todd considered acceptable.
- **Asked Todd to do technical things.** Editing an SSH config file, approving things he couldn't evaluate.
- **Acted on Codex pastes before discussing.** Todd now wants discussion first, action only when he says so.

## Codex's patterns

- **Constant stopping.** Stopped for a Linear status name that didn't exist ("In Progress" vs "Implementation"), for an ordinary tool error, for a credential judgment, for cost receipts. Root cause: the AGENTS.md "ask Todd for an account action" rule was read as anything touching an account. Narrowed at 09:52 to three cases.
- **Loosening limits instead of respecting them.** Reworked the cost tracker to make room for more review rather than stopping.
- **Allowlist leak.** 24 requests went to Ornith (paid, not allowlisted) and 16 to Glyph Cluster after it was dropped. Small money, but the model allowlist wasn't holding.

## Process and setup issues

- **Laptop-era assumptions left behind.** Pre-plan admission, the vault launcher and the "operator on the laptop" all assumed the laptop after work moved to the server, causing permission walls all morning.
- **Spending control.** Account caps weren't enforceable (CommandCode worst case about $84). Settled: the runner's adapter enforces the model allowlist and the $1 per-card cap.
- **Security vs progress.** About two hours went to admin accounts and lockdowns before Todd decided to accept the risks and add rules only after a problem actually happens.
