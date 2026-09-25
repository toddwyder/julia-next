"""One independent JUL-129 check. Linear comments are the incident ledger."""

from __future__ import annotations

import asyncio
import hashlib
import re
import subprocess
from datetime import datetime, timezone

from .board import why_not
from .linear import LinearApp

MOVED = re.compile(r'graph-moved: (\S+) running=([^\s]+) limit=(\d+)')


def incident(kind: str, card: str, event: str) -> str:
    digest = hashlib.sha256(f'{kind}\0{card}\0{event}'.encode()).hexdigest()[:24]
    return f'watchdog: incident={digest}'


def elapsed(seconds: float) -> str:
    minutes = int(seconds) // 60
    return f'{minutes} min {int(seconds) % 60} s' if minutes else f'{int(seconds)} s'


async def alert(linear, card: str, marker: str, body: str) -> None:
    # The comment is durable before assignment. A failed assignment can be
    # retried next tick without repeating the notification comment.
    fresh = await linear.watchdog_card(card)
    if not any(marker in c['body'].splitlines() for c in fresh['comments']):
        await linear.comment(card, f'{body}\n\n{marker}')
    await linear.assign_todd(card)


async def check(linear, now, graph: tuple[str, str]) -> None:
    current = now()
    for issue in await linear.in_progress_cards():
        card = issue['identifier']
        # Re-read immediately before a write: a card may have reached UAT
        # between the list and this check.
        fresh = await linear.watchdog_card(card)
        if fresh['state'] != 'Implementation':
            continue
        status = next((c['body'] for c in reversed(fresh['comments'])
                       if c['body'].startswith('**Where this card is**')), None)
        if not status or not (match := MOVED.fullmatch(status.splitlines()[-1])):
            continue
        moved_text, step, limit_text = match.groups()
        if step == 'none' or (limit := int(limit_text)) <= 0:
            continue
        try:
            moved = datetime.fromisoformat(moved_text.replace('Z', '+00:00'))
        except ValueError:
            continue
        age = (current - moved).total_seconds()
        if age <= limit:
            continue
        activity = next((line.removeprefix('Now: ').strip() for line in status.splitlines()
                         if line.startswith('Now: ')), step.replace('-', ' '))
        marker = incident('step', card, f'{moved_text}|{step}|{limit}')
        await alert(linear, card, marker,
                    f'Stuck at {activity.split(", by ")[0]} for {elapsed(age)} '
                    f'(limit {elapsed(limit)}). Last known activity: {activity}. '
                    f'Last moved at {moved:%H:%M UTC, %d %b}.')

    state, outage = graph
    if state == 'active':
        return
    ready = sorted(await linear.ready_cards(), key=lambda c: c['sort_order'])
    eligible = next((card for card in ready if not why_not(card)), None)
    if eligible:
        card = eligible['identifier']
        fresh = await linear.watchdog_card(card)
        if fresh['state'] == 'Ready' and not why_not(fresh):
            await alert(linear, card, incident('graph', card, outage),
                        f'The graph stopped while {card} was eligible in Ready. '
                        'Last known activity: waiting in Ready for the graph to start it.')


def graph_state() -> tuple[str, str]:
    """Systemd owns liveness; its inactive transition identifies this outage."""
    result = subprocess.run(['systemctl', 'show', 'julia-graph.service',
                             '--property=ActiveState,InactiveEnterTimestampMonotonic,ActiveExitTimestampMonotonic'],
                            capture_output=True, text=True, check=True)
    values = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    state = values['ActiveState']
    with open('/proc/sys/kernel/random/boot_id') as source:
        boot = source.read().strip()
    transition = next((value for value in (values.get('InactiveEnterTimestampMonotonic'),
                                           values.get('ActiveExitTimestampMonotonic')) if value and value != '0'), '0')
    return state, f'{boot}:{transition}'


def main() -> int:
    try:
        asyncio.run(check(LinearApp(), lambda: datetime.now(timezone.utc), graph_state()))
    except Exception as error:
        print(f'watchdog check failed: {type(error).__name__}: {error}', flush=True)
        return 1
    return 0
