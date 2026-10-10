# JUL-205 — Behavior proof and review gate

## Required review practice

For Julia changes with user-facing behavior, builders run the relevant recipes in
`.agents/skills/verify-julia/SKILL.md` and preserve the launch and Doctor records, browser actions
and observations, test output/exit codes, console result, and post-cleanup readback. Reviewers inspect
those artifacts themselves and compare the recorded commit and dirty-tree SHA-256 with the exact
candidate under review. Any source change after the run makes its proof stale.

Missing, failed, unavailable, stale, or identity-mismatched proof fails closed. A builder statement
such as “tests pass,” a healthy endpoint without candidate identity, or Todd's UAT is not a substitute.
Not applicable is reserved for a change with no relevant user-facing behavior and must include a
reason.

## CI seam and maintenance disposition

This slice does not alter CI enforcement. The existing seam is the `CI` workflow in
`.github/workflows/ci.yml`. Its current route table selects `docs-policy` for `docs/**` changes
and selected policy scripts; it selects `web` for the mapped application, test, and Playwright
configuration paths. This change includes `docs/**`, so it selects `docs-policy`; its root
instruction and skill paths do not independently select that job. The workflow currently runs the
browser suite in `web` but does not publish a verification-proof artifact contract. JUL-206 owns
extending that existing route to require applicable verification and retain failure proof; this
handoff makes no claim that CI has already done so.

Until that enforcement lands, a builder retains the run evidence at an accessible candidate path
and gives the independent reviewer the exact path or pull-request link. The reviewer reads the
launch and Doctor records, behavior results, exit codes, console result, and post-cleanup readback
there, then rejects evidence whose identity does not match the reviewed tree.

The feature map is maintained by the added review-gate instruction in
`.agents/skills/verify-julia/features/README.md`. No helper-script change is required: the
existing `scripts/verify-julia.mjs` launch and Doctor commands already record and validate the
commit and dirty-tree digest. If a verified surface or its entry point changes, use the skill's
existing `/maintain-verification-skill` route to update the relevant recipe and helper only as
needed.

## Complete JUL-204 example — proof with an explicit candidate caveat

The evidence was captured from the JUL-204 checkout at
`C:\Dev\julia-next-jul204\.artifacts\verify-julia\2026-10-09T224511-930Z-b78fc626\evidence`.
It was copied byte-for-byte to
[`docs/research/evidence/JUL-204/2026-10-09T224511-930Z-b78fc626/`](evidence/JUL-204/2026-10-09T224511-930Z-b78fc626/).
Every copied file's SHA-256 is listed below and was checked against the original.

The actual candidate record is:

| Field | Recorded value |
| --- | --- |
| Run ID | `2026-10-09T224511-930Z-b78fc626` |
| Branch | `toddwyder/jul-204-generate-verify-julia-and-prove-the-two-existing-features` |
| HEAD | `5bd201cd08b6e96e2517c0ab279e339ea79feb38` |
| Dirty worktree SHA-256 | `28d5599cbf8edb81e4f31e7109c7a3382506d3683885ddacf66780590dd96db8` |
| URL | `http://127.0.0.1:61166` |
| Runtime versions | Node `v24.14.1`; Julia package `0.0.0`; Next.js `16.3.5`; Playwright `1.63.0` |
| Process/listener | Next root PID `45556`; listener PID `39712` |

Launch did not return until the recorded Next process tree owned the listener and `/api/health`
returned `status: ok`. Doctor independently confirmed the same candidate and ownership, with one
successful health attempt. The page showed `Julia 0.0.0` and `what are we cooking today?`. The
manifest link was same-origin with two favicon links; the manifest returned HTTP 200 with
`application/manifest+json`, and its two PNG assets returned HTTP 200 and decoded to 192×192 and
512×512. Both checked-in browser tests passed twice (2/2 each); the browser reported zero console
errors. Cleanup after terminating the recorded root removed its verified listener child, cleared
`run.json`, removed the isolated build output, and a subsequent launch reached readiness. The run
recorded no persistent household-data changes.

**Candidate caveat:** this is proof for the recorded dirty candidate at HEAD `5bd201cd` and digest
`28d5599c…`; it is not a proof run on commit `39c6dd28` or the merged commit `aae0706c`. The app,
spec, config, and helper diff between `39c6dd28` and `aae0706c` is empty, but that relationship does
not change the recorded identity or turn this artifact into proof of either commit. A review of
`aae0706c` still needs evidence whose candidate identity matches that commit; the empty diff is
context, not an exception to the evidence gate.

## Rejected missing/stale-proof example

Suppose a review targets `aae0706c`, but the submission contains only “the Playwright tests passed,”
or links these JUL-204 artifacts as if they were produced by `aae0706c`. Reject the proof: the first
submission has no inspectable behavior evidence or candidate identity; the second records HEAD
`5bd201cd` and dirty digest `28d5599c…`, which do not match the reviewed candidate. The empty
app/spec/config/helper diff noted above does not make that mismatch disappear. Re-run the proof on
the exact reviewed tree, or keep the review blocked; do not report pass or not-applicable.

## Preserved JUL-204 evidence and hashes

Source for all files: `C:\Dev\julia-next-jul204\.artifacts\verify-julia\2026-10-09T224511-930Z-b78fc626\evidence`.
Destination: `docs/research/evidence/JUL-204/2026-10-09T224511-930Z-b78fc626/`.

| File | SHA-256 |
| --- | --- |
| `abnormal-root-exit-cleanup.txt` | `C699777FCA8FB2CB990EF0C166199CBF266827E501BEC99A809C0E9974706526` |
| `console-errors.txt` | `BD97BE5C2AD83024485E38ED8161C8216137A54C905224BF656BC3CF2EABA3B4` |
| `doctor.json` | `33A476FCF36F510DC1CCC91F0C3F60277A71FD275E9535B2D73DFD4D5CDBB364` |
| `home-main.txt` | `D7F5BCB634AD30C9138BAD6881F25B6C52C94B5A40B9FCBC760ECB3700EB77EB` |
| `home-snapshot.yml` | `BCB54F2DEAAE33F98018F6BE5D193D461C9D9AE31167C36EC20B436FA2F26DCA` |
| `home.png` | `1E3B92581EA85C902977AFE82BC036517303EFFF496F55EA39E69E7150497CF1` |
| `launch.json` | `9F3341025456BF8BE53AF5B8CA29BF3C9F43D666023CDA17F9C44960760973EA` |
| `manifest-assets.json` | `A8995DE1713ABB323DCEBA739E23B47D8EE7CD2C826754B35D53162B5E97D331` |
| `manifest-entry.json` | `45619B0062C264A418E3F3F627479AD696F710A70CC83F1460FB2A65D7A335FF` |
| `playwright-test-1.txt` | `70586CC00065BDE2651A17EFB65BF99EDE086288D57F7D9060F7183551949210` |
| `playwright-test-2.txt` | `C21D035E0C4B95AE855EA0C060988CF890BE668AEB27D6A71B9707FC19BD67E2` |
| `post-cleanup-relaunch.json` | `7AB29188474F0D6F1EEF86FB8EDB508F78A73893A408B4EC22503E1840FC14C0` |
| `server.log` | `77B52F5CBE5985F6712C7DC0B945B5248C68F2172CC8CBC63137976A5F72F52A` |
| `side-effects.txt` | `78BA434425C89A935F89386E25758D816B969128D2BD84B1B9B450DBC1096F96` |
