// A card read from a file instead of from Linear, so a practice run can be made
// on a machine whose Linear key is dead. The shape is the part of the issue the
// loop reads: an identifier, a title, and a description carrying the criteria.

import fs from 'node:fs';

export function parseCard(text, file = 'the card file') {
  let card;
  try {
    card = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not JSON: ${error.message}`);
  }
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    throw new Error(`${file} does not hold a card object.`);
  }
  for (const field of ['identifier', 'title', 'description']) {
    if (typeof card[field] !== 'string' || card[field].trim() === '') {
      throw new Error(`${file} has no ${field}.`);
    }
  }
  return { ...card, url: card.url ?? null };
}

export function readCardFile(file) {
  return parseCard(fs.readFileSync(file, 'utf8'), file);
}
