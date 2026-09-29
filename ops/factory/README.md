# Factory exceptions list and installation

## Exceptions list

Every place we use our own piece instead of Factory's, Mastra's or GitHub's (ADR 0009). Only
Todd adds or removes an entry. Anything custom that is not listed here is not approved.

| # | Exception | Gap it fills | Remove when |
|---|---|---|---|
| 1 | WorkOS cookie identity fix in `@mastra/auth-workos` 1.6.5 | Default platform sign-in rejects our self-hosted address; the WorkOS cookie path drops the organization ([#25252](https://github.com/mastra-ai/mastra/issues/25252)) | #25252 ships in a Mastra release |
| 2 | Factory wait watcher and Discord webhook | Stock Factory 0.17.2 shows waits in the web app but does not send phone and Windows alerts when Todd is away ([Mastra request #25378](https://github.com/mastra-ai/mastra/issues/25378)); public ntfy.sh exhausted its daily quota (42908), and the private ntfy PWA did not register desktop Web Push | Remove when Mastra adds its own alerts |

Approved by ADR 0009 but not built yet: the check that rejects unapproved custom machinery, and
the weekly cost summary (Monday note). Each gets its row when it is built.

## Installation

Approved exception #1 restores the pinned `@mastra/auth-workos` 1.6.5 cookie
identity fix described in [mastra-ai/mastra#25252](https://github.com/mastra-ai/mastra/issues/25252).
It is the only installed Mastra package code change. See
`docs/agents/factory-platform-auth-change-log.md` for the complete change list.

When replacing the ntfy watcher, stop its timer before copying the new watcher:
`sudo systemctl stop julia-factory-wait-alerts.timer`. The new service uses a
separate `discord-ready` gate; old ntfy subscription markers cannot enable it.
After the normal `install.sh` below, re-run `install-wait-alerts.sh` to install
the new unit and restart the timer. It preserves the existing config and
delivery ledger. Remove the old `subscribed` and `subscribed-self-hosted`
markers, add the Discord webhook URL to the config, then create `discord-ready`.
Check `systemctl status julia-factory-wait-alerts.timer` afterward.

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

The supported GitHub event-rule overrides in `app/src/mastra/index.ts` keep
machine issues and publisher App PRs off Factory's Work and Review boards.
Known machine source numbers are explicitly excluded; new machine issues use
the `factory:machine` GitHub label when created. If an existing issue gets the
label later, remove its existing Factory card through the Work card delete
action. Factory-authored Julia PRs enter Reviewing
directly so Review auto-start can run. Remove these rules when stock Factory
supports source filters and automatic Review entry for trusted authoring PRs.

The server's previous `postinstall` pointed at a machine-specific patch copy.
The repository manifest removes that hook; **always use this installer**, never
run `npm ci` alone on the service directory: the installer applies the approved
patch after install and again to Mastra's built output and runs both regressions.
No additional Mastra package code is changed. Factory uses its installed boards
and normal model and GitHub connections.

## Wait-alert watcher

The normal installer copies `wait-alerts.py` and `wait-alerts.sql` into the app.
Run the one-time root setup after the normal install:

From the root of a reviewed checkout owned by the operator, run:

```sh
sudo bash "$(pwd -P)/ops/factory/install-wait-alerts.sh" \
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
The watcher claims each wait's stable key before posting to a dedicated Discord
channel webhook. It uses Discord's `wait=true` response to record the confirmed
message ID. A timeout, HTTP 5xx, or interrupted send has an uncertain outcome
and is never replayed. A non-rate-limit HTTP 4xx rejection records only the
numeric status in the private ledger and journal and makes the systemd run fail
visibly. Historical attempted and rate-limited ntfy rows are never replayed.
A Discord HTTP 429 means no message was posted; the watcher keeps that wait
pending and uses Discord's `Retry-After` time before another attempt. The
one-minute timer remains enabled across Factory restarts and reboots. Never
publish the ledger's
keys or links, or the webhook URL, in an issue or log.

### Discord delivery

Discord's [incoming webhooks](https://docs.discord.com/developers/resources/webhook#execute-webhook)
post to one channel without a bot or paid service. Create a webhook for a
private text channel Todd can access on Windows and Android. Set that channel's
[notification override](https://support.discord.com/hc/en-us/articles/215253258-Notifications-Settings-101)
to **All messages** on both devices, enable mobile push, and leave the server
unmuted. Keep the Discord desktop app running for Windows alerts. Discord may
delay mobile push while the desktop is active; its **Push Notification Inactive
Timeout** controls that behavior. The watcher includes the Factory link in the
message and disables mentions from untrusted card titles. Discord returns one
message for each new wait; the watcher does not post a staged Factory question
to test delivery.

The webhook URL belongs in `/etc/julia-factory-wait-alerts/config.json`
(root-owned, group `julia-factory`, mode `0640`) under `discord_webhook_url`.
Use the URL Discord provides, beginning with `https://discord.com/api/webhooks/`.
The watcher accepts only that host and endpoint shape. After confirming the
channel's notification settings and a successful webhook metadata lookup,
create `/etc/julia-factory-wait-alerts/discord-ready` as root, then start
`julia-factory-wait-alerts.service`. Keep the old ntfy markers absent; they do
not enable Discord delivery. Once a real wait reaches both devices, disable
the retired ntfy service and remove its port 8443 Funnel route.

Inspect current waits without publishing:

```sh
sudo -u julia-factory python3 /var/lib/julia-factory/app/ops/factory/wait-alerts.py --dry-run
```
