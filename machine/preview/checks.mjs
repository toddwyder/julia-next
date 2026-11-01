// The checks on a commit decide whether the change is fit to look at, so a
// check that never ran, or ran and was skipped, counts against the commit in
// the same way as one that failed.

const UNNAMED = '(unnamed check)';
const NO_RUNS = 'no check runs for this commit';
const NO_JOBS = 'no workflow job is defined for this commit';

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

// A check run is what GitHub reports for the commit, and a job that never
// reported has no run at all, so the runs alone cannot say what is missing. The
// workflow jobs the commit started are the list of what should be there, and a
// job on that list with no run is a failure rather than an absence.
function absentItems(items, expected, sha) {
  const present = new Set(items.map(item => item.name));
  return expected
    .filter(name => typeof name === 'string' && name && !present.has(name))
    .map(name => ({ name, status: null, conclusion: null, sha, ok: false, absent: true }));
}

export function checksVerdict(checkRuns, sha, { expected = null } = {}) {
  const runs = checkItems(checkRuns, sha);
  const jobs = Array.isArray(expected) ? expected : null;
  const items = [...runs, ...absentItems(runs, jobs ?? [], sha)].sort(byName);
  const failed = items.filter(item => !item.ok).map(item => item.name);
  const counts = {
    total: items.length,
    passed: items.length - failed.length,
    failed: failed.length,
    skipped: items.filter(item => item.status === 'completed' && item.conclusion === 'skipped').length,
  };
  // A commit whose workflow run started no job at all, and a commit with no
  // readable run, are both failures the reader is told about by name.
  if (jobs && jobs.length === 0) failed.push(NO_JOBS);
  if (items.length === 0) failed.push(NO_RUNS);
  const named = [...new Set(failed)];
  return { sha, ok: named.length === 0, items, failed: named, counts };
}
