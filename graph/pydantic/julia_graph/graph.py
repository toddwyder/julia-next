"""The build-and-test graph (JUL-118): one card, one builder, the tests, the result on the card.

    Resume -> Prepare -> Build -> Test -> Report -> end
                           \\        \\
                            `--------`--> Report (with the failure)

Every step saves the card's progress before the next one starts
(``checkpoint.py``). A restart enters at ``Resume``, which picks up from the
saved step and never counts unfinished work as done:

* a builder that was started but never reported is announced on the card as
  interrupted, and its uncommitted edits are discarded before a new attempt;
* no builder or test run starts while an earlier one is still alive;
* the result comment is posted once, keyed on the card by its marker line.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Protocol

from pydantic_graph import BaseNode, End, GraphBuilder, GraphRunContext

from .checkpoint import CardRun, Checkpoint, TestResult

MAX_BUILD_ATTEMPTS = 2


class Linear(Protocol):
    async def card(self, card: str) -> dict: ...  # {identifier, title, description, comments: [body]}
    async def comment(self, card: str, body: str) -> None: ...


@dataclass
class BuildResult:
    ok: bool
    reason: str | None = None
    report: str | None = None


@dataclass
class Deps:
    linear: Linear
    checkpoint: Checkpoint
    # Makes the card's working copy at the base commit, or finds the one a
    # previous run made. Returns a refusal reason or None.
    prepare: Callable[[CardRun], Awaitable[str | None]]
    builder: Callable[[CardRun, str], Awaitable[BuildResult]]
    # discard puts the working copy back to the base commit and returns how
    # many files and commits it threw away. commit commits what the builder
    # left and returns (commit, None) or (None, reason); the commit comes from
    # git, never from the builder's report.
    discard: Callable[[CardRun], Awaitable[int]]
    commit: Callable[[CardRun], Awaitable[tuple[str | None, str | None]]]
    tester: Callable[[CardRun], Awaitable[TestResult]]
    # The processes of a worker kind ('builder' or 'tests') still alive on the
    # machine, and a wait for them to end, so a restart never adds a second one.
    live_workers: Callable[[str], list[int]]
    wait_for_exit: Callable[[str], Awaitable[list[int]]]
    graph_version: str = 'unknown'
    log: Callable[[str], None] = field(default=print)


def marker(step: str, run: CardRun, **fields: object) -> str:
    extra = ''.join(f' {k}={v}' for k, v in fields.items())
    return f'graph: {step} card={run.card} base={run.base[:12]}{extra}'


async def say_once(ctx: GraphRunContext[CardRun, Deps], text: str, line: str) -> None:
    """Post a comment unless the card already has one with this marker line."""
    card = await ctx.deps.linear.card(ctx.state.card)
    if any(line in body for body in card['comments']):
        return
    await ctx.deps.linear.comment(ctx.state.card, f'{text}\n\n{line}')


def save(ctx: GraphRunContext[CardRun, Deps]) -> None:
    ctx.deps.checkpoint.save(ctx.state)


async def no_second_worker(ctx: GraphRunContext[CardRun, Deps], kind: str) -> str | None:
    """Wait for any earlier worker of this kind to end; refuse if it will not."""
    if not ctx.deps.live_workers(kind):
        return None
    ctx.deps.log(f'an earlier {kind} is still running; waiting for it to end')
    still = await ctx.deps.wait_for_exit(kind)
    if still:
        return f'an earlier {kind} is still running (process {", ".join(map(str, still))}), so the graph did not start a second one'
    return None


def fail(ctx: GraphRunContext[CardRun, Deps], reason: str) -> Report:
    ctx.state.failure = reason
    ctx.state.step = 'report'
    save(ctx)
    return Report()


@dataclass
class Resume(BaseNode[CardRun, Deps, str]):
    async def run(self, ctx: GraphRunContext[CardRun, Deps]) -> Prepare | Build | Test | Report | End[str]:
        s = ctx.state
        if s.step == 'done':
            return End('already reported')
        if s.step == 'prepare':
            return Prepare()
        if s.step == 'build':
            if s.build_started:
                # The builder was started and never reported: it is not done.
                if reason := await no_second_worker(ctx, 'builder'):
                    return fail(ctx, reason)
                discarded = await ctx.deps.discard(s)
                await say_once(
                    ctx,
                    f'Builder attempt {s.attempt} was interrupted before it reported. '
                    f'The graph discarded {discarded} uncommitted file(s) it left and did not count it as done.',
                    marker('build-interrupted', s, attempt=s.attempt),
                )
                s.build_started = False
                save(ctx)
            return Build()
        if s.step == 'test':
            if reason := await no_second_worker(ctx, 'tests'):
                return fail(ctx, reason)
            return Test()
        return Report()


@dataclass
class Prepare(BaseNode[CardRun, Deps, str]):
    async def run(self, ctx: GraphRunContext[CardRun, Deps]) -> Build | Report:
        if refusal := await ctx.deps.prepare(ctx.state):
            return fail(ctx, f'the working copy could not be prepared: {refusal}')
        await say_once(
            ctx,
            f'The Pydantic graph started on this card ({ctx.deps.graph_version}), '
            f'from base commit `{ctx.state.base[:12]}`.',
            marker('started', ctx.state),
        )
        ctx.state.step = 'build'
        save(ctx)
        return Build()


def builder_brief(card: dict, run: CardRun) -> str:
    return f"""You are the builder for Linear card {card['identifier']}: {card['title']}.

Make the change this card asks for, in the working folder. Follow the card's
acceptance criteria exactly and change nothing outside them. Add or update the
tests that prove the change (node:test files named scripts/*.test.mjs).

You can read and edit files only; you cannot run commands. The graph commits
your edits and runs the test suite itself after you finish.

When you are done, end with a short final report: what you changed, and for
each acceptance criterion, where it is met. If you cannot do the work, say
BLOCKED and why.

<card>
{card['description']}
</card>
"""


@dataclass
class Build(BaseNode[CardRun, Deps, str]):
    async def run(self, ctx: GraphRunContext[CardRun, Deps]) -> Test | Report:
        s = ctx.state
        if s.attempt >= MAX_BUILD_ATTEMPTS:
            return fail(ctx, f'the builder did not finish in {MAX_BUILD_ATTEMPTS} attempts')
        if reason := await no_second_worker(ctx, 'builder'):
            return fail(ctx, reason)
        card = await ctx.deps.linear.card(s.card)
        s.attempt += 1
        s.build_started = True
        save(ctx)  # saved before the builder starts, so a crash is seen on restart
        await say_once(ctx, f'Builder attempt {s.attempt} started.', marker('build-started', s, attempt=s.attempt))
        result = await ctx.deps.builder(s, builder_brief(card, s))
        s.build_started = False
        if not result.ok:
            return fail(ctx, f'the builder failed: {result.reason}')
        commit, reason = await ctx.deps.commit(s)
        if not commit:
            return fail(ctx, f'the builder reported done, but {reason}')
        s.commit = commit
        s.builder_report = result.report
        s.step = 'test'
        save(ctx)
        return Test()


@dataclass
class Test(BaseNode[CardRun, Deps, str]):
    async def run(self, ctx: GraphRunContext[CardRun, Deps]) -> Report:
        ctx.state.tests = await ctx.deps.tester(ctx.state)
        ctx.state.step = 'report'
        save(ctx)
        return Report()


def result_text(s: CardRun, version: str) -> tuple[str, str]:
    passed = s.failure is None and s.tests is not None and s.tests.passed
    lines = [f'**Pydantic graph result: {"PASSED" if passed else "FAILED"}**', '']
    lines.append(f'- Graph: {version}')
    lines.append(f'- Base commit: `{s.base}`')
    lines.append(f'- Candidate commit: `{s.commit}`' if s.commit else '- Candidate commit: none')
    if s.failure:
        lines.append(f'- Failure: {s.failure}')
    if s.tests:
        lines.append(f'- Tests: {s.tests.summary}')
        lines.extend(f'  - failing: {name}' for name in s.tests.failing[:20])
    elif s.commit:
        lines.append('- Tests: not run')
    if s.builder_report:
        report = s.builder_report.strip()
        lines += ['', "Builder's final report:", '', '> ' + report[:3000].replace('\n', '\n> ')]
    return '\n'.join(lines), 'passed' if passed else 'failed'


@dataclass
class Report(BaseNode[CardRun, Deps, str]):
    async def run(self, ctx: GraphRunContext[CardRun, Deps]) -> End[str]:
        text, outcome = result_text(ctx.state, ctx.deps.graph_version)
        await say_once(ctx, text, marker('result', ctx.state, commit=ctx.state.commit or 'none', outcome=outcome))
        ctx.state.step = 'done'
        save(ctx)
        return End(outcome)


def build_graph():
    g = GraphBuilder(state_type=CardRun, deps_type=Deps, output_type=str)

    @g.step
    async def begin(ctx) -> Resume:
        return Resume()

    g.add(
        g.edge_from(g.start_node).to(begin),
        g.node(Resume),
        g.node(Prepare),
        g.node(Build),
        g.node(Test),
        g.node(Report),
    )
    return g.build()


GRAPH = build_graph()


async def run_card(state: CardRun, deps: Deps) -> str:
    """Run (or resume) one card. The card's lock is held for the whole run."""
    deps.checkpoint.lock()
    try:
        saved = deps.checkpoint.load()
        if saved is None:
            deps.checkpoint.save(state)
        else:
            state = saved
        return await GRAPH.run(state=state, deps=deps)
    finally:
        deps.checkpoint.unlock()
