# OVH leftover readback

This is the requested inventory before any further JUL-253 proof work. Nothing was removed, stopped, restarted or redeployed. It records 18,377 paths, including 146 checkouts and 3,915 skill files. The canonical checkout and the two current JUL-253 worktrees are identified separately. The other 143 checkout locations include retained CI/proof snapshots and other agents' card worktrees; their presence does not prove abandonment.

The main snapshot ran from 22:36:16 to 22:38:41 UTC on 23 October 2026. Configuration enrichment finished at the time recorded in [scope.json](scope.json). This is a maker's checksummed readback with separate read-only explorers, not independent production review.

## Every path has a readback line

- [All checkout paths, commits and observed/configured use](checkouts.md).
- [Complete readback as TSV](readback.tsv) and [JSON Lines](readback.jsonl). Large files can be downloaded through GitHub's Raw view.
- [Small readback parts](lines/). Each part has at most 600 rows and the same columns. Together they contain every readback line.
- [All system and ubuntu-user service/timer states](services-and-timers.json).
- [Relevant process cwd, executable, path references and open files](processes.json).
- [Every matching laptop, retired-flow and old-deployment reference](legacy-references.jsonl), with file commit and line numbers. Historical evidence is labeled separately.
- [Actual Tailscale Serve readback](tailscale-serve.json).
- [Scope, exclusions, counts and validation](scope.json).

Each line names its path and checkout commit. A non-Git installed file has a content checksum instead. Four installed helpers additionally name the current-main commit whose tracked blob exactly matches them. Protected credential files have metadata only and were never read or hashed. A dirty checkout's HEAD does not identify its uncommitted content; individual file checksums preserve that distinction.

## Confirmed ways to pick stale instructions or code

| Path | Commit or provenance | Observed or configured use |
| --- | --- | --- |
| `/home/ubuntu/julia-next` | `03cd9033fa17bae834db6b7c025acc30ed17d2d3`, tracked changes present | Codex/tmux processes have actual cwd here. This session's supplied r6 skill catalog still points here. The enabled maintenance notifier also has a configured reader edge here. |
| `/home/ubuntu/julia-next/.agents/skills/verify-machine/SKILL.md` | `03cd9033`, file checksum in readback | Advertised through r6 and actually read in the previous JUL-253 turn. Main removed this skill in `6379e9ae5ebeb2befaca6f4249aeccd61a362a52` on 22 October at 21:45:17 UTC. It was the source of the incorrect Windows Proof gate. |
| `/home/ubuntu/.config/julia-verification-maintenance/config.json` | Non-Git, checksum in readback | Enabled maintenance service reads it. Its `notification.root` is stale `/home/ubuntu/julia-next`. The blocked-notification path imports that checkout's Linear helper and launches its secret wrapper conditionally. |
| `/home/ubuntu/.local/share/julia-verification-maintenance/notify-blocked.mjs` | Installed blob matches main `fa95a1a4` | `maintenance.mjs` invokes it conditionally. Current helper content can still use stale code because of its configuration. |
| `/var/lib/julia-build/repository` | `92f337dd684ada68f42c8cffbc9aec62bce41855` | Old build and sign-in scripts remain. Disabled/inactive `julia-build.service` and static/inactive `julia-build-sign-in.service` still target them. |
| `/usr/local/bin/julia-control-run` | Non-Git, SHA-256 in readback | Still names `/etc/julia-control/secrets.env` and absent `/opt/julia-control/reviewer`. No current unit was observed invoking it. |
| `/usr/local/sbin/julia-control-deploy-and-restart` | Non-Git, SHA-256 in readback | Still names absent `/opt/julia-control`. Both `/etc/sudoers.d/90-julia-agent` and `90-julia-control-delivery` retain authorization references to it. |
| `/etc/julia-control/op-service-account-token` | Non-Git, root-owned 0600 metadata only | Still exists. No current Julia machine unit references it. Its contents were never read or hashed. |
| `/tmp/framework-map-publish-candidate/ops/mastra-agents/reviewer (deleted)` | Original deleted checkout commit unknown | Two orphan process trees remain alive. Their actual cwd is this deleted path; their argv also mentions stale `julia-next`. These are separate facts. |
| `/home/ubuntu/julia-machine-main/.claude/skills/tdd/SKILL.md` and `.agents/skills/tdd/SKILL.md` | Main `fa95a1a4`, different file checksums | Same skill name with different content. Current standards explicitly select the `.claude` copy. |
| `/home/ubuntu/julia-machine-main/.claude/skills/teach/SKILL.md` and `.agents/skills/teach/SKILL.md` | Main `fa95a1a4`, different file checksums | Same name with different content. `ask-matt` still describes the old interpretation. |
| `/home/ubuntu/julia-machine-main/.claude/skills/pre-plan/SKILL.md` | Main `fa95a1a4` | Still discoverable, despite retirement in the agreed path-forward. It still names the Windows vault/admission command. |
| `/home/ubuntu/julia-machine-main/docs/agents/server-runbook.md` | Main `fa95a1a4` | Current AGENTS links it. It still names laptop/Windows operation, port 43123 and removed `/opt/julia-control` deployment, while actual Serve routes to 43126. |
| `/home/ubuntu/julia-machine-main/AGENTS.md` | Main `fa95a1a4` | Still contains the $0 trial rule, despite its linked path-forward's later Models and money decision retiring it. The dated decision and JUL-253 authorization remain controlling. |

Current control and runner services point to `/home/ubuntu/julia-machine-main`, not the old root deployment. Their installed `server-main.mjs` matches that checkout's recorded source at `fa95a1a41be69202dcc75b9cf1f753557ecb7a91`. The server-test and maintenance installed helpers also match tracked current-main blobs. These baseline entries are retained so a correct installed helper is not mislabeled stale solely because it lives outside a checkout.

The [agreed path-forward](https://github.com/toddwyder/julia-next/blob/fa95a1a41be69202dcc75b9cf1f753557ecb7a91/docs/plans/path-forward.md) says machine staging proof runs on the server through Todd's Tailscale address. The stale Windows skill is not that gate.

## Limits of the readback

An actual cwd or executable path is distinct from an argv mention. An open file descriptor does not by itself establish read direction. A configured conditional reader need not have run during this snapshot. No observed reader means unknown beyond the sampled processes, units and references; it never means nobody reads the file.

Checkout HEAD is the revision on disk. It does not identify code already loaded by a long-lived process. Automated services can create more proof snapshots after the census. Scope exclusions cover vendor dependencies, package caches and OS package databases. The user caches were separately scanned for Git directories and yielded no extra project checkout. There were no traversal permission errors.

Prove It Works changed the method to live process, unit, checksum and Git readback. Model the Domain kept checkout, file, process, unit and configured-reader evidence distinct. The separate synthesis caught and corrected an initial cwd-versus-argv overclaim before publication.

Reproduce the capture with `sudo -n python3 collect.py`, then `sudo -n python3 augment.py`, then `sudo -n python3 finalize.py`, from this directory. The scripts write only this audit's output files. They do not stop or remove anything. Read the fixed output path in each script before using it in a different checkout.
