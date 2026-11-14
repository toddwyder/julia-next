#!/usr/bin/env node
// Rewrites each font folder from Google Fonts' latin files and the family's OFL.txt.
// Rerunning it must leave `git diff` empty, which is how a reviewer proves where the files came from.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');

const FONTS = [
  { family: 'Playfair Display', axes: 'ital,wght@0,400..900;1,400..900', licence: 'ofl/playfairdisplay', into: 'app/fonts/playfair-display' },
  { family: 'Inter', axes: 'wght@100..900', licence: 'ofl/inter', into: 'app/fonts/inter' },
  { family: 'Roboto Mono', axes: 'wght@100..700', licence: 'ofl/robotomono', into: 'app/fonts/roboto-mono' },
  { family: 'Public Sans', axes: 'wght@100..900', licence: 'ofl/publicsans', into: 'dashboard/app/fonts/public-sans' },
];

// Google serves different files per user agent. This is the one next/font/google sent, so the files match what the build used before.
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36';

async function get(url, headers) {
  const res = await fetch(url, { headers });
  if (res.status !== 200) throw new Error(`${url}: status ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchFont({ family, axes, licence, into }) {
  const css = (await get(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:${axes}&display=swap`, { 'User-Agent': USER_AGENT })).toString();
  const slug = basename(into);
  const files = new Map();
  for (const [, block] of css.matchAll(/\/\* latin \*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    const style = block.match(/font-style:\s*(\w+)/)[1];
    files.set(`${slug}-latin-${style}.woff2`, await get(block.match(/src:\s*url\(([^)]+)\)/)[1]));
  }
  if (files.size === 0) throw new Error(`${family}: no latin @font-face block`);
  files.set('OFL.txt', await get(`https://raw.githubusercontent.com/google/fonts/main/${licence}/OFL.txt`));
  return files;
}

for (const font of FONTS) {
  const files = await fetchFont(font);
  const target = join(root, font.into);
  mkdirSync(target, { recursive: true });
  for (const old of readdirSync(target)) if (/\.woff2$|^(LICENSE|OFL)(\.txt)?$/.test(old)) rmSync(join(target, old));
  for (const [name, data] of files) writeFileSync(join(target, name), data);
  console.log(`${font.into}: ${[...files.keys()].join(', ')}`);
}
