// The Lead's task is the card's own words for the goal, the done check, the proof wanted, what
// is already known and the real constraints. Everything else about how to work comes from
// poteto-mode, whose SKILL.md is the Lead's instructions.

const headingPattern = /^(#{1,6})[ \t]+(.+?)[ \t]*$/gm;

// A section ends at the next heading of the same or a higher level, so its own sub-headings
// stay inside it.
const sectionFrom = (description, heading, level) => {
  const after = description.slice(heading.index + heading[0].length);
  const next = new RegExp(`^#{1,${level}}[ \\t]+\\S`, 'm').exec(after);
  return (next ? after.slice(0, next.index) : after).trim();
};

const normalized = text => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const CARD_PARTS = [
  ['Goal', ['goal', 'outcome']],
  ['Done check', ['acceptance criteria', 'criteria', 'done means', 'done check']],
  ['Proof', ['proof', 'uat steps']],
  ['What is already known', ['what we know', 'what this is', 'context', 'read first', 'before this card starts']],
  ['Constraints', ['constraints', 'out of scope']],
];

export function taskFromCard(card) {
  const description = String(card?.description ?? '');
  const headings = [...description.matchAll(headingPattern)]
    .map(match => ({ match, name: normalized(match[2]), level: match[1].length }));
  const found = CARD_PARTS.map(([label, names]) => {
    const heading = names.map(name => headings.find(candidate => candidate.name === name)).find(Boolean);
    return heading ? [label, sectionFrom(description, heading.match, heading.level)] : null;
  }).filter(part => part?.[1]);

  const named = card?.identifier && card?.title ? `Linear card ${card.identifier}: ${card.title}` : 'The card';
  if (found.length === 0) return description.trim() ? `${named}\n\n${description.trim()}` : named;
  return [named, ...found.map(([label, text]) => `## ${label}\n${text}`)].join('\n\n');
}
