# Todd decision, 21 October 2026 16:30

Maker self-check. No independent review, paid calls, Triage, or cards.

Applied to `/home/ubuntu/.codex/config.toml`: `approval_policy = "on-request"` → `approval_policy = "never"`. The `default_permissions = "julia-delivery"` workspace profile, `/opt/julia-control` workspace root, network setting, and disabled startup updates are unchanged. Full actual before/after readbacks accompany this record. Existing sessions retain their launch settings; this file change does not claim to rewrite an active turn.

Removed all three `decision = "prompt"` rules from `/home/ubuntu/julia-next/.codex/rules/repository.rules`. Compared every forbidden rule before/after: identical. Actual Codex 0.163.0 engine output is in `policy-checks.json`. Former prompt cases now have no matched decision; configured approval policy is never. Force-push, service-control and sudo cases remain forbidden.

**Outstanding:** deploy-helper check is forbidden, because the pre-existing sudo catch-all overrides its allow. The 16:10 task explicitly requires removing this catch-all after the OS restriction is installed. No claim of a permitted deploy helper is made. The sudoers candidate passed `/usr/sbin/visudo -c -f docs/agents/ovh-20261021/99-zz-julia-ubuntu`; installation approval was requested once and is pending. An attempted `sudo -n -l` was rejected by the loaded Codex forbidden rule before sudo ran; it is not evidence of an OS denial.

Commands actually run: Python read/transform/write of the two authorized settings files (exit 0, escalated filesystem access because `.codex` is protected); Python exact forbidden-rule comparison and eight `codex execpolicy check` subprocesses (exit 0). No credential value was accessed. Config readback confirmed the written bytes.

Framework map: installed `codex execpolicy check --help` (0.163.0); installed sudo 1.9.15p5 `sudoers(5)` empty-string arguments and last-match sections; [official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). The official reference confirms approval policy controls execution approval; it does not establish what an already-running session has loaded.
