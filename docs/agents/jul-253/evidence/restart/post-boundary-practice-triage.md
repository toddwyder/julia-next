# Post-boundary JUL-253 Start practice triage

Status. Awaiting Todd's approval before tracker creation.

## Category

Enhancement / machine-proof fixture.

## Summary

Create one fresh practice card to prove the repaired JUL-253 builder boundary through the real Tailscale Start page. JUL-254 and JUL-255 stay unchanged as evidence of their failed runs.

## Current behavior

JUL-255 was admitted and started from the real control page at source `ab6e94a0464888118796083f9ec1302b65626e53`. It settled 33 Sol requests and 30 DeepSeek requests for $1.556041076, then correctly refused a $0.499130000 Sol reservation because only $0.443958924 remained. It failed before implementation and produced no marker or candidate commit.

The builder crossed its ownership boundary. It investigated the host's Start route, browser, server, and earlier proof evidence instead of limiting Build to the requested repository change. The JUL-253 source repair makes the repository change the builder's scope and leaves outer Start and evidence capture with the host.

## Desired behavior

Create `JUL-253-START-PRACTICE-2.txt` containing exactly `Julia cleaned Start proof.` followed by one newline. The resulting practice candidate is clean, nonempty, and contains that marker as its only change from the repaired JUL-253 source commit.

## Key interfaces

`JUL-253-START-PRACTICE-2.txt` is the requested repository output. The real server Start page supplies the saved card and selected model roles to the machine. The host retains outer route and evidence artifacts.

## Acceptance criteria

- The real control page admits the Ready practice card and Start is clicked at `https://ovh.tail91f394.ts.net/julia-control`.
- The saved snapshot uses ChatGPT-plan Sol for orchestration and CommandCode DeepSeek for coding.
- The build finishes under the card's own unchanged $2 ceiling.
- The candidate commit is clean and nonempty, and its only change is the exact marker file and bytes.
- The card's shared ledger contains settled Sol and DeepSeek requests with provider usage and API-equivalent debits.
- Start response, browser network and console record, screenshots, receipt, exact commit, ledger rows, and marker readback are retained on `build/jul-253`.

## Proof

Refresh the standalone server checkout to the exact repaired branch head. Drive the installed Playwright browser through Todd's Tailscale address. Wait for a terminal successful build. Read the candidate diff and marker bytes from the exact commit. Read the card ledger and restore the normal Tailscale route and services afterward.

## Scope and risk

This is a disposable proof fixture. It does not publish or merge the marker, modify JUL-254 or JUL-255, reset any ledger, raise any cap, or reuse a failed card. The proof may spend up to the existing $2 per-card authorization. Failure evidence is retained without an unapproved replacement card.

## Approval requested

Approve creation of one fresh practice tracker issue with this brief and its transition to Ready for the final repaired JUL-253 Start proof.
