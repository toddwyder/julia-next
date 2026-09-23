// acceptance-check.mjs -- JUL-81's "acceptance check": a plain script, no AI,
// that answers one question -- is all the evidence present? (Todd, 23 Sep,
// after JUL-92 reached UAT with none of the evidence its UAT plan promised.)
//
// It reads the card's own description for the two lists it promises:
//   * the ACCEPTANCE CRITERIA -- every checkbox line under an "Acceptance
//     criteria" heading (a `##` heading or a bold `**Acceptance criteria:**`
//     line), each given an id AC1, AC2, ... in order. A struck-through line
//     (`~~...~~`) was taken off the card and is not a criterion.
//   * the UAT PLAN -- every numbered item under the `## UAT plan` heading, each
//     given an id UAT1, UAT2, ... by its own number.
//
// and it refuses, naming every gap, unless:
//   * every criterion has the BUILDER's evidence and the REVIEWER's verdict
//     "met", each entry matched to the criterion by its id AND by its words
//     (so an answer about a different criterion under the right id is refused);
//   * every UAT-plan item has the builder's written answer.
// It judges presence, never truth: whether the evidence is right is the
// reviewer's job, and the reviewer answers per criterion, by name.
//
// The same module also checks the LIVE card right before the UAT move
// (`checkCardForUat`): every criterion box ticked, and one evidence comment
// that carries every UAT-plan item. The controller moves a card to UAT only
// when that passes.
//
// CLI: node scripts/acceptance-check.mjs --description <file> --evidence <file>
//   <evidence> is JSON: { "builder": <builder answer>, "reviewer": <reviewer answer> }
//   exit 0 and "PASS", or exit 1 and one "MISSING: ..." line per gap.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKBOX = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/;
const ACCEPTANCE_HEADING = /^\s*(#{1,6})?\s*\**\s*acceptance criteria\s*:?\s*\**\s*:?\s*$/i;
const UAT_HEADING = /^[ \t]*##[ \t]+UAT plan[ \t]*$/i;
const HEADING = /^\s*(#{1,6})\s/;

// A section ends only at a heading of its own level or higher. A bold label or
// a deeper heading inside it (`**Security:**`, `### More`) does NOT end it: an
// item after one must still be required (PR #106 review, finding 1). A section
// opened by a bold label ends at any heading. Erring this way can only require
// more, never less.
function endsSection(line, level) {
  const heading = HEADING.exec(line);
  return Boolean(heading) && heading[1].length <= level;
}

// Markdown, links and punctuation out; words kept. Used only to compare.
export function normalize(text) {
  return String(text ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~>#]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

export function parseAcceptanceCriteria(description) {
  const lines = String(description ?? '').split(/\n/);
  const criteria = [];
  let level = null; // null: outside the section
  lines.forEach((raw, index) => {
    const line = raw.replace(/\r$/, '');
    const opening = ACCEPTANCE_HEADING.exec(line);
    if (opening) { level = opening[1] ? opening[1].length : 6; return; }
    if (level === null) return;
    if (endsSection(line, level)) { level = null; return; }
    const box = CHECKBOX.exec(line);
    if (!box) return;
    const text = box[2].trim();
    if (text.startsWith('~~')) return;
    criteria.push({ id: `AC${criteria.length + 1}`, text, ticked: box[1] !== ' ', index });
  });
  return criteria;
}

export function parseUatPlan(description) {
  const lines = String(description ?? '').split(/\r?\n/);
  const items = [];
  let inside = false;
  for (const line of lines) {
    if (UAT_HEADING.test(line)) { inside = true; continue; }
    if (!inside) continue;
    if (endsSection(line, 2)) break;
    // Top-level numbered items only (an indented sub-step is part of its item),
    // numbered in order, so a repeated number cannot hide an item (PR #106
    // review, finding 5).
    const numbered = /^(\d+)\.\s+(.*)$/.exec(line.replace(/\r$/, ''));
    if (!numbered) continue;
    const text = numbered[2].trim();
    const bold = /^\*\*([^*]+?)\s*:?\s*\*\*/.exec(text);
    items.push({ id: `UAT${items.length + 1}`, name: (bold ? bold[1] : text).replace(/:$/, '').trim(), text });
  }
  return items;
}

// The lists as a worker is shown them: the id, then the exact words to echo.
export function evidenceListsForBrief(description) {
  const criteria = parseAcceptanceCriteria(description);
  const uat = parseUatPlan(description);
  return [
    '## Acceptance criteria, by id',
    '',
    ...(criteria.length ? criteria.map((c) => `- ${c.id}: ${c.text}`) : ['(none found on the card)']),
    '',
    '## UAT plan items, by id',
    '',
    ...(uat.length ? uat.map((u) => `- ${u.id}: ${u.name}`) : ['(none found on the card)']),
    '',
  ].join('\n');
}

// Does an answer entry name this criterion? By id, and by ALL its words: the
// entry's `criterion` must carry the criterion's whole text (markdown, case and
// punctuation aside), so two criteria that start alike cannot stand in for each
// other (PR #106 review, finding 2).
export function namesCriterion(entry, criterion) {
  if (!entry || String(entry.id ?? '').toUpperCase() !== criterion.id) return false;
  const want = normalize(criterion.text);
  return Boolean(want) && normalize(entry.criterion).includes(want);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// THE CHECK, on the answers, before anything is merged.
export function checkEvidence({ description, builder, reviewer }) {
  const criteria = parseAcceptanceCriteria(description);
  const uat = parseUatPlan(description);
  const missing = [];
  if (!criteria.length) missing.push('the card lists no acceptance criteria, so there is nothing to accept against');
  if (!uat.length) missing.push('the card\'s UAT plan lists no numbered items, so there is nothing to hand Todd');

  const builderAc = Array.isArray(builder?.acceptance) ? builder.acceptance : [];
  const reviewerAc = Array.isArray(reviewer?.criteria) ? reviewer.criteria : [];
  const builderUat = Array.isArray(builder?.uat) ? builder.uat : [];
  for (const criterion of criteria) {
    const label = `${criterion.id} ("${criterion.text.slice(0, 80)}")`;
    const built = builderAc.find((entry) => namesCriterion(entry, criterion));
    if (!built) missing.push(`${label}: the builder gave no evidence naming it`);
    else if (!nonEmpty(built.evidence)) missing.push(`${label}: the builder named it but gave no evidence`);
    const checked = reviewerAc.find((entry) => namesCriterion(entry, criterion));
    if (!checked) missing.push(`${label}: the reviewer did not check it by name`);
    else if (checked.verdict !== 'met') missing.push(`${label}: the reviewer found it ${JSON.stringify(checked.verdict ?? null)}, not "met"${nonEmpty(checked.how) ? ` -- ${checked.how.trim()}` : ''}`);
    else if (!nonEmpty(checked.how)) missing.push(`${label}: the reviewer said "met" but not how it checked`);
  }
  for (const item of uat) {
    const answer = builderUat.find((entry) => String(entry?.id ?? '').toUpperCase() === item.id);
    if (!answer || !nonEmpty(answer.text)) missing.push(`${item.id} ("${item.name}"): the UAT plan promises it and the builder wrote nothing for it`);
  }
  return { ok: missing.length === 0, missing, criteria, uat };
}

// The one evidence comment the controller posts before the UAT move.
export const EVIDENCE_MARKER = 'UAT evidence (the acceptance check passed)';

export function evidenceCommentBody({ card, check, builder, reviewer }) {
  const lines = [`**${card.identifier}: ${EVIDENCE_MARKER}.** Every acceptance criterion has the builder's evidence and the reviewer's "met", and every UAT-plan item is answered.`, ''];
  lines.push('**The UAT plan**', '');
  for (const item of check.uat) {
    const answer = builder.uat.find((entry) => String(entry.id).toUpperCase() === item.id);
    lines.push(`**${item.id}. ${item.name}**`, '', answer.text.trim(), '');
  }
  lines.push('**The acceptance criteria**', '');
  for (const criterion of check.criteria) {
    const built = builder.acceptance.find((entry) => namesCriterion(entry, criterion));
    const checked = reviewer.criteria.find((entry) => namesCriterion(entry, criterion));
    lines.push(`- **${criterion.id}: ${criterion.text}**`, `  - Evidence (builder): ${built.evidence.trim()}`, `  - Checked (reviewer): met -- ${checked.how.trim()}`);
  }
  return lines.join('\n');
}

// Tick every open criterion box in the description, and nothing else.
// By line position, never by text, so a same-worded box in another section is
// left alone (PR #106 review, finding 4).
export function tickCriteria(description) {
  const open = new Set(parseAcceptanceCriteria(description).filter((c) => !c.ticked).map((c) => c.index));
  return String(description ?? '').split(/\n/).map((line, index) => (
    open.has(index) ? line.replace(/\[ \]/, '[x]') : line
  )).join('\n');
}

// THE GUARD, on the live card, right before the UAT move.
export function checkCardForUat({ description, comments = [] }) {
  const criteria = parseAcceptanceCriteria(description);
  const uat = parseUatPlan(description);
  const missing = [];
  if (!criteria.length) missing.push('the card lists no acceptance criteria');
  if (!uat.length) missing.push('the card\'s UAT plan lists no numbered items');
  for (const criterion of criteria.filter((c) => !c.ticked)) missing.push(`${criterion.id} ("${criterion.text.slice(0, 80)}") is not ticked`);
  // The NEWEST evidence comment: a card carried twice is judged on this carry's
  // evidence, not an older one (PR #106 review, finding 3).
  const evidence = comments.map((c) => String(c?.body ?? '')).filter((body) => body.includes(EVIDENCE_MARKER)).at(-1);
  if (!evidence) missing.push('no evidence comment is on the card');
  else {
    for (const item of uat) {
      if (!evidence.includes(`**${item.id}. ${item.name}**`)) missing.push(`the evidence comment has nothing for ${item.id} ("${item.name}")`);
    }
  }
  return { ok: missing.length === 0, missing };
}

function main(argv) {
  const at = (flag) => { const i = argv.indexOf(flag); return i > -1 ? argv[i + 1] : null; };
  const descriptionPath = at('--description');
  const evidencePath = at('--evidence');
  if (!descriptionPath || !evidencePath) {
    console.error('usage: node scripts/acceptance-check.mjs --description <file> --evidence <file>');
    return 2;
  }
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const result = checkEvidence({ description: readFileSync(descriptionPath, 'utf8'), builder: evidence.builder, reviewer: evidence.reviewer });
  if (result.ok) { console.log('PASS'); return 0; }
  for (const gap of result.missing) console.log(`MISSING: ${gap}`);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
