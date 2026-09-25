"""The board check (JUL-127): Todd moves a card to Ready and the graph starts it.

About once a minute the graph reads the Ready column in board order. Each
ineligible card gets one plain comment saying why, and the highest eligible
card starts when no builder is running. There is no webhook.

Only one builder ever runs:

* one board per machine: a lock file held for as long as the graph runs, so a
  second graph started during a restart refuses to check the board at all;
* one check at a time inside the graph, so two checks at once start one card;
* the builder reservation is a file, written before the card starts and
  removed only once its run has ended. A restart that finds it resumes that
  card before it looks at Ready, and never starts a second one alongside it.

A card already in Ready when the graph starts is simply what the first check
sees. The card's UAT steps are locked into its saved progress when it starts;
after that only an Instruction comment changes what the builder is told.
"""

from __future__ import annotations

import asyncio
import fcntl
import json
import os
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

from .checkpoint import CardRun, Checkpoint
from .graph import Deps, uat_section
from .workers import set_aside
from .status import clock

READY = 'Ready'
STARTED = 'Implementation'  # the column a started card moves to (graph/board-spec.mjs)
# A blocker counts as cleared once it reaches UAT or later, or is finished or
# abandoned (scripts/ready-queue.mjs isBlockerClosed, Todd's rule).
CLEARED_COLUMNS = {'UAT', 'Complete'}
NOT_AGENT_WORK = ('Parent', 'Decision')
CHECK_EVERY = 60  # seconds
UAT_ITEM = re.compile(r'^ {0,2}\d+\.\s+\S', re.M)


class BoardLinear(Protocol):
    # Ready cards: {identifier, title, description, sort_order, labels: [name],
    # blockers: [{identifier, state, type}]}, in whatever order Linear returns.
    async def ready_cards(self) -> list[dict]: ...
    async def card(self, card: str) -> dict: ...
    async def comment(self, card: str, body: str) -> str: ...
    async def edit(self, comment_id: str, body: str) -> None: ...
    async def move(self, card: str, state: str) -> None: ...


class BoardLocked(Exception):
    """Another graph is already checking this board."""


# ------------------------------------------------------------ eligibility

def blocker_open(blocker: dict) -> bool:
    return blocker.get('type') not in ('completed', 'canceled') and blocker.get('state') not in CLEARED_COLUMNS


def why_not(card: dict) -> list[tuple[str, str]]:
    """Why the graph will not start this card, as (key, plain sentence) pairs;
    empty when it can start. The key changes only when the reason does."""
    reasons = []
    for label in NOT_AGENT_WORK:
        if label in card.get('labels', []):
            reasons.append((f'label={label}', f'It is a {label} card, and {label} cards are not built by the graph.'))
    blockers = sorted((b for b in card.get('blockers', []) if blocker_open(b)), key=lambda b: b['identifier'])
    if blockers:
        # Named without their columns: the comment changes only when the reason
        # does, so a column shown here would go stale as the blocker moves on.
        names = ', '.join(b['identifier'] for b in blockers)
        reasons.append((f'blocked-by={names.replace(" ", "")}',
                        f'It is blocked by {names}, not yet at UAT.'))
    plan = uat_section(card.get('description') or '')
    if plan is None:
        reasons.append(('no-uat-plan', 'It has no "## UAT plan" section, so there is no way to check it at the end.'))
    elif not UAT_ITEM.search(plan):
        reasons.append(('no-uat-steps', 'Its "## UAT plan" section has no numbered steps to follow at the end.'))
    return reasons


def not_started_marker(card: str) -> str:
    return f'graph: not-started card={card}'


def not_started_text(card: str, reasons: list[tuple[str, str]]) -> str:
    lines = ['The graph will not start this card yet:', '']
    lines += [f'- {sentence}' for _, sentence in reasons]
    lines += ['', 'The cards below it in Ready are not held up. Once this is fixed the card starts on its own. '
                  'This comment is updated if the reason changes.',
              '', not_started_marker(card), f"graph-why: {' '.join(key for key, _ in reasons)}"]
    return '\n'.join(lines)


# ------------------------------------------------------------ the board

@dataclass
class Board:
    linear: BoardLinear
    state_dir: Path
    worktrees: str
    # The commit a new card starts from (origin/main, freshly fetched).
    base: Callable[[], Awaitable[str]]
    # The graph's outside world for one card's run.
    card_deps: Callable[[str], Deps]
    # Runs (or resumes) one card; graph.run_card, in its own thread on the server.
    run: Callable[[CardRun, Deps], Awaitable[str]]
    log: Callable[[str], None] = field(default=print)
    now: Callable[[], datetime] = field(default=lambda: datetime.now(timezone.utc))

    def __post_init__(self):
        self.state_dir = Path(self.state_dir)
        self._checking = asyncio.Lock()
        self._running: asyncio.Task | None = None
        self._board_lock = None

    # -------------------------------------------------------- one board per machine

    def open(self) -> None:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self._board_lock = open(self.state_dir / 'board.lock', 'a')
        try:
            fcntl.flock(self._board_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self._board_lock.close()
            self._board_lock = None
            raise BoardLocked('another graph is already checking the board') from None

    def close(self) -> None:
        if self._board_lock:
            self._board_lock.close()
            self._board_lock = None

    # -------------------------------------------------------- the builder reservation

    @property
    def _reservation(self) -> Path:
        return self.state_dir / 'builder.json'

    def reserved(self) -> str | None:
        try:
            return json.loads(self._reservation.read_text())['card']
        except FileNotFoundError:
            return None
        except (ValueError, KeyError, TypeError) as error:
            # Written atomically, so only a damaged disk gets here. Crashing on it
            # every restart would stop the board for good; a builder still alive
            # is caught by the graph's own no-second-worker check instead.
            self.log(f'the builder reservation is unreadable and was removed: {type(error).__name__}: {error}')
            self._release()
            return None

    def _reserve(self, card: str) -> None:
        tmp = self._reservation.with_suffix('.tmp')
        with open(tmp, 'w') as f:
            json.dump({'card': card, 'since': self.now().isoformat()}, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self._reservation)

    def _release(self) -> None:
        self._reservation.unlink(missing_ok=True)

    def busy(self) -> bool:
        return self._running is not None and not self._running.done()

    async def idle(self) -> None:
        """Wait for the running card, if any, to end (for tests and shutdown)."""
        if self._running:
            await asyncio.gather(self._running, return_exceptions=True)

    # -------------------------------------------------------- one check

    async def check(self) -> str:
        """One look at the board. Returns what it did, in a few words."""
        if self._board_lock is None:
            raise BoardLocked('the board is not open: call open() first')
        async with self._checking:
            try:
                ready = sorted(await self.linear.ready_cards(), key=lambda c: c['sort_order'])
            except Exception as error:  # Linear unreachable: try again next minute
                self.log(f'the board could not be read: {type(error).__name__}: {error}')
                ready = None
            eligible = []
            for card in ready or []:
                if reasons := why_not(card):
                    await self._tell(card['identifier'], reasons)
                else:
                    eligible.append(card)
            if self.busy():
                return f'busy with {self.reserved()}'
            if (held := self.reserved()) and (resumed := await self._resume(held)):
                return resumed
            if not eligible:
                return 'nothing to start'
            return await self._start(eligible[0])

    async def _tell(self, card: str, reasons: list[tuple[str, str]]) -> None:
        """One comment per ineligible card, edited only when the reason changes."""
        text = not_started_text(card, reasons)
        try:
            comments = (await self.linear.card(card))['comments']
            old = next((c for c in comments if not_started_marker(card) in c['body'].splitlines()), None)
            if old is None:
                await self.linear.comment(card, text)
            elif why_line(old['body']) != why_line(text):
                await self.linear.edit(old['id'], text)
        except Exception as error:
            self.log(f'{card}: the not-started comment could not be posted: {type(error).__name__}: {error}')

    async def _resume(self, card: str) -> str | None:
        """A reservation left by a graph that died mid-run: carry on with that card.
        One whose run had already ended is released instead."""
        saved = self._load(Checkpoint(self.state_dir, card))
        if saved is None or saved.step == 'done':
            self._release()
            return None
        if not await self._leave_ready(card):  # the graph may have died before the move
            return f'{card} waits: it could not leave Ready'
        self.log(f'{card}: resuming the run a restart interrupted')
        self._launch(saved)
        return f'resumed {card}'

    async def _start(self, card: dict) -> str:
        name = card['identifier']
        checkpoint = Checkpoint(self.state_dir, name)
        saved = self._load(checkpoint)
        if saved and saved.step != 'done':
            state = saved  # moved back to Ready mid-run: carry on from where it stopped
        else:
            try:
                base = await self.base()
            except Exception as error:
                self.log(f'{name}: no base commit, not started: {type(error).__name__}: {error}')
                return 'no base commit'
            if checkpoint.path.exists():
                self._archive(checkpoint)
            number = name.split('-')[-1]
            # Always card-<number>: the worker launchers accept no other name.
            worktree = f'{self.worktrees}/card-{number}'
            self._set_aside(worktree)
            state = CardRun(card=name, base=base, branch=f'graph/card-{number}', worktree=worktree,
                            uat_plan=uat_section(card.get('description') or ''), uat_locked_at=self.now())
            checkpoint.save(state)
        self._reserve(name)  # before anything starts, so a restart sees it
        if not await self._leave_ready(name):
            # The reservation stays: Linear may have made the move and lost only
            # the reply. The next check resumes the card, moving it again first,
            # so it is neither started twice nor left in Implementation unbuilt.
            return f'{name} waits: it could not leave Ready'
        self.log(f'{name}: started from Ready')
        self._launch(state)
        await self._started(name)
        return f'started {name}'

    async def _started(self, card: str) -> None:
        """A card told earlier why it would not start is told that no longer applies."""
        try:
            comments = (await self.linear.card(card))['comments']
            old = next((c for c in comments if not_started_marker(card) in c['body'].splitlines()), None)
            if old and why_line(old['body']) != 'graph-why: started':
                await self.linear.edit(old['id'], f'The graph started this card at {clock(self.now())}. '
                                                  'The earlier reason it could not start no longer applies.\n\n'
                                                  f'{not_started_marker(card)}\ngraph-why: started')
        except Exception as error:
            self.log(f'{card}: the not-started comment could not be updated: {type(error).__name__}: {error}')

    async def _leave_ready(self, card: str) -> bool:
        """Move the card out of Ready before its run starts. A card left in Ready
        would be started again once its run ended, so no move means no start;
        the next check tries again."""
        try:
            await self.linear.move(card, STARTED)
            return True
        except Exception as error:
            self.log(f'{card}: could not move the card to {STARTED}, not started: {type(error).__name__}: {error}')
            return False

    def _runs(self, checkpoint: Checkpoint) -> int:
        return len(list(self.state_dir.glob(f'{checkpoint.path.stem}.run*.json')))

    def _archive(self, checkpoint: Checkpoint) -> int:
        """Keep an earlier run's saved progress under a new name; returns how many are kept."""
        runs = self._runs(checkpoint)
        os.replace(checkpoint.path, checkpoint.path.with_name(f'{checkpoint.path.stem}.run{runs + 1}.json'))
        return runs + 1

    def _set_aside(self, worktree: str) -> None:
        """An earlier run's working copy moves to <folder>.runN, kept as it was,
        so the card starts afresh in its usual folder."""
        folder = Path(worktree)
        if folder.exists():
            self.log(f'{folder.name}: the earlier working copy was kept as {set_aside(folder).name}')

    def _load(self, checkpoint: Checkpoint) -> CardRun | None:
        """A card's saved progress. A damaged file is set aside as an earlier run
        rather than crashing every check: the card then starts afresh."""
        try:
            return checkpoint.load()
        except ValueError as error:  # pydantic's ValidationError is a ValueError
            kept = self._archive(checkpoint)
            self.log(f'{checkpoint.path.stem}: its saved progress was unreadable and was kept as run {kept}: '
                     f'{type(error).__name__}')
            return None

    def _launch(self, state: CardRun) -> None:
        self._running = asyncio.create_task(self._carry(state))

    async def _carry(self, state: CardRun) -> str | None:
        try:
            outcome = await self.run(state, self.card_deps(state.card))
        except Exception as error:
            # The run itself broke. The card stays where it is for the stuck
            # check to report; a builder still alive is caught by the graph's
            # own no-second-worker check before any next one starts.
            self.log(f'{state.card}: the run broke: {type(error).__name__}: {error}')
            self._release()
            return None
        self.log(f'{state.card}: {outcome}')
        self._release()
        return outcome


def why_line(body: str) -> str | None:
    return next((line for line in body.splitlines() if line.startswith('graph-why: ')), None)


async def serve(board: Board, every: float = CHECK_EVERY) -> None:
    """Check the board now, then about once a minute, for as long as the graph runs."""
    board.open()
    try:
        while True:
            board.log(f'board: {await board.check()}')
            await asyncio.sleep(every)
    finally:
        board.close()
