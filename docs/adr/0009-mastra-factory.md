# 0009. Deliver through stock Mastra Factory, with GitHub as the board

Date: 2026-09-26, revised 2026-09-27

Status: accepted 2026-09-27 after two trials (JUL-183: issue #129 / PR #130, then issue #132 /
PR #133) and a product-use audit (`docs/research/mastra-intended-use-audit.md`). Supersedes the
Pydantic graph as the planned route and the Linear parts of ADR 0008.

The Pydantic graph never carried a card from start to finish. We built too much of our own
machinery around it: worker launchers, watchdogs and restart files. There was no dashboard, so
nobody could see what was happening, and the framework left every piece of plumbing to us. We
are replacing it with Mastra Factory, self-hosted on OVH, for its dashboard, metrics,
observability and agent framework.

The first trial repeated the graph's mistake inside Factory: its custom board had nothing that
started an agent, so an operator agent moved the cards, wrote the evidence and merged with its
own scripts. The second trial, on stock Factory with no agent driving it, worked. So the rule
is: **use Factory, Mastra and GitHub as their makers intend, and use their relevant features.
Use the stock product first; improve only what real use shows is lacking.**

**The route.** Factory's stock Work and Review boards run every card. Our process goes into
Factory's supported customisation points, not into a custom board: we override the
`factory-plan` and `factory-review` skills from the Factory project's `factory-skills/` folder,
and the build step follows the approved plan plus `AGENTS.md`. The repo's Pocock skills are
loaded into every session. Every plan must name the seams and the failing tests written first
(Pocock `tdd`), and the lasting observability the change adds. The plan is saved in the pull
request, and both reviewers check the work against it.

**Models.** Codex builds, on Todd's ChatGPT Pro sign-in (OpenAI's CI/CD guide allows unattended
runs as your own account on private infrastructure; if OpenAI objects, the builder moves to an
API key). Observational memory is Factory's default; its observer and reflector run on a fast,
cheap model as Mastra recommends, starting with DeepSeek flash. Every model is a setting Todd
names in a sentence; none is fixed by this ADR. We rejected Gemini: Todd's Gemini plan works
only inside Google's own tools, and paying for an API key on top is waste.

**Review.** Factory's review step runs Pocock `code-review` (Standards and Spec) on the builder's
model. A separate review agent, built from Mastra's `template-github-review-agent` and trusted
through `MASTRACODE_GITHUB_AUTHORIZED_BOTS`, tries to break the work against every acceptance
criterion. Its model must come from a different maker than the builder's; its model and ordered
backups are settings (DeepSeek to start). Either reviewer's "Request changes" goes back to the
builder through Factory's own GitHub rule. When a review finds something that should apply to
all future code, the builder adds one line to `CODING_STANDARDS.md` in the same pull request.

**Todd's part.** Factory's Intake column is the backlog: nothing starts until Todd taps it, and
issues agents open wait there too. Auto-start stays off; plans are approved automatically.
Robot checks (CI, including the Playwright browser test) and both reviews pass before GitHub
asks for Todd's review. He tries the Vercel rehearsal copy, following the plain-language steps
on the pull request, and approves or requests changes in one sentence. Approval is acceptance:
GitHub's own auto-merge, with a branch rule requiring Todd's approval, merges it. Factory never
merges. Progress is Factory's board and its Needs attention list; the issue checklist is dropped.

**Keeping agents honest.** A rule an agent can ignore is not enough, so there are locks: agent
permissions that deny moving Factory cards, using Factory's GitHub keys, or merging; a required
check that rejects custom machinery not on the exceptions list; and an exceptions list only Todd
can change (GitHub code owners). Before any workaround, script, or change to Mastra's code, an
agent stops and states the gap, the Mastra docs it checked, and what breaks without it; Todd
approves or refuses. Todd's assurance does not come from pull requests or agent reports: each
card shows whether every step was done by Factory or by Todd, from Factory's own audit records,
and an independent audit against Mastra's documentation runs after setup and after the first
three cards.

**Costs.** Mastra traces and cost charts are on before the first real card, because costs cannot
be reduced without data. GitHub's hosted runners run CI (billing fixed, $0 Actions cap as a
backstop, minute-saving CI settings). One weekly summary covers model costs and GitHub minutes
with a month-end forecast, and an early warning goes out the day the forecast passes the 2,000
free minutes. The forecast is a small piece of our own code and goes on the exceptions list.

Cards move from Linear to GitHub issues and the Factory board. JUL-184 (this setup) is the last
new Linear card. Linear stays as the read-only library of Julia documents: nothing is deleted,
each GitHub issue links to the Linear card or document it came from, and a Linear feature card
closes only once its GitHub issue exists, with a one-line pointer, so anything still open in
Linear has not been carried across.
We rejected keeping Linear for planning alongside GitHub for builds, and Factory's built-in
Linear intake: two boards kept in step is the kind of homemade machinery that sank the graph.

## Consequences

- No more trials. Setup comes first: traces and cost charts, the memory model, GitHub billing,
  and Todd's one-time Vercel sign-in. Then the spec is written from this ADR, and its tickets
  run through Factory as real cards, smallest first.
- Approved exceptions today: the WorkOS sign-in fix (upstream mastra-ai/mastra#25252; remove when
  it ships), the unapproved-machinery check, and the cost forecast.
- `docs/research/mastra-route-requirements.md` is retired; the spec replaces it.
  `docs/agents/work-execution.md` and `CLAUDE.md` must stop describing hand-driven builds and the
  Pydantic graph, or agents following them will repeat the first trial.
- The Settings card is retired, which partly reverses ADR 0008's "models are never chosen in a
  file". A new model maker first needs its key stored on the server. Per-card model overrides
  wait until they are missed.
- Factory gets one public https address behind its own login, so GitHub events reach it and Todd
  can open the board from anywhere. The rest of the OVH server stays private behind Tailscale.
- Once the new route's tickets exist, every open graph card in Linear is canceled with a one-line
  reason pointing here. Julia-feature cards stay open as history until rewritten as GitHub
  issues. The graph is kept as reference; nothing new is built on it.
- Deferred until real use calls for them: phone alerts for stuck cards (Factory's Needs attention
  comes first), Mastra evals, per-card model choice, and extra agent roles.
- To confirm during setup: traces recorded on our server and Studio reachable; the browser test
  runs against the rehearsal copy with the test data; GitHub asks Todd only once everything is
  green; auto-merge works on pull requests the Factory App authored; a trusted reviewer bot's
  "Request changes" reaches the builder. If auto-merge fails, Todd presses Merge; no script.
