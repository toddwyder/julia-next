// Captures Library, Enter a Recipe and Recipe at the reference framing and
// writes same-size side-by-sides next to docs/design/vintage references.
// Usage: node side-by-side.mjs <base-url> <out-dir>
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

// References show an 800px column at ~0.485 scale inside a 1131x672 browser area.
const VIEW = { width: 2330, height: 1384 };
const SHOWN = { width: 1131, height: 672 };

const LIBRARY = [
  'Sheet-Pan Caponata With Cod',
  'Crispy Tofu With Peanut Sauce',
  'Sicilian-Style Baked Cod',
  'Eggplant Fatteh',
  'Basil and Tomato Fried Rice',
  'Homemade Artisan Crackers',
];
const CRACKERS = {
  ingredients: [
    '2 cup all-purpose flour, (250g), plus more for kneading and rolling',
    '1 tsp granulated sugar',
    '1 tsp salt',
    '½ tsp onion powder',
    '½ tsp garlic powder',
    '1 tbsp fresh rosemary, or other add-in (see Notes)*, finely chopped',
    '⅔ cup water, (160g/ml)',
    '3 tbsp extra-virgin olive oil, (45g/45ml), plus more for brushing on top',
    'flaky sea salt, for topping',
  ].join('\n'),
  steps: 'Preheat the oven to 450°F.\nStir the flour, sugar, salt and seasonings together.',
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEW });
await page.goto(`${base}/`);
await page.evaluate(() => window.localStorage.clear());

let crackers = '';
for (const title of LIBRARY) {
  await page.goto(`${base}/recipes/new`);
  await page.getByLabel('Recipe Title').fill(title);
  await page.getByLabel('Ingredients').fill(title === 'Homemade Artisan Crackers' ? CRACKERS.ingredients : '1 cod fillet');
  await page.getByLabel('Instructions').fill(title === 'Homemade Artisan Crackers' ? CRACKERS.steps : 'Bake.');
  await page.getByRole('button', { name: 'Save Recipe' }).click();
  await page.waitForURL(/\/recipes\/(?!new$)[^/]+$/);
  if (title === 'Homemade Artisan Crackers') crackers = page.url();
}

const screens = [
  { name: '01-library', url: `${base}/recipes` },
  { name: '11-manual-entry', url: `${base}/recipes/new` },
  { name: '07-recipe-detail', url: crackers },
];

for (const screen of screens) {
  await page.goto(screen.url);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${out}/${screen.name}-julia-next.png` });
}

const sheet = await browser.newPage({ viewport: { width: SHOWN.width * 2 + 48, height: SHOWN.height + 72 } });
for (const screen of screens) {
  const reference = readFileSync(new URL(`../../../../docs/design/vintage/${screen.name}.jpg`, import.meta.url)).toString('base64');
  const ours = readFileSync(`${out}/${screen.name}-julia-next.png`).toString('base64');
  await sheet.setContent(`
    <body style="margin:0;padding:16px;background:#444;font:14px sans-serif;color:#fff;display:flex;gap:16px">
      <figure style="margin:0"><figcaption>Reference ${screen.name}.jpg (live Julia)</figcaption>
        <div style="width:${SHOWN.width}px;height:${SHOWN.height}px;overflow:hidden;margin-top:8px">
          <img src="data:image/jpeg;base64,${reference}" style="display:block">
        </div></figure>
      <figure style="margin:0"><figcaption>julia-next (this branch)</figcaption>
        <img src="data:image/png;base64,${ours}" style="display:block;margin-top:8px;width:${SHOWN.width}px;height:${SHOWN.height}px">
      </figure>
    </body>`);
  await sheet.screenshot({ path: `${out}/${screen.name}-side-by-side.png` });
}

await browser.close();
console.log(out);
