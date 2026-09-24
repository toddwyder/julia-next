"""python -m julia_graph JUL-NN --base <commit>

Runs (or resumes) one card through the build-and-test graph on the server, as
orchestrator-svc under systemd-run (see graph/pydantic/README.md).
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.metadata
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import workers
from .checkpoint import CardLocked, CardRun, Checkpoint
from .graph import Deps, run_card
from .linear import LinearApp

REPO = '/srv/julia-runner/repo'
WORKTREES = '/srv/julia-runner/worktrees'
STATE = '/srv/julia-runner/graph-state'
WAIT_LIMIT_SECONDS = 45 * 60


def log(line: str) -> None:
    print(f'{datetime.now(timezone.utc):%H:%M:%S} {line}', flush=True)


def graph_version() -> str:
    here = Path(__file__).resolve().parent
    code = subprocess.run(['git', 'rev-parse', '--short=12', 'HEAD'], cwd=here, capture_output=True, text=True).stdout.strip()
    return f"pydantic-graph {importlib.metadata.version('pydantic-graph')}, graph code `{code or 'unknown'}`"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog='julia_graph')
    parser.add_argument('card')
    parser.add_argument('--base', required=True, help='the commit the card starts from')
    args = parser.parse_args(argv)
    os.umask(0o002)  # the builder account shares the working copy through its group
    number = args.card.split('-')[-1]
    Path(STATE).mkdir(exist_ok=True)
    state = CardRun(card=args.card, base=workers.git(REPO, 'rev-parse', '--verify', f'{args.base}^{{commit}}'),
                    branch=f'graph/card-{number}', worktree=f'{WORKTREES}/card-{number}')
    deps = Deps(
        linear=LinearApp(), checkpoint=Checkpoint(Path(STATE), args.card),
        prepare=workers.prepare(REPO), builder=workers.builder(log), discard=workers.discard,
        commit=workers.commit, tester=workers.tester, live_workers=workers.live_workers,
        wait_for_exit=workers.waiter(WAIT_LIMIT_SECONDS), graph_version=graph_version(), log=log,
    )
    log(f'{args.card}: {deps.graph_version}')
    try:
        outcome = asyncio.run(run_card(state, deps))
    except CardLocked as refused:
        log(f'refused: {refused}')
        return 3
    log(f'{args.card}: {outcome}')
    return 0 if outcome in ('passed', 'already reported') else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
