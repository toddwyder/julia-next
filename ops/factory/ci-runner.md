# Trial CI runner

PR #130's GitHub-hosted jobs never started. GitHub's check annotation reported
failed account payments or a spending limit. Vercel still deployed successfully.
For JUL-183, GitHub's supported self-hosted runner now executes checks on OVH.
Runner registration required no billing change or additional App permission.
Publishing the workflow repair subsequently required adding only **Workflows
read/write** to the existing Factory App installation, still selecting only
`julia-next`. The native permission-review page confirmed that exact delta.

GitHub's repository Settings > Actions > Runners page supplied the Linux x64
runner **2.337.0** and SHA-256
`70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613`.
The archive hash was verified before extraction. Registration used the page's
time-limited token; no token belongs in the repository.

- Account: `julia-trial-ci`, system account with no login shell or sudo access.
- Directory: `/var/lib/julia-trial-ci/runner`, owned by that account, mode 700.
- Repository: only `toddwyder/julia-next`.
- Runner name: `ovh-julia-factory-trial`; custom label: `julia-factory-trial`.
- Service: `actions.runner.toddwyder-julia-next.ovh-julia-factory-trial.service`.

The documented `config.sh --unattended` registration and `svc.sh install
julia-trial-ci` / `svc.sh start` procedure was used. A service drop-in adds:

```ini
[Service]
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/julia-trial-ci
UMask=0077
```

The account cannot read Factory's protected credentials or evidence directory.
CI accepts same-repository PRs from the two approved publisher Apps, or pushes
to main. The publisher check still rejects personal PR authors and checks out
no branch code. CI uses the builder's verified Node 22.23.2 runtime. Normal
application CI now also runs Chromium, framework lint
and the production build.

The unchanged frozen graph had a missing Python dependency and a broken Linear
test fixture at the trial baseline. Application-only changes run every other
script test. Changes to `graph/pydantic` or its execution wrapper still require
the graph execution suite; its failures are not presented as passing evidence.

Removal: restore the workflow runner labels after hosted jobs work; stop and
uninstall this service with `svc.sh`, remove this runner in GitHub Settings,
then remove its dedicated directory/account. Keep the Factory publisher
allowlist while that App is the authorized publisher.

Sources: [adding runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners),
[service setup](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application).
