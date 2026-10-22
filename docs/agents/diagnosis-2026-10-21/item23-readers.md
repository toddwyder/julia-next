# Item 23 — 21 October readers, not a fix

Scope is 21 October UTC, the workday Todd named. No credential values are
included. Source readers are distinguished from merely reading launcher source.

Documented actual readers in that day's retained records:

- One-off Python subprocess launchers ran `sudo -n -u julia-control cat
  /run/credentials/julia-control.service/op-service-account-token`, captured
  stdout in memory and passed it to `op run`. The initial three SDK runs are
  explicitly recorded in `framework-guardrails/evidence/resume-readback.md`
  on `preplan/framework-learning-tests`.
- `/tmp/framework-shape-secret-run.py` used that same sudo-cat reader for the
  learning runs recorded in `framework-guardrails/evidence/runner-resume-readback.md`.
  The wrapper was already absent at this cleanup's first /tmp listing. No new
  invocation was made by this diagnosis.
- The fixed `/usr/local/sbin/julia-framework-learning-run` opens the credential
  with `os.open` before dropping privileges. Its actual suite runs are recorded
  in `framework-guardrails/evidence/mutation-2026-10-21/readback.md`. It remains
  installed and byte-identical. This diagnosis's attempts were refused by sudo
  before that open, so they are not additional token reads.

Reading `/usr/local/bin/julia-control-run` source, metadata tests of the
credential path, mentions in documentation, and rejected sudo commands are not
counted as actual reads. No assertion about otherwise unlogged service starts
or readers is made. The service-account bootstrap and op child's use of the
inherited value are distinct from rereading the protected token file.

`item23-session-index.json` indexes 27 retained tool calls mentioning the token
path, including 8 with a textual direct sudo-cat pattern. It stores timestamp,
call ID, source line and command hash rather than command bodies or token data.
These are **mentions**, including source creation and evidence reads, not an
execution count. The documented actual-reader statements above come from the
retained run readbacks, not from treating those pattern matches as execution.
This is not an exhaustive host audit: no auditd record or host-wide sudo journal
was available. No token-read fix or permission change was attempted.
