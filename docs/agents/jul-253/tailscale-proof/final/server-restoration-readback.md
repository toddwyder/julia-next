# Server restoration readback

Checked through `ssh ovh` after the JUL-255 run stopped.

```text
card checkout:
/home/ubuntu/julia-jul-253
ab6e94a0464888118796083f9ec1302b65626e53
clean build/jul-253

main checkout:
/home/ubuntu/julia-machine-main
fa95a1a41be69202dcc75b9cf1f753557ecb7a91
clean main

retired paths:
absent /home/ubuntu/julia-next
absent /var/lib/julia-build
absent /usr/local/bin/julia-control-run
absent /usr/local/sbin/julia-control-deploy-and-restart
absent /etc/sudoers.d/90-julia-agent
absent /etc/sudoers.d/90-julia-control-delivery
absent /etc/julia-control/op-service-account-token

retired units:
no julia-build.service or julia-build-sign-in.service unit file

proof units:
jul253-final-control-20261024.service inactive
jul253-final-runner-20261024.service inactive

main units:
julia-machine-control.service active
julia-machine-runner.service active

Tailscale Serve:
https 443 -> http://127.0.0.1:43126

maintenance notification:
root /home/ubuntu/julia-machine-main
issue JUL-251
```

The proof did not recreate any retired path or unit. The normal route, services, maintenance checkout, and notifier configuration match the pre-proof state.
