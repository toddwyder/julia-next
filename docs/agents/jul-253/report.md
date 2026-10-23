# JUL-253 implementation continuation

Todd's continuation supersedes the preflight parking report in pushed commit `20d2d9cba129d435b1749e5aa21a9da37a89fa6a`. Implementation continued while the account sign-ins waited.

The candidate replaces the zero-spend trial with one $2 card ledger shared across roles and restarted jobs. It keeps outstanding reservations, counts subscription usage at published API rates, handles configured long-context price tiers and permits ordinary positive charges. Normal sessions use Sol and DeepSeek; explicit machinery runs use Beam for the session and every helper. Refused reviews no longer count as successful review.

Stock AuthStorage owns both subscription sign-ins and renewal. ChatGPT's device flow and Claude's hosted paste-code flow were started and their account steps were supplied to Todd. Neither account is authorized yet. The first ChatGPT code expired and needs refresh. Claude Pro eligibility and ChatGPT's exact input-count endpoint remain unverified. Missing counts refuse generation rather than inventing an affordable input bound.

The local checks pass. There are 42 caught mutations, 14 passing SDK learning tests, and 198 passing root tests with four environment-dependent skips. The root suite's initial missing reviewer dependency was fixed with that owner's locked install. Framework lint and agent links pass. The framework lint currently targets an absent legacy graph tree, so it does not prove runner lint coverage. The DeepSeek coding delegate completed 40 guarded real requests and settled 84396744 nano-dollars; native Codex chat usage is not exposed by that ledger and is not included in that figure.

A full acceptance or independent-review pass is not claimed. Both subscription proofs, final adversarial review and exact-head CI remain to be completed. This report will be replaced with the reviewed candidate and publication evidence after those steps.
