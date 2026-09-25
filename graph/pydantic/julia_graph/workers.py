"""The real outside world behind the graph, on the OVH server.

The graph runs as orchestrator-svc. The builder (Gemini, edits only) and the
test worker (no model) run in their own accounts through the fixed sudo rules
the minimal runner already installed (ops/julia-runner/sudoers); each gets its
input as JSON on stdin and an environment of PATH and LANG only.
"""

from __future__ import annotations

import asyncio
import json
import os
import pwd
import re
import shutil
import subprocess
import time
from pathlib import Path

from .checkpoint import CardRun, TestResult
from .graph import BuildResult

WORKER_COMMANDS = {
    'builder': ('gemini-worker', '/opt/julia-runner/ops/julia-runner/run-gemini.mjs'),
    'tests': ('julia-tester', '/opt/julia-runner/ops/julia-runner/run-tests.mjs'),
}
WORKER_ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}
# Who each worker is, in the words the card shows.
WORKER_NAMES = {'builder': 'Gemini (agy)', 'tests': 'the test runner (no AI model)'}
# The exit code ops/julia-runner/time-limit.mjs gives a worker it stopped, as GNU timeout does.
STOPPED_EXIT = 124
GIT_ID = ['-c', 'user.name=Julia graph', '-c', 'user.email=graph@julia-next.invalid']


def sudo_command(kind: str) -> list[str]:
    account, script = WORKER_COMMANDS[kind]
    return ['sudo', '-n', '-u', account, '--', '/usr/bin/node', script]


def git(cwd: str, *args: str) -> str:
    done = subprocess.run(['git', *GIT_ID, *args], cwd=cwd, capture_output=True, text=True)
    if done.returncode != 0:
        raise RuntimeError(f'git {" ".join(args)} failed: {done.stderr.strip()}')
    return done.stdout.strip()


# ------------------------------------------------------------ live workers

def account_uid(kind: str) -> int | None:
    try:
        return pwd.getpwnam(WORKER_COMMANDS[kind][0]).pw_uid
    except KeyError:  # no such account on this machine (the tests' laptop)
        return None


def real_uid(entry: Path) -> int | None:
    for line in (entry / 'status').read_text().splitlines():
        if line.startswith('Uid:'):
            return int(line.split()[1])
    return None


def live_workers(kind: str, proc: Path = Path('/proc'), uid: int | None | str = 'account') -> list[int]:
    """Processes on this machine running this kind of worker's launcher, or
    owned by the worker's account: an agy or `node --test` left behind has no
    launcher in its command line. uid is the account's, looked up by default."""
    script = WORKER_COMMANDS[kind][1].encode()
    if uid == 'account':
        uid = account_uid(kind)
    found = []
    for entry in proc.iterdir():
        if not entry.name.isdigit() or int(entry.name) == os.getpid():
            continue
        try:
            if script in (entry / 'cmdline').read_bytes().split(b'\0') or (uid is not None and real_uid(entry) == uid):
                found.append(int(entry.name))
        except (OSError, ValueError):
            continue
    return sorted(found)


def waiter(limit_seconds: float, every: float = 5.0):
    async def wait_for_exit(kind: str) -> list[int]:
        deadline = time.monotonic() + limit_seconds
        while (still := live_workers(kind)) and time.monotonic() < deadline:
            await asyncio.sleep(every)
        return still
    return wait_for_exit


# ------------------------------------------------------------ worker runs

async def run_worker(kind: str, request: dict | str, on_line=None) -> tuple[int | None, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *sudo_command(kind), env=WORKER_ENV,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        limit=64 * 1024 * 1024,
    )
    try:
        proc.stdin.write((request if isinstance(request, str) else json.dumps(request)).encode())
        await proc.stdin.drain()
        proc.stdin.close()
    except (BrokenPipeError, ConnectionResetError):
        pass  # the worker ended before reading; its exit status and stderr say why
    out: list[str] = []

    async def read_out():
        async for raw in proc.stdout:
            line = raw.decode(errors='replace')
            out.append(line)
            if on_line:
                await on_line(line)

    reader = asyncio.create_task(read_out())
    err = await proc.stderr.read()
    await reader
    status = await proc.wait()
    return status, ''.join(out), err.decode(errors='replace')


def _json(line: str):
    try:
        return json.loads(line)
    except ValueError:
        return None


def agy_step(line: str) -> str | None:
    step = (_json(line) or {}).get('step_update') or {}
    if step.get('state') != 'ACTIVE' or not step.get('tool_name'):
        return None
    arg = next((v for v in (step.get('tool_info') or {}).get('parameters', {}).values() if isinstance(v, str)), '')
    return f"{step['tool_name']} {arg}".strip()


def agy_outcome(status: int | None, stdout: str, stderr: str) -> BuildResult:
    """agy exits 0 and says SUCCESS even when it denied a tool, so the outcome
    is the stream's final result event, and an empty reply is a failure."""
    tail = stderr.strip().splitlines()[-1:] or ['']
    if status == STOPPED_EXIT:
        return BuildResult(False, tail[0] or 'stopped by its time limit', stopped=True)
    events = [e for e in map(_json, stdout.splitlines()) if isinstance(e, dict)]
    final = next((e['result'] for e in reversed(events) if e.get('event') == 'result'), None)
    if final is None:
        return BuildResult(False, f'the builder ended without a result (exit {status}) {tail[0]}'.strip())
    if final.get('status') != 'SUCCESS':
        return BuildResult(False, str(final.get('error') or final.get('response') or f"agy status {final.get('status')}"))
    denied = final.get('denied_actions') or []
    if denied:
        return BuildResult(False, 'agy denied ' + ', '.join(f"{d.get('action')} ({d.get('display_name')})" for d in denied))
    reply = str(final.get('response') or '').strip()
    if not reply:
        return BuildResult(False, 'agy reported SUCCESS with an empty reply')
    if status != 0:
        return BuildResult(False, f'the builder exited {status}')
    return BuildResult(True, report=reply)


def line_handler(log, progress):
    """Every line the builder prints moves the card; tool steps are also logged."""
    async def on_line(line):
        if step := agy_step(line):
            log(f'builder: {step}')
        await progress()
    return on_line


def builder(log):
    async def build(run: CardRun, brief: str, limit_seconds: int, progress) -> BuildResult:
        request = {'worktree': run.worktree, 'prompt': brief, 'limit_seconds': limit_seconds}
        status, out, err = await run_worker('builder', request, line_handler(log, progress))
        return agy_outcome(status, out, err)
    return build


SUMMARY = re.compile(r'^\S*\s*(tests|pass|fail|skipped|cancelled|todo) (\d+)\s*$', re.M)
FAILED = re.compile(r'^✖ (.+?) \([\d.]+m?s\)\s*$', re.M)
# The spec reporter repeats every failure, with its error, after this line.
FAILING_SECTION = '✖ failing tests:'
# The most failure output the builder's repair brief carries.
MAX_DETAILS = 8000


def failure_details(output: str) -> str:
    """What the builder needs to repair the failures: the reporter's failing-tests
    section when there is one (it has each error), else the end of the output."""
    at = output.rfind(FAILING_SECTION)
    if at >= 0:
        return output[at:].strip()[:MAX_DETAILS]
    return output.strip()[-MAX_DETAILS:]


def suite_result(status: int, output: str) -> TestResult:
    counts = {k: int(v) for k, v in SUMMARY.findall(output)}
    failing = sorted(set(FAILED.findall(output)))
    summary = ', '.join(f'{k} {counts[k]}' for k in ('tests', 'pass', 'fail', 'skipped') if k in counts)
    passed = status == 0 and counts.get('fail', 1) == 0 and counts.get('tests', 0) > 0
    return TestResult(passed=passed, summary=f'`node --test scripts/*.test.mjs`: {summary or "no summary"} (exit {status})',
                      failing=failing, details='' if passed else failure_details(output))


async def ask_tester(run: CardRun, what: str, limit_seconds: int, progress) -> tuple[int | None, str, bool]:
    """(status, output, stopped). Only the launcher's own exit 124 is a stop; a
    test command that itself exits 124 comes back inside the JSON answer. A
    worker that did not answer has no status (None): nothing ran that the
    builder could fix. The launcher prints a line whenever the tests print, and
    each line moves the card."""
    async def on_line(line):
        await progress()
    request = {'worktree': run.worktree, 'run': what, 'limit_seconds': limit_seconds}
    status, out, err = await run_worker('tests', request, on_line if progress else None)
    if status == STOPPED_EXIT:
        return STOPPED_EXIT, (err.strip().splitlines()[-1:] or ['stopped by its time limit'])[0], True
    reply = _json((out.strip().splitlines() or [''])[-1])
    if status == 0 and isinstance(reply, dict) and isinstance(reply.get('status'), int):
        return reply['status'], str(reply.get('output', '')), False
    return None, f'the test worker did not answer (exit {status}): {err.strip()[-500:]}', False


async def tester(run: CardRun, limit_seconds: int, progress, ask=ask_tester) -> TestResult:
    # The card shows one limit for the step, so the suite gets what the lint left of it.
    started = time.monotonic()
    lint_status, lint_output, stopped = await ask(run, 'lint', limit_seconds, progress)
    if stopped:
        return TestResult(passed=False, summary=f'`npm run lint:framework` {lint_output}', stopped=True)
    if lint_status is None:  # names no failure, so it is reported and never sent to the builder
        return TestResult(passed=False, summary=f'`npm run lint:framework`: {lint_output}')
    status, output, stopped = await ask(run, 'suite', max(1, limit_seconds - int(time.monotonic() - started)), progress)
    if stopped:
        return TestResult(passed=False, summary=f'`node --test scripts/*.test.mjs` {output}', stopped=True)
    if status is None:
        return TestResult(passed=False, summary=f'`node --test scripts/*.test.mjs`: {output}')
    result = suite_result(status, output)
    if lint_status != 0:
        result.passed = False
        result.summary = f'`npm run lint:framework` failed (exit {lint_status}); ' + result.summary
        result.failing.insert(0, 'lint: ' + (lint_output.strip().splitlines() or [''])[-1][:200])
        lint = f'`npm run lint:framework` failed:\n{lint_output.strip()[-MAX_DETAILS // 2:]}'
        result.details = f'{lint}\n\n{result.details}'.strip()[:MAX_DETAILS]
    else:
        result.summary = '`npm run lint:framework` passed; ' + result.summary
    return result


# ------------------------------------------------------------ git

def npm_ci(worktree: str) -> str | None:
    done = subprocess.run(['npm', 'ci', '--no-audit', '--no-fund'], cwd=worktree, capture_output=True, text=True)
    return None if done.returncode == 0 else f'npm ci failed (exit {done.returncode}): {done.stderr.strip()[-300:]}'


def prepare(repo: str, install=npm_ci):
    """Only runs while the saved step is 'prepare', so an existing working copy
    is one a killed run left before any build: it must be this card's branch,
    exactly at this base, and its dependencies are installed again (npm ci
    starts clean)."""
    async def prepare_card(run: CardRun) -> str | None:
        wt = Path(run.worktree)
        if wt.exists() and old_style(run.worktree):
            set_aside(wt)  # an older graph's git worktree: its .git points out of the folder
        if wt.exists():
            branch = git(run.worktree, 'rev-parse', '--abbrev-ref', 'HEAD')
            if branch != run.branch:
                return f'{run.worktree} already holds branch {branch}, not {run.branch}'
            if git(run.worktree, 'rev-parse', 'HEAD') != run.base:
                return f'{run.worktree} does not start from base {run.base[:12]}: it is at another commit'
            if git(run.worktree, 'status', '--porcelain'):
                return f'{run.worktree} has uncommitted changes left by an earlier run'
            cut_ties(run.worktree)  # a run killed straight after cloning left them
        else:
            git(repo, 'fetch', '-q', 'origin', 'main')
            git(repo, 'rev-parse', '--verify', f'{run.base}^{{commit}}')
            # A local clone, not `git worktree add`: a worktree's .git is a
            # pointer into the main repo, outside the one folder the builder may
            # read, and headless agy ends the whole turn when Gemini follows it
            # (JUL-142 and JUL-144, 25 Sep). A clone keeps its git data inside
            # the folder. --local hardlinks the objects where it can (the
            # server's repo is shallow, so there git copies them instead).
            # It is made beside the card's folder and moved into place only when
            # complete, so a run killed half-way never leaves a half-made card-N.
            new = wt.with_name(f'{wt.name}.new')
            shutil.rmtree(new, ignore_errors=True)
            git(repo, 'clone', '-q', '--local', '--no-checkout', '.', str(new))
            # A clone brings only the repo's own branches; the base is the repo's
            # copy of GitHub's main, which its local main may lag, so fetch that too.
            git(str(new), 'fetch', '-q', 'origin', '+refs/remotes/origin/*:refs/remotes/github/*')
            if subprocess.run(['git', 'cat-file', '-e', f'{run.base}^{{commit}}'], cwd=new).returncode:
                shutil.rmtree(new, ignore_errors=True)
                return f'the base commit {run.base[:12]} is not in the working copy made for this card'
            git(str(new), 'checkout', '-q', '-b', run.branch, run.base)
            cut_ties(str(new))
            os.replace(new, wt)
        return install(run.worktree) if (wt / 'package-lock.json').exists() else None
    return prepare_card


def old_style(worktree: str) -> bool:
    """A working copy an older graph made with `git worktree add`: its .git is a
    one-line pointer into the main repo, outside the builder's folder."""
    return Path(worktree, '.git').is_file()


def set_aside(folder: Path) -> Path:
    """Move a working copy to <folder>.runN, kept as it was; returns where it went."""
    n = 1
    while folder.with_name(f'{folder.name}.run{n}').exists():
        n += 1
    kept = folder.with_name(f'{folder.name}.run{n}')
    os.replace(folder, kept)
    return kept


def cut_ties(worktree: str) -> None:
    """Leave nothing in the folder that names the repo it was cloned from.
    Gemini reads git's own files and follows any path it finds: the clone's
    history log says "clone: from /srv/julia-runner/repo", and reading that
    repo was refused and ended the turn (live check, 25 Sep). The remote, the
    last-fetch record and the history logs are the only places that name it."""
    if 'origin' in git(worktree, 'remote').split():
        git(worktree, 'remote', 'remove', 'origin')
    Path(worktree, '.git', 'FETCH_HEAD').unlink(missing_ok=True)
    shutil.rmtree(Path(worktree, '.git', 'logs'), ignore_errors=True)


def tracked_files(run: CardRun) -> list[str]:
    """The repo's files, for the builder's brief: with them it has no reason to
    scan the folder, which Gemini did with a shell command that was refused."""
    return git(run.worktree, 'ls-files').splitlines()


async def discard(run: CardRun) -> int:
    """Back to where this build started: the base, or for a repair the failed
    candidate it was repairing, so a first build's work is never thrown away."""
    start = run.repair_from or run.base
    dirty = [l for l in git(run.worktree, 'status', '--porcelain').splitlines() if l]
    commits = int(git(run.worktree, 'rev-list', '--count', f'{start}..HEAD'))
    git(run.worktree, 'reset', '-q', '--hard', start)
    git(run.worktree, 'clean', '-fdq')
    return len(dirty) + commits


async def commit(run: CardRun) -> tuple[str | None, str | None]:
    git(run.worktree, 'add', '-A')
    if subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=run.worktree).returncode == 0:
        return None, 'the working copy has no changes to commit'
    git(run.worktree, 'commit', '-q', '-m', f'graph: {run.card} build attempt {run.attempt}')
    return git(run.worktree, 'rev-parse', 'HEAD'), None
