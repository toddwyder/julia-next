# Server cleanup readback

Checked at 2026-10-24T00:43Z through `ssh ovh`.

```text
checkouts:
/home/ubuntu/julia-jul-253
/home/ubuntu/julia-machine-main

retired_paths:
absent /home/ubuntu/julia-next
absent /var/lib/julia-build
absent /usr/local/bin/julia-control-run
absent /usr/local/sbin/julia-control-deploy-and-restart
absent /etc/sudoers.d/90-julia-agent
absent /etc/sudoers.d/90-julia-control-delivery
absent /etc/julia-control/op-service-account-token

retired_units:
(no julia-build.service or julia-build-sign-in.service unit file)

orphan_pids:
absent 94175
absent 95047

notifier_config:
root /home/ubuntu/julia-machine-main
issue JUL-251
```

The `julia-codex` tmux pane reports `/home/ubuntu/julia-machine-main` as its current directory. The active card checkout is a standalone fresh clone at commit `61293bb0e7f18b5b10acebd8b8efbf90d15b8570`.
