// Captures Library, Enter a Recipe and Recipe on live Julia and on a julia-next
// build at the same width and 2x pixel density, then writes full-size
// comparisons with live on the left. Nothing is scaled; long pages are split
// into sections.
// Usage: node side-by-side.mjs <julia-next-url> <out-dir> [live-url]
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [base, out, live = 'https://julia-mu-green.vercel.app'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const WIDTH = 900;
const SCALE = 2;
const SECTION = 1000;
const MAX_SECTIONS = 3;

const LIBRARY = [
  'Sheet-Pan Caponata With Cod',
  'Crispy Tofu With Peanut Sauce',
  'Sicilian-Style Baked Cod',
  'Eggplant Fatteh',
  'Basil and Tomato Fried Rice',
  'Homemade Artisan Crackers',
];
const CRACKERS = JSON.parse(readFileSync(new URL('./side-by-side-crackers.json', import.meta.url), 'utf8'));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: WIDTH, height: SECTION }, deviceScaleFactor: SCALE });
const page = await context.newPage();

await page.goto(`${base}/`);
await page.evaluate(() => window.localStorage.clear());
let crackers = '';
for (const title of LIBRARY) {
  const isCrackers = title === 'Homemade Artisan Crackers';
  await page.goto(`${base}/recipes/new`);
  await page.getByLabel('Recipe Title').fill(title);
  await page.getByLabel('Ingredients').fill(isCrackers ? CRACKERS.ingredients : '1 cod fillet');
  await page.getByLabel('Instructions').fill(isCrackers ? CRACKERS.steps : 'Bake.');
  await page.getByRole('button', { name: 'Save Recipe' }).click();
  await page.waitForURL(/\/recipes\/(?!new$)[^/]+$/);
  if (isCrackers) crackers = page.url();
}

const screens = [
  { name: '01-library', title: 'Library', live: `${live}/`, ours: `${base}/recipes`, ready: 'Homemade Artisan Crackers' },
  { name: '11-manual-entry', title: 'Enter a Recipe', live: `${live}/new`, ours: `${base}/recipes/new`, ready: 'Enter a Recipe' },
  { name: '07-recipe-detail', title: 'Recipe', live: `${live}/recipes/07f89a01-9422-43f8-81f1-eb42adb771b1`, ours: crackers, ready: 'Preparation' },
];

async function capture(url, ready, path) {
  await page.goto(url, { waitUntil: 'load' });
  await page.getByText(ready).first().waitFor({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  await page.screenshot({ path, fullPage: true });
  return page.evaluate(() => document.documentElement.scrollHeight);
}

const sheet = await browser.newPage({ deviceScaleFactor: 1 });
const written = [];
for (const screen of screens) {
  const livePath = `${out}/${screen.name}-live.png`;
  const oursPath = `${out}/${screen.name}-julia-next.png`;
  await capture(screen.live, screen.ready, livePath);
  const oursHeight = await capture(screen.ours, screen.ready, oursPath);
  // Sections follow julia-next's length; live's extra recipes and nutrition panel have no counterpart yet.
  const sections = Math.min(Math.ceil(oursHeight / SECTION), MAX_SECTIONS);
  const liveImage = readFileSync(livePath).toString('base64');
  const oursImage = readFileSync(oursPath).toString('base64');
  for (let i = 0; i < sections; i += 1) {
    const label = sections === 1 ? 'whole page' : i === 0 ? 'top' : `lower ${i}`;
    const panel = (caption, image) => `
      <figure style="margin:0">
        <figcaption style="height:32px">${caption}</figcaption>
        <div style="width:${WIDTH * SCALE}px;height:${SECTION * SCALE}px;overflow:hidden;background:#fff">
          <img src="data:image/png;base64,${image}" style="display:block;margin-top:-${i * SECTION * SCALE}px">
        </div>
      </figure>`;
    await sheet.setViewportSize({ width: WIDTH * SCALE * 2 + 72, height: SECTION * SCALE + 80 });
    await sheet.setContent(`
      <body style="margin:0;padding:24px;background:#444;font:24px sans-serif;color:#fff;display:flex;gap:24px">
        ${panel(`Live Julia: ${screen.title} (${label})`, liveImage)}
        ${panel(`julia-next: ${screen.title} (${label})`, oursImage)}
      </body>`);
    await sheet.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
    const file = `${out}/${screen.name}-${sections === 1 ? 'whole' : i === 0 ? 'top' : `lower-${i}`}.png`;
    await sheet.screenshot({ path: file });
    written.push(file);
  }
}

await browser.close();
console.log(written.join('\n'));
