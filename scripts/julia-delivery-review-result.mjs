export function validObserved(role, configured, observed) {
  if (!observed || observed.harness !== configured.harness || observed.model !== configured.model || observed.maker !== configured.maker) return `${role} observed identity does not match its saved configuration`;
  if (role === 'reviewer' && observed.maker.trim().toLowerCase() === configured.builderMaker?.trim().toLowerCase()) return 'reviewer maker matches builder maker';
  return null;
}
