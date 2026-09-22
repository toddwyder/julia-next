# Firewall

One persistent rule so far, added by hand from a laptop session (see
`docs/agents/jul43-coordinator-runbook.md`). Not installed by any sudo rule or
graph action — a firewall change is always a laptop-session edit, never
something the controller or a worker does.

## `jul99-runner-v4-only` — `runner` skips IPv6 for its own internet egress

**Why:** Google Antigravity (`agy`, used for the Gemini builder trial on
JUL-99) refuses every call made from this server over IPv6 — `FAILED_PRECONDITION
(code 400): User location is not supported for the API use` — while the same
account and CLI build work over IPv4, both on this server and from an
unrelated network. Proven 2026-09-22: 5/5 runs failed over IPv6 on the server,
5/5 succeeded over IPv4 on the server, 5/5 succeeded from a different network.

**What it does:** forces the `runner` account's traffic out the server's
normal internet interface (`ens3`) onto IPv4 only. Scoped two ways, so it
touches nothing else:
- `--uid-owner runner` — only processes running as `runner`. `ubuntu`, root
  and `orchestrator-svc` (which runs the controller) are unaffected.
- `-o ens3` — only the server's normal internet link. Tailscale's own
  interface (`tailscale0`) is untouched, though `runner`'s own Tailscale
  access already goes over the IPv4 100.x address, not IPv6.

Source of truth: `jul99-runner-v4-only.before6.rules.snippet`, which is the
exact block inserted into `/etc/ufw/before6.rules` (the file UFW itself
reapplies on every `ufw reload`, `ufw enable` and reboot — a raw
`ip6tables -I OUTPUT ...` insert does **not** reliably survive a `ufw
reload` producing a stale duplicate, which is why the rule lives in this file
rather than a one-off command).

**What it affects:** every outside service `runner` talks to (GitHub, npm,
DeepSeek's API, Anthropic's API, Linear's API, Axiom, Sentry, Google
accounts) has a real IPv6 address and is ordinarily dual-stack, so it falls
back to IPv4 on its own — confirmed nothing else broke during setup or
testing. The only real risk is a tool that insists on IPv6 and refuses to
fall back; none was found in use here.

### Verify it's active

```
sudo ip6tables -S ufw6-before-output | grep jul99-runner-v4-only
sudo -u runner curl -6 -m 6 -o /dev/null -w '%{http_code}\n' https://daily-cloudcode-pa.googleapis.com/   # should fail/refuse
sudo -u runner curl -4 -m 8 -o /dev/null -w '%{http_code}\n' https://daily-cloudcode-pa.googleapis.com/   # should return 404 (reachable)
```

Proven to survive `sudo ufw reload` (twice, live, 2026-09-22) with no
reboot needed to re-apply it.

### Reapply on a rebuilt server

Insert the block from `jul99-runner-v4-only.before6.rules.snippet` into
`/etc/ufw/before6.rules`, directly after the existing
`-A ufw6-before-output -o lo -j ACCEPT` line, then `sudo ufw reload`.

### Undo

Delete the block from `/etc/ufw/before6.rules` and `sudo ufw reload` — or,
for an immediate rollback without editing the file first:

```
sudo ip6tables -D ufw6-before-output -o ens3 -m owner --uid-owner runner -m comment --comment jul99-runner-v4-only -j REJECT --reject-with icmp6-port-unreachable
```

(that alone won't survive the next `ufw reload`, since the file still has
the rule — remove it from the file too if the intent is to undo it for
good).
