"""python -m julia_graph serve
python -m julia_graph JUL-NN --base <commit>

`serve` is the graph as a service (JUL-127): it checks the board about once a
minute and starts the top eligible Ready card. The second form runs (or
resumes) one card by hand. Both run as orchestrator-svc (see graph/pydantic/README.md).
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
from .board import Board, BoardLocked, serve
from .checkpoint import CardLocked, CardRun, Checkpoint
from .graph import LIMIT_CAPS, LIMITS, Deps, checked_limit, run_card
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


def card_deps(card: str, limits: dict[str, int] | None = None) -> Deps:
    return Deps(
        linear=LinearApp(), checkpoint=Checkpoint(Path(STATE), card),
        prepare=workers.prepare(REPO), builder=workers.builder(log), discard=workers.discard,
        commit=workers.commit, tester=workers.tester, live_workers=workers.live_workers,
        wait_for_exit=workers.waiter(WAIT_LIMIT_SECONDS), graph_version=graph_version(), log=log,
        worker_names=workers.WORKER_NAMES, limits=limits or dict(LIMITS),
    )


async def fresh_main() -> str:
    """origin/main as it is now: the commit a card started from Ready builds on."""
    await asyncio.to_thread(workers.git, REPO, 'fetch', '-q', 'origin', 'main')
    return await asyncio.to_thread(workers.git, REPO, 'rev-parse', '--verify', 'origin/main^{commit}')


async def in_own_thread(state: CardRun, deps: Deps) -> str:
    """A card's run gets its own thread and event loop, so its git and npm
    calls never hold up the next board check."""
    return await asyncio.to_thread(asyncio.run, run_card(state, deps))


def serve_board() -> int:
    os.umask(0o002)
    board = Board(linear=LinearApp(), state_dir=Path(STATE), worktrees=WORKTREES, base=fresh_main,
                  card_deps=card_deps, run=in_own_thread, log=log)
    log(f'board: checking Ready about once a minute ({graph_version()})')
    try:
        asyncio.run(serve(board))
    except BoardLocked as refused:
        log(f'refused: {refused}')
        return 3
    return 0


def main(argv: list[str]) -> int:
    if argv[:1] == ['serve']:
        return serve_board()
    parser = argparse.ArgumentParser(prog='julia_graph')
    parser.add_argument('card')
    parser.add_argument('--base', required=True, help='the commit the card starts from')
    # Shorter limits are for proving a stop on a throwaway card. A limit the
    # launcher would not enforce is refused, so the card never quotes one.
    for kind in ('builder', 'tests'):
        parser.add_argument(f'--{kind}-limit', type=lambda text, kind=kind: checked_limit(kind, text), default=LIMITS[kind],
                            help=f'seconds, 1 to {LIMIT_CAPS[kind]} (default %(default)s)')
    args = parser.parse_args(argv)
    os.umask(0o002)  # the builder account shares the working copy through its group
    number = args.card.split('-')[-1]
    Path(STATE).mkdir(exist_ok=True)
    state = CardRun(card=args.card, base=workers.git(REPO, 'rev-parse', '--verify', f'{args.base}^{{commit}}'),
                    branch=f'graph/card-{number}', worktree=f'{WORKTREES}/card-{number}')
    deps = card_deps(args.card, {'builder': args.builder_limit, 'tests': args.tests_limit})
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
