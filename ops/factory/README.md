# Factory exceptions list and installation

## Exceptions list

Every place we use our own piece instead of Factory's, Mastra's or GitHub's (ADR 0009). Only
Todd adds or removes an entry. Anything custom that is not listed here is not approved.

| # | Exception | Gap it fills | Remove when |
|---|---|---|---|
| 1 | WorkOS cookie identity fix in `@mastra/auth-workos` 1.6.5 | Default platform sign-in rejects our self-hosted address; the WorkOS cookie path drops the organization ([#25252](https://github.com/mastra-ai/mastra/issues/25252)) | #25252 ships in a Mastra release |
| 2 | Factory wait watcher | Stock Factory 0.17.2 shows waits in the web app but does not send phone and Windows alerts when Todd is away ([Mastra request #25378](https://github.com/mastra-ai/mastra/issues/25378)) | Remove when Mastra adds its own alerts |

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

The installer copies `ops/factory/app/{package.json,package-lock.json,tsconfig.json}`,
`ops/factory/app/src/mastra/{index,local-sandbox}.ts`, and the two project overrides in
`ops/factory/app/src/mastra/public/factory-skills/{factory-plan,factory-review}/SKILL.md`
into the service directory before `npm ci`; it never copies `.env`, databases or
runtime workspaces. The versioned lockfile pins the deployed dependencies; it does
not upgrade them. Factory 0.17.2 loads project-local `factory-skills` before its
bundled skills; Mastra's build places the overrides under `.mastra/output/factory-skills`.
After installing and restarting, verify precedence in Factory's Settings › Skills
or a fresh bound session; a staged build alone proves packaging, not live activation.
The Factory UI is supplied by Mastra's build, not committed as generated assets. The WorkOS
patch checks version and original SHA-256 and rejects unexpected files. It applies
before build and checks the copied deployment dependency afterward. Repeat
application is safe. Back up the service directory before a live install and
restart the service only after checks succeed.

**Issue #146 deployment gate:** The local-provider configuration requires native
`bubblewrap` with `nativeSandbox.allowNetwork: true`. Todd approved general internet
access on 2026-09-28; the earlier Git-only egress restriction was withdrawn.
Before merging, check `bwrap` as the service user, back up the service install, use
the installer above, restart the service, and prove the installed Factory session
runs isolated commands. Independently verify harmless canaries exist at protected
file/key/database/secret locations outside the sandbox, then prove each is denied
inside. Prove a disposable Git fetch/commit/push using Factory's intended short-lived
Git credentials, and record commands/results and accepted network scope in the
change log and PR. Roll back if the service fails to start or isolation is bypassed;
never print key or database contents. #144 owns the retired Orca reachability check
and does not block #146.

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

The server's previous `postinstall` pointed at a machine-specific patch copy.
The repository manifest removes that hook; **always use this installer**, never
run `npm ci` alone on the service directory: the installer applies the approved
patch after install and again to Mastra's built output and runs both regressions.
No additional Mastra package code is changed. Factory uses its installed boards
and normal model and GitHub connections.

## Wait-alert watcher

The normal installer copies `wait-alerts.py` and `wait-alerts.sql` into the app.
Run the one-time root setup after the normal install:

```sh
sudo bash /var/lib/julia-factory/patches/install-wait-alerts.sh \
  /var/lib/julia-factory/app \
  49b0ea94-d24b-43d7-8ce1-618cb61c5188 \
  user_01M3HB0CKYTK5V2DXGTZ4PA3B8 \
  https://julia-factory.tail91f394.ts.net
```

The setup creates a PostgreSQL peer role with SELECT only on the tables the
watcher needs. Its query runs in a read-only transaction. The watcher writes
only its own SQLite delivery ledger in `/var/lib/julia-factory-wait-alerts`;
it never changes Factory records, answers questions, or moves cards. A
wait means a session question, a plan waiting for review, an unresolved
supervisor finding, or a Triage card labeled `status: needs approval`.
Automation run suggestions, other decisions, and mentions are excluded.
The watcher records each wait's stable key before publishing, so an uncertain
network result cannot resend it. A definite ntfy HTTP 429 rejection is safe to
retry: numeric code 42901 (request bucket) is retried at most once per minute
while another attempt fits inside the first five minutes; code 42908 (daily
quota), an unknown subtype, or a burst limit that lasts past the deadline is
recorded as `deadline_unmet`, not called a successful delivery. The five-minute
window starts at the wait's `occurred_at`, including timer discovery delay;
a wait first seen after that deadline is recorded without publishing. An HTTP
publish accepted after the deadline is recorded as `sent_late` (or
`sent_late_fallback`), not a timely success. A rejected publish does not prevent
other new waits from being attempted. An optional,
independently hosted ntfy origin can be used immediately after a definite
primary 429 (even when its subtype is unknown); it uses the same wait identity
and Click link. A fallback 429 follows the same bounded primary retry policy;
an uncertain result on either origin is never sent again. Timeouts, interrupted
sends, other HTTP failures, and old `attempted` rows need operator inspection;
they are not automatically resent. Existing due rows lacking a recorded
five-minute deadline are marked `deadline_unmet` rather than replayed. The
one-minute systemd timer checks when a retry is due and stays enabled across
Factory restarts and server reboots. Its journal records only wait kind,
outcome (`sent`, `sent_fallback`, `sent_late`, `sent_late_fallback`,
`rate_limited`, `deadline_unmet`, or `uncertain_failure`), allowlisted numeric
subtype (or `unknown`), rejection count, and UTC due time; the private SQLite
ledger retains successful publish origin and whether acceptance was late,
alongside the deadline. An accepted publish does not prove device receipt. Never
publish the ledger's keys or links, ntfy topics, host credentials, or raw error
responses in an issue or log.

**Fallback rollout is not approved by configuring a URL alone.** Leave
`fallback_url` and `fallback_topic` absent until Todd approves the additional
service/subscriptions on issue #156 and the authorized operator confirms a free,
independent HTTPS ntfy origin can deliver promptly to *both* devices. Once
approved, add both fields to the existing root-owned `config.json`:
`fallback_url` is the HTTPS origin (no path, query, fragment, or user info), and
`fallback_topic` is a separate private topic subscribed on both devices.
Do not create another topic on ntfy.sh as a fallback: rate limits apply to the
publisher's visitor. Self-hosted PWA delivery needs Web Push configured
([ntfy configuration](https://docs.ntfy.sh/config/#web-push)); iOS app instant
push for self-hosted servers may require forwarding poll requests to ntfy.sh
([iOS instant notifications](https://docs.ntfy.sh/config/#ios-instant-notifications)).
A self-hosted server accepted a publish is not proof of phone delivery. If
neither approved route can meet the deadline, report the blocker on #156
instead of weakening the two-device/five-minute requirement. Keep #148 open
until Todd confirms the next naturally occurring question/plan reaches phone
and Windows once with the correct link; do not manufacture a question or
send a test notification to prove it.

The setup generates a random topic in
`/etc/julia-factory-wait-alerts/config.json` (root-owned, group
`julia-factory`, mode `0640`). Keep that topic out of public issues and logs:
anyone who knows a public ntfy topic can read or post to it. Todd installs the
[ntfy phone app](https://docs.ntfy.sh/subscribe/phone/) and the
[Windows PWA](https://docs.ntfy.sh/subscribe/pwa/), subscribes to the same
topic in both, and enables notifications. The Windows browser must be running
for background notifications. Delivery remains gated until the operator
creates `/etc/julia-factory-wait-alerts/subscribed` after Todd confirms both
subscriptions.

Inspect current waits without publishing:

```sh
sudo -u julia-factory python3 /var/lib/julia-factory/app/ops/factory/wait-alerts.py --dry-run
```
