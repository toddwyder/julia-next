// The checks on a commit decide whether the change is fit to look at, so a
// check that never ran, or ran and was skipped, counts against the commit in
// the same way as one that failed.

const UNNAMED = '(unnamed check)';
const NO_RUNS = 'no check runs for this commit';

function text(value) {
  return typeof value === 'string' ? value : null;
}

function itemFrom(run, sha) {
  const status = text(run.status);
  const conclusion = text(run.conclusion);
  return {
    name: text(run.name) ?? UNNAMED,
    status,
    conclusion,
    sha: text(run.head_sha),
    ok: status === 'completed' && conclusion === 'success' && run.head_sha === sha,
  };
}

// Ties keep the order they arrived in.
function byName(left, right) {
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

function startedAt(run) {
  const at = Date.parse(text(run.started_at) ?? '');
  return Number.isNaN(at) ? 0 : at;
}

// Re-running a check leaves the older attempt behind under the same name, often
// cancelled or failed. The newest attempt is the one that speaks for the check,
// so an older one is replaced rather than counted a second time.
function newestPerName(runs) {
  const kept = new Map();
  for (const run of runs) {
    const name = text(run.name) ?? UNNAMED;
    const previous = kept.get(name);
    if (!previous) {
      kept.set(name, run);
      continue;
    }
    const newer = startedAt(run) - startedAt(previous);
    const later = newer > 0 || (newer === 0 && (Number(run.id) || 0) >= (Number(previous.id) || 0));
    if (later) kept.set(name, run);
  }
  return [...kept.values()];
}

export function checkItems(checkRuns, sha) {
  const runs = Array.isArray(checkRuns) ? checkRuns : [];
  return newestPerName(runs.filter(run => run !== null && typeof run === 'object'))
    .map(run => itemFrom(run, sha))
    .sort(byName);
}

export function checksVerdict(checkRuns, sha) {
  const items = checkItems(checkRuns, sha);
  const failed = items.filter(item => !item.ok).map(item => item.name);
  const counts = {
    total: items.length,
    passed: items.length - failed.length,
    failed: failed.length,
    skipped: items.filter(item => item.status === 'completed' && item.conclusion === 'skipped').length,
  };
  if (items.length === 0) {
    return { sha, ok: false, items, failed: [NO_RUNS], counts };
  }
  return { sha, ok: failed.length === 0, items, failed, counts };
}
