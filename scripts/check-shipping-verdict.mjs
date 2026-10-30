// The shipping verdict gate. A card pull request may not go green in CI until
// an agent that did not write the code has run the change the way Todd uses it
// and posted a PASS for every acceptance criterion, against the head commit the
// pull request carries now.
//
// The verdict is a pull request comment holding one fenced json block:
//
//   {"juliaShippingVerdict": 1,
//    "card": "JUL-290",
//    "head": "<the 40 character head commit the verifier ran>",
//    "verdict": "PASS" | "FAIL",
//    "builder": "<the model that wrote the code>",
//    "verifier": "<the model that ran the change>",
//    "criteria": [{"criterion": "<the card's words>", "verdict": "PASS" | "FAIL", "note": "<what it saw>"}]}
//
// The gate refuses, naming every gap, unless a verdict comment covers the
// pull request's current head, names the pull request's card, names a verifier
// that differs from the builder, and (for a PASS) has a PASS for every
// criterion it lists. A FAIL verdict is a red gate. A PASS against an older
// head is not a verdict for this head: CI re-reads the pull request and its
// comments on every run, so a push after a PASS turns the gate red again.
//
// A pull request is a card pull request when it names a card: in its title,
// else in a lone "Card: JUL-n" line of its body, else in a `runner/card-<n>`
// branch, else in its branch name. Engineering pull requests name no card and
// the gate passes them without a verdict. A plan, retro or correction branch
// (plan/, retro/, correct/) names the card it is about without delivering it,
// so the gate passes it: a plan for JUL-276 cannot satisfy JUL-276's
// acceptance criteria.
//
// What the gate cannot judge from GitHub: whether the verdict lists every
// criterion the card has, and whether the verifier really differs from the
// builder. GitHub carries one account for the machine (toddwyder), so both are
// declared inside the record and judged as declared. The evidence review
// (JUL-252) reads the card and holds the completeness line.
//
// CLI: node scripts/check-shipping-verdict.mjs [--pull <number>] [--repository <owner/name>]
//   exit 0 and "PASS", or exit 1 and one "MISSING: ..." line per gap.
//   GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL and GITHUB_EVENT_PATH are
//   read when the matching flag is absent.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERDICT_KEY = 'juliaShippingVerdict';
export const VERDICT_TEMPLATE = `{"${VERDICT_KEY}":1,"card":"<card>","head":"<head commit>","verdict":"PASS","builder":"<model>","verifier":"<model>","criteria":[{"criterion":"<the card's words>","verdict":"PASS","note":"<what the verifier saw>"}]}`;

const CARD = /\bJUL-\d+\b/gi;
const CARD_LINE = /^[ \t]*card[ \t]*:[ \t]*(JUL-\d+)[ \t]*$/gim;
const CARD_BRANCH = /^runner\/card-(\d+)$/i;
// Planning, retrospective and correction pull requests carry a card's id
// without delivering the card: a plan for JUL-276 cannot satisfy JUL-276's
// acceptance criteria, and a retro runs after the card is complete. Their
// branches say so, and the gate leaves them alone.
const PAPER_BRANCH = /^(plan|retro|correct)\//i;

function text(value) {
  return typeof value === 'string' ? value : '';
}

// The pull request's own card. The title comes first, because that is where
// the pull request states what it delivers; then a lone "Card: JUL-n" line of
// the body; then a `runner/card-<n>` branch; then a JUL id in the branch name.
// Only the first source is read, so a slice pull request titled (JUL-290) on a
// branch cut from JUL-276's work stays JUL-290, and a body that mentions
// another card in prose says nothing about this one. A title naming two cards
// is a real ambiguity, so both are returned and the gate refuses them. A plan,
// retro or correction branch names a card without delivering it, so it names
// no card here. A pull request that names no card is not a card pull request
// and the gate has nothing to judge.
export function pullCards(pull) {
  const ref = text(pull?.head?.ref);
  if (PAPER_BRANCH.test(ref)) return [];
  const title = [...text(pull?.title).matchAll(CARD)].map(match => match[0]);
  const declared = [...text(pull?.body).matchAll(CARD_LINE)].map(match => match[1]);
  for (const found of [title, declared]) {
    if (found.length) return [...new Set(found.map(card => card.toUpperCase()))].sort();
  }
  const branch = ref.match(CARD_BRANCH);
  if (branch) return [`JUL-${branch[1]}`];
  const found = [...ref.matchAll(CARD)].map(match => match[0].toUpperCase());
  return [...new Set(found)].sort();
}

// A verdict comment is the first fenced json block in the comment body. A
// comment that carries no such block, or a block that is not an object tagged
// with the verdict key, is not a verdict and does not count.
export function parseVerdictComment(body) {
  const block = text(body).match(/```json[ \t]*\r?\n([\s\S]*?)```/i);
  if (!block) return null;
  let record;
  try {
    record = JSON.parse(block[1]);
  } catch {
    return null;
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  if (record[VERDICT_KEY] !== 1) return null;
  return record;
}

function newest(verdicts) {
  const time = verdict => text(verdict?.createdAt);
  const number = verdict => Number(verdict?.id ?? 0);
  return [...verdicts].sort((a, b) => {
    const byTime = time(b).localeCompare(time(a));
    return byTime !== 0 ? byTime : number(b) - number(a);
  })[0];
}

function named(value) {
  return text(value).trim();
}

// The verdict that decides this pull request, judged on the record the gate can
// read. Returns { ok, card, head, verdict, missing }.
export function shippingVerdict({ pull, comments }) {
  const head = text(pull?.head?.sha).toLowerCase();
  const cards = pullCards(pull);
  if (!cards.length) return { ok: true, card: null, head, verdict: null, missing: [] };
  if (cards.length > 1) {
    return { ok: false, card: null, head, verdict: null, missing: [`the pull request names more than one card (${cards.join(', ')}); a card pull request names exactly one`] };
  }
  const card = cards[0];
  // Each verdict keeps the comment it arrived on, so two verdicts are ordered by
  // when they were posted and by comment id when they claim the same moment.
  const records = (comments ?? [])
    .map(comment => ({ record: parseVerdictComment(comment?.body), createdAt: comment?.createdAt, id: comment?.id }))
    .filter(verdict => verdict.record);
  const onHead = records.filter(verdict => text(verdict.record.head).toLowerCase() === head);
  if (!onHead.length) {
    return {
      ok: false, card, head, verdict: null,
      missing: [`no shipping verdict covers head ${head || '(the pull request has no head commit)'} of ${card}; an agent that did not write the code must run the change and post its verbatim verdict per criterion`],
    };
  }
  const record = newest(onHead).record;
  const verdict = text(record.verdict).toUpperCase();
  const missing = [];
  if (text(record.card).toUpperCase() !== card) missing.push(`the newest verdict on this head is for ${text(record.card) || 'no card'}, not ${card}`);
  const builder = named(record.builder);
  const verifier = named(record.verifier);
  if (!builder) missing.push('the verdict names no builder, so the gate cannot tell that its verifier did not write the code');
  if (!verifier) missing.push('the verdict names no verifier');
  if (builder && verifier && builder.toLowerCase() === verifier.toLowerCase()) missing.push(`the verdict's verifier is its builder (${builder}); an agent that wrote the code cannot verify it`);
  if (verdict === 'FAIL') {
    const failed = (Array.isArray(record.criteria) ? record.criteria : [])
      .filter(item => text(item?.verdict).toUpperCase() !== 'PASS')
      .map(item => `${named(item?.criterion) || '(criterion unnamed)'}: ${named(item?.note) || 'no note'}`);
    missing.push(`the shipping verdict is FAIL on head ${head}${failed.length ? `: ${failed.join('; ')}` : ''}`);
  } else if (verdict !== 'PASS') {
    missing.push(`the newest verdict on this head reads "${text(record.verdict) || '(empty)'}"; it must read PASS or FAIL`);
  } else {
    const criteria = Array.isArray(record.criteria) ? record.criteria : [];
    if (!criteria.length) missing.push('the PASS verdict lists no criteria; it must carry the verbatim verdict for every acceptance criterion of the card');
    for (const [index, item] of criteria.entries()) {
      const name = named(item?.criterion) || `criterion ${index + 1}`;
      const status = text(item?.verdict).toUpperCase();
      if (status !== 'PASS') missing.push(`${card} criterion "${name}" is ${status || 'unstated'}, not PASS`);
      if (!named(item?.note)) missing.push(`${card} criterion "${name}" has no note saying what the verifier saw`);
    }
  }
  return { ok: missing.length === 0, card, head, verdict: verdict || null, missing };
}

async function github(path, { apiUrl, repository, token }) {
  const response = await fetch(`${apiUrl}/repos/${repository}/${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub ${path} request failed with ${response.status}`);
  return response.json();
}

async function githubPages(path, { apiUrl, repository, token }) {
  const values = [];
  for (let page = 1; ; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const valuesOnPage = await github(`${path}${separator}per_page=100&page=${page}`, { apiUrl, repository, token });
    values.push(...valuesOnPage);
    if (valuesOnPage.length < 100) return values;
  }
}

export function pullNumberFor({ event, pull, ref }) {
  if (pull) return Number(pull);
  const number = event?.pull_request?.number ?? event?.issue?.number;
  if (number) return Number(number);
  const fromRef = text(ref).match(/^refs\/pull\/(\d+)\//);
  return fromRef ? Number(fromRef[1]) : null;
}

export async function checkShippingVerdict({
  apiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com',
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GITHUB_TOKEN,
  pull,
  number = pullNumberFor({
    event: process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : null,
    pull,
    ref: process.env.GITHUB_REF,
  }),
} = {}) {
  if (!repository || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  if (!number) return { ok: true, card: null, head: null, verdict: null, missing: [], skipped: 'this event carries no pull request' };
  const [request, comments] = await Promise.all([
    github(`pulls/${number}`, { apiUrl, repository, token }),
    githubPages(`issues/${number}/comments`, { apiUrl, repository, token }),
  ]);
  const result = shippingVerdict({
    pull: request,
    comments: comments.map(comment => ({ body: comment.body, id: comment.id, createdAt: comment.created_at })),
  });
  return { ...result, number };
}

function main(argv) {
  const at = flag => { const index = argv.indexOf(flag); return index > -1 ? argv[index + 1] : null; };
  return checkShippingVerdict({ repository: at('--repository') ?? undefined, pull: at('--pull') ?? undefined }).then(result => {
    if (result.ok) {
      if (result.skipped) console.log(`PASS: ${result.skipped}, so there is no card to gate`);
      else if (result.card) console.log(`PASS: ${result.card} has a shipping verdict on head ${result.head}`);
      else console.log('PASS: this pull request names no card');
      return 0;
    }
    for (const gap of result.missing) console.log(`MISSING: ${gap}`);
    console.log('A verdict is a comment on the pull request holding this json block, with one criteria entry per acceptance criterion of the card:');
    console.log(VERDICT_TEMPLATE);
    return 1;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
