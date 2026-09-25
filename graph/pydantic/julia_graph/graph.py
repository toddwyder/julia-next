"""The card graph (JUL-118, JUL-128): one card, one builder, the tests, an
independent review, the result on the card.

    Resume -> Prepare -> Build -> Test -> Review -> Report -> end
                           ^       |        |
                           |<------'        |   failed tests, at most MAX_TEST_REPAIRS times
                           |<---------------'   review findings, at most MAX_REVIEW_ROUNDS rounds
                   (any failure goes straight to Report)

Failed tests that name what failed go back to the builder, with the failures,
to repair on top of its own commit; the repaired commit is tested again. Once
the repairs are used up the result says the tests still failed, with each run.

Passing tests go to a reviewer from a different model maker than the
builder. Its findings go back to the builder, on top of its own commit, and
the new commit is tested and reviewed again. After MAX_REVIEW_ROUNDS rounds of
findings the card stops with every round's reasons in one comment. Only a
clear final verdict counts: a reviewer that crashes, runs out of time or ends
without one never approves, and one that changed the candidate is voided.

Every step saves the card's progress before the next one starts
(``checkpoint.py``). A restart enters at ``Resume``, which picks up from the
saved step and never counts unfinished work as done:

* a builder that was started but never reported is announced on the card as
  interrupted, and its uncommitted edits are discarded before a new attempt;
* no builder or test run starts while an earlier one is still alive;
* the result comment is posted once, keyed on the card by its marker line.
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

from pydantic_graph import BaseNode, End, GraphBuilder, GraphRunContext

from .checkpoint import CardRun, Checkpoint, ReviewResult, StepMark, TestResult
from .status import day, duration, render, status_marker

# Builder runs for one build or one repair: an interrupted run is tried again once.
MAX_BUILD_ATTEMPTS = 2
# Times failed tests go back to the builder before the card reports the failure.
MAX_TEST_REPAIRS = 2
# Review rounds that may end in findings before the card stops (JUL-128).
MAX_REVIEW_ROUNDS = 2
# One review is one prompt, and DeepSeek's seat hands it to Pi as a single
# command argument, which Linux caps at 128 KiB (E2BIG): a bigger brief is
# refused, never cut short (the same limit as scripts/julia-minimal-runner.mjs).
MAX_REVIEW_BYTES = 130_000
# The reviewer's standing orders, read from the card's start commit.
REVIEWER_ROLE_FILE = '.agents/skills/julia-reviewer/SKILL.md'
# Each worker's time limit in seconds. Each worker's own launcher enforces it
# (ops/julia-runner/time-limit.mjs; the reviewer's through run-reviewer.mjs),
# so a worker is stopped, with everything it started, even if the graph dies.
LIMITS = {'builder': 60 * 60, 'tests': 15 * 60, 'reviewer': 20 * 60}
# The most each launcher accepts (time-limit.mjs LIMITS.max): a longer limit
# would be quoted on the card but never enforced, so it is refused.
LIMIT_CAPS = {'builder': 3 * 60 * 60, 'tests': 60 * 60, 'reviewer': 60 * 60}
WHAT = {'builder': 'The builder', 'tests': 'The test run', 'reviewer': 'The reviewer'}
# The only reasons a stopped card goes to Todd (JUL-128 AC 5), as the reviewer
# names them in its verdict's "todd" field.
TODD_REASONS = {
    'account_action': 'an account action',
    'money_decision': 'a money decision',
    'product_decision': 'a product decision',
}


def checked_limit(kind: str, text: str) -> int:
    """A time limit from the command line: whole seconds, above 0, within the launcher's cap."""
    seconds = int(text)
    if not 0 < seconds <= LIMIT_CAPS[kind]:
        raise ValueError(f'the {kind} limit must be 1 to {LIMIT_CAPS[kind]} seconds, not {seconds}')
    return seconds


class Linear(Protocol):
    # {identifier, title, description, comments: [{id, body}]}, oldest comment first
    async def card(self, card: str) -> dict: ...
    async def comment(self, card: str, body: str) -> str: ...  # returns the new comment's id
    async def edit(self, comment_id: str, body: str) -> None: ...
    async def assign_to_todd(self, card: str) -> None: ...


@dataclass
class BuildResult:
    ok: bool
    reason: str | None = None
    report: str | None = None
    # True when the builder was stopped for running past its time limit.
    stopped: bool = False


@dataclass
class Deps:
    linear: Linear
    checkpoint: Checkpoint
    # Makes the card's working copy at the base commit, or finds the one a
    # previous run made. Returns a refusal reason or None.
    prepare: Callable[[CardRun], Awaitable[str | None]]
    # builder(run, brief, limit_seconds, progress): progress() is awaited on
    # each line of the builder's output, so the card shows it is still moving.
    builder: Callable[[CardRun, str, int, Callable[[], Awaitable[None]]], Awaitable[BuildResult]]
    # discard puts the working copy back to the base commit and returns how
    # many files and commits it threw away. commit commits what the builder
    # left and returns (commit, None) or (None, reason); the commit comes from
    # git, never from the builder's report.
    discard: Callable[[CardRun], Awaitable[int]]
    commit: Callable[[CardRun], Awaitable[tuple[str | None, str | None]]]
    # tester(run, limit_seconds, progress), progress as for the builder
    tester: Callable[[CardRun, int, Callable[[], Awaitable[None]]], Awaitable[TestResult]]
    # reviewer(run, brief, limit_seconds, progress): the independent reviewer.
    # It gets the whole review in its brief and runs where it cannot reach the
    # working copy; its verdict is read from its final message only.
    reviewer: Callable[[CardRun, str, int, Callable[[], Awaitable[None]]], Awaitable[ReviewResult]]
    # The processes of a worker kind ('builder', 'tests' or 'reviewer') still
    # alive on the machine, and a wait for them to end, so a restart never adds
    # a second one.
    live_workers: Callable[[str], list[int]]
    wait_for_exit: Callable[[str], Awaitable[list[int]]]
    # What the working copy holds, as (HEAD commit, `git status` output): taken
    # before and after a review, so a reviewer that changed anything is caught.
    # restore puts it back to a commit, with nothing uncommitted left.
    snapshot: Callable[[CardRun], tuple[str, str]]
    restore: Callable[[CardRun, str], Awaitable[None]]
    # How the working copy differs from a commit, or '' (workers.drift).
    drift: Callable[[CardRun, str], str]
    # The change under review (the diff from the base) and a file as it was at
    # the base commit (the reviewer's role file), both read from git.
    diff: Callable[[CardRun], str]
    base_file: Callable[[CardRun, str], str]
    graph_version: str = 'unknown'
    log: Callable[[str], None] = field(default=print)
    now: Callable[[], datetime] = field(default=lambda: datetime.now(timezone.utc))
    # Who each kind of worker is, and the company that makes its model, in the
    # words the card shows. The reviewer's maker must differ from the builder's.
    worker_names: dict[str, str] = field(default_factory=lambda: {'builder': 'the builder', 'tests': 'the test runner',
                                                                  'reviewer': 'the reviewer'})
    worker_makers: dict[str, str] = field(default_factory=dict)
    limits: dict[str, int] = field(default_factory=lambda: dict(LIMITS))
    # Worker output moves the card at once, but edits its comment at most this often.
    status_every: float = 60
    # The files in the card's working copy, listed in the builder's brief.
    files: Callable[[CardRun], list[str]] = field(default=lambda run: [])


def marker(step: str, run: CardRun, **fields: object) -> str:
    extra = ''.join(f' {k}={v}' for k, v in fields.items())
    return f'graph: {step} card={run.card} base={run.base[:12]}{extra}'


async def say_once(ctx: GraphRunContext[CardRun, Deps], text: str, line: str) -> None:
    """Post a comment unless the card already has one with this marker line."""
    card = await ctx.deps.linear.card(ctx.state.card)
    if any(line in c['body'] for c in card['comments']):
        return
    await ctx.deps.linear.comment(ctx.state.card, f'{text}\n\n{line}')


def save(ctx: GraphRunContext[CardRun, Deps]) -> None:
    ctx.deps.checkpoint.save(ctx.state)


# ------------------------------------------------------------ where the card is

async def show(ctx: GraphRunContext[CardRun, Deps]) -> None:
    """Edit the card's one status comment, first finding it by its marker if the
    saved progress has no id for it (a crash can fall between posting and saving).
    Linear being unreachable never stops the run: the card simply stops moving,
    which is what the stuck check looks for."""
    s = ctx.state
    text = render(s)
    try:
        if s.status_id is None:
            card = await ctx.deps.linear.card(s.card)
            line = status_marker(s)
            s.status_id = next((c['id'] for c in card['comments'] if line in c['body']), None)
            if s.status_id is None:
                s.status_id = await ctx.deps.linear.comment(s.card, text)
            else:
                await ctx.deps.linear.edit(s.status_id, text)
        else:
            await ctx.deps.linear.edit(s.status_id, text)
    except Exception as error:
        ctx.deps.log(f'the status comment could not be updated: {type(error).__name__}: {error}')
        return
    s.shown_at = s.moved_at
    save(ctx)


def open_mark(s: CardRun) -> StepMark | None:
    return s.marks[-1] if s.marks and s.marks[-1].outcome is None else None


def close(ctx: GraphRunContext[CardRun, Deps], outcome: str) -> None:
    """End the running step (if any) with this outcome: 'done' or a few words."""
    now = ctx.deps.now()
    if mark := open_mark(ctx.state):
        mark.outcome, mark.ended = outcome, now
    ctx.state.moved_at = now
    save(ctx)


async def step(ctx: GraphRunContext[CardRun, Deps], doing: str, done: str, kind: str | None = None) -> None:
    """Start a step on the card: any step still running ends as done."""
    close(ctx, 'done')
    ctx.state.marks.append(StepMark(
        doing=doing, done=done, worker=ctx.deps.worker_names.get(kind) if kind else None,
        limit=ctx.deps.limits.get(kind) if kind else None, started=ctx.deps.now(),
    ))
    save(ctx)
    await show(ctx)


async def moved(ctx: GraphRunContext[CardRun, Deps]) -> None:
    """The worker produced output: the card moved, and its comment says so at most once a minute."""
    s = ctx.state
    s.moved_at = ctx.deps.now()
    if s.shown_at is None or (s.moved_at - s.shown_at).total_seconds() >= ctx.deps.status_every:
        await show(ctx)


async def stopped(ctx: GraphRunContext[CardRun, Deps], kind: str) -> Report:
    """A worker was stopped for running too long. The stop is saved before the
    graph waits to see the worker gone, so a crash in that wait resumes as the
    same confirmation (Resume) and never starts the worker again."""
    s = ctx.state
    mark = open_mark(s)
    s.stop_kind = kind
    s.stop_ran = (ctx.deps.now() - mark.started).total_seconds() if mark else 0
    s.ending = f'Stopped: {WHAT[kind].lower()} ran too long. The result comment says what happened.'
    s.step = 'report'
    close(ctx, f'stopped after {duration(s.stop_ran)}')  # saves
    await confirm_stop(ctx)
    return Report()


async def confirm_stop(ctx: GraphRunContext[CardRun, Deps]) -> None:
    """Say which step ran too long, for how long, and whether it is gone. The
    builder is free again only once no process of the worker remains."""
    s = ctx.state
    kind = s.stop_kind
    reason = (f'{WHAT[kind]} ran longer than its {duration(ctx.deps.limits[kind])} time limit '
              f'and was stopped after {duration(s.stop_ran)}.')
    still = ctx.deps.live_workers(kind)
    if still:
        still = await ctx.deps.wait_for_exit(kind)
    if still:
        after = {'builder': 'so the builder is not free', 'tests': 'so no new test run starts until it ends',
                 'reviewer': 'so no new review starts until it ends'}[kind]
        s.failure = reason + (f' The graph could not confirm it ended: it is still running '
                              f'(process {", ".join(map(str, still))}), {after}.')
    elif kind == 'builder':
        s.failure = reason + ' It is no longer running, so the builder is free for the next card.'
    else:
        s.failure = reason + ' It is no longer running.'
    s.stop_kind = None
    save(ctx)


async def no_second_worker(ctx: GraphRunContext[CardRun, Deps], kind: str) -> str | None:
    """Wait for any earlier worker of this kind to end; refuse if it will not."""
    if not ctx.deps.live_workers(kind):
        return None
    ctx.deps.log(f'an earlier {kind} is still running; waiting for it to end')
    name = {'builder': 'builder', 'tests': 'test run', 'reviewer': 'review'}[kind]
    await step(ctx, f'Waiting for an earlier {name} to end', f'Waited for an earlier {name} to end')
    still = await ctx.deps.wait_for_exit(kind)
    if still:
        close(ctx, 'it did not end')
        return f'an earlier {kind} is still running (process {", ".join(map(str, still))}), so the graph did not start a second one'
    close(ctx, 'done')
    return None


def fail(ctx: GraphRunContext[CardRun, Deps], reason: str) -> Report:
    ctx.state.failure = reason
    ctx.state.step = 'report'
    save(ctx)
    return Report()


@dataclass
class Resume(BaseNode[CardRun, Deps, str]):
    async def run(self, ctx: GraphRunContext[CardRun, Deps]) -> Prepare | Build | Test | Review | Report | End[str]:
        s = ctx.state
        if s.step == 'done':
            return End('already reported')
        if open_mark(s):
            # A step the card showed as running never finished: the graph died in it.
            close(ctx, 'interrupted')
        if s.stop_kind:
            await confirm_stop(ctx)  # the graph died while seeing a stopped worker gone
            return Report()
        if s.step in ('build', 'test', 'review') and Path(s.worktree, '.git').is_file():
            # An older graph made this working copy with `git worktree add`: its
            # .git points out of the builder's folder, and following it ended
            # every build (JUL-127). Start again from a fresh copy; Prepare
            # keeps the old one aside. Any worker still running goes first.
            for kind in ('builder', 'tests', 'reviewer'):
                if reason := await no_second_worker(ctx, kind):
                    return fail(ctx, reason)
            await say_once(ctx, "This card's working copy was made by an older version of the graph, and its git "
                                "data points outside the builder's folder. The old copy is kept aside and the card "
                                'starts again from a fresh one.', marker('fresh-copy', s))
            s.step, s.build_started, s.attempt, s.tries = 'prepare', False, 0, 0
            s.commit, s.builder_report, s.tests = None, None, None
            s.repairs, s.repair_from, s.test_rounds = 0, None, []
            s.review, s.round_reasons, s.fixing, s.needs_todd = None, [], None, None
            save(ctx)
            return Prepare()
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
        if s.step == 'review':
            if reason := await no_second_worker(ctx, 'reviewer'):
                return fail(ctx, reason)
            return Review()
        return Report()


@dataclass
class Prepare(BaseNode[CardRun, Deps, str]):
    async def run(self, ctx: GraphRunContext[CardRun, Deps]) -> Build | Report:
        await step(ctx, 'Preparing the working copy', 'Prepared the working copy')
        if refusal := await ctx.deps.prepare(ctx.state):
            close(ctx, 'refused')
            return fail(ctx, f'the working copy could not be prepared: {refusal}')
        if ctx.state.uat_locked_at is None:
            # Started by hand rather than from Ready: the UAT steps lock now.
            card = await ctx.deps.linear.card(ctx.state.card)
            ctx.state.uat_plan, ctx.state.uat_locked_at = uat_section(card['description']), ctx.deps.now()
            save(ctx)
        await say_once(
            ctx,
            f'The Pydantic graph started on this card ({ctx.deps.graph_version}), '
            f'from base commit `{ctx.state.base[:12]}`. {uat_note(ctx.state)}',
            marker('started', ctx.state),
        )
        ctx.state.step = 'build'
        close(ctx, 'done')  # saves; the card never shows a finished step as still running
        return Build()


MAX_LISTED_FILES = 3000


def listed(ctx: GraphRunContext[CardRun, Deps]) -> list[str]:
    """The working copy's files for the brief; a brief without them still works."""
    try:
        return ctx.deps.files(ctx.state)
    except Exception as error:
        ctx.deps.log(f'the file list for the brief could not be read: {type(error).__name__}: {error}')
        return []


def builder_brief(card: dict, run: CardRun, files: list[str] | None = None) -> str:
    return f"""You are the builder for Linear card {card['identifier']}: {card['title']}.

Make the change this card asks for, in the working folder. Follow the card's
acceptance criteria exactly and change nothing outside them. Add or update the
tests that prove the change (node:test files named scripts/*.test.mjs).

What you may do in this run: read and edit files inside your working folder,
{run.worktree}, and nothing else. Do not run any command, not even to list
files or run tests, and do not start subagents. Do not read anything outside
the working folder. Any of these is refused, and a refusal ends your turn and
fails the card. This overrides any file in the repository (AGENTS.md, CLAUDE.md,
role or skill files) that tells you to run tests or commands: in this run the
graph commits your edits and runs the test suite itself after you finish.
{files_part(files or [])}
This card starts from commit {run.base}.

When you are done, end with a short final report: what you changed, and for
each acceptance criterion, where it is met. If you cannot do the work, say
BLOCKED and why.

<card>
{with_locked_uat(card['description'], run.uat_plan)}
</card>
""" + instructions_part(card)


def files_part(files: list[str]) -> str:
    """The repository's files, so the builder never needs to scan the folder
    (Gemini's subagent once ran `find` for that, and was refused)."""
    if not files:
        return ''
    shown = files[:MAX_LISTED_FILES]
    more = f'\n(and {len(files) - len(shown)} more)' if len(files) > len(shown) else ''
    return '\nThe files in your working folder (from git, before your changes):\n\n<files>\n' + '\n'.join(shown) + more + '\n</files>\n'


# ------------------------------------------------------------ the locked UAT steps (JUL-127)

UAT_HEADING = re.compile(r'^[ \t]*##[ \t]+UAT plan[ \t]*$', re.I | re.M)
SECTION_END = re.compile(r'^[ \t]*#{1,2}[ \t]', re.M)
INSTRUCTION = re.compile(r'^\W*instruction\b', re.I)


def uat_section(description: str) -> str | None:
    """The card's "## UAT plan" section, heading included, up to the next
    heading of level 2 or above; None when the card has none. The same heading
    rule as scripts/acceptance-check.mjs."""
    start = UAT_HEADING.search(description)
    if not start:
        return None
    end = SECTION_END.search(description, start.end())
    return description[start.start():end.start() if end else len(description)].rstrip()


def with_locked_uat(description: str, locked: str | None) -> str:
    """The card as the builder sees it: today's text, but the UAT steps as they
    were when the card started. An edit to them since then does not count."""
    if locked is None:
        return description
    now = uat_section(description)
    if now is None:
        return description.rstrip() + '\n\n' + locked
    return description.replace(now, locked, 1)


def uat_note(run: CardRun) -> str:
    if run.uat_plan is None:
        return 'The card had no UAT plan when it started.'
    steps = len(re.findall(r'^ {0,2}\d+\.\s+\S', run.uat_plan, re.M))
    return (f'Its UAT plan ({steps} step{"" if steps == 1 else "s"}) is locked as it was at {day(run.uat_locked_at)}: '
            'a later edit to it does not count, only a new Instruction comment does.')


def instructions_part(card: dict) -> str:
    """Todd's Instruction comments, oldest first: they override the card, and
    they are the only way to change the UAT steps once the card has started."""
    found = [c['body'].strip() for c in card['comments'] if INSTRUCTION.match(c['body'])]
    if not found:
        return ''
    return ('\nTodd posted these Instruction comments on the card. They override the card text, '
            'including its UAT plan:\n\n' + '\n\n'.join(f'<instruction>\n{text}\n</instruction>' for text in found) + '\n')


@dataclass
class Build(BaseNode[CardRun, Deps, str]):
    async def run(self, ctx: GraphRunContext[CardRun, Deps]) -> Test | Report:
        s = ctx.state
        if s.tries >= MAX_BUILD_ATTEMPTS:
            what = {'tests': f'repair {s.repairs}', 'review': f'fix for review round {len(s.round_reasons)}'}.get(s.fixing, 'build')
            return fail(ctx, f'the builder did not finish the {what} in {MAX_BUILD_ATTEMPTS} attempts')
        if s.fixing == 'tests':
            # Said here, not in Test, so a restart between the two still says it.
            await say_once(ctx, repair_notice(s), marker('tests-failed', s, commit=s.repair_from))
        if s.fixing == 'review':
            await post_review(ctx)  # the same, for the review that asked for changes
        if reason := await no_second_worker(ctx, 'builder'):
            return fail(ctx, reason)
        card = await ctx.deps.linear.card(s.card)
        s.attempt += 1
        s.tries += 1
        s.build_started = True
        save(ctx)  # saved before the builder starts, so a crash is seen on restart
        await say_once(ctx, f'Builder attempt {s.attempt} started.', marker('build-started', s, attempt=s.attempt))
        why = {'tests': ', repairing failed tests', 'review': ', fixing review findings'}.get(s.fixing, '')
        await step(ctx, f'Building (attempt {s.attempt}{why})', f'Built (attempt {s.attempt}{why})', 'builder')
        brief = builder_brief(card, s, listed(ctx)) + repair_part(s) + findings_part(s)
        try:
            result = await ctx.deps.builder(s, brief, ctx.deps.limits['builder'], lambda: moved(ctx))
        except Exception as error:  # a worker that cannot even start is a failed worker
            s.build_started = False
            close(ctx, 'could not start')
            return fail(ctx, f'the builder could not run: {type(error).__name__}: {error}')
        s.build_started = False
        if result.stopped:
            return await stopped(ctx, 'builder')
        if not result.ok:
            close(ctx, 'failed')
            return fail(ctx, f'the builder failed: {result.reason}')
        commit, reason = await ctx.deps.commit(s)
        if not commit:
            close(ctx, 'changed nothing')
            return fail(ctx, f'the builder reported done, but {reason}')
        s.commit = commit
        s.builder_report = result.report
        s.step = 'test'
        close(ctx, 'done')  # saves, so a restart from here never shows the build as interrupted
        return Test()


def failing_lines(tests: TestResult, most: int) -> str:
    return ''.join(f'\n- failing: {name}' for name in tests.failing[:most])


def repair_notice(s: CardRun) -> str:
    return (f'The tests failed on candidate `{s.repair_from}`: {s.tests.summary}{failing_lines(s.tests, 20)}\n\n'
            f'The builder gets the failures to repair on top of that commit (repair {s.repairs} of {MAX_TEST_REPAIRS}), '
            'and the repaired commit is tested again.')


def repair_part(s: CardRun) -> str:
    """The failed tests, for a repair: the builder cannot run them itself."""
    if s.fixing != 'tests':
        return ''
    return f"""
## The tests failed on your last commit

This is repair {s.repairs} of {MAX_TEST_REPAIRS}. Your earlier work is already
committed in the working folder (commit {s.repair_from}): change it, do not
start again. The graph ran the tests on that commit and they failed:

- {s.tests.summary}{failing_lines(s.tests, 50)}

<test-failures>
{s.tests.details or '(the test run gave no more detail)'}
</test-failures>

Fix the change so these tests pass and the card's acceptance criteria are still
met. If a test is itself wrong about what the card asks, correct the test and
say so in your final report.
"""


def findings_part(s: CardRun) -> str:
    """The reviewer's findings, for the round that fixes them."""
    if s.fixing != 'review' or not s.round_reasons:
        return ''
    return f"""
## The independent review asked for changes

Review round {len(s.round_reasons)} of {MAX_REVIEW_ROUNDS} found problems with your
last commit ({s.repair_from}). Your earlier work is already committed in the
working folder: change it, do not start again. Address every finding:

<findings>
{s.round_reasons[-1].strip()}
</findings>

Say in your final report how each finding was addressed.
"""


@dataclass
class Test(BaseNode[CardRun, Deps, str]):
    async def run(self, ctx: GraphRunContext[CardRun, Deps]) -> Build | Review | Report:
        s = ctx.state
        await step(ctx, 'Running the tests', 'Ran the tests', 'tests')
        try:
            s.tests = await ctx.deps.tester(s, ctx.deps.limits['tests'], lambda: moved(ctx))
        except Exception as error:  # reported once, not retried on every restart
            s.tests = TestResult(passed=False, summary=f'the test worker could not run: {type(error).__name__}: {error}')
        s.test_rounds.append(f'`{(s.commit or "none")[:12]}`: {s.tests.summary}')
        if s.tests.stopped:
            return await stopped(ctx, 'tests')
        # Only a finished run that names what failed is the builder's to repair;
        # a test worker that did not run or answer is reported as it is.
        if not s.tests.passed and s.tests.failing:
            if s.repairs < MAX_TEST_REPAIRS:
                s.repairs, s.repair_from, s.tries, s.step = s.repairs + 1, s.commit, 0, 'build'
                s.fixing = 'tests'
                close(ctx, 'failed')  # saves
                return Build()
            s.failure = f'the tests still failed after {MAX_TEST_REPAIRS} repair attempts'
        if not s.tests.passed:
            s.step = 'report'
            close(ctx, 'failed')  # saves
            return Report()
        s.step = 'review'
        close(ctx, 'done')  # saves
        return Review()


# ------------------------------------------------------------ the independent review (JUL-128)

# The acceptance criteria, numbered as scripts/acceptance-check.mjs numbers them:
# the checkbox items under an "Acceptance criteria" heading (or bold label), up
# to a heading of the same level or higher; struck-through items do not count.
CHECKBOX = re.compile(r'^\s*[-*]\s+\[( |x|X)\]\s+(.*)$')
ACCEPTANCE_HEADING = re.compile(r'^\s*(#{1,6})?\s*\**\s*acceptance criteria\s*:?\s*\**\s*:?\s*$', re.I)
HEADING = re.compile(r'^\s*(#{1,6})\s')


def acceptance_criteria(description: str) -> list[tuple[str, str]]:
    """[(id, text)]: AC1, AC2, ... in order."""
    found, level = [], None
    for line in (description or '').split('\n'):
        line = line.rstrip('\r')
        if opening := ACCEPTANCE_HEADING.match(line):
            level = len(opening[1]) if opening[1] else 6
            continue
        if level is None:
            continue
        if (heading := HEADING.match(line)) and len(heading[1]) <= level:
            level = None
            continue
        if (box := CHECKBOX.match(line)) and not box[2].strip().startswith('~~'):
            found.append((f'AC{len(found) + 1}', box[2].strip()))
    return found


def normalize(text: object) -> str:
    """Markdown, links and punctuation out, words kept (acceptance-check.mjs normalize)."""
    text = re.sub(r'<[^>]+>', ' ', str(text or ''))
    text = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', text)
    text = re.sub(r'[*_`~>#]', ' ', text)
    return ' '.join(re.sub(r'[^\w]+|_', ' ', text).split()).lower()


def criteria_gaps(description: str, answers: list[dict]) -> list[str]:
    """Why an approval does not cover the card: each criterion needs an answer
    naming its id and its words, found "met", saying how it was checked."""
    wanted = acceptance_criteria(description)
    if not wanted:
        return ['the card lists no acceptance criteria to approve against']
    gaps = []
    for ac, text in wanted:
        answer = next((a for a in answers if str(a.get('id', '')).upper() == ac
                       and normalize(text) and normalize(text) in normalize(a.get('criterion'))), None)
        if answer is None:
            gaps.append(f'{ac} was not checked by name')
        elif answer.get('verdict') != 'met':
            gaps.append(f'{ac} was found {answer.get("verdict")!r}, not "met"')
        elif not str(answer.get('how') or '').strip():
            gaps.append(f'{ac} was called met without saying how it was checked')
    return gaps


def reviewer_brief(card: dict, run: CardRun, role: str, diff: str) -> str:
    """Everything the reviewer sees: its role file (from the start commit), the
    card with its locked UAT steps, the graph's own test result, the builder's
    report and the whole change. It runs where it cannot open the working copy,
    so this is the whole review."""
    commits = f'{run.base[:12]}..{(run.commit or "")[:12]}'
    report = (run.builder_report or '(none)').strip()
    return f"""You are the independent reviewer for Linear card {card['identifier']}: {card['title']}.

Your standing orders are your role file, below. In this run two things differ
from it: you cannot open the working copy or run anything, so the change, the
card and the graph's test result below are the whole review; and "the
controller" in it is the graph, which runs the tests once, checks that the
candidate is unchanged after you finish, and posts your verdict on the card.

<role-file path="{REVIEWER_ROLE_FILE}">
{role.strip()}
</role-file>

<card>
{with_locked_uat(card['description'], run.uat_plan)}
</card>
{instructions_part(card)}
The acceptance criteria, by id:
{chr(10).join(f'- {ac}: {text}' for ac, text in acceptance_criteria(card['description'])) or '(none found on the card)'}

The candidate is commit {run.commit}, from start commit {run.base} ({commits}).

<test-result>
The graph ran the tests once on the candidate: {run.tests.summary if run.tests else 'not run'}
</test-result>

<builder-report>
{report}
</builder-report>

<diff>
{diff.strip() or '(no changes)'}
</diff>

End your final message with the single JSON object your role file describes,
and nothing after it: that object is your verdict, and only it counts. Earlier
text does not. Its "criteria" list must answer every criterion above by its id
and its exact words; an approval that leaves one out does not count. If your findings cannot be fixed by the builder because they
need Todd himself, add "todd": "account_action", "money_decision" or
"product_decision", and "todd_reason": "<why, in one sentence>". Use it for
nothing else: an ordinary defect never needs Todd.
"""


def verdict_text(s: CardRun, review: ReviewResult) -> str:
    lines = [f'**Independent review of `{(s.commit or "")[:12]}`: {"APPROVED" if review.verdict == "approve" else "CHANGES NEEDED"}**',
             '', f'- Reviewer: {review.reviewer}', f'- Model that ran: {review.model or "not reported"}',
             f'- Round: {review.round} of {MAX_REVIEW_ROUNDS}']
    if review.summary:
        lines.append(f'- Summary: {review.summary.strip()}')
    if review.verdict != 'approve' and review.findings:
        lines += ['', '**Findings:**', '', review.findings.strip()]
    return '\n'.join(lines)


@dataclass
class Review(BaseNode[CardRun, Deps, str]):
    async def run(self, ctx: GraphRunContext[CardRun, Deps]) -> Build | Report:
        s = ctx.state
        who = ctx.deps.worker_names.get('reviewer', 'the reviewer')
        builder_maker = ctx.deps.worker_makers.get('builder', '')
        maker = ctx.deps.worker_makers.get('reviewer', '')
        if not builder_maker or not maker or builder_maker.lower() == maker.lower():
            return fail(ctx, f'the reviewer must come from a different model maker than the builder '
                             f'(builder: {builder_maker or "unknown"}, reviewer: {maker or "unknown"})')
        if reason := await no_second_worker(ctx, 'reviewer'):
            return fail(ctx, reason)
        round_ = len(s.round_reasons) + 1
        await step(ctx, f'Reviewing (round {round_})', f'Reviewed (round {round_})', 'reviewer')
        card = await ctx.deps.linear.card(s.card)
        try:
            brief = reviewer_brief(card, s, ctx.deps.base_file(s, REVIEWER_ROLE_FILE), ctx.deps.diff(s))
        except Exception as error:
            close(ctx, 'could not start')
            return fail(ctx, f'the review brief could not be made: {type(error).__name__}: {error}')
        size = len(brief.encode())
        if size > MAX_REVIEW_BYTES:
            close(ctx, 'too big')
            return fail(ctx, f'the review would be {size} bytes, over the {MAX_REVIEW_BYTES}-byte limit for one review, '
                             'so it was not started; the card needs splitting')
        # The review starts from exactly the candidate. Anything else (a crash
        # left it changed) is put back first, and the card says so when it
        # was more than a test run's ignored leftovers.
        if drifted := ctx.deps.drift(s, s.commit):
            await say_once(ctx, f'Before review round {round_}, the working copy did not match the candidate `{s.commit[:12]}` '
                                f'({drifted}). It was put back to the candidate; nothing from it is reviewed or kept.',
                           marker('review-drift', s, commit=s.commit, round=round_))
        await ctx.deps.restore(s, s.commit)
        before = ctx.deps.snapshot(s)
        try:
            review = await ctx.deps.reviewer(s, brief, ctx.deps.limits['reviewer'], lambda: moved(ctx))
        except Exception as error:  # a reviewer that cannot even run never approves
            review = ReviewResult(reason=f'the reviewer could not run: {type(error).__name__}: {error}')
        review = review.model_copy(update={'reviewer': f'{who}, from {maker}', 'round': round_})
        after = ctx.deps.snapshot(s)
        # Every outcome is saved before anything is posted; post_review (here,
        # or in Build or Report after a restart) posts it, once.
        if after != before:
            # AC 4: the reviewer changed the candidate. Whatever it said does not count.
            changed = ', '.join(x for x in (
                f'the commit moved from `{before[0][:12]}` to `{after[0][:12]}`' if after[0] != before[0] else '',
                'files in the working copy changed' if after[1] != before[1] else '') if x)
            s.review = review.model_copy(update={'ok': False, 'voided': True, 'reason': changed})
            return await failed_review(ctx, 'voided', f'the review was voided because the reviewer changed the candidate ({changed})')
        if review.ok and review.verdict == 'approve':
            if gaps := criteria_gaps(card['description'], review.criteria):
                review = review.model_copy(update={'ok': False, 'reason': 'its approval does not cover the acceptance '
                                                                         'criteria: ' + '; '.join(gaps)})
        s.review = review
        if review.stopped:
            return await stopped(ctx, 'reviewer')
        if not review.ok:
            # AC 3: no clear final verdict, whatever the reviewer wrote before.
            return await failed_review(ctx, 'no verdict', f'the review gave no clear final verdict, so it is not an approval: '
                                                          f'{review.reason}')
        if review.verdict == 'approve':
            s.step = 'report'
            close(ctx, 'done')  # saves
            await post_review(ctx)
            return Report()
        s.round_reasons.append(review.findings.strip() or review.summary.strip() or '(the reviewer gave no detail)')
        if len(s.round_reasons) < MAX_REVIEW_ROUNDS:
            s.repair_from, s.tries, s.fixing, s.step = s.commit, 0, 'review', 'build'
            close(ctx, 'changes needed')  # saves
            await post_review(ctx)
            return Build()
        # AC 2: the last round also asked for changes.
        if review.todd in TODD_REASONS:
            s.needs_todd = review.todd
        return await failed_review(ctx, 'changes needed', f'the review asked for changes in {MAX_REVIEW_ROUNDS} rounds; '
                                                          'the reasons are in one comment above')


async def failed_review(ctx: GraphRunContext[CardRun, Deps], outcome: str, reason: str) -> Report:
    """End the run on this review: the review, the failure and the next step
    are saved together, so a restart never reviews again from a changed
    working copy or a decided round; then what it says is posted."""
    ctx.state.failure, ctx.state.step = reason, 'report'
    close(ctx, outcome)  # saves
    await post_review(ctx)
    return Report()


async def post_review(ctx: GraphRunContext[CardRun, Deps]) -> None:
    """Post what the saved review says, once each: the verdict (AC 1), the stop
    with every round's reasons (AC 2), or the void (AC 4), putting a changed
    working copy back to the candidate first. Safe to run again after a restart."""
    s, review = ctx.state, ctx.state.review
    if review is None:
        return
    if review.voided:
        await ctx.deps.restore(s, s.commit)
        await say_once(ctx, f'The review by {review.reviewer} of `{(s.commit or "")[:12]}` is **void**: the reviewer '
                            f'changed the candidate ({review.reason}). Its verdict does not count, and the working copy '
                            f'was put back to `{(s.commit or "")[:12]}`.', marker('review-voided', s, commit=s.commit))
        return
    if not review.ok:
        return  # no verdict to post; the result comment says why
    await say_once(ctx, verdict_text(s, review), marker('review-verdict', s, commit=s.commit))
    if review.verdict == 'changes_needed' and len(s.round_reasons) >= MAX_REVIEW_ROUNDS:
        reasons = '\n\n'.join(f'**Round {n}:** {text}' for n, text in enumerate(s.round_reasons, 1))
        todd = (f'\n\nThe reviewer says this needs Todd: {TODD_REASONS[s.needs_todd]}. {review.todd_reason}'.rstrip()
                if s.needs_todd else '')
        await say_once(ctx, f'**The review stopped this card after {MAX_REVIEW_ROUNDS} rounds of findings.** No new card was '
                            f'opened for them.\n\n{reasons}{todd}', marker('review-stopped', s))


def result_text(s: CardRun, version: str) -> tuple[str, str]:
    passed = (
        s.failure is None
        and s.tests is not None
        and s.tests.passed
        and s.review is not None
        and s.review.ok
        and s.review.verdict == 'approve'
    )
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
    if s.repairs:
        lines.append(f'- Test runs ({s.repairs} of {MAX_TEST_REPAIRS} repairs used), oldest first:')
        lines.extend(f'  {n}. {text}' for n, text in enumerate(s.test_rounds, 1))
    if s.review:
        verdict = ('void' if s.review.voided else 'no clear verdict' if not s.review.ok
                   else 'approved' if s.review.verdict == 'approve' else 'changes needed')
        lines.append(f'- Review: {verdict}, by {s.review.reviewer}, model {s.review.model or "not reported"} '
                     f'(round {s.review.round} of {MAX_REVIEW_ROUNDS})')
    elif s.tests and s.tests.passed:
        lines.append('- Review: not run')
    if s.builder_report:
        report = s.builder_report.strip()
        lines += ['', "Builder's final report:", '', '> ' + report[:3000].replace('\n', '\n> ')]
    return '\n'.join(lines), 'passed' if passed else 'failed'


@dataclass
class Report(BaseNode[CardRun, Deps, str]):
    async def run(self, ctx: GraphRunContext[CardRun, Deps]) -> End[str]:
        await post_review(ctx)  # a no-op unless a restart fell between saving a review and posting it
        text, outcome = result_text(ctx.state, ctx.deps.graph_version)
        await say_once(ctx, text, marker('result', ctx.state, commit=ctx.state.commit or 'none', outcome=outcome))
        if not ctx.state.ending:
            ctx.state.ending = ('Finished: the tests passed and the review approved.' if outcome == 'passed'
                                else 'Finished: the run failed. The result comment says why.')
        if outcome == 'failed' and ctx.state.needs_todd in TODD_REASONS:
            # AC 5: only the reviewer's own "needs Todd" answer assigns the card,
            # and only for an account action, a money decision or a product decision.
            try:
                await ctx.deps.linear.assign_to_todd(ctx.state.card)
                await say_once(ctx, f'Assigned to Todd: the review says this needs {TODD_REASONS[ctx.state.needs_todd]}.',
                               marker('assigned-todd', ctx.state))
            except Exception as error:
                ctx.deps.log(f'the card could not be assigned to Todd: {type(error).__name__}: {error}')
        close(ctx, 'done')
        await show(ctx)
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
        g.node(Review),
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
