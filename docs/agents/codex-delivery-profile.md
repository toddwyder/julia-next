# Server Codex delivery profile

This profile records the server Codex delivery setup Todd approved on 2026-10-20.
It changes no model, credential or spend limit. Codex startup update checks are
disabled; this setup configures no automatic update job.

## Default permissions

Merge this into `/home/ubuntu/.codex/config.toml`. Keep root keys before tables
and preserve unrelated UI, project-trust and connector settings. Remove older
`sandbox_mode` / `sandbox_workspace_write` settings because they take precedence
and would bypass the named profile. No CLI flags or shell alias are needed for
normal starts.

```toml
# Julia delivery defaults, approved by Todd 2026-10-20.
default_permissions = "julia-delivery"
approval_policy = "on-request"
check_for_update_on_startup = false

[permissions.julia-delivery]
description = "Julia server delivery: workspace writes, control root and outbound network"
extends = ":workspace"

[permissions.julia-delivery.workspace_roots]
"/opt/julia-control" = true

[permissions.julia-delivery.network]
enabled = true
```

The built-in `:workspace` parent supplies the workspace-write sandbox, including
protected Git and agent directories. The additional root allows unprivileged
deployment under `/opt/julia-control`; outbound command network access is on.
`on-request` retains human approval for escalation not allowed by a rule.
Commands that already fit within the sandbox do not necessarily prompt.

## Deployment and privileged activation

Copy only the exact reviewed candidate's required files into
`/opt/julia-control/reviewer` as `ubuntu`, using the approved delivery plan and
preserving installed dependencies unless that plan changes them. Make the
installed tree writable for delivery without changing its contents:

```sh
sudo chown -R ubuntu:julia-control /opt/julia-control/reviewer
sudo find /opt/julia-control/reviewer -type d -exec chmod g+s '{}' +
```

The service runs as `julia-control`. New deployed files must remain readable
by that user. The setgid directories preserve its group on newly created files.
No credentials, service unit, root-owned secret launcher or state database change
in this setup. Application code is never executed as root by the activation helper.

Install this exact script at
`/usr/local/sbin/julia-control-deploy-and-restart`, owned `root:root`, mode `0755`.
Its parent `/usr/local/sbin` must also be root-owned and not writable by delivery
users. Run `sh -n` before installing; install with `sudo install -o root -g root
-m 0755 SCRIPT /usr/local/sbin/julia-control-deploy-and-restart`.

```sh
#!/bin/sh
# Activate files deployed without root into /opt/julia-control/reviewer.
set -eu
if [ "$#" -ne 0 ]; then
    echo 'julia-control-deploy-and-restart: no arguments accepted' >&2
    exit 64
fi
if [ "$(/usr/bin/id -u)" -ne 0 ]; then
    echo 'julia-control-deploy-and-restart: root required; use sudo -n' >&2
    exit 77
fi
cd /
/usr/bin/logger -t julia-control-delivery -- 'restart requested: julia-control.service'
if /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/systemctl restart julia-control.service &&
   /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/systemctl is-active --quiet julia-control.service; then
    /usr/bin/logger -t julia-control-delivery -- 'restart succeeded: julia-control.service'
    echo 'julia-control.service restarted and active'
else
    /usr/bin/logger -t julia-control-delivery -- 'restart failed: julia-control.service; inspect journalctl -u julia-control.service'
    echo 'julia-control.service restart failed' >&2
    exit 1
fi
```

Install this exact sudoers fragment at `/etc/sudoers.d/90-julia-control-delivery`,
owned `root:root`, mode `0440`, using `visudo -cf FRAGMENT` first and `visudo -c`
after installation:

```sudoers
# Fixed Julia activation only. Empty quotes mean no command arguments.
ubuntu ALL=(root) NOPASSWD: NOSETENV: /usr/local/sbin/julia-control-deploy-and-restart ""
```

The empty argument string in sudoers means **no arguments**, rather than arbitrary
arguments. The script independently rejects every supplied argument before taking
any action. All executable paths and the unit name are fixed, the working
directory is `/`, and systemctl receives a clean environment. No caller-selected
unit, executable, source path or shell fragment reaches root execution.

After deploying files, activate them with:

```sh
sudo -n /usr/local/sbin/julia-control-deploy-and-restart
systemctl status julia-control.service
```

The helper records requested/succeeded/failed restart events under journal tag
`julia-control-delivery`, returns nonzero on failure, and checks systemd's active
state. Active state is not HTTP readiness; check the configured control page
afterward. It does not automatically roll back a failed application deployment.

## Execution rules

Save the following as
`/home/ubuntu/julia-next/.codex/rules/repository.rules` (the pre-existing project
policy extended for delivery). Link `/home/ubuntu/.codex/rules/repository.rules`
to that absolute path so normal starts in other directories load the same rules.
`~/.codex/rules/default.rules` contains only a comment pointing to the shared
policy; stale one-off approvals were removed. Keep other rule files free of broad
privileged allows. A normal start must not override this profile or ignore rules.

```python
# Codex CLI 0.163.0; project-local policy requested by Todd, 2026-10-20.
# Source: rust-v0.163.0/codex-rs/execpolicy/README.md and official Rules page.
# Unmatched commands retain on-request approval; no blanket executable allows.
prefix_rule(
    pattern = ["git", ["status", "diff", "log", "fetch", "add", "commit"]],
    decision = "allow",
    match = ["git status", "git diff HEAD", "git log -1", "git fetch origin", "git add AGENTS.md", "git commit -m docs"],
    not_match = ["git push", "git reset", "git clean"],
)
prefix_rule(
    pattern = ["gh", "pr", ["create", "view", "checks", "merge"]],
    decision = "allow",
    match = ["gh pr create", "gh pr view 304", "gh pr checks 304", "gh pr merge 304 --merge"],
    not_match = ["gh pr comment 304", "gh api", "gh auth refresh"],
)
# Ordinary delivery pushes approved by Todd, 2026-10-20.
prefix_rule(pattern = ["git", "push"], decision = "allow")
prefix_rule(pattern = ["git", ["switch", "checkout", "branch", "pull", "rev-parse", "show", "ls-remote", "merge-base"]], decision = "allow")
prefix_rule(pattern = ["gh", "pr", ["list", "diff"]], decision = "allow")
prefix_rule(pattern = ["gh", "run", ["list", "view", "watch"]], decision = "allow")
prefix_rule(pattern = ["gh", "auth", "status"], decision = "allow")
# The root-owned helper validates its argument count before any service action.
prefix_rule(pattern = ["sudo", "-n", "/usr/local/sbin/julia-control-deploy-and-restart"], decision = "allow")
prefix_rule(pattern = ["sudo", "/usr/local/sbin/julia-control-deploy-and-restart"], decision = "allow")
# Direct service mutations and common root-shell escapes are never delivery commands.
prefix_rule(pattern = ["sudo", ["systemctl", "/usr/bin/systemctl", "/bin/systemctl", "service", "bash", "sh", "/bin/bash", "/bin/sh", "env", "/usr/bin/env", "su", "-i", "-s", "-E"]], decision = "forbidden", justification = "Use sudo -n /usr/local/sbin/julia-control-deploy-and-restart with no arguments.")
prefix_rule(pattern = ["sudo", "-n", ["systemctl", "/usr/bin/systemctl", "/bin/systemctl", "service", "bash", "sh", "/bin/bash", "/bin/sh", "env", "/usr/bin/env", "su", "-i", "-s", "-E"]], decision = "forbidden", justification = "Use the fixed no-argument Julia helper.")
prefix_rule(pattern = ["systemctl", ["restart", "start", "stop", "reload", "try-restart", "reload-or-restart", "enable", "disable", "mask", "unmask", "edit", "daemon-reload", "reboot", "poweroff"]], decision = "forbidden", justification = "Use the fixed no-argument Julia helper.")
# Read-only server diagnostics.
prefix_rule(pattern = ["systemctl", ["status", "show", "is-active", "is-enabled"]], decision = "allow")
prefix_rule(pattern = ["journalctl", "-u", "julia-control.service"], decision = "allow")
prefix_rule(pattern = ["getent", ["hosts", "ahosts"]], decision = "allow")
prefix_rule(pattern = ["uname"], decision = "allow")
prefix_rule(pattern = ["df"], decision = "allow")
prefix_rule(pattern = ["free"], decision = "allow")
prefix_rule(pattern = ["ss", ["-lnt", "-lntp", "-tulpn"]], decision = "allow")
# Block common force spellings where prefix rules can express them.
# Arbitrary-position flags, equals forms and +refspecs are not fully covered;
# prefix rules cannot match substrings or arbitrary argument positions.
prefix_rule(
    pattern = ["git", "push", ["--force", "-f", "--force-with-lease", "--force-if-includes", "-uf", "-fu"]],
    decision = "forbidden",
    justification = "Force-push is forbidden. Use an ordinary push after review.",
    match = ["git push --force", "git push -f origin topic", "git push --force-with-lease", "git push -uf origin topic"],
    not_match = ["git push -u origin topic"],
)
prefix_rule(
    pattern = ["git", "push", "origin", ["--force", "-f", "--force-with-lease", "--force-if-includes", "-uf", "-fu"]],
    decision = "forbidden",
    justification = "Force-push is forbidden. Use an ordinary push after review.",
    match = ["git push origin --force", "git push origin -f topic", "git push origin --force-with-lease"],
    not_match = ["git push origin topic"],
)
prefix_rule(
    pattern = ["git", "push", ["-u", "--set-upstream"], ["--force", "-f", "--force-with-lease", "--force-if-includes"]],
    decision = "forbidden",
    justification = "Force-push is forbidden. Use an ordinary push after review.",
    match = ["git push -u --force origin topic", "git push --set-upstream -f origin topic"],
)
prefix_rule(
    pattern = ["git", "push", ["-u", "--set-upstream"], "origin", ["--force", "-f", "--force-with-lease", "--force-if-includes"]],
    decision = "forbidden",
    justification = "Force-push is forbidden. Use an ordinary push after review.",
    match = ["git push -u origin --force topic", "git push --set-upstream origin -f topic"],
)

# Additional common force positions and mirror pushes.
prefix_rule(pattern = ["git", "push", ["--mirror", "--force=true", "--force-with-lease=main", "+HEAD:main", "+HEAD:refs/heads/main"]], decision = "forbidden", justification = "Use an ordinary push after review.")
prefix_rule(pattern = ["git", "push", "origin", ["HEAD", "main"], ["--force", "-f", "--force-with-lease", "--force-if-includes"]], decision = "forbidden", justification = "Use an ordinary push after review.")
prefix_rule(pattern = ["git", "push", "origin", ["--mirror", "+HEAD:main", "+HEAD:refs/heads/main"]], decision = "forbidden", justification = "Use an ordinary push after review.")
```

## Enforcement limits

- The `ubuntu` account keeps its pre-existing administrator privileges. This
  profile does not revoke them. The new sudoers entry grants only the no-argument
  helper, so the helper is the only privileged command explicitly **allowed by
  this delivery policy**; this is not an OS-enforced confinement of `ubuntu`.
  Approved escalation, alternate sudo syntax, other tools, or configuration
  overrides can still reach host privileges. No claim is made that every possible
  way of restarting another service is technically prevented.
- Codex 0.163.0 rules match prefixes, not arbitrary argument positions or
  substrings. Listed direct service mutations/root-shell forms and common force
  pushes are forbidden. Other force spellings, equals forms, flags after an
  arbitrary refspec, `+refspecs`, alternate executable paths and Git aliases are
  not comprehensively covered. Force-push remains prohibited delivery behavior;
  the policy enforces the common forms it can express without blocking ordinary
  pushes. It is not a complete Git security boundary.
- Unmatched out-of-sandbox operations retain `on-request`; sandbox-contained
  operations can run without prompting. Files writable by `ubuntu`, including
  the user configuration and project rules, are not immutable against a human
  administrator. New sessions are required after configuration edits.

This setup documents the remaining enforcement gaps rather than blocking
completion. Removing the host's administrative access or introducing a separate
delivery account is outside this setup.

## Documentation map

| Need | Feature | Exact version-matched source read |
| --- | --- | --- |
| Default sandbox, added root, network | Named permission profile extending `:workspace` | [Official permissions](https://learn.chatgpt.com/docs/permissions), [0.163.0 config schema](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/config.schema.json), installed `codex --help` / `codex sandbox --help` |
| Persistent command approvals and bans | Prefix rules and decision precedence | [0.163.0 execpolicy README](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/execpolicy/README.md), [official rules](https://learn.chatgpt.com/docs/agent-configuration/rules), installed `codex execpolicy check --help` |
| No-argument root grant | Sudoers command argument matching, NOPASSWD, NOSETENV | Installed sudo 1.9.15p5 `/usr/share/man/man5/sudoers.5.gz`, command-matching and command-tag sections; `sudo -V`, `visudo -h` |
| Fixed restart and active-state check | systemctl restart / is-active | Installed systemd 255 `/usr/share/man/man1/systemctl.1.gz`, restart and is-active entries |
| Root script, fixed environment, journal events | POSIX shell, env, logger | Installed `/usr/share/man/man1/dash.1.gz`, `/usr/share/man/man1/env.1.gz`, `/usr/share/man/man1/logger.1.gz` |
| Ownership, inheritance and file installation | chown, chmod setgid, install | Installed `/usr/share/man/man1/chown.1.gz`, `/usr/share/man/man1/chmod.1.gz`, `/usr/share/man/man1/install.1.gz` |
| Scratch push and PR delivery | Ordinary Git push and checked-head PR merge | Installed Git 2.43.0 `git help push`; GitHub CLI 2.45.0 `gh pr create --help`, `gh pr checks --help`, `gh pr merge --help` |
