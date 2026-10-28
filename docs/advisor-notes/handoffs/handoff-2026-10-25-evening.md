# Handoff — 25 Oct 2026, 20:25 PT (for a non-Claude agent)

You are taking over the **advisor** role on Julia-next from Claude. Todd Wyder is a non-technical product manager. Read this whole file before replying to him.

## How to work with Todd (binding)

- **Read before you state.** Open the file, card, PR or source you are about to describe. Today's errors all came from describing things not yet read.
- **Don't over-summarise.** Todd's explicit concern. Keep specifics; cite file and line.
- **Don't invent names.** Use only existing names: "evidence review" (card + board column), "practice card", "Prove It Works", pstack's playbook names. Describe new things instead of naming them.
- **Use pstack as intended.** pstack is the reference; Julia is measured against it, never the reverse. Don't rebuild what pstack already does (the recurring failure with Mastra, Pocock's skills and pstack).
- **Proof = Todd pressing Start and seeing the card do what it says.** Not builder tests, not checklists.
- **Fewer rules that stop completion.** Every new stop needs a real problem behind it.
- **One consolidated, paste-ready instruction** for the agent. Never pieces. No instruction until every item in it is agreed; never call something "Todd's decision" he didn't make.
- One question at a time. Short replies, failure first. Say so plainly when Todd is wrong, with the reason.
- Verify agent reports on GitHub and Linear from raw evidence before telling Todd anything.

## Who does what

- **The agent:** Command Code CLI on DeepSeek V4.1 Flash on the server `ovh`. Todd opens it with the Windows Terminal profile **"Julia builder"** (runs `tmux julia-builder` → `/home/ubuntu/bin/julia-builder`, which pulls main in `/home/ubuntu/julia-builder`).
- **Codex on GPT-6 Sol:** profile **"Julia Codex"**, fixed tonight (see below). Untested.
- **The machine:** runs one pstack session per card in Mastra Code when Todd presses Start (`https://ovh.tail91f394.ts.net/julia-control`).
- Access: `gh api` REST works on `toddwyder/julia-next` (GraphQL doesn't). Linear tools work. The server is not reachable from a cloud session; evidence must land on GitHub.

## Where things stand

### Evidence review (Linear JUL-252)
- Merged today: #346 (Reviewer box on Start, npm/registry access, filtered builder keys), #348 (npm inside the file fence), #347 (real review with the Start reviewer; merge 9e2d523), #349 (machine checklist refusal and fake runtime removed; review reads the card's current text from Linear; merge 50a715d).
- Real runs: JUL-268 passed review (GPT-6 Sol reviewer, comment 19:34Z). JUL-269 went review 1 fail → Remediation → review 2 fail → Investigation → stop (comments 19:51, 19:56, 19:58Z). JUL-270 wrong-playbook run: review 1 unproven quoting the criterion edited after Start (20:47Z), then review 2 failed only on playbook steps although the result was confirmed, Investigation, stop (21:02Z).
- By Todd's standard (press Start, see an independent review; on failure one round of fixing, then root cause and stop) the card's behaviour has been shown. JUL-252 is **not yet marked Complete** in Linear; check its state.
- Reviewer GPT-6 Sol runs on Todd's **ChatGPT subscription** (`openai/` prefix, `ops/build-runner/machine-settings.json`). ChatGPT quota reset 24 Oct, 85% left on 25 Oct (the 24 Oct handoff's "30 Oct" was wrong).

### Agreed with Todd tonight, NOT yet sent to the agent
Walked through step by step and agreed:
1. **Evidence review judges only** whether each criterion is proven by evidence from where Todd would look (the PR's Vercel preview for a Julia change; a run through Start for a machine change). Wrong surface or inconclusive = unproven. Delete all playbook judging: `requiredBuildPlaybook` label logic, wrong-playbook rule, skipped-steps rule (`ops/build-runner/evidence-review.mjs:4-26`, `:150`). Code quality is left to pstack's code review inside the build.
2. **Builder publishes its own branch and opens its PR** so Vercel builds a preview it checks at "Verify on the matching surface". GitHub sign-in limited to pushing branches/opening PRs on this repo. Main's required checks unchanged (ruleset "main requires checks" is active).
3. **No refusal for live-site criteria.** The review judges them on the preview; the smoke test checks live after merge.
4. **Prove through Start** with a throwaway practice Julia card (home-page text criterion): read back PR + preview link, preview showing text, review comment judging from the preview, card passing; cancel the card.
5. Add to `docs/plans/path-forward.md`: proof is Todd pressing Start; Julia changes proven on the Vercel preview; machine changes proven on the candidate branch running as a second machine with a practice card on Beam, built by the next machine card; Julia and machine cards alternate.
6. PR, CI green, merge, only main; readbacks on the PR; evidence review card to Complete.
- Raised but **not agreed**: the evidence review stops using `.agents/skills/adversarial-review/SKILL.md` (it does code review, mentions Windows paths) and gets a short instruction instead. Todd then redirected to pstack. Also note pstack's own Shipping playbook already has an independent verifier per PR, so step 1 may be superseded by the pstack review below. **Don't send this instruction until the pstack review is done and Todd re-agrees.**

### pstack review (in progress — the current task)
Todd wants: what pstack's proper, intended way of working does that Julia doesn't do or does differently. pstack is the baseline.
- **Source:** https://github.com/backnotprop/pstack at commit `e44668c2aad92eacf4e84df47984121fefb11b82` (recorded in `.agents/skills/PSTACK-SOURCE.md`). Julia's install copied only skill folders; never installed: `docs/guide/` (10 chapters, 1,164 lines — how pstack is meant to be used), `docs/harness/claude-code.md`, `agents/poteto-agent.md`, `agents/comment-sicko.md`, `automations/benny/`.
- **Factual audit:** `docs/audits/pstack-usage-2026-10-25.md` on main (PR #351, merge 6bc6f7a). 5,039 rows, two columns (pstack with file:line | Julia with file:line or "nothing"), no judgments. Guide rows start at line 3820 (`## docs/guide`, 398 rows, 177 "nothing"). Its cost line covers only the agent's own chat ($0.11), not the 62 DeepSeek helpers; Todd can read the CommandCode usage page. An earlier judgment-style version (PR #350) was replaced; Todd didn't want analysis from DeepSeek.
- **Plan Todd was about to approve** (he raised over-summarising first):
  1. Read all 10 guide chapters in full (Claude read 01, 02, 06, 07; still to read 03, 04, 05, 08, 09, 10).
  2. One row per concrete practice the guide names (no compression; a section with five practices gives five rows): pstack (what it says, chapter:line) | Julia (what it does, file:line, or "nothing"). Check each Julia claim against the audit report and the code.
  3. At the top: every guide section heading with its row count, so nothing drops out unseen.
  4. Go through it with Todd a section at a time; decisions into `docs/plans/path-forward.md`; fixes via pstack's own tools (`/correct`, `/create-verification-skill`), not new machinery.
- **What chapters 1, 2, 6, 7 say that bears on proof (read by Claude, verify yourself):**
  - Ch1 (`01-setup.md`): `/setup-pstack` offers to generate a verification skill; the guide says it pays off the most. Julia: `verify-julia` is laptop-era PowerShell, local server only; `verify-machine` deleted.
  - Ch2 (`02-poteto-mode.md`): a prompt is goal, done check, proof wanted, what you know, constraints; don't enumerate skills or steps. Julia's host instructions (`ops/build-runner/pstack-session.mjs:52-56`) dictate checklist files and mark the PR step out of scope.
  - Ch6 (`06-verify-and-ship.md`): prove on the real app via the verification skill; keep it current with `/maintain-verification-skill`; Opening a PR → Babysit to green → Shipping, where a fresh agent proves behaviour live and the judge never built it. Julia: host owns PRs (`pstack-session.mjs:54`), no Babysit anywhere, own evidence review instead of Shipping. Maintenance on merge does run `maintain-verification-skill` (`ops/verification-maintenance/`).
  - Ch7 (`07-overnight.md`): "earn the trust before the loop" — four conditions before running unattended (seen done by hand; agent has your tools, verification skill first; every stage proves its work; repeated failures turned into tools/checks). Julia built the unattended machine first.

### Other findings from the first audit (PR #350, real, unaddressed)
- A correct "proven" verdict is downgraded to "unproven" if the reviewer names its proof file with a short path (`evidence-review.mjs:118-120`, `worker.mjs:151-158`).
- `createPstackSession` throws on `inherit-parent`/`auto` model values that `/setup-pstack` writes (`pstack-session.mjs:28-40`); the machine uses a hand-edited `ops/build-runner/pstack-models.md` (Haiku main session, DeepSeek elsewhere) — not the plan's split (Sol main session).
- CI's no-fakes check runs on all files (`scripts/no-fakes-repository.test.mjs:6-8`), so a card can be blocked by an old fake. It is a word filter and missed `test/fake-runtime/` (now deleted).

## Laptop change tonight
- Windows Terminal profile "Julia Codex" rewritten (backup `settings.json.before-julia-codex-fix` in `%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState`). It now runs: `ssh -t ovh` → clone `~/julia-codex` if missing → pull main → `tmux new-session -A -s codex` running `codex -m gpt-6-sol`, then a shell. Untested: the model name and the first clone. If it fails the error stays on screen.

## Cost so far
JUL-252 card ledger $21.22; JUL-269 $5.27; JUL-268 $0.68; JUL-270 run $6.07 (Opus ~93%). Audit helpers' cost unknown.

## For the retro (add to `retros/` notes)
- The proof failures came from rules and from the builder having no real place to prove (no PR, no preview, laptop verification skill), not from the work.
- Repeat: Julia rebuilds what its frameworks already provide instead of using them as intended (Mastra, Pocock, pstack).
- Advisor slips Todd corrected tonight: added the skipped-steps rule himself; proposed a deterministic test suite against pstack's way; invented names; called the Claude Code harness guide "closest to ours" without reading it (host is Mastra Code; poteto-mode's own Harness section applies); asked DeepSeek for analysis when Todd wanted facts; scoped the audit to installed skills only; proposed a third audit instead of using the data; over-summarised the guide.
