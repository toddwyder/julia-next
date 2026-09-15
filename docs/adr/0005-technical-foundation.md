# 0005. Vercel for the website, a purpose-built offline-sync service for the data

Date: 2026-09-15

Status: accepted; the sync service is not yet named (see below).

The website runs on Vercel, as before, on the free personal plan at a Vercel-made address. The
data lives in a purpose-built offline-sync service (the "every device has a full copy, syncs
when it can" category), not Firebase. Errors and logs go to Sentry and Axiom from the first
line (ADR 0001). The OVH server stays the agent runner and gate; it never hosts the app.

Every proposed change gets a **rehearsal copy**: a temporary Julia (website and data) where
evidence is recorded before Todd accepts. Real data is never touched by an unaccepted change.

A new error in the real Julia opens a Linear ticket by itself; Todd gets a one-line
notification and never reads error emails or logs. Nobody in the household is on call.

**Journey zero** is the pipeline itself: an agent on the OVH runner ships a trivial change
through the gate, the publisher opens the PR, a rehearsal copy appears, and gated evidence
lands. It comes before any feature.

We chose this over Vercel + Firebase again because the old gate's Java emulators pushed the
runner to its limit and Firebase's offline behaviour has rough edges agents would work around
again; over a rented app server because someone becomes on-call; over a custom domain because
Todd chose the Vercel address.

## Consequences

- The Vercel project name is chosen once, deliberately: it becomes the address on every
  installed device, in the clipper, and in shared links.
- The sync service is picked by research against fixed criteria (full copy per device,
  later-wins per line, Google sign-in with a two-account allowlist, rehearsal copies, free at
  household size, tests on the runner without a heavy emulator) and approved by Todd. This ADR
  is amended with the name when that happens.
- Bootstrapping julia-next on the runner (read-only clone, deploy key, publisher App install,
  publish-from-server demonstrated) is part of journey zero.

Decided in [Technical foundation: what Julia is built on this time](https://linear.app/julia-next/issue/JUL-11).
