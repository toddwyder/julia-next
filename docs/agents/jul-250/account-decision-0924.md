# For Todd — actual CommandCode credential exposure

Pushed source/evidence checkpoint: 6c36e2db646acc3921c2bc7a3b84a6235cdce408
(build/jul-250-key-route). This is an unmerged work-in-progress checkpoint.

The key-route learning run exposed the live CommandCode API key to Beam. The
real request-resolution case used the retained learning harness, which writes
its custom provider configuration, including apiKey, into the owned temporary
settings.json. Beam chose the stock view tool to read that file. Its tool result
was included in four later HTTP 200 provider requests and in the captured SDK
result. This is observed credential exposure, not a hypothetical safeguard case.
No control-page vault pass was read and no runner limit was changed.

The temporary fixture is removed by the harness's finally cleanup. The two
uncommitted complete-suite.stdout copies were redacted before Git publication.
The existing credential-value scan then found zero matches across 131 candidate
files. No key value was printed to Todd, committed or pushed to GitHub. No key
rotation, revocation or account change has been attempted. There is no evidence
here of subsequent misuse; that is not a claim that the key remained confidential.
See evidence/2026-10-22-0924/credential-exposure.json, credential-redaction.json,
secret-scan-detected.json and secret-scan.json. The retained log is sanitized.

Before this account blocker, Claude's JUL-250 update was verified in
Implementation, JUL-249/local rules were reconciled with the clarified stop
policy, both fresh admissions passed and broken copies refused, all thirteen
learning tests passed with thirteen real broken/restored guard pairs, and 27
clean-candidate route/documentation/map/CI-routing/line-ending checks passed.
An ordinary missing-Zod setup error was fixed by the reviewer package's own
npm ci and admission rerun; it did not stop work. julia-agent remains unused.

Account decision needed: rotate the exposed CommandCode key (updating both the
Julia original and Julia agents copy), or accept this specific exposure and
continue. The copies do not synchronize. The builder's read-only agents pass
cannot rotate the provider account or update the two vault items.

Restart plan after Todd's account response: fix the actual learning-fixture
fault test-first, using SDK1.14.0's public setCustomProvidersSource runtime
interface instead of persisting the live key, and redact evidence serialization
without altering provider replies. Prove the settings/log regression directly
without a model, then rerun the few Beam-side cases and complete suite. No
hypothetical-risk rule, criterion or card is added. Review, final Proof, PR/CI,
merge, guardrails implementation and Build restart remain pending.
