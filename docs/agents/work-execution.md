# How card work runs

Mastra Factory is **RETIRED**. Its server, public endpoint, credentials, database, timers, and
repository source have been removed. New Julia and machine cards live in Linear: Linear owns cards, requirements, acceptance criteria, and status;
GitHub owns code, commits, pull requests, and CI; Run files own execution state. The intended route
is the adapted JUL-122 runner, started on Todd's Windows laptop with `$init JUL-nnn`. The adapted
runner and `$init` wrapper are pending implementation and verification. This documentation
checkpoint does not authorize starting delivery through them. The adapted runner's complete test
suite must pass on Todd's Windows laptop before it is used for delivery. UAT means Todd testing the
Vercel preview before merge by following the card's household-facing steps, not testing the live app
after merge.

## Retired Factory route

Factory is historical evidence only. Its code and operating resources have been removed; do not
restore or follow its former workflow. Existing Git history and decision records remain only for
audit and reference.

## Plan answers and blockers

The approved plan answers the questions skills ask — public interface, test seams, scope,
acceptance criteria, verification, and lasting observability. When a skill asks to agree test
seams, the plan's seams are the agreed seams; do not ask Todd again. Resolve routine
implementation details from code and history and record a concise assumption.

### Runtime dependency matrix

Any plan or laptop brief for a change that runs on the server or touches a database must
include a `## Runtime dependency matrix`. The plan is not approved without it. For every boundary
the change crosses, include one row naming the principal (the identity the deployed service
actually runs as), the backing store or API, read or write mode, the fixture that exercises the
boundary in tests, and the proof command that shows it works on the real server.

This comes from #211: unit tests covered code paths but not the deployed path, and unstated
runtime dependencies later surfaced as a missing entry point, missing database permissions, and
trace pages that were never followed. Use those as the worked example; a generic matrix does not
make a plan executable.

Never ask Todd for an exception or workaround approval. If an authorization boundary or platform
limit blocks the next required action, park the Linear card with one line explaining why.
