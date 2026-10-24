# JUL-253 real server Start proof

The OVH inventory was pushed first in `1a93d523e7fb34289bdd16218fcefdb7dcbee382`. No pre-existing leftover was removed or stopped. The Windows Proof gate in the earlier report was incorrect. It came from the retired skill in stale `/home/ubuntu/julia-next`. Current `machine-main` and its agreed path-forward require the real server Start route through Todd's Tailscale address.

## What actually ran

Practice card [JUL-254](https://linear.app/julia-next/issue/JUL-254/practice-jul-253-through-server-start) was admitted by the real control page. Playwright drove `https://ovh.tail91f394.ts.net/julia-control`, selected native ChatGPT-plan Sol as orchestrator and CommandCode DeepSeek as coder, and clicked Start. No route or model response was mocked.

The pinned practice runtime was `808c6c8a070a387097185508d44c30ede7babb3f`. Its initialization response, job and ledger refer to the same card and source. [Browser driver](start-drive.mjs), [selected page](attempt-2/start-selected.png), [Start response](attempt-2/start-response.json), [browser console/network](attempt-2/start-browser.json). Console entries and page errors were empty.

The real Start also exposed two code defects that the earlier direct SDK probes had missed. Native subscription offers were absent from Start, and raw model-ID resolution could silently substitute a native backend for a CommandCode selection. Both were fixed before the first click. The candidate also incorporated current main's corrected CLAUDE entrypoint before being served.

## The build did not finish

| Model | Settled real requests | API-equivalent debit |
| --- | ---: | ---: |
| `openai/gpt-6-sol` | 26 | $1.143767200 |
| `commandcode/deepseek/deepseek-v4.1-flash` | 10 | $0.009005268 |
| Total | 36 | $1.152772468 |

The ledger holds zero and retains $0.847227532 of the original $2. Every listed request has provider-reported usage and a settled charge. These are API-price debits, including subscriptions, not an invoice assertion. [Every request ID and token category](practice-ledger.tsv), [raw ledger](attempt-2/ledger.json), [actual HTTP outcomes](attempt-2/requests.jsonl), [subagent events](attempt-2/events.jsonl).

DeepSeek completed the coding handoff and wrote the requested 41-byte marker. The maker read its bytes and verified SHA-256 `b09619c7d8fde0f90345ac3a717dad9979cbf4039cc15209b5d3eb80d687c7d0`. The file contains exactly `Julia subscriptions build through Start.` plus one newline. The run failed before finishing its review checklist and creating a candidate commit. The marker is still uncommitted in the retained practice worktree. This is not a passed Build or staging proof. [Actual readback](practice-readback.json), [unfinished checklist](attempt-2/pstack-checklist.md), [failed receipt](attempt-2/receipt.json).

## Attempts and corrections

1. Run `jul-254-a5e7237716de0621d9adb2f00c469726` on `b08bedc1` failed before inference. The worker logger constructed a Request, transferring its body, then forwarded the consumed original. It booked zero and held zero. The extracted observer now forwards its constructed Request. A real local HTTP echo regression failed before the fix and passed afterward. [Original receipt](attempt-1/receipt.json), [red](request-body-red.txt), [green](request-body-green.txt).
2. Run `jul-254-551c2aab2a1005b421fffb7fb1bd0464` on `808c6c8a` made the 36 real requests above, then refused the next reservation. Its receipt reports a ledger refusal. Source inspection shows the guard used the long-context maximum rate even for a padded input bound below the published 272000-token threshold. The last settled Sol request reserved $0.82598 for a 140620-token input bound. Reachable short-context rates require $0.43347 for that same bound and output ceiling. The exact refused request bound was not saved; its immediate ceiling-refusal mechanism is inferred from the receipt, remaining balance and calculation path. The inflated reservation calculation itself is proven by source and regression.

The correction is pushed in `2255d7c57731a058ab16e71f5e3f531c25d82c29`. Reservation takes category maxima over tiers reachable within the declared input bound. At a 150000-token bound with the same prior spending, the former $0.87288 maximum falsely refused the $0.847227532 balance. The corrected $0.45692 maximum fits. Tests also check the exact 272000/272001 boundary. No padding, limit, spent amount, hold or ledger history was reduced. [Red](reservation-tier-red.txt), [green](reservation-tier-green.txt), [57 caught mutation probes with source restored and 77-test final suite green](practice-tier-mutations/mutations.json), [fix source identity](fix-source-readback.json).

The corrected candidate has not been driven through Start again. CI status is reported separately. The earlier static DeepSeek review covers source `808c6c8a`, not this last pricing correction. It has a same-model limitation for its delegated offer-discovery draft and is not a full independent acceptance pass. Its Beam-check concern omitted the existing worker caller that rejects `machineryProof && internalReview.deepseekSent`; its configuration concerns were not reproduced in the actual configured Start. [Raw review](start-code-review.json).

## Existing stop rule and restart plan

The current [agreed path-forward](https://github.com/toddwyder/julia-next/blob/fa95a1a41be69202dcc75b9cf1f753557ecb7a91/docs/plans/path-forward.md) says "2nd proof failure stops the card" and that a stopped card stays in its column while Todd receives a root cause and restart plan for his OK. Those are the two real server proof failures above. The retired Linux/Windows Doctor was not counted.

No third Start or further paid request was launched after the second failure. JUL-253 and JUL-254 remain in Implementation, not Complete or parked. The monetary account itself is not stopped and still has the stated balance; this is the workflow's two-failure stop, not a claim that $2 was spent.

Restart plan: retain the practice card, its existing worktree, correct marker, saved SDK thread and all accounting. Use the corrected reservation calculation, verify a continuation of that saved run through the Start path, and complete its remaining reviews, commit and proof within the remaining $0.847227532. Do not rebuild under another card ID, reset the ledger, raise the cap or claim this correction has already passed live proof. A continuation path needs verification before another paid run; the current Start idempotently returns a saved failed job rather than resuming it automatically.

The original Tailscale Serve configuration was restored exactly. Only this run's newly created proof units were stopped. No old checkout, helper, skill, credential, timer or pre-existing service was removed or stopped. All practice jobs, threads, ledgers and evidence remain. [Before](serve-before.json), [candidate route](serve-candidate.json), [restored](serve-restored.json), [restoration check](route-restoration.json).
