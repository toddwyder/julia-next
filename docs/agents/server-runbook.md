# Julia server runbook

Linear holds cards and requirements. GitHub holds code, pull requests, and CI. Mastra Factory is retired; do not use it as a server route.

## Authority

Todd's latest card decision controls server changes. Ask Todd only for an indispensable account action, spending beyond the card cap, or a household product decision.

Do not restore `julia-agent`, the old learning helper, the retired build service, the former root control deployment, or the old machine kept at tag `old-machine-final`. Do not repeat the completed one-time vault bootstrap.

## Agent commands

Run commands that need Julia credentials through this wrapper from the repository root:

```sh
node scripts/julia-agents.mjs -- <command> [args...]
```

The wrapper reads `/home/ubuntu/.config/julia-agents/service-account-token`, clears inherited 1Password authentication overrides, and invokes `op run --env-file=scripts/julia-agents.env`. Never print credentials, OAuth links or codes, pairing material, or raw credential-bearing subprocess output.

## The dashboard service

The dashboard runs here as `julia-dashboard.service` from `/home/ubuntu/julia-dashboard`, a
worktree of `main` and never the operator checkout. Its settings are in `/etc/julia-dashboard.env`
(`root:root` 0600, no secret), its state that must outlive a checkout reset is in
`/var/lib/julia-dashboard`, and two timers keep it current (update every 5 minutes) and watch it
(health every minute).

```sh
systemctl status julia-dashboard
systemctl restart julia-dashboard
journalctl -u julia-dashboard -n 100 --no-pager
sudo node dashboard/scripts/install-service.mjs --host 100.119.112.9
```

Install from the checkout the units should copy from. The installer refuses to run off this server
or from the operator checkout or a lane worktree, and running it twice is safe. When the watchdog
gives up three probes in a row it tells Todd through JUL-276 rather than creating a service issue.
Read `dashboard/docs/service.md` for the unit list, the run-file format, and what each log line
means.

## GitHub boundaries

Use ordinary signed-in GitHub access for authorized cards. Keep authentication material inside its trusted process. Evidence and notes belong on the card branch and pull request.
