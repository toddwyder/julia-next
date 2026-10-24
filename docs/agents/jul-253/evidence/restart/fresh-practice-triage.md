# Fresh JUL-253 Start practice triage

Status: awaiting Todd's approval before tracker creation.

## Category

Enhancement / machine-proof fixture.

## Summary

Create one fresh practice card to prove the cleaned JUL-253 candidate through the real Tailscale Start page. The earlier practice card, JUL-254, stays unchanged in Implementation as evidence of the two failed attempts.

## Current behavior

The Tailscale control state has no Ready cards. JUL-254 exists in Implementation. Linear reports that JUL-255 does not exist. No fresh card can therefore be selected on the Start page, and no new tracker issue has been created.

## Desired behavior

The fresh card asks the machine to create `JUL-253-START-PRACTICE-2.txt` containing exactly `Julia cleaned Start proof.` followed by one newline, with that marker as the practice candidate's only repository change.

## Acceptance criteria

- The card is admitted by the real control page and started from `https://ovh.tail91f394.ts.net/julia-control`.
- The Start snapshot uses ChatGPT-plan Sol for orchestration and CommandCode DeepSeek for coding.
- The build finishes, produces a clean nonempty candidate commit, and the exact marker bytes are read back from that commit.
- The shared per-card ledger contains settled Sol and DeepSeek requests with provider usage and API-equivalent debits under the existing $2 cap.
- Start response, browser network/console record, job receipt, exact commit, ledger rows, and marker readback are retained on `build/jul-253`.

## Scope and risk

This is a disposable proof fixture only. It does not merge or publish the marker, change production behavior, reset JUL-254 accounting, raise the cap, or reuse the old practice card. The proof may spend up to the already-settled $2 per-card authorization. Failure evidence is retained without silently retrying under another card.

## Approval requested

Approve creation of this one fresh practice tracker issue for the final JUL-253 Start proof.
