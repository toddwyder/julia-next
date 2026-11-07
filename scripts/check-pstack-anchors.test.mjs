import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ANCHORS_FILE, checkAnchors, newPstackText, readAnchors } from './check-pstack-anchors.mjs';

const ROWS = [
  { rule: 'Each role runs on its explicit model.', file: '.agents/skills/poteto-mode/SKILL.md', anchor: 'explicit model per role', enforcedBy: 'gate' },
  { rule: 'Subagents are fresh per delegation.', file: '.agents/skills/poteto-mode/SKILL.md', anchor: 'Fresh subagents by default.', enforcedBy: 'stock Mastra' },
];
const SOURCE = 'Commit: 6c75f4e67546c2ddbf9634734c1e3ebbea34861a\nInstalled: 3 November 2026\n';

const SKILL = [
  '# Poteto mode',
  '',
  '## Subagents',
  '',
  '**Defaults for every `Task` call.** Role models cover each role, explicit model per role.',
  '',
  '**Fresh subagents by default.** A new agent per round.',
  '',
].join('\n');

function write(path, text) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

function workspace(body) {
  const root = mkdtempSync(join(tmpdir(), 'pstack-anchors-test-'));
  try {
    write(join(root, ANCHORS_FILE), JSON.stringify({ anchors: ROWS }));
    write(join(root, ROWS[0].file), SKILL);
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function repository(body) {
  const root = mkdtempSync(join(tmpdir(), 'pstack-anchors-git-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', ...args], { cwd: root, encoding: 'utf8' });
  try {
    write(join(root, ANCHORS_FILE), JSON.stringify({ anchors: ROWS }));
    write(join(root, ROWS[0].file), SKILL);
    write(join(root, '.agents/skills/PSTACK-SOURCE.md'), SOURCE);
    git('init', '-q');
    git('add', '-A');
    git('commit', '-qm', 'base');
    return body(root, git);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('readAnchors needs every field on every row', () => {
  workspace(root => {
    assert.equal(readAnchors(root).length, ROWS.length);
    write(join(root, ANCHORS_FILE), JSON.stringify({ anchors: [{ ...ROWS[0], anchor: '' }] }));
    assert.throws(() => readAnchors(root), /non-empty "anchor"/);
    write(join(root, ANCHORS_FILE), JSON.stringify({ anchors: [] }));
    assert.throws(() => readAnchors(root), /non-empty "anchors" list/);
  });
});

test('checkAnchors passes an untouched tree and fails a missing or doubled anchor by rule', () => {
  workspace(root => {
    assert.deepEqual(checkAnchors(ROWS, root), []);

    write(join(root, ROWS[0].file), SKILL.replace('explicit model per role', 'explicit model for each role'));
    assert.deepEqual(checkAnchors(ROWS, root), [
      'anchor is missing from .agents/skills/poteto-mode/SKILL.md: "explicit model per role" (rule: Each role runs on its explicit model.)',
    ]);

    write(join(root, ROWS[0].file), `${SKILL}Fresh subagents by default. Twice.\n`);
    assert.deepEqual(checkAnchors(ROWS, root), [
      'anchor appears 2 times in .agents/skills/poteto-mode/SKILL.md: "Fresh subagents by default." (rule: Subagents are fresh per delegation.)',
    ]);
  });
});

test('checkAnchors passes an anchor moved to another line, unchanged', () => {
  workspace(root => {
    const moved = SKILL.replace('**Fresh subagents by default.** A new agent per round.', 'A new agent per round. Fresh subagents by default.');
    write(join(root, ROWS[0].file), `# Poteto mode\n\n## Core\n\n${moved.split('## Subagents')[1]}`);
    assert.deepEqual(checkAnchors(ROWS, root), []);
  });
});

test('checkAnchors names a file that is gone', () => {
  workspace(root => {
    rmSync(join(root, ROWS[0].file));
    assert.deepEqual(checkAnchors(ROWS, root), [
      'anchor file is missing: .agents/skills/poteto-mode/SKILL.md (rule: Each role runs on its explicit model.)',
      'anchor file is missing: .agents/skills/poteto-mode/SKILL.md (rule: Subagents are fresh per delegation.)',
    ]);
  });
});

test('newPstackText lists an added line under its heading', () => {
  repository((root, git) => {
    write(join(root, ROWS[0].file), `${SKILL}\nA new sentence about budget pacing.\n`);
    write(join(root, '.agents/skills/PSTACK-SOURCE.md'), SOURCE.replace('3 November', '4 November'));
    git('commit', '-qam', 'head');
    const { text, sections } = newPstackText({ root, base: 'HEAD~1', anchors: readAnchors(root) });
    assert.deepEqual(sections, [{ file: '.agents/skills/poteto-mode/SKILL.md', groups: [{ heading: '## Subagents', lines: ['A new sentence about budget pacing.'] }] }]);
    assert.match(text, /^<!-- pstack-anchors -->/);
    assert.match(text, /Under `## Subagents`/);
    assert.match(text, /- A new sentence about budget pacing\./);
  });
});

test('newPstackText lists added playbook text under its ### heading', () => {
  repository((root, git) => {
    const playbook = '.agents/skills/poteto-mode/playbooks/feature.md';
    write(join(root, playbook), '### Feature\n\nOld line.\n');
    git('add', '-A');
    git('commit', '-qm', 'playbook');
    write(join(root, playbook), '### Feature\n\nOld line.\nA new playbook sentence.\n');
    write(join(root, '.agents/skills/PSTACK-SOURCE.md'), SOURCE.replace('3 November', '4 November'));
    git('commit', '-qam', 'head');
    const { sections } = newPstackText({ root, base: 'HEAD~1', anchors: readAnchors(root) });
    assert.deepEqual(sections, [{ file: playbook, groups: [{ heading: '### Feature', lines: ['A new playbook sentence.'] }] }]);
  });
});

test('newPstackText reports nothing when PSTACK-SOURCE.md is untouched', () => {
  repository((root, git) => {
    write(join(root, ROWS[0].file), `${SKILL}\nA new sentence.\n`);
    git('commit', '-qam', 'head');
    assert.equal(newPstackText({ root, base: 'HEAD~1', anchors: readAnchors(root) }).text, '');
  });
});

test('newPstackText skips a line an anchor already covers', () => {
  repository((root, git) => {
    write(join(root, ROWS[0].file), `${SKILL}\nEditorial text that repeats explicit model per role.\n`);
    write(join(root, '.agents/skills/PSTACK-SOURCE.md'), SOURCE.replace('3 November', '4 November'));
    git('commit', '-qam', 'head');
    assert.equal(newPstackText({ root, base: 'HEAD~1', anchors: readAnchors(root) }).text, '');
  });
});

test('the checked-in anchors hold in this tree', () => {
  const root = resolve(import.meta.dirname, '..');
  assert.deepEqual(checkAnchors(readAnchors(root), root), []);
});
