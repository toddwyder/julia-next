# JUL-253 blocked at credential preflight

Evidence is pushed in commit `62c634b2b74de217bc64baae7f1b87ac3786dc08` on `build/jul-253`. The checked deployed main commit is `1009fde68bb43368ea95ab2e43ed2e7d04b409be`.

JUL-253 is parked in Implementation pending Todd's stock ChatGPT and Anthropic account authorizations. This follows the supplied AGENTS instructions to check required credentials before building and park when an account authorization boundary blocks the next required action.

The actual runner service uses `/home/ubuntu/julia-machine-main/ops/build-runner/machine-settings.json`. It has no `authPath`, explicitly marks Sol unavailable, and selects Beam for both machine roles. Its worker supplies a job-specific state directory. The adapter opens that directory's `auth.json` through stock `AuthStorage` and disables environment fallback. Neither that job store nor the default stock app-data store exists. See [credential trace](evidence/credential-path-trace.txt), [service configuration](evidence/deployed-units.txt), and [preflight readback](evidence/preflight.json). 1Password masked some nonsecret path segments in the bootstrap's output.

The stock SDK supports initial subscription login and subsequent token renewal. Existing Codex sign-in does not supply the adapter's configured credential store. Todd must authorize the subscriptions through the stock sign-ins; no account transfer or alternative Claude connection was attempted.

Node is 24.14.1 and the deployed SDK is 1.14.0, matching its lockfile. CommandCode and Linear keys were present through the required agents bootstrap. No inference requests ran. Claude Pro eligibility remains untested. This report does not settle its success or failure.

This is the maker's self-check, not independent review or machine Proof. The Prove It Works principle changed the check from assuming a signed-in Codex session was sufficient to inspecting the deployed runner's actual stores. No implementation, $2 cap, model split, ADR, acceptance proof, PR or delivery completion is claimed. The [todo list](todo.md) retains that work. The original dirty checkout and live services were left untouched.
