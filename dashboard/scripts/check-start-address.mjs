#!/usr/bin/env node
// Answers one question before an address is handed to Todd: does this address
// really serve the Start screen? The dashboard is its own Next app in
// `dashboard/`, while Vercel builds the cookbook at the repository root, so a
// Vercel preview answers 404 for `/start/<card>` inside the cookbook shell.
// Saying "the lanes passed" proves nothing about an address nobody opened.
import { fileURLToPath } from 'node:url';

const MUST_SHOW = [
  'Start screen',
  'Main session',
  'Shipping',
  'Effort',
  'Small',
  'Medium',
  'Large',
  'Unlimited',
  'How hard the models think',
];

const NOT_THE_DASHBOARD = [
  'This page could not be found',
  '<title>Login – Vercel</title>',
  'Vercel Authentication',
];

export function checkStartHtml(html, url = 'this address') {
  const body = String(html ?? '');
  const missing = MUST_SHOW.filter(mark => !body.includes(mark));
  // Next.js embeds its 404 template in every page, so the marks must decide
  // first and the 404/login wording only explains a page that lacks them.
  if (!missing.length) return { ok: true };
  const wrong = NOT_THE_DASHBOARD.find(mark => body.includes(mark));
  if (wrong) {
    return { ok: false, problem: `${url} is not the Julia dashboard: the page says ${JSON.stringify(wrong)}. Vercel builds the cookbook at the repository root, which has no /start route; point this at the dashboard server instead.` };
  }
  return { ok: false, problem: `${url} answered, but the page is missing ${missing.map(x => JSON.stringify(x)).join(', ')}, so it is not the Start screen.` };
}

async function main(argv) {
  const url = argv[2];
  if (!url) {
    process.stderr.write('usage: check-start-address.mjs <url of a Start screen, e.g. http://host:4314/start/JUL-279>\n');
    return 2;
  }
  let response;
  try {
    response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
  } catch (error) {
    process.stderr.write(`FAIL ${url} could not be reached: ${error.message}\n`);
    return 1;
  }
  const html = await response.text();
  const where = response.redirected ? `${url} (landed on ${response.url})` : url;
  if (response.status !== 200) {
    process.stderr.write(`FAIL ${where} answered HTTP ${response.status}.\n`);
    return 1;
  }
  const verdict = checkStartHtml(html, where);
  if (!verdict.ok) {
    process.stderr.write(`FAIL ${verdict.problem}\n`);
    return 1;
  }
  process.stdout.write(`OK ${where} serves the Start screen.\n`);
  return 0;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) process.exit(await main(process.argv));
