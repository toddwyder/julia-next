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
import re
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

def live_workers(kind: str, proc: Path = Path('/proc')) -> list[int]:
    """Processes on this machine running this kind of worker's script."""
    script = WORKER_COMMANDS[kind][1].encode()
    found = []
    for entry in proc.iterdir():
        if not entry.name.isdigit() or int(entry.name) == os.getpid():
            continue
        try:
            if script in (entry / 'cmdline').read_bytes().split(b'\0'):
                found.append(int(entry.name))
        except OSError:
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
    proc.stdin.write((request if isinstance(request, str) else json.dumps(request)).encode())
    await proc.stdin.drain()
    proc.stdin.close()
    out: list[str] = []

    async def read_out():
        async for raw in proc.stdout:
            line = raw.decode(errors='replace')
            out.append(line)
            if on_line:
                on_line(line)

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
    events = [e for e in map(_json, stdout.splitlines()) if isinstance(e, dict)]
    final = next((e['result'] for e in reversed(events) if e.get('event') == 'result'), None)
    tail = stderr.strip().splitlines()[-1:] or ['']
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


def builder(log):
    async def build(run: CardRun, brief: str) -> BuildResult:
        def on_line(line):
            if step := agy_step(line):
                log(f'builder: {step}')
        status, out, err = await run_worker('builder', {'worktree': run.worktree, 'prompt': brief}, on_line)
        return agy_outcome(status, out, err)
    return build


SUMMARY = re.compile(r'^\S*\s*(tests|pass|fail|skipped|cancelled|todo) (\d+)\s*$', re.M)
FAILED = re.compile(r'^✖ (.+?) \([\d.]+m?s\)\s*$', re.M)


def suite_result(status: int, output: str) -> TestResult:
    counts = {k: int(v) for k, v in SUMMARY.findall(output)}
    failing = sorted(set(FAILED.findall(output)))
    summary = ', '.join(f'{k} {counts[k]}' for k in ('tests', 'pass', 'fail', 'skipped') if k in counts)
    passed = status == 0 and counts.get('fail', 1) == 0 and counts.get('tests', 0) > 0
    return TestResult(passed=passed, summary=f'`node --test scripts/*.test.mjs`: {summary or "no summary"} (exit {status})', failing=failing)


async def ask_tester(run: CardRun, what: str) -> tuple[int, str]:
    status, out, err = await run_worker('tests', {'worktree': run.worktree, 'run': what})
    reply = _json((out.strip().splitlines() or [''])[-1])
    if status == 0 and isinstance(reply, dict) and isinstance(reply.get('status'), int):
        return reply['status'], str(reply.get('output', ''))
    return 1, f'the test worker did not answer (exit {status}): {err.strip()[-500:]}'


async def tester(run: CardRun) -> TestResult:
    lint_status, lint_output = await ask_tester(run, 'lint')
    status, output = await ask_tester(run, 'suite')
    result = suite_result(status, output)
    if lint_status != 0:
        result.passed = False
        result.summary = f'`npm run lint:framework` failed (exit {lint_status}); ' + result.summary
        result.failing.insert(0, 'lint: ' + (lint_output.strip().splitlines() or [''])[-1][:200])
    else:
        result.summary = '`npm run lint:framework` passed; ' + result.summary
    return result


# ------------------------------------------------------------ git

def prepare(repo: str):
    async def prepare_card(run: CardRun) -> str | None:
        wt = Path(run.worktree)
        if wt.exists():
            branch = git(run.worktree, 'rev-parse', '--abbrev-ref', 'HEAD')
            return None if branch == run.branch else f'{run.worktree} already holds branch {branch}, not {run.branch}'
        git(repo, 'fetch', '-q', 'origin', 'main')
        git(repo, 'rev-parse', '--verify', f'{run.base}^{{commit}}')
        git(repo, 'worktree', 'add', '-q', '-b', run.branch, run.worktree, run.base)
        if (wt / 'package-lock.json').exists():
            done = subprocess.run(['npm', 'ci', '--no-audit', '--no-fund'], cwd=run.worktree, capture_output=True, text=True)
            if done.returncode != 0:
                return f'npm ci failed (exit {done.returncode}): {done.stderr.strip()[-300:]}'
        return None
    return prepare_card


async def discard(run: CardRun) -> int:
    dirty = [l for l in git(run.worktree, 'status', '--porcelain').splitlines() if l]
    commits = int(git(run.worktree, 'rev-list', '--count', f'{run.base}..HEAD'))
    git(run.worktree, 'reset', '-q', '--hard', run.base)
    git(run.worktree, 'clean', '-fdq')
    return len(dirty) + commits


async def commit(run: CardRun) -> tuple[str | None, str | None]:
    git(run.worktree, 'add', '-A')
    if subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=run.worktree).returncode == 0:
        return None, 'the working copy has no changes to commit'
    git(run.worktree, 'commit', '-q', '-m', f'graph: {run.card} build attempt {run.attempt}')
    return git(run.worktree, 'rev-parse', 'HEAD'), None
