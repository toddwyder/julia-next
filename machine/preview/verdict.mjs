// One PASS or FAIL for a change, built from every check and proof the machine
// ran. A line the machine could not run is a failing line, never a missing one.
const TODD = 'https://linear.app/julia-next/profiles/toddwyder';

function checkItem(check) {
  const result = check.absent ? 'never ran for this commit' : check.conclusion ?? check.status ?? 'unknown';
  return { kind: 'check', name: check.name, ok: check.ok === true, detail: result };
}

function proofItem(proof) {
  const skipped = proof.skipped ? `, ${proof.skipped} skipped` : '';
  return { kind: 'proof', name: proof.name, ok: proof.ok === true, detail: `${proof.detail}${skipped}` };
}

function previewItem({ scope, preview, previewGap }) {
  if (scope !== 'dashboard') {
    return { kind: 'preview', name: 'preview', ok: true, detail: 'not needed: the change touches no file under dashboard/', skip: true };
  }
  if (!preview?.address) return { kind: 'preview', name: 'preview', ok: false, detail: previewGap ?? 'the preview never answered' };
  const built = preview.buildSeconds === null || preview.buildSeconds === undefined ? '' : `, built in ${preview.buildSeconds}s`;
  return { kind: 'preview', name: 'preview', ok: true, detail: `${preview.address}${built}` };
}

function liveItem(live) {
  if (!live?.dir) return { kind: 'live', name: 'live dashboard records', ok: true, detail: 'not compared: no live state folder was given', skip: true };
  if (live.unchanged === true) {
    // The live service rewrites some of its own files on a timer. Saying those
    // moved is honest; saying the whole folder was identical when it was not
    // would not be.
    const touched = new Set((live.touched ?? []).map(file => file.path));
    const theirs = (live.changed ?? []).map(file => file.path).filter(name => !touched.has(name));
    const aside = theirs.length ? `; the live service rewrote ${theirs.join(', ')} on its own timer` : '';
    return { kind: 'live', name: 'live dashboard records', ok: true, detail: `no record the machine could move changed${aside}` };
  }
  const touched = (live.touched ?? []).map(file => `${file.path} ${file.how}`).join(', ');
  return {
    kind: 'live',
    name: 'live dashboard records',
    ok: false,
    detail: touched ? `touched while the preview ran: ${touched}` : 'changed while the preview ran',
  };
}

// A commit with no readable check runs is not a commit with no problems: the
// machine says so as its own failing line rather than leaving the list empty.
function checksGap(checks) {
  if (!checks) return { kind: 'checks', name: 'pull request checks', ok: false, detail: 'the machine never read them' };
  if ((checks.items ?? []).length > 0) return null;
  return {
    kind: 'checks',
    name: 'pull request checks',
    ok: false,
    detail: (checks.failed ?? []).join(', ') || 'no check ran for this commit',
  };
}

export function verdictOf({ scope, checks, preview = null, previewGap = null, proofs = [], live = null } = {}) {
  const gap = checksGap(checks);
  const items = [
    previewItem({ scope, preview, previewGap }),
    ...(gap ? [gap] : []),
    ...(checks?.items ?? []).map(checkItem),
    ...proofs.map(proofItem),
    liveItem(live),
  ];
  const failing = items.filter(item => !item.ok).map(item => `${item.name}: ${item.detail}`);
  const ok = failing.length === 0;
  return { verdict: ok ? 'PASS' : 'FAIL', ok, items, failing };
}

function line(item) {
  const mark = item.skip ? 'not needed' : item.ok ? 'pass' : 'FAIL';
  return `- ${item.name}: ${mark} (${item.detail})`;
}

export function recordBody(record) {
  const lines = [
    `## ${record.verdict}: preview and smoke test for #${record.pr}`,
    '',
    `Commit \`${record.sha}\` of pull request #${record.pr}${record.card?.identifier ? ` on ${record.card.identifier}` : ''}.`,
    record.scopeReason ? `${record.scopeReason[0].toUpperCase()}${record.scopeReason.slice(1)}.` : '',
    '',
    '### Every check and proof',
    '',
    ...(record.items ?? []).map(line),
    '',
  ];
  if (record.verdict !== 'PASS') {
    lines.push('### What failed', '', ...(record.failing ?? []).map(entry => `- ${entry}`), '');
  }
  lines.push(`Recorded ${record.at ?? new Date().toISOString()} by the preview machine.`);
  return `${lines.filter((entry, index, all) => !(entry === '' && all[index - 1] === '')).join('\n')}\n`;
}

export function buildNote(record) {
  const lines = [`The preview and smoke test failed for #${record.pr} at \`${record.sha}\`. The card goes back to the build.`, ''];
  if (record.preview?.address) lines.push(`The second copy of the dashboard ran at ${record.preview.address}, with its own records folder.`, '');
  lines.push(...(record.failing ?? []).map(entry => `- ${entry}`));
  lines.push('', `This is failure ${record.failCount ?? 1} of 2. The second one stops the card.`);
  return `${lines.join('\n')}\n`;
}

export function stopMessage(record) {
  return [
    `${TODD} Julia stopped: the preview and smoke test failed twice for #${record.pr}.`,
    '',
    ...(record.failing ?? []).map(entry => `- ${entry}`),
    '',
    'The card is stopped rather than sent back a third time. The record is beside the pull request.',
  ].join('\n');
}
