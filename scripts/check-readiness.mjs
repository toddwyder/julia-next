#!/usr/bin/env node
// check-readiness.mjs -- checks every precondition for the julia-coordinator
// skill (.claude/skills/julia-coordinator/SKILL.md) to dispatch through
// Orca on the OVH runner and publish through julia-graph-publisher. Each
// precondition is reported as its own pass/fail line, not folded into one
// generic result -- an unreachable runner and a missing credential are
// different problems with different fixes.
//
// No LINEAR_API_KEY check: the coordinator is a live agent session using
// Linear's MCP tools directly (docs/agents/issue-tracker.md), not a
// headless script that needs its own API key -- that requirement was
// inherited from an earlier session's AI-Stack-headless-script design that
// this route no longer uses.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getPublisherInstallationToken } from './publish-via-github-app.mjs';
import { terminalCreate, terminalRead } from './orca-cli.mjs';

const execFileAsync = promisify(execFile);
// No personal-machine fallback path here on purpose (retro finding, JUL-61
// closing pass) -- see the matching comment in orca-cli.mjs. Callers must
// set ORCA_BIN for their own machine.
function requireOrcaBin() {
  const bin = process.env.ORCA_BIN;
  if (!bin) {
    throw new Error('ORCA_BIN is not set -- point it at this machine\'s orca binary (e.g. the laptop\'s orca.exe, or /opt/Orca/orca-ide on the server)');
  }
  return bin;
}
// 'OVH runner' is the laptop's own registered name for this runtime
// (orca.exe pairs to it remotely). Running this same check as
// orchestrator-svc ON that runner uses a different local pairing --
// 'ovh-local' -- registered via `orca environment add` against the
// runtime's own advertised endpoint (JUL-61 step 7). Both names point at
// the same physical Orca runtime; only the calling machine differs. Read
// lazily (a function, not a module-load-time constant) so a caller --
// including a test -- can set ORCA_ENVIRONMENT right before invoking a
// check and see it take effect, rather than needing a fresh process.
export function getEnvironment() {
  return process.env.ORCA_ENVIRONMENT || 'OVH runner';
}
const JULIA_NEXT_PROJECT_ID = 'github:toddwyder/julia-next';

function check(name, ok, detail) {
  return { name, ok, detail };
}

async function defaultOrcaStatusImpl() {
  const { stdout } = await execFileAsync(requireOrcaBin(), ['status', '--environment', getEnvironment(), '--json']);
  return JSON.parse(stdout);
}

async function defaultOrcaProjectSetupsImpl() {
  const { stdout } = await execFileAsync(requireOrcaBin(), ['project', 'setups', '--environment', getEnvironment(), '--json']);
  return JSON.parse(stdout);
}

async function defaultPublisherCheckImpl() {
  try {
    // getPublisherInstallationToken both checks installation and mints a
    // token; a readiness check only needs the first half, but there is no
    // separate installation-only endpoint call worth duplicating here --
    // minting a short-lived token as a side effect of a readiness check is
    // harmless (it is never used) and keeps this check exercising the exact
    // path a real publish will take.
    await getPublisherInstallationToken({
      ...process.env,
      JULIA_PUBLISHER_REPO: 'julia-next',
    });
    return { installed: true, detail: 'julia-graph-publisher is installed on toddwyder/julia-next' };
  } catch (error) {
    return { installed: false, detail: error.message };
  }
}

// The LAST `<field>:...` line anchored to a line start, never the first match
// anywhere in the string -- see the comment inside defaultGroupDriftCheckImpl
// below for why a first match is wrong here. Returns the comma-separated
// value split into trimmed, non-empty names, or `null` if the field never
// appeared at all (a probe that crashed before printing anything, as opposed
// to one that printed an empty list).
function lastFieldValue(output, field) {
  const re = new RegExp(`^${field}:(.*)$`, 'gm');
  let match;
  let last = null;
  while ((match = re.exec(output)) !== null) last = match;
  if (last === null) return null;
  return last[1].split(',').map((s) => s.trim()).filter(Boolean);
}

// THE STALE-SUPPLEMENTARY-GROUPS CHECK (JUL-44's pattern, recurred for real
// on JUL-98: a `commandcode-readers` group created after both Orca daemons
// had already started left every terminal either daemon spawned unable to
// read the `commandcode` secret -- three real controller-started reviewer
// dispatches died on it, each timing out at `agent_readiness` because `pi`
// crashed on an uncaught EACCES before ever drawing its TUI. A person typing
// the same command by hand always got a FRESH login, with the group already
// applied, so it worked for them every time and never for the controller.
// This check catches that class of drift before a real dispatch pays for it.
//
// THE COMPARISON, done inside ONE Orca-spawned terminal so both sides are
// read the same way the bug actually bites. `id -Gn` prints the PRIMARY
// group first, then the process's supplementary groups (GNU coreutils,
// confirmed live) -- fixed at the moment the Orca daemon that owns this
// terminal itself started, never re-read live no matter how long the
// daemon has been up since. The primary group is stripped out (`id -gn`)
// before comparing, because `getent group`'s member lists never include a
// user's primary group either -- comparing the raw, unstripped `id -Gn`
// output against `getent group` always disagrees by exactly that one entry,
// which is not drift. `getent group` itself is a fresh NSS/file lookup that
// costs nothing to run and reflects `/etc/group` as it stands RIGHT NOW,
// independent of this process's own frozen credential set.
//
// BOTH DIRECTIONS ARE CHECKED, not just "added since". A group present in
// `/etc/group` but absent from the frozen process is the JUL-98 case (a
// daemon that needs restarting to pick up new membership). A group the
// frozen process still holds but that `/etc/group` no longer lists for this
// account is the mirror case (a daemon holding access that was meant to be
// revoked) -- a one-directional comparison reports that case as a clean
// match, which is a real, silent false negative a symmetric check does not
// have. ONLY THIS ONE ENVIRONMENT is probed per call (whichever
// `getEnvironment()` names) -- like every other check in this file, it does
// not reach across to the other Orca daemon; run it once per environment to
// cover both.
export async function defaultGroupDriftCheckImpl({
  terminalCreateImpl = terminalCreate,
  terminalReadImpl = terminalRead,
} = {}) {
  // Every expansion below is double-quoted. An earlier version left `$actual`/
  // `$missing` unquoted in the final `echo`/`tr` pipeline: the shell then
  // word-split the multi-line value back into space-separated words before
  // `tr` ever saw a newline to translate, so two or more missing groups came
  // out space-joined ("foo bar") instead of comma-separated ("foo,bar") --
  // parsed downstream as one garbled name instead of two real ones. Quoting
  // keeps the internal newlines intact all the way to `tr`.
  const command = 'u=$(id -un); primary=$(id -gn); '
    + 'actual=$(id -Gn | tr " " "\\n" | grep -v -x "$primary" | sort -u); '
    + 'expected=$(getent group | awk -F: -v u="$u" \'{n=split($4,a,","); for(i=1;i<=n;i++) if(a[i]==u) print $1}\' | sort -u); '
    + 'missing=$(comm -13 <(printf "%s\\n" "$actual") <(printf "%s\\n" "$expected")); '
    + 'extra=$(comm -23 <(printf "%s\\n" "$actual") <(printf "%s\\n" "$expected")); '
    + 'printf "ACTUAL:%s\\n" "$(printf "%s" "$actual" | tr "\\n" ",")"; '
    + 'printf "EXPECTED:%s\\n" "$(printf "%s" "$expected" | tr "\\n" ",")"; '
    + 'printf "MISSING:%s\\n" "$(printf "%s" "$missing" | tr "\\n" ",")"; '
    + 'printf "EXTRA:%s\\n" "$(printf "%s" "$extra" | tr "\\n" ",")"';
  const created = await terminalCreateImpl({
    environment: getEnvironment(),
    worktree: 'path:/home/runner/julia-next',
    command,
    title: 'readiness-group-drift-check',
  });
  const read = await terminalReadImpl({ environment: getEnvironment(), terminal: created.terminal.handle });
  const output = (read.terminal.tail ?? []).join('\n');
  // THE LAST occurrence of each field, anchored to the start of a line, never
  // the first `.exec()` match anywhere in the string -- live-verified this
  // matters: the terminal's tail includes the shell ECHOING the command
  // before it runs, and that echoed text contains the literal substrings
  // "MISSING:" and "EXTRA:" inside the `printf` format strings themselves.
  // A first-match regex reads the echoed command's own source as if it were
  // the answer. Same anchoring shape as wiring.mjs's END_MARKER_LINE, for the
  // same reason: the command that produced the marker is not the marker.
  const missing = lastFieldValue(output, 'MISSING');
  const extra = lastFieldValue(output, 'EXTRA');
  const actualLine = lastFieldValue(output, 'ACTUAL');
  if (missing === null || extra === null) {
    return { ok: false, detail: `the group-drift probe printed no MISSING/EXTRA line -- nothing to read and nothing is guessed: ${output || '(no output)'}` };
  }
  if (missing.length === 0 && extra.length === 0) {
    return { ok: true, detail: `this terminal's groups match /etc/group (ACTUAL:${(actualLine ?? []).join(',')})` };
  }
  const parts = [];
  if (missing.length > 0) {
    parts.push(`is missing ${missing.join(', ')}, though /etc/group lists ${missing.length === 1 ? 'it' : 'them'} for this account right now -- the Orca daemon that spawned this terminal was very likely started before that group existed (the JUL-44/JUL-98 stale-supplementary-groups pattern)`);
  }
  if (extra.length > 0) {
    parts.push(`still holds ${extra.join(', ')}, which /etc/group no longer lists for this account -- membership was revoked after this daemon started and it has not picked that up`);
  }
  return {
    ok: false,
    detail: `this terminal ${parts.join('; and ')}. Restart the daemon that owns the "${getEnvironment()}" environment (checking first that no worker is mid-run) and re-check. Raw: ${output}`,
  };
}

export async function checkReadiness({
  orcaStatusImpl = defaultOrcaStatusImpl,
  orcaProjectSetupsImpl = defaultOrcaProjectSetupsImpl,
  publisherCheckImpl = defaultPublisherCheckImpl,
  groupDriftCheckImpl = defaultGroupDriftCheckImpl,
} = {}) {
  const checks = [];

  try {
    const status = await orcaStatusImpl();
    const { reachable, connectionState } = status.result.runtime;
    checks.push(
      reachable && connectionState === 'connected'
        ? check('OVH runner reachable', true, `Orca reports the OVH runner ${connectionState}`)
        : check('OVH runner reachable', false, `Orca reports the OVH runner as ${connectionState} (reachable: ${reachable})`),
    );
  } catch (error) {
    checks.push(check('OVH runner reachable', false, error.message));
  }

  try {
    const setups = await orcaProjectSetupsImpl();
    const julia = setups.result.setups.find((s) => s.projectId === JULIA_NEXT_PROJECT_ID);
    checks.push(
      julia && julia.setupState === 'ready'
        ? check('julia-next project registered', true, `ready at ${julia.path}`)
        : check('julia-next project registered', false, 'no ready setup found for github:toddwyder/julia-next on the OVH runner'),
    );
  } catch (error) {
    checks.push(check('julia-next project registered', false, error.message));
  }

  try {
    const { installed, detail } = await publisherCheckImpl();
    checks.push(check('julia-graph-publisher installed on julia-next', installed, detail));
  } catch (error) {
    checks.push(check('julia-graph-publisher installed on julia-next', false, error.message));
  }

  try {
    const { ok: groupsOk, detail } = await groupDriftCheckImpl();
    checks.push(check('worker terminal groups match /etc/group', groupsOk, detail));
  } catch (error) {
    checks.push(check('worker terminal groups match /etc/group', false, error.message));
  }

  return { ok: checks.every((c) => c.ok), checks };
}

async function main() {
  const { ok, checks } = await checkReadiness();
  for (const c of checks) console.log(`  [${c.ok ? 'x' : ' '}] ${c.name}: ${c.detail}`);
  console.log(`READY: ${ok}`);
  process.exitCode = ok ? 0 : 1;
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
