# Factory exceptions list and installation

## Exceptions list

Every place we use our own piece instead of Factory's, Mastra's or GitHub's (ADR 0009). Only
Todd adds or removes an entry. Anything custom that is not listed here is not approved.

| # | Exception | Gap it fills | Remove when |
|---|---|---|---|
| 1 | WorkOS cookie identity fix in `@mastra/auth-workos` 1.6.5 | Default platform sign-in rejects our self-hosted address; the WorkOS cookie path drops the organization ([#25252](https://github.com/mastra-ai/mastra/issues/25252)) | #25252 ships in a Mastra release |

Approved by ADR 0009 but not built yet: the check that rejects unapproved custom machinery, and
the weekly cost summary (Monday note). Each gets its row when it is built.

## Installation

Approved exception #1 restores the pinned `@mastra/auth-workos` 1.6.5 cookie
identity fix described in [mastra-ai/mastra#25252](https://github.com/mastra-ai/mastra/issues/25252).
It is the only installed Mastra package code change. See
`docs/agents/factory-platform-auth-change-log.md` for the complete change list.

Run installation as the dedicated Factory service user:

```sh
bash /path/to/julia-next/ops/factory/install.sh /var/lib/julia-factory/app
```

This uses the existing lockfile; it does not upgrade dependencies. The WorkOS
patch checks version and original SHA-256 and rejects unexpected files. It applies
before build and checks the copied deployment dependency afterward. Repeat
application is safe. Restart the service only after checks succeed.

The installer runs `workos-cookie-identity.check.mjs` against both package copies.
Its fixture checks one membership, an explicit organization choice, and no
membership without using a real account.

Remove the exception when #25252 ships in a Mastra release. Review that release,
remove this patch and installer hook, then reinstall and build from the lockfile.

Personal and factory-wide observer/reflector settings select `deepseek/deepseek-flash`
(2026-09-28), with `DEFAULT_OM_MODEL_ID` set to the same model in the environment. Mastra
observability (traces and metrics, DuckDB) is on; see the change log.
The organization has a normal OpenAI Codex OAuth connection and a direct
DeepSeek API-key connection. There is no model package patch.

The dedicated `julia-factory` account also needed a Git commit identity. GitHub's
API confirmed this installation's bot identity; its normal Git configuration is:

```sh
git config --global user.name 'julia-factory-todd-wyder[bot]'
git config --global user.email '334524704+julia-factory-todd-wyder[bot]@users.noreply.github.com'
```

Run these only as the dedicated service account. They persist for fresh
sandboxes and do not authorize publishing. Removal is `git config --global
--unset user.name` and the corresponding `user.email` command for that account.

Factory **0.17.2** scans both `.claude/skills` and `.agents/skills` as local
sources. The earlier package patch selecting one root was removed so WorkOS is
the only Mastra code exception. Skill-loading repair is separate work.

The Factory app's `postinstall` script is
`python3 /var/lib/julia-factory/patches/apply-install-patches.py .`; this keeps a
plain `npm ci` from silently losing the exception. Copy this directory to that
protected deployment path before installing. The wrapper remains the complete
install/build/check procedure.

The installer runs only the approved WorkOS package fix and its regression,
followed by the scaffold's normal check and build. Factory uses its installed
boards and normal model and GitHub connections.
