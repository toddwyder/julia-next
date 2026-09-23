import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPTS_DIR, '..');

export const ROLE_NAMES = ['julia-builder', 'julia-reviewer'];

export const EXPECTED_HEADINGS = [
  '## Purpose and scope',
  '## Inputs',
  '## Preflight',
  '## Execution',
  '## Boundaries',
  '## Stop and escalate',
  '## Output contract',
  '## Verification by the controller',
  '## Reporting and cleanup',
];

/**
 * Validates that a role file contains a valid frontmatter block
 * and the exact nine headings in order.
 */
export function validateRoleFileStructure(content) {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!frontmatterMatch) {
    throw new Error('Missing or malformed frontmatter block');
  }
  const frontmatter = frontmatterMatch[1];
  if (!/^name:\s*\S+/m.test(frontmatter)) {
    throw new Error('Frontmatter missing "name" field');
  }
  if (!/^description:\s*\S+/m.test(frontmatter)) {
    throw new Error('Frontmatter missing "description" field');
  }

  const h2Headings = [...content.matchAll(/^##\s+.*$/gm)].map((m) => m[0].trim());
  if (h2Headings.length !== EXPECTED_HEADINGS.length) {
    throw new Error(
      `Expected ${EXPECTED_HEADINGS.length} headings, but found ${h2Headings.length}: ${h2Headings.join(', ')}`
    );
  }

  for (let i = 0; i < EXPECTED_HEADINGS.length; i++) {
    if (h2Headings[i] !== EXPECTED_HEADINGS[i]) {
      throw new Error(
        `Heading at index ${i} was expected to be "${EXPECTED_HEADINGS[i]}", but found "${h2Headings[i]}"`
      );
    }
  }
}

/**
 * Validates a role file on disk.
 */
export function validateRoleFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  const content = readFileSync(filePath, 'utf8');
  validateRoleFileStructure(content);
  return content;
}

/**
 * Removes a heading and its section up to the next ## heading or EOF.
 */
export function removeSection(content, heading) {
  const headingIndex = content.indexOf(heading);
  if (headingIndex === -1) {
    throw new Error(`Heading "${heading}" not found in content`);
  }
  const nextHeadingRel = content.slice(headingIndex + heading.length).search(/\n##\s+/);
  if (nextHeadingRel === -1) {
    return content.slice(0, headingIndex);
  }
  return content.slice(0, headingIndex) + content.slice(headingIndex + heading.length + nextHeadingRel + 1);
}

/**
 * Checks that every .agents/skills/... path referenced in content exists in the repo.
 */
export function checkSkillPathsExist(content, repoRoot = REPO_ROOT) {
  const matches = [...content.matchAll(/\.agents\/skills\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*/g)].map((m) => m[0]);
  for (const skillPath of matches) {
    const fullPath = resolve(repoRoot, skillPath);
    assert.ok(existsSync(fullPath), `Named skill path does not exist in repo: ${skillPath}`);
  }
  return matches;
}

for (const role of ROLE_NAMES) {
  test(`${role}: frontmatter block and nine headings are present and in order in both trees`, () => {
    const agentsPath = join(REPO_ROOT, '.agents', 'skills', role, 'SKILL.md');
    const claudePath = join(REPO_ROOT, '.claude', 'skills', role, 'SKILL.md');

    assert.ok(existsSync(agentsPath), `${agentsPath} must exist`);
    assert.ok(existsSync(claudePath), `${claudePath} must exist`);

    const agentsContent = readFileSync(agentsPath, 'utf8');
    const claudeContent = readFileSync(claudePath, 'utf8');

    validateRoleFileStructure(agentsContent);
    validateRoleFileStructure(claudeContent);
  });

  test(`${role}: .agents and .claude copies are identical`, () => {
    const agentsPath = join(REPO_ROOT, '.agents', 'skills', role, 'SKILL.md');
    const claudePath = join(REPO_ROOT, '.claude', 'skills', role, 'SKILL.md');

    assert.ok(existsSync(agentsPath), `${agentsPath} must exist`);
    assert.ok(existsSync(claudePath), `${claudePath} must exist`);

    const agentsContent = readFileSync(agentsPath, 'utf8');
    const claudeContent = readFileSync(claudePath, 'utf8');

    assert.strictEqual(
      agentsContent,
      claudeContent,
      `${role} copy under .agents and .claude must be byte-for-byte identical`
    );
  });

  test(`${role}: every .agents/skills/... path named in the file exists in the repo`, () => {
    for (const root of ['.agents', '.claude']) {
      const filePath = join(REPO_ROOT, root, 'skills', role, 'SKILL.md');
      assert.ok(existsSync(filePath), `${filePath} must exist`);
      const content = readFileSync(filePath, 'utf8');
      const foundPaths = checkSkillPathsExist(content, REPO_ROOT);

      if (role === 'julia-builder') {
        assert.ok(
          foundPaths.includes('.agents/skills/implement/SKILL.md'),
          `julia-builder in ${root} must name .agents/skills/implement/SKILL.md`
        );
        assert.ok(
          foundPaths.includes('.agents/skills/tdd/SKILL.md'),
          `julia-builder in ${root} must name .agents/skills/tdd/SKILL.md`
        );
        assert.ok(
          foundPaths.includes('.agents/skills/code-review/SKILL.md'),
          `julia-builder in ${root} must name .agents/skills/code-review/SKILL.md`
        );
      }
    }
  });

  test(`${role}: planted copy with one section removed fails validation (in memory and temp folder)`, () => {
    for (const root of ['.agents', '.claude']) {
      const filePath = join(REPO_ROOT, root, 'skills', role, 'SKILL.md');
      assert.ok(existsSync(filePath), `${filePath} must exist`);
      const content = readFileSync(filePath, 'utf8');

      // Test in-memory: removing any of the required headings must fail validation
      for (const heading of EXPECTED_HEADINGS) {
        assert.ok(content.includes(heading), `${heading} must be present in ${filePath}`);
        const planted = removeSection(content, heading);
        assert.throws(
          () => validateRoleFileStructure(planted),
          /Expected 9 headings|Heading at index/,
          `Planted copy with section "${heading}" removed from ${filePath} must be rejected by heading check`
        );
      }

      // Test with temp folder file
      const tempDir = mkdtempSync(join(tmpdir(), `role-test-${role}-${root.replace('.', '')}-`));
      try {
        const plantedHeading = EXPECTED_HEADINGS[2]; // ## Preflight
        const planted = removeSection(content, plantedHeading);
        const tempFile = join(tempDir, 'SKILL.md');
        writeFileSync(tempFile, planted, 'utf8');
        assert.throws(
          () => validateRoleFile(tempFile),
          /Expected 9 headings|Heading at index/,
          `Planted file on disk missing "${plantedHeading}" must be rejected`
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  test(`${role}: does not mention a progress file, heartbeats, or a five-minute stall rule (AC1)`, () => {
    for (const root of ['.agents', '.claude']) {
      const filePath = join(REPO_ROOT, root, 'skills', role, 'SKILL.md');
      assert.ok(existsSync(filePath), `${filePath} must exist`);
      const content = readFileSync(filePath, 'utf8');

      assert.doesNotMatch(content, /progress[- ]file/i, `${role} in ${root} must not mention a progress file`);
      assert.doesNotMatch(content, /heartbeat/i, `${role} in ${root} must not mention heartbeats`);
      assert.doesNotMatch(content, /five[- ]minute|5[- ]minute/i, `${role} in ${root} must not mention a five-minute stall rule`);
      assert.doesNotMatch(content, /\bstall\b/i, `${role} in ${root} must not mention stall`);
    }
  });

  test(`${role}: states final-output report format with every field the graph reads (AC2)`, () => {
    for (const root of ['.agents', '.claude']) {
      const filePath = join(REPO_ROOT, root, 'skills', role, 'SKILL.md');
      assert.ok(existsSync(filePath), `${filePath} must exist`);
      const content = readFileSync(filePath, 'utf8');

      assert.match(content, /final output/i, `${role} in ${root} must state reporting in final output`);

      if (role === 'julia-builder') {
        assert.match(content, /"outcome"/, `${role} in ${root} must name "outcome" field`);
        assert.match(content, /"summary"/, `${role} in ${root} must name "summary" field`);
        assert.match(content, /"acceptance"/, `${role} in ${root} must name "acceptance" field`);
        assert.match(content, /"uat"/, `${role} in ${root} must name "uat" field`);
      } else if (role === 'julia-reviewer') {
        assert.match(content, /"verdict"/, `${role} in ${root} must name "verdict" field`);
        assert.match(content, /"criteria"/, `${role} in ${root} must name "criteria" field`);
      }
    }
  });
}

