// agent-docs.test.mjs -- JUL-79 step 8, pieces 4 and 5: the standing cleanup
// rule must live in BOTH the repo instructions Claude Code reads (CLAUDE.md)
// and the coordinator skill it follows (SKILL.md), and the runbook must carry
// the facts verified live on 2026-09-19 that a fresh session cannot re-derive.
// Pinning the wording here keeps a later edit from silently dropping one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { TEMPLATE_NAME } from '../graph/board-spec.mjs';
import { orchestratorLaunchCommandFor } from './julia-run.mjs';

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

// The general server runbook. Named once here so the rename cannot leave a
// half-updated test file behind (JUL-92).
const RUNBOOK = 'docs/agents/server-runbook.md';

test('CLAUDE.md states the standing cleanup rule for agent-created test/throwaway Linear cards', () => {
  const text = read('CLAUDE.md');
  assert.match(text, /test\s+or\s+throwaway/i);
  assert.match(text, /cancelled\s+by that same agent/i);
  assert.match(text, /one-line\s+reason/i);
  assert.match(text, /before its ticket counts as\s+done/i);
});

// Laptop sessions do not load the coordinator skill, so the card-hygiene rules
// live here, where every session reads them (Todd, 2026-09-21): tick as you go,
// and finish the card (UAT, assigned to Todd, never Complete).
test('CLAUDE.md carries the two card-hygiene rules for laptop sessions, word for word: tick as you go, and finish the card', () => {
  const text = read('CLAUDE.md').replace(/\s+/g, ' ');
  const tick = "**Tick as you go.** Tick each checkbox on the card you're working the moment its evidence is posted, in the same step. Never tick at the end, and never tick before the evidence exists. The checkbox count is Todd's only view of progress.";
  const finish = "**Finish the card.** When the work is done and the report is posted, move the card to UAT and assign it to Todd. Never leave a finished card in Backlog, and never move it to Complete; acceptance is Todd's.";
  assert.ok(text.includes(tick), 'the "Tick as you go" rule is missing or reworded');
  assert.ok(text.includes(finish), 'the "Finish the card" rule is missing or reworded');
  // Both sit under the laptop-sessions section, "Finish the card" directly after "Tick as you go".
  const laptopHeading = text.indexOf('## Laptop sessions are the exception');
  const nextHeading = text.indexOf('## Reaching the server');
  assert.ok(laptopHeading >= 0, 'the laptop-sessions heading is missing');
  assert.ok(nextHeading >= 0, 'the heading after it is missing');
  assert.ok(laptopHeading < text.indexOf(tick));
  assert.equal(text.indexOf(finish), text.indexOf(tick) + tick.length + 1, '"Finish the card" must sit directly under "Tick as you go"');
  assert.ok(text.indexOf(finish) < nextHeading);
});

test('the coordinator skill states the same standing cleanup rule in its own voice', () => {
  const text = read('.claude/skills/julia-coordinator/SKILL.md');
  assert.match(text, /test\s+or\s+throwaway/i);
  assert.match(text, /cancelled\s+by that same agent/i);
  assert.match(text, /one-line\s+reason/i);
  assert.match(text, /before its ticket counts as\s+done/i);
});

test('the runbook records the JUL-79 step 8 live-verified facts, each dated 2026-09-19', () => {
  const text = read('docs/agents/server-runbook.md');
  // (a) the silent Z.ai exhaustion
  assert.match(text, /Insufficient balance or no resource package/);
  // (b) the relay is reachable directly from an on-box coordinator
  assert.match(text, /127\.0\.0\.1:8943/);
  // (c) the launcher binds the run to its own terminal, so worker-start fences
  assert.match(text, /consumer_fenced/);
  // (d) ORCA_TERMINAL_HANDLE is unset in a julia-run-started Claude orchestrator
  assert.match(text, /ORCA_TERMINAL_HANDLE/);
  // (e) nothing can read a PR's mergeable_state with the publisher token
  assert.match(text, /mergeable_state/);
  const dated = text.match(/2026-09-19/g) ?? [];
  assert.ok(dated.length >= 5, `expected at least five 2026-09-19 facts, found ${dated.length}`);
});

// JUL-79 step 8 follow-up: the family-collision guard (scripts/seat-labels.mjs)
// only prevents anthropic-reviewing-anthropic if the written procedure
// actually tells the coordinator to run it. Both passages that send a capped
// seat to its backup must name the command, not just the table read.
test('both coordinator fallback passages require resolving the fallback through the seat-labels CLI', () => {
  const text = read('.claude/skills/julia-coordinator/SKILL.md');
  const runningStart = text.indexOf('## Running a step');
  const afterStart = text.indexOf('## After verification');
  assert.ok(runningStart >= 0, 'missing "Running a step" section');
  assert.ok(afterStart > runningStart, 'missing "After verification" section');
  const running = text.slice(runningStart, afterStart);
  const nextAfter = text.indexOf('\n## ', afterStart + 1);
  const after = text.slice(afterStart, nextAfter === -1 ? undefined : nextAfter);
  assert.match(running, /seat-labels\.mjs fallback/);
  assert.match(after, /seat-labels\.mjs fallback/);
  // And the refusal must park the item, never run a same-family pair.
  assert.match(running, /park the item as \*\*Blocked\*\*/);
  assert.match(after, /park the item as \*\*Blocked\*\*/);
});

test('the coordinator skill and the runbook say the headless coordinator is one-shot and must stay until its card is done or parked (JUL-106)', () => {
  const skill = read('.claude/skills/julia-coordinator/SKILL.md').replace(/\r\n/g, '\n').replace(/\s+/g, ' ');
  assert.match(skill, /You are a one-shot session: do not end your reply while any work is in flight/);
  assert.match(skill, /A background watcher, a "wake me when it goes idle" wait/);
  assert.match(skill, /End the wake only when the item is complete, or parked with the reason posted/);
  // The old step-2 wording counted a still-running worker as done, which invited the early exit.
  assert.doesNotMatch(skill, /every in-flight item is running, verified-and-advanced/);
  const runbook = read('docs/agents/server-runbook.md').replace(/\s+/g, ' ');
  assert.match(runbook, /one-shot headless session, so it has to stay until its card is complete or parked/);
});

// JUL-97 step 2, item 7: Linear applies a team's default template only to a
// card a person creates in the app. A card created through the API gets
// nothing unless the template is NAMED (`save_issue`'s own `template`
// parameter, "Applied on create only ... Labels merge with the template's
// own"), proven live 2026-09-20 with two throwaway cards: without the
// template, zero labels; with it, all twelve. So every document and skill in
// this repo that tells an agent to create a card has to name it, and the name
// itself is spelled once, in graph/board-spec.mjs. The skills are discovered
// by scanning both mirrored trees, so a creation route added later cannot slip
// past this test the way to-spec and wayfinder did.
test('every document and skill that creates a Linear card names the team template', () => {
  assert.equal(TEMPLATE_NAME, 'Julia-next agent defaults');
  // The name is not duplicated in board-setup.mjs; it imports and re-exports
  // the spec's constant.
  const setup = read('scripts/board-setup.mjs');
  assert.doesNotMatch(setup, /=\s*'Julia-next agent defaults'/, 'the template name is spelled once, in the board spec');
  assert.match(setup, /TEMPLATE_NAME,?\n\} from '\.\.\/graph\/board-spec\.mjs'/);

  const tracker = read('docs/agents/issue-tracker.md');
  // The create convention itself names it, and says why.
  assert.match(tracker, /\*\*Create an issue\*\*[\s\S]{0,200}template: "Julia-next agent\s+defaults"/);
  assert.match(tracker, /Always name the\s+template/);
  assert.match(tracker, /only to a card a person creates in the app/);
  // And so do the other two places this file tells a session to make a card.
  const publish = tracker.slice(tracker.indexOf('## When a skill says "publish to the issue tracker"'));
  assert.match(publish.slice(0, 300), /Julia-next agent defaults/);
  assert.match(tracker, /\*\*Child ticket\*\*[\s\S]{0,160}Julia-next\s+agent defaults/);

  assert.match(read('docs/agents/triage-labels.md'), /template: "Julia-next agent defaults"/);

  // Both skill trees are kept in step; a card published by either names it.
  // The creating skills are DISCOVERED, not listed: attempt 1 hand-listed
  // triage and to-tickets and missed to-spec and wayfinder. A seventh skill
  // that tells a session to create a tracker card has to fail this test, so
  // the scan reads every SKILL.md in both trees and treats "creates/publishes
  // an issue, ticket or card" (or calls `save_issue`/`create_issue` at all) as
  // a creation route.
  const CREATES_A_CARD = /\bcreat(e|es|ing)\b[^.\n]{0,60}\b(issue|ticket|card)s?\b|\bpublish(es|ing|ed)?\b[^.\n]{0,60}\b(issue|ticket|tracker)\b|save_issue|create_issue/i;
  const creators = [];
  for (const root of ['.claude', '.agents']) {
    for (const skill of readdirSync(new URL(`../${root}/skills`, import.meta.url))) {
      const relativePath = `${root}/skills/${skill}/SKILL.md`;
      if (!existsSync(new URL(`../${relativePath}`, import.meta.url))) continue;
      const text = read(relativePath);
      if (!CREATES_A_CARD.test(text)) continue;
      creators.push(relativePath);
      assert.match(text, /template: "Julia-next agent defaults"/, `${relativePath} creates a card but does not name the template`);
      assert.match(text, /only to a card a person creates in the app/, `${relativePath} does not say why`);
    }
  }

  // The scan must not quietly shrink: every route known today stays in it, in
  // both mirrored trees.
  for (const root of ['.claude', '.agents']) {
    for (const skill of ['triage', 'to-tickets', 'to-spec', 'wayfinder']) {
      assert.ok(
        creators.includes(`${root}/skills/${skill}/SKILL.md`),
        `${root}/skills/${skill} is a known creation route but the scan did not find it`,
      );
    }
  }
});

// JUL-97 step 2, item 8: six facts this run established live, in the
// runbook, dated 2026-09-21. A fresh coordinator cannot re-derive any of
// them from the code, and two of the six were already partly recorded and are
// extended in place rather than duplicated.
test('the runbook records the six JUL-97 step 2 facts, dated 2026-09-21', () => {
  const text = read('docs/agents/server-runbook.md');
  const start = text.indexOf('## Six JUL-97 step 2 discoveries (verified 2026-09-21)');
  assert.ok(start >= 0, 'the JUL-97 step 2 section is missing');
  const section = text.slice(start, text.indexOf('\n## ', start + 1));

  // (i) the queue-launched coordinator must bind its own Run, or
  // consumer_fenced. Extended in place on the passage that already carried the
  // fresh-orchestrator case, and pointed at from the section.
  assert.match(section, /A queue-launched coordinator must bind its own Run first/);
  assert.match(section, /Ready\s+queue launches every coordinator the same way/);
  assert.match(text, /Extended 2026-09-21 \(JUL-97\): this is now the NORMAL case/);
  assert.match(text, /run-use --environment orchestrator-local --id <runId> --from <its own terminal handle>/);
  assert.match(text, /Skipping it fails `consumer_fenced` on the first dispatch/);
  // (ii) ORCA_ENVIRONMENT=ovh-local -> run_not_found on orchestration commands
  assert.match(section, /run_not_found/);
  assert.match(section, /ORCA_ENVIRONMENT=ovh-local/);
  // (iii) worker-stop and worker-list reject --from; worker-list takes --run
  assert.match(section, /`worker-stop` and `worker-list` reject `--from`/);
  assert.match(section, /`worker-list` takes `--run`/);
  // (iv) only a supervised worker leaves a timing record
  assert.match(section, /created_at` and `completed_at/);
  assert.match(section, /nine build attempts can be timed/);
  // (v) the granted list refuses the --env-file form of check-readiness
  assert.match(section, /--env-file=\/etc\/orchestrator-svc\/\.env\.publisher scripts\/check-readiness\.mjs/);
  assert.match(section, /Use the plain form/);
  // (vi) board-setup's "already matches the spec" blind spot
  assert.match(section, /already matches graph\/board-spec\.mjs; no changes/);
  assert.match(section, /builder-glm-5\.3/);
  assert.match(section, /issueLabelRetire/);

  // Two of the six are extensions, and each says so instead of re-stating a
  // fact the runbook already carried.
  assert.equal((section.match(/Already recorded/g) ?? []).length, 2);

  const dated = text.match(/2026-09-21/g) ?? [];
  assert.ok(dated.length >= 3, `expected the 2026-09-21 facts to be dated, found ${dated.length}`);
});

// ---------------------------------------------------------------------------
// JUL-92: the docs have to match how things actually run now. Four guards, one
// per stale item the card names. Each pins the CORRECTED fact, so the doc
// cannot quietly drift back.
// ---------------------------------------------------------------------------

// JUL-92, item 2: the runbook is the general server runbook, not the record of
// one closed ticket, and the old filename is gone from the whole tree --
// CLAUDE.md, the three julia-* skills, the ops unit files, the sudoers header
// and the scripts that cite it. The needle is assembled from pieces so this
// test file is not itself a hit.
test('no file in the repo still refers to the old runbook filename', () => {
  const stale = ['jul43', 'coordinator', 'runbook'].join('-');
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  const offenders = tracked.filter((path) => {
    if (path.includes(stale)) return true;
    let text;
    try {
      text = read(path);
    } catch {
      return false; // a binary or unreadable file cannot name it in prose
    }
    return text.includes(stale);
  });
  assert.deepEqual(offenders, [], `these files still name the old runbook: ${offenders.join(', ')}`);
  // And the new one is really there, under a name that is about the server
  // rather than about a ticket.
  assert.ok(existsSync(new URL(`../${RUNBOOK}`, import.meta.url)), `${RUNBOOK} is missing`);
  assert.match(read(RUNBOOK).split('\n')[0], /^# .*[Ss]erver runbook/);
});

// JUL-92, item 1: the runbook printed a copy of the coordinator's granted
// command list, and a copy goes stale the moment the launcher changes. This
// compares the printed block against `orchestratorLaunchCommandFor`'s real
// --allowedTools string, entry for entry, so a grant added or removed in
// scripts/julia-run.mjs fails here until the runbook is updated in the same PR.
test('the runbook\'s granted-command block is exactly the launcher\'s live --allowedTools list', () => {
  const live = orchestratorLaunchCommandFor('claude', 'JUL-92')
    .match(/--allowedTools "([^"]*)"/)[1]
    .split(',')
    .map((grant) => grant.trim())
    .filter(Boolean);
  const runbook = read(RUNBOOK);
  const fence = runbook.match(/```\n\s*(mcp__linear__\*[\s\S]*?)\n\s*```/);
  assert.ok(fence, 'the runbook no longer prints the granted-command block');
  const documented = fence[1]
    .split(',')
    .map((grant) => grant.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  assert.deepEqual(documented, live);
});

// JUL-92, item 1 (second half): the same section's prose used to name only
// five of the granted scripts, so a reader who trusted the sentence rather
// than the block would think ready-queue, seat-labels and linear-cli were
// ungranted. Every script on the live list has to appear in that prose too.
test('the runbook prose that explains the grants names every granted script', () => {
  const text = read(RUNBOOK);
  const start = text.indexOf('The headless launch needs its own tool grants');
  assert.ok(start >= 0, 'the headless-launch grants passage is missing');
  const section = text.slice(start, text.indexOf('\n## ', start));
  for (const script of [
    'orca-cli.mjs',
    'ready-queue.mjs',
    'seat-labels.mjs',
    'linear-cli.mjs',
    'check-readiness.mjs',
    'collect-worker-result.mjs',
    'verify-reviewer-worktree.mjs',
    'coordinator-events.mjs',
  ]) {
    assert.ok(section.includes(script), `the grants passage does not name ${script}`);
  }
});

// JUL-92, item 1 (third half) and the runbook's own finding 5: the granted
// list has `Bash(node scripts/check-readiness.mjs:*)` and nothing with the
// --env-file prefix, so a coordinator that copies a documented --env-file
// invocation is refused before the command runs. No runnable shell block in
// either document may show that form.
test('no runnable example tells a coordinator to run check-readiness behind the publisher --env-file prefix', () => {
  const refused = '--env-file=/etc/orchestrator-svc/.env.publisher scripts/check-readiness.mjs';
  for (const path of [RUNBOOK, '.claude/skills/julia-coordinator/SKILL.md']) {
    const text = read(path);
    for (const [, block] of text.matchAll(/```sh\n([\s\S]*?)```/g)) {
      assert.ok(!block.includes(refused), `${path} has a shell block running the refused form`);
    }
  }
  // The skill's readiness-check line names the granted plain form, and says
  // why the prefixed one is not it.
  const skill = read('.claude/skills/julia-coordinator/SKILL.md');
  assert.match(skill, /\*\*Readiness check\*\* \(`node scripts\/check-readiness\.mjs`\)/);
  assert.match(skill, /--env-file/);
  assert.match(skill, /refused|not granted/);
});

// JUL-92, item 4: a long multi-line prompt handed straight to
// `orca terminal create --command` is mangled (JUL-79, 2026-09-19 13:31Z) --
// two reviewer launches died silently on it. The workaround was never written
// down anywhere; a fresh coordinator would hit it again.
test('the runbook records the terminal-create long-prompt mangling and its workaround', () => {
  const text = read(RUNBOOK);
  const start = text.indexOf('A long multi-line prompt passed inline to `orca terminal create --command` is mangled');
  assert.ok(start >= 0, 'the long-prompt mangling fact is missing');
  const fact = text.slice(start, start + 1400).replace(/\s+/g, ' ');
  // The symptom, so it is recognisable when it happens again.
  assert.match(fact, /echoed the command twice and truncated it/);
  assert.match(fact, /zero-byte/);
  // The workaround, and the one form that does NOT work.
  assert.match(fact, /-p "\$\(cat <file>\)"/);
  assert.match(fact, /heredoc works only when it is the \*entire\* command/);
  assert.match(fact, /&&/);
  assert.match(fact, /2026-09-19/);
});

// JUL-92, item 3: the journey-accounting snippet used to tell the coordinator
// to wait on a plain diagnostic terminal with Orca's own wait. Neither mode is
// a completion signal there (tui-idle returns mid-run; exit only times out
// because the shell stays open), and a JUL-76 wake proved tui-idle can ALSO
// time out on a terminal that had already finished. The snippet now polls the
// read for the shell prompt; it must not go back.
test('the journey-accounting snippet waits by polling the terminal read, never with an Orca wait', () => {
  const skill = read('.claude/skills/julia-coordinator/SKILL.md');
  const start = skill.indexOf('## Journey accounting');
  assert.ok(start >= 0, 'the journey-accounting section is missing');
  const section = skill.slice(start, skill.indexOf('\n## ', start + 1));
  // The snippet itself polls terminalRead until the shell prompt returns.
  assert.match(section, /for \(let attempt = 0; attempt < 15; attempt \+= 1\)/);
  assert.match(section, /terminalRead\(\{ environment: 'ovh-local'/);
  assert.match(section, /poll the read until the\s*\/\/ last line is the shell prompt again/);
  // And it says, in the snippet, that neither wait mode is that signal.
  assert.match(section, /neither `terminalWait`\s*\/\/ mode is that signal/);
  // No live recommendation to wait on this terminal.
  assert.doesNotMatch(section, /await terminalWait\(/);
  assert.doesNotMatch(section, /orca terminal wait/);
});

// JUL-92, acceptance criterion 1 (the cold-reader check). A fresh session read
// the runbook alone against this live server and found eleven instructions the
// box contradicts. Eight were the runbook's own text and are corrected; these
// guards pin the ones a machine can check, because every one of them is the
// same failure as the granted-command list above -- a constant copied out of
// code into prose, where nothing makes it follow the code.
test('the runbook does not claim the builder seat is Claude -- the seat table names it', async () => {
  const { SEAT_TABLE } = await import('../graph/seat-table.mjs');
  const text = read(RUNBOOK);
  // Whatever the table says today, the runbook must not contradict it.
  assert.equal(SEAT_TABLE.builder.primary, 'gemini');
  assert.doesNotMatch(text, /`SEAT_TABLE\.builder` still names `claude`/);
  assert.match(text, /builder: \{ primary: 'gemini', backup: 'claude' \}/);
});

test('the runbook lists every readiness check the script actually runs, by its real label', () => {
  const script = read('scripts/check-readiness.mjs');
  const labels = [...script.matchAll(/check\('([^']+)'/g)].map(([, label]) => label);
  const unique = [...new Set(labels)];
  assert.ok(unique.length >= 5, `expected at least five checks, found ${unique.length}`);
  const start = read(RUNBOOK).indexOf('## Readiness');
  assert.ok(start >= 0, 'the Readiness section is missing');
  const section = read(RUNBOOK).slice(start, read(RUNBOOK).indexOf('\n## ', start + 1));
  for (const label of unique) {
    assert.ok(section.includes(label), `the Readiness section does not list "${label}"`);
  }
  // And it must not go back to promising four.
  assert.doesNotMatch(section, /^Checks, each its own pass\/fail line:$/m);
});

test('the runbook does not carry a hand-copied drop-box field list that the code can outgrow', () => {
  const text = read(RUNBOOK);
  const start = text.indexOf('There is no `vercel.env`');
  assert.ok(start >= 0, 'the drop-box fields passage is missing');
  const passage = text.slice(start, start + 900).replace(/\s+/g, ' ');
  // It points at the constant...
  assert.match(passage, /`FIELDS` in `ops\/service-dropbox\/dropbox\.mjs`/);
  assert.match(passage, /read that constant,? never a list copied out of here/);
  // ...and the snapshot it does print is the real one, commandcode included.
  assert.match(passage, /`commandcode`/);
});

test('the runbook does not tell a recovering session to run `orca worker-show`, which is not a command', () => {
  const text = read(RUNBOOK);
  // The recovery recipe uses the real form.
  assert.match(text, /orca orchestration worker-show --dispatch <dispatch id>/);
  // The bare form survives only where the runbook explicitly calls it out as wrong.
  for (const [, line] of text.matchAll(/^(.*\borca worker-show\b.*)$/gm)) {
    assert.match(line, /NOT `orca worker-show|prints "Unknown command"/, `stale command in: ${line.trim()}`);
  }
});

test('the runbook does not still say a card can only start by explicit launch -- the controller loop starts them', () => {
  const text = read(RUNBOOK);
  const start = text.indexOf('## Start');
  const section = text.slice(start, text.indexOf('\n## ', start + 1));
  assert.match(section, /Cards start themselves\. The controller is the live route/);
  assert.match(section, /graph\/controller\/main\.mjs --loop/);
  // The old absolute claim may remain only as the manual route's own scope.
  assert.doesNotMatch(section, /^There is no scheduled trigger — explicit launch only\./m);
});
