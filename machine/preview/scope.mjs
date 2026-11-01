// A pull request is judged by the machine that runs its tests, and a change to
// the dashboard is also read by a person before it lands, so the two are told
// apart here.

export const DASHBOARD_PREFIX = 'dashboard/';

// GitHub accepts paths longer than one sentence has room for, so a very long
// first path is cut to keep the reason inside its 200 characters.
const PATH_LIMIT = 120;

const MACHINE_REASON =
  "the change touches no file under dashboard/, so only the tests and the pull request's checks judge it";

function stringPaths(files) {
  if (!Array.isArray(files)) return [];
  return files.filter(file => typeof file === 'string');
}

function dashboardPaths(files) {
  return stringPaths(files).filter(file => file.startsWith(DASHBOARD_PREFIX));
}

function shorten(path) {
  return path.length <= PATH_LIMIT ? path : `${path.slice(0, PATH_LIMIT - 1)}…`;
}

export function scopeOf(files) {
  return dashboardPaths(files).length > 0 ? 'dashboard' : 'machine';
}

export function scopeReason(scope, files) {
  const touched = dashboardPaths(files);
  if (scope === 'dashboard' && touched.length > 0) {
    const total = stringPaths(files).length;
    return `the change touches the dashboard (${touched.length} of ${total} files, starting with ${shorten(touched[0])})`;
  }
  return MACHINE_REASON;
}
