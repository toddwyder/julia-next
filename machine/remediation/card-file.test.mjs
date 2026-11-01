import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCard } from './card-file.mjs';

const GOOD = {
  identifier: 'JUL-999',
  title: 'Practice card',
  description: '## Acceptance criteria\n\n* the page says hello',
  url: 'https://linear.app/julia-next/issue/JUL-999/practice-card',
};

test('a card file gives back the card the loop reads', () => {
  const card = parseCard(JSON.stringify(GOOD), 'cards/JUL-999.json');
  assert.equal(card.identifier, 'JUL-999');
  assert.equal(card.title, 'Practice card');
  assert.match(card.description, /the page says hello/);
});

test('a card file with no url is still a card', () => {
  const { url, ...rest } = GOOD;
  assert.equal(parseCard(JSON.stringify(rest), 'cards/JUL-999.json').url, null);
});

test('a card file that is not JSON names itself in the error', () => {
  assert.throws(
    () => parseCard('not json', 'cards/JUL-999.json'),
    /cards\/JUL-999\.json is not JSON/,
  );
});

test('a card file with no criteria description is refused', () => {
  assert.throws(
    () => parseCard(JSON.stringify({ ...GOOD, description: '  ' }), 'cards/JUL-999.json'),
    /has no description/,
  );
});

test('a card file with no identifier is refused, because the loop names the card in its posts', () => {
  const { identifier, ...rest } = GOOD;
  assert.throws(
    () => parseCard(JSON.stringify(rest), 'cards/JUL-999.json'),
    /has no identifier/,
  );
});
