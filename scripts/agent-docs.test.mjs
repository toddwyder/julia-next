// agent-docs.test.mjs -- JUL-79 step 8, pieces 4 and 5: the standing cleanup
// rule must live in BOTH the repo instructions Claude Code reads (CLAUDE.md)
// and the coordinator skill it follows (SKILL.md), and the runbook must carry
// the facts verified live on 2026-09-19 that a fresh session cannot re-derive.
// Pinning the wording here keeps a later edit from silently dropping one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

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
  assert.ok(text.indexOf('## Laptop sessions are the exception') < text.indexOf(tick));
  assert.ok(text.indexOf(tick) + tick.length < text.indexOf(finish));
  assert.ok(text.indexOf(finish) < text.indexOf('## Reaching the server'));
});

test('the coordinator skill states the same standing cleanup rule in its own voice', () => {
  const text = read('.claude/skills/julia-coordinator/SKILL.md');
  assert.match(text, /test\s+or\s+throwaway/i);
  assert.match(text, /cancelled\s+by that same agent/i);
  assert.match(text, /one-line\s+reason/i);
  assert.match(text, /before its ticket counts as\s+done/i);
});

test('the runbook records the JUL-79 step 8 live-verified facts, each dated 2026-09-19', () => {
  const text = read('docs/agents/jul43-coordinator-runbook.md');
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
  const runbook = read('docs/agents/jul43-coordinator-runbook.md').replace(/\s+/g, ' ');
  assert.match(runbook, /one-shot headless session, so it has to stay until its card is complete or parked/);
});
