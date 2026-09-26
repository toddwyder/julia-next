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
from .model_choice import effective, next_pair

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
    checkpoint = Checkpoint(Path(STATE), card)
    pair = {}  # filled from Linear before the first graph node or worker starts
    linear = LinearApp()
    deps = Deps(
        linear=linear, checkpoint=checkpoint,
        prepare=workers.prepare(REPO), builder=workers.builder(log, pair), discard=workers.discard,
        commit=workers.commit, tester=workers.tester, reviewer=workers.reviewer(log, pair),
        live_workers=workers.live_workers, wait_for_exit=workers.waiter(WAIT_LIMIT_SECONDS),
        snapshot=workers.snapshot, restore=workers.restore, drift=workers.drift, diff=workers.change,
        install=workers.clean_install,
        base_file=workers.base_file,
        graph_version=graph_version(), log=log,
        limits=limits or dict(LIMITS), files=workers.tracked_files,
    )

    async def select_models(run: CardRun, quota_role: str | None) -> str | None:
        try:
            choices = effective(await linear.settings(), await linear.card(run.card))
            if quota_role is None:
                builder = run.builder_model or choices['builder']['model']
                reviewer = run.reviewer_model or choices['reviewer']['model']
                try:
                    selected = workers.resolve_pair(builder, reviewer)
                except ValueError:
                    current = {'builder': builder, 'reviewer': reviewer}
                    exhausted = {'builder': run.exhausted_builder, 'reviewer': run.exhausted_reviewer}
                    selected = (next_pair(choices, current, exhausted, 'builder', workers.resolve_pair)
                                or next_pair(choices, current, exhausted, 'reviewer', workers.resolve_pair))
                    if selected is None:
                        return 'No legal builder and reviewer pair remains in this card\'s current choices and backups.'
            else:
                current = getattr(run, f'{quota_role}_model')
                exhausted = getattr(run, f'exhausted_{quota_role}')
                if current not in exhausted:
                    exhausted.append(current)
                other = 'reviewer' if quota_role == 'builder' else 'builder'
                selected = next_pair(choices, {'builder': run.builder_model, 'reviewer': run.reviewer_model},
                                     {'builder': run.exhausted_builder, 'reviewer': run.exhausted_reviewer},
                                     quota_role, workers.resolve_pair)
                if selected is None:
                    return f'{quota_role} model {current} hit its quota. No legal builder and reviewer pair remains in this card\'s current backup lists.'
                if getattr(run, f'{other}_model') != selected[other]['label']:
                    await linear.comment(run.card, f'{other.title()} moved from {getattr(run, f"{other}_model")} to '
                                         f'{selected[other]["label"]} so builder and reviewer have different makers.')
            run.builder_model, run.reviewer_model = selected['builder']['label'], selected['reviewer']['label']
            run.builder_effort, run.reviewer_effort = choices['builder']['effort'], choices['reviewer']['effort']
            pair.update(selected)
            deps.worker_names = workers.worker_names(pair)
            deps.worker_makers = workers.worker_makers(pair)
            deps.worker_models = {'reviewer': pair['reviewer']['model']}
            checkpoint.save(run)
            return None
        except (ValueError, RuntimeError) as error:
            return f'models could not be selected from Linear: {error}'

    deps.select_models = select_models
    deps.model_labels = None
    return deps


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
    for kind in ('builder', 'tests', 'reviewer'):
        parser.add_argument(f'--{kind}-limit', type=lambda text, kind=kind: checked_limit(kind, text), default=LIMITS[kind],
                            help=f'seconds, 1 to {LIMIT_CAPS[kind]} (default %(default)s)')
    args = parser.parse_args(argv)
    os.umask(0o002)  # the builder account shares the working copy through its group
    number = args.card.split('-')[-1]
    Path(STATE).mkdir(exist_ok=True)
    state = CardRun(card=args.card, base=workers.git(REPO, 'rev-parse', '--verify', f'{args.base}^{{commit}}'),
                    branch=f'graph/card-{number}', worktree=f'{WORKTREES}/card-{number}')
    deps = card_deps(args.card, {'builder': args.builder_limit, 'tests': args.tests_limit, 'reviewer': args.reviewer_limit})
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
