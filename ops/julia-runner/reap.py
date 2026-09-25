"""reap.py -- runs one command and, when it ends or is stopped, stops everything it started (JUL-128).

    python3 reap.py -- <command> [args...]

run-reviewer.mjs starts the reviewer through this. It makes itself the
command's "child subreaper" (Linux prctl PR_SET_CHILD_SUBREAPER), so a process
the command starts stays below it even after its parent is gone: one that left
the process group with setsid, or a double fork, is re-parented here, not to
init. When the command ends, or this is sent SIGTERM (at the time limit, or
when the graph stops the reviewer), every process still below it is sent
SIGTERM, then SIGKILL. The reviewer's account also runs other things (Orca), so
nothing is swept by account: only what is below this process.

A process that forks while being stopped is caught too: the sweep repeats
until nothing is left below it. Anything still running after that is named
on stderr, and a run that left it exits 125 (never a clean run).

Exits with the command's own status, 124 when it was stopped, or 125.
"""

import ctypes
import os
import signal
import subprocess
import sys
import time

PR_SET_CHILD_SUBREAPER = 36
STOPPED_EXIT = 124
# The reviewer ended but left something that would not stop: never a clean run.
LEFT_RUNNING = 125
GRACE_SECONDS = 3
KILL_SECONDS = 5


def below(root: int, proc: str = '/proc') -> list[int]:
    """Every live process whose parent chain leads to root. A zombie (already
    dead, waiting to be reaped) is walked through but not listed."""
    parents, zombies = {}, set()
    for name in os.listdir(proc):
        if not name.isdigit():
            continue
        try:
            with open(f'{proc}/{name}/stat') as f:
                # pid (comm) state ppid ...: comm may hold spaces, so split after the last ')'
                state, ppid = f.read().rsplit(')', 1)[1].split()[:2]
            parents[int(name)] = int(ppid)
            if state == 'Z':
                zombies.add(int(name))
        except (OSError, IndexError, ValueError):
            continue
    found, frontier = [], [root]
    while frontier:
        parent = frontier.pop()
        children = [pid for pid, ppid in parents.items() if ppid == parent]
        found += children
        frontier += children
    return [pid for pid in found if pid not in zombies]


def mine() -> list[int]:
    return below(os.getpid())


def signal_all(sig: int, listed=mine, kill=os.kill) -> int:
    count = 0
    for pid in listed():
        try:
            kill(pid, sig)
            count += 1
        except ProcessLookupError:
            pass
    return count


def reap_zombies() -> None:
    while True:
        try:
            pid, _ = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return
        if pid == 0:
            return


def sweep(listed=mine, kill=os.kill, reap=reap_zombies, pause=time.sleep, clock=time.monotonic) -> list[int]:
    """Stop everything below this process: politely, then for good, again and
    again until nothing is left, so a process that forks while being stopped
    is caught on the next pass (SIGKILL cannot be caught, so the passes end).
    Returns what could still not be stopped within KILL_SECONDS: nothing,
    unless a process is stuck in the kernel."""
    if signal_all(signal.SIGTERM, listed, kill):
        deadline = clock() + GRACE_SECONDS
        while listed() and clock() < deadline:
            reap()
            pause(0.1)
    deadline = clock() + KILL_SECONDS
    while True:
        reap()
        left = listed()
        if not left or clock() >= deadline:
            return left
        signal_all(signal.SIGKILL, listed, kill)
        pause(0.05)


def swept() -> bool:
    """Sweep, and say on stderr what could not be stopped."""
    left = sweep()
    if left:
        print(f'reap: could not stop {len(left)} process(es) the reviewer started: {", ".join(map(str, left))}',
              file=sys.stderr)
    return not left


def main(argv: list[str]) -> int:
    if argv[:1] != ['--'] or len(argv) < 2:
        print('usage: reap.py -- <command> [args...]', file=sys.stderr)
        return 2
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        print(f'reap: could not become a subreaper (errno {ctypes.get_errno()})', file=sys.stderr)
        return 2
    stopped = False

    def stop(signum, frame):
        nonlocal stopped
        stopped = True
        swept()
        os._exit(STOPPED_EXIT)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        child = subprocess.Popen(argv[1:])
    except OSError as error:
        print(f'reap: {argv[1]} did not start: {error}', file=sys.stderr)
        return 127
    code = child.wait()
    if not swept():  # anything the command left running
        return LEFT_RUNNING
    if stopped:
        return STOPPED_EXIT
    return 128 - code if code < 0 else code  # killed by a signal: 128 + its number, as a shell says


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
