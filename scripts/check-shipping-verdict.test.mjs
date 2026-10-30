// check-shipping-verdict.test.mjs -- the gate that keeps a card pull request
// red until an agent that did not write the code has run the change on the
// current head and passed every acceptance criterion. The cases below are the
// decisions the gate makes: no verdict, stale verdict, FAIL, PASS, and the
// records it refuses to read as a verdict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseVerdictComment, pullCards, pullNumberFor, shippingVerdict, VERDICT_KEY, VERDICT_TEMPLATE } from './check-shipping-verdict.mjs';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const AC = 'A fresh card shows the account balance on its first screen.';
const AC2 = 'The balance refreshes when a card starts.';

const verdict = (over = {}) => ({
  [VERDICT_KEY]: 1,
  card: 'JUL-290',
  head: HEAD,
  verdict: 'PASS',
  builder: 'sol',
  verifier: 'deepseek',
  criteria: [{ criterion: AC, verdict: 'PASS', note: 'ran the app and read the screen' }],
  ...over,
});

const comment = (record, createdAt = '2026-10-30T10:00:00Z', id = 1) => ({
  id,
  createdAt,
  body: `Shipping verdict\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`,
});

const pull = (over = {}) => ({
  title: 'Show how much is left on every account when a card starts (JUL-290)',
  body: 'Ordinary body text.',
  head: { ref: 'feat/jul-290-account-status', sha: HEAD },
  ...over,
});

test('a pull request that names no card needs no verdict', () => {
  const result = shippingVerdict({ pull: { title: 'Document adding a model', head: { ref: 'docs/model', sha: HEAD } }, comments: [] });
  assert.equal(result.ok, true);
  assert.equal(result.card, null);
});

test('a body that merely mentions another card is not a card pull request', () => {
  const result = shippingVerdict({ pull: { title: 'Gate card pull requests', head: { ref: 'ci/gate', sha: HEAD }, body: 'The evidence review is JUL-252 work.' }, comments: [] });
  assert.equal(result.ok, true);
  assert.equal(result.card, null);
});

test('a Card line in the body names the card', () => {
  assert.deepEqual(pullCards({ title: 'Gate card pull requests', head: { ref: 'ci/gate' }, body: 'Why\n\nCard: JUL-301\n' }), ['JUL-301']);
});

test('a runner branch names its card without a JUL id', () => {
  assert.deepEqual(pullCards({ title: 'Balance on start', head: { ref: 'runner/card-290' } }), ['JUL-290']);
});

test('a plan, retro or correction branch names the card it is about without delivering it', () => {
  for (const ref of ['plan/jul-276-start-screen', 'retro/jul-276-2026-10-30', 'correct/2026-10-27']) {
    assert.deepEqual(pullCards({ title: 'Plan JUL-276 as nine separately verified PRs', head: { ref }, body: 'Card: JUL-276\n' }), []);
  }
});

test('a card named only in the title is still gated, on any branch but a paper one', () => {
  assert.deepEqual(pullCards({ title: 'Show the balance (JUL-290)', head: { ref: 'account-status' } }), ['JUL-290']);
  assert.deepEqual(pullCards({ title: 'Write the JUL-290 runbook', head: { ref: 'docs/jul-290-runbook' } }), ['JUL-290']);
});

test('the title decides, so a slice off another card branch stays its own card', () => {
  const pull = { title: 'Show how much is left on every account (JUL-290)', head: { ref: 'feat/jul-290-account-status' }, body: 'JUL-290, slice 4b of JUL-276.' };
  assert.deepEqual(pullCards(pull), ['JUL-290']);
  assert.deepEqual(pullCards({ title: 'Show the balance (JUL-290)', head: { ref: 'feat/jul-276-slice-4b' } }), ['JUL-290']);
});

test('a declared card in the body outranks the branch name', () => {
  const pull = { title: 'Balance on start', head: { ref: 'feat/jul-276-slice-4b' }, body: 'Card: JUL-290\n' };
  assert.deepEqual(pullCards(pull), ['JUL-290']);
});

test('a card pull request with no verdict is red', () => {
  const result = shippingVerdict({ pull: pull(), comments: [] });
  assert.equal(result.ok, false);
  assert.equal(result.card, 'JUL-290');
  assert.match(result.missing.join('\n'), /no shipping verdict covers head a{40} of JUL-290/);
});

test('a verdict for an older head is red on the current head', () => {
  const result = shippingVerdict({ pull: pull(), comments: [comment(verdict({ head: OLD }))] });
  assert.equal(result.ok, false);
  assert.match(result.missing.join('\n'), /no shipping verdict covers head a{40}/);
});

test('a stale PASS does not carry over after a push', () => {
  const passed = shippingVerdict({ pull: pull(), comments: [comment(verdict())] });
  assert.equal(passed.ok, true);
  const pushed = shippingVerdict({ pull: pull({ head: { ref: 'feat/jul-290-account-status', sha: OLD } }), comments: [comment(verdict())] });
  assert.equal(pushed.ok, false);
});

test('a PASS on the current head with a PASS per criterion is green', () => {
  const result = shippingVerdict({ pull: pull(), comments: [comment(verdict())] });
  assert.deepEqual(result.missing, []);
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'PASS');
});

test('a lower case head still matches the pull request head', () => {
  const result = shippingVerdict({ pull: pull({ head: { ref: 'feat/jul-290', sha: HEAD.toUpperCase() } }), comments: [comment(verdict())] });
  assert.equal(result.ok, true);
});

test('a FAIL verdict is red and names the failed criteria', () => {
  const result = shippingVerdict({
    pull: pull(),
    comments: [comment(verdict({ verdict: 'FAIL', criteria: [{ criterion: AC2, verdict: 'FAIL', note: 'the balance did not refresh' }] }))],
  });
  assert.equal(result.ok, false);
  assert.match(result.missing.join('\n'), /the shipping verdict is FAIL on head a{40}: The balance refreshes when a card starts\.: the balance did not refresh/);
});

test('the newest verdict on the head decides, so a FAIL after a PASS is red', () => {
  const comments = [comment(verdict(), '2026-10-30T10:00:00Z', 1), comment(verdict({ verdict: 'FAIL' }), '2026-10-30T11:00:00Z', 2)];
  assert.equal(shippingVerdict({ pull: pull(), comments }).ok, false);
});

test('the newest verdict on the head decides, so a PASS after a FAIL is green', () => {
  const comments = [comment(verdict({ verdict: 'FAIL' }), '2026-10-30T10:00:00Z', 1), comment(verdict(), '2026-10-30T11:00:00Z', 2)];
  assert.equal(shippingVerdict({ pull: pull(), comments }).ok, true);
});

test('two verdicts posted at the same time are ordered by comment id', () => {
  const comments = [comment(verdict(), '2026-10-30T10:00:00Z', 1), comment(verdict({ verdict: 'FAIL' }), '2026-10-30T10:00:00Z', 9)];
  assert.equal(shippingVerdict({ pull: pull(), comments }).ok, false);
});

test('a PASS that lists no criteria is red', () => {
  const result = shippingVerdict({ pull: pull(), comments: [comment(verdict({ criteria: [] }))] });
  assert.equal(result.ok, false);
  assert.match(result.missing.join('\n'), /the PASS verdict lists no criteria/);
});

test('a PASS with one criterion not passed is red', () => {
  const result = shippingVerdict({ pull: pull(), comments: [comment(verdict({ criteria: [{ criterion: AC, verdict: 'PASS', note: 'seen' }, { criterion: AC2, verdict: 'FAIL', note: 'not seen' }] }))] });
  assert.equal(result.ok, false);
  assert.match(result.missing.join('\n'), /criterion "The balance refreshes when a card starts\." is FAIL, not PASS/);
});

test('a PASS whose criterion has no note is red', () => {
  const result = shippingVerdict({ pull: pull(), comments: [comment(verdict({ criteria: [{ criterion: AC, verdict: 'PASS' }] }))] });
  assert.equal(result.ok, false);
  assert.match(result.missing.join('\n'), /has no note saying what the verifier saw/);
});

test('the verifier cannot be the builder', () => {
  const result = shippingVerdict({ pull: pull(), comments: [comment(verdict({ verifier: 'SOL' }))] });
  assert.equal(result.ok, false);
  assert.match(result.missing.join('\n'), /the verdict's verifier is its builder \(sol\)/);
});

test('a verdict that names no builder is red closed', () => {
  const result = shippingVerdict({ pull: pull(), comments: [comment(verdict({ builder: '  ' }))] });
  assert.equal(result.ok, false);
  assert.match(result.missing.join('\n'), /names no builder/);
});

test('a verdict that names no verifier is red', () => {
  const result = shippingVerdict({ pull: pull(), comments: [comment(verdict({ verifier: undefined }))] });
  assert.equal(result.ok, false);
  assert.match(result.missing.join('\n'), /names no verifier/);
});

test('a verdict for another card is red', () => {
  const result = shippingVerdict({ pull: pull(), comments: [comment(verdict({ card: 'JUL-252' }))] });
  assert.equal(result.ok, false);
  assert.match(result.missing.join('\n'), /is for JUL-252, not JUL-290/);
});

test('an unknown verdict word is red', () => {
  const result = shippingVerdict({ pull: pull(), comments: [comment(verdict({ verdict: 'MAYBE' }))] });
  assert.equal(result.ok, false);
  assert.match(result.missing.join('\n'), /must read PASS or FAIL/);
});

test('a title naming two different cards is red', () => {
  const result = shippingVerdict({ pull: pull({ title: 'Balance (JUL-290) for JUL-276', head: { ref: 'feat/jul-290-accounts', sha: HEAD } }), comments: [comment(verdict())] });
  assert.equal(result.ok, false);
  assert.match(result.missing.join('\n'), /names more than one card \(JUL-276, JUL-290\)/);
});

test('only a fenced json block tagged with the verdict key is a verdict', () => {
  assert.equal(parseVerdictComment('Looks good to me'), null);
  assert.equal(parseVerdictComment('```json\n{"verdict":"PASS"}\n```'), null);
  assert.equal(parseVerdictComment('```json\nnot json\n```'), null);
  assert.equal(parseVerdictComment('```json\n["juliaShippingVerdict"]\n```'), null);
  assert.ok(parseVerdictComment(comment(verdict()).body));
});

test('a prose PASS in a comment does not count as a verdict', () => {
  const result = shippingVerdict({ pull: pull(), comments: [{ id: 1, createdAt: '2026-10-30T10:00:00Z', body: 'PASS, I ran it and it works' }] });
  assert.equal(result.ok, false);
});

test('the printed template is itself parsed as a verdict record once filled', () => {
  const filled = VERDICT_TEMPLATE.replace('<card>', 'JUL-290').replace('<head commit>', HEAD)
    .replace('"<model>","verifier":"<model>"', '"sol","verifier":"deepseek"')
    .replace("<the card's words>", AC).replace('<what the verifier saw>', 'ran the app');
  const record = parseVerdictComment(`\`\`\`json\n${filled}\n\`\`\``);
  assert.ok(record);
  const result = shippingVerdict({ pull: pull(), comments: [{ ...comment(record), body: `\`\`\`json\n${filled}\n\`\`\`` }] });
  assert.deepEqual(result.missing, []);
  assert.equal(result.ok, true);
});

// The pull request number an event carries, so the gate can be run by hand.
test('the pull request number comes from the flag, the event, or the ref', () => {
  assert.equal(pullNumberFor({ pull: '383' }), 383);
  assert.equal(pullNumberFor({ event: { pull_request: { number: 384 } } }), 384);
  assert.equal(pullNumberFor({ event: { issue: { number: 385 } } }), 385);
  assert.equal(pullNumberFor({ ref: 'refs/pull/386/merge' }), 386);
  assert.equal(pullNumberFor({ ref: 'refs/heads/main' }), null);
});

// An event with no pull request is the ordinary push to main, and the job
// passes there without asking GitHub anything. The repository and token are
// set but never used, because the gate returns before it makes a request.
test('the CLI passes on an event that carries no pull request', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'shipping-verdict-'));
  const event = join(directory, 'event.json');
  writeFileSync(event, JSON.stringify({ ref: 'refs/heads/main' }));
  const result = await runCli({ GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: 'toddwyder/julia-next', GITHUB_TOKEN: 'unused' });
  assert.equal(result.status, 0);
  assert.match(result.output, /PASS: this event carries no pull request, so there is no card to gate/);
});

function runCli(env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['scripts/check-shipping-verdict.mjs'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, ...env },
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('close', status => resolve({ status, output }));
  });
}
