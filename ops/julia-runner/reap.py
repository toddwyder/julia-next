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

Exits with the command's own status, or 124 when it was stopped.
"""

import ctypes
import os
import signal
import subprocess
import sys
import time

PR_SET_CHILD_SUBREAPER = 36
STOPPED_EXIT = 124
GRACE_SECONDS = 3


def below(root: int, proc: str = '/proc') -> list[int]:
    """Every process whose parent chain leads to root."""
    parents = {}
    for name in os.listdir(proc):
        if not name.isdigit():
            continue
        try:
            with open(f'{proc}/{name}/stat') as f:
                # pid (comm) state ppid ...: comm may hold spaces, so split after the last ')'
                parents[int(name)] = int(f.read().rsplit(')', 1)[1].split()[1])
        except (OSError, IndexError, ValueError):
            continue
    found, frontier = [], [root]
    while frontier:
        parent = frontier.pop()
        children = [pid for pid, ppid in parents.items() if ppid == parent]
        found += children
        frontier += children
    return found


def signal_all(sig: int) -> int:
    count = 0
    for pid in below(os.getpid()):
        try:
            os.kill(pid, sig)
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


def sweep() -> None:
    """Stop everything below this process: politely, then for good."""
    if signal_all(signal.SIGTERM):
        deadline = time.monotonic() + GRACE_SECONDS
        while below(os.getpid()) and time.monotonic() < deadline:
            reap_zombies()
            time.sleep(0.1)
    signal_all(signal.SIGKILL)
    time.sleep(0.1)
    reap_zombies()


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
        sweep()
        os._exit(STOPPED_EXIT)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        child = subprocess.Popen(argv[1:])
    except OSError as error:
        print(f'reap: {argv[1]} did not start: {error}', file=sys.stderr)
        return 127
    code = child.wait()
    sweep()  # anything the command left running
    if stopped:
        return STOPPED_EXIT
    return 128 - code if code < 0 else code  # killed by a signal: 128 + its number, as a shell says


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
