"""The card's "Where this card is" comment (JUL-126): one comment, edited in place.

It says what the graph is doing now, who is doing it, when the card last
moved, and the steps so far, in words Todd reads. Its last two lines are for
machines: the marker that finds the comment again after a restart, and the
last-moved time the stuck check (JUL-129) reads.
"""

from __future__ import annotations

from datetime import datetime, timezone

from .checkpoint import CardRun, StepMark


def status_marker(run: CardRun) -> str:
    return f'graph: status card={run.card} base={run.base[:12]}'


def clock(t: datetime) -> str:
    return f'{t.astimezone(timezone.utc):%H:%M} UTC'


def day(t: datetime) -> str:
    t = t.astimezone(timezone.utc)
    return f'{clock(t)}, {t.day} {t:%b}'


def duration(seconds: float) -> str:
    minutes, secs = divmod(int(seconds), 60)
    parts = [f'{minutes} min'] if minutes else []
    if secs or not minutes:
        parts.append(f'{secs} s')
    return ' '.join(parts)


def mark_line(mark: StepMark) -> str:
    if mark.outcome is None:
        return f'- … {mark.doing}, since {clock(mark.started)}'
    if mark.outcome == 'done':
        return f'- ✓ {mark.done}, {clock(mark.ended or mark.started)}'
    return f'- ✗ {mark.doing}: {mark.outcome}, {clock(mark.ended or mark.started)}'


def render(run: CardRun) -> str:
    current = run.marks[-1] if run.marks and run.marks[-1].outcome is None else None
    lines = ['**Where this card is**', '']
    if current:
        now = f'Now: {current.doing}'
        if current.worker:
            now += f', by {current.worker}'
        if current.limit:
            now += f', time limit {duration(current.limit)}'
        lines.append(now)
    elif run.ending:
        lines.append(run.ending)
    if run.moved_at:
        lines.append(f'Last moved: {day(run.moved_at)}')
    if run.marks:
        lines += ['', *map(mark_line, run.marks)]
    moved = run.moved_at.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') if run.moved_at else 'never'
    running = f'running={current.doing.split(" (")[0].lower().replace(" ", "-")} limit={current.limit or 0}' if current else 'running=none'
    lines += ['', status_marker(run), f'graph-moved: {moved} {running}']
    return '\n'.join(lines)
