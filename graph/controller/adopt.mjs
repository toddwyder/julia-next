// adopt.mjs -- JUL-98 step 6: the START-THEN-ADOPT route, built ONCE and taken
// by every seat whose agent Orca has no launcher for.
//
// WHY A SECOND ROUTE EXISTS AT ALL. `worker-start --agent` knows claude, codex
// and cursor. It does not know `agy` (Gemini) or `pi` (DeepSeek), and there is
// no flag that teaches it one. The only recorded way either of those reports to
// the coordinator's mailbox is the one JUL-109 found for Pi (findings, section
// 4) and ./dispatch.mjs's old refusal spelled out in full: start the agent
// INTERACTIVELY in an Orca terminal, wait until it has fully started, then
// `worker-start --terminal <handle>` -- at which point Orca types its worker
// contract and the task into the running agent, and the agent answers
// `worker_done` like any other worker.
//
// FOUR THINGS THIS FILE IS CAREFUL ABOUT, each one a recorded failure:
//
//  1. THE FOLDER IS TRUSTED FIRST. A TUI on a folder it has not seen asks
//     whether it is trusted and then does nothing. Orca still says
//     `input_accepted`. That is the 19-20 September eight-hour stall, and agy
//     asks the same question (./agent-trust.mjs records the measurement). So
//     the trust entry is written before the agent is started, not after it
//     hangs.
//
//  2. THE REAL BRIEF IS THE ONE DISPATCH. The probe of this route on 2026-09-22
//     passed the placeholder `adopted-only` as `--spec` and then typed the real
//     brief into the terminal afterwards (the runner's own agy history holds
//     both, as separate entries). Two deliveries is two chances to lose one --
//     and the first one is what the agent is told to do. Here the brief IS the
//     spec, and nothing is typed in afterwards.
//
//  3. THE STARTUP RACE IS WAITED OUT, BY ORCA. JUL-109 lost a Pi worker's task
//     text twice by adopting a terminal while the agent was still starting.
//     `terminal wait --for tui-idle` is Orca's own answer and is used instead
//     of a sleep; `wait.satisfied` is read, because a timed-out wait still
//     prints a normal result (orca-cli skill).
//
//  4. A ROUTE THAT CANNOT FINISH TAKES BACK WHAT IT MADE -- BUT ONLY WHILE
//     NOTHING IS RUNNING YET. The terminal is
//     closed and the worktree removed, so the refusal that goes back to
//     ./dispatch.mjs is honestly `launchRefused` -- nothing created -- and
//     ./step-runner.mjs's EXISTING seat-backup path (JUL-98 step 5, fifth fix)
//     catches it with no second fallback machine. Anything the teardown itself
//     could not remove is reported as a residual resource rather than hidden.
//     ONCE `worker-start` HAS SUCCEEDED that stops being true: a worker exists,
//     it holds the brief, and it may already be spending. From that point a
//     failure here is the OBSERVATION failing, never the worker -- the dispatch
//     identity is preserved, nothing is destroyed, and ./step-runner.mjs
//     reconciles the worker through the mailbox (round 2, finding 5).
//
// Every boundary is injected; nothing here calls Orca directly. ./wiring.mjs
// supplies the real ones.

export const SEAT_TERMINAL_TITLE_PREFIX = 'julia-seat-';

// Long enough for a cold agy/pi start under real load, short enough that a
// stuck TUI is a refusal in minutes rather than the eight hours the unguarded
// version took. Raised from 180000 (Todd's Decision, 2026-09-22, after JUL-92
// attempt 4 live-timed-out here): a real pi-deepseek reviewer's own review
// turn already runs 10-12 minutes on this box (JUL-92's own recorded reviewer
// cost lines: 11.76min, 11.97min), and a busy host can make even the START
// (reaching an idle prompt, before any work begins) slower than 180s was
// budgeting for.
export const DEFAULT_TUI_WAIT_MS = 600000;

// The SECOND look, immediately after the brief is delivered: is the terminal
// still busy? Short on purpose -- this is a reading, not a wait. See
// ./turn-start.mjs for why the transition idle -> busy is the only turn-start
// proof available for an agent whose provider Orca reports as `unsupported`.
export const DEFAULT_BUSY_WINDOW_MS = 8000;

function refusal({ seat, entry, detail, residualResources }) {
  return {
    ok: false,
    seat,
    entry,
    reason: `the ${seat} seat's ${entry} start-then-adopt route could not be completed: ${detail}`,
    residualResources,
  };
}

export async function startAdoptedWorker({
  seat,
  entry,
  launch,
  // THE REAL BRIEF. ./dispatch.mjs builds it from one step and hands it here.
  spec,
  worktreeName,
  runId,
  from,
  requestId,
  tuiWaitMs = DEFAULT_TUI_WAIT_MS,
  busyWindowMs = DEFAULT_BUSY_WINDOW_MS,

  worktreeCreateImpl,
  prepareWorktreeImpl,
  agentTerminalCreateImpl,
  terminalWaitImpl,
  terminalCloseImpl,
  removeWorktreeImpl,
  workerStartImpl,
  // Only the Pi seat uses these two -- see (4b) below.
  dispatchPreambleImpl,
  terminalSendImpl,
} = {}) {
  if (typeof spec !== 'string' || spec.trim() === '') {
    // Never a placeholder, and never an empty one either: the spec is the whole
    // of what the worker is told.
    throw new Error(`startAdoptedWorker: the ${seat} seat was given no brief to dispatch -- the real brief is the one dispatch on this route`);
  }

  let worktree = null;
  let worktreePath = null;
  let terminal = null;
  // The `worker-start` answer, once it has succeeded. Its presence is the line
  // between "nothing was created" and "a worker exists and may be running":
  // past it, no failure here may close a terminal or remove a worktree.
  let adopted = null;
  const residualResources = [];

  // The one teardown, used by every failure below and in the one order that
  // works: the terminal first (Orca refuses to remove a worktree whose terminal
  // is still open), then the worktree.
  async function takeBack() {
    if (terminal) {
      try {
        await terminalCloseImpl({ terminal });
      } catch (error) {
        residualResources.push({ kind: 'terminal', id: terminal, error: error.message });
      }
    }
    if (worktree) {
      try {
        await removeWorktreeImpl({ worktree });
      } catch (error) {
        residualResources.push({ kind: 'worktree', id: worktree, error: error.message });
      }
    }
  }

  async function stop(detail) {
    await takeBack();
    return refusal({ seat, entry, detail, residualResources });
  }

  try {
    const created = await worktreeCreateImpl({ name: worktreeName });
    worktree = created?.worktree?.id ?? null;
    worktreePath = created?.worktree?.path ?? null;
    if (!worktree || !worktreePath) {
      return refusal({ seat, entry, detail: `orca worktree create answered no worktree id or path (${JSON.stringify(created ?? null).slice(0, 200)})`, residualResources });
    }

    // (1) Trust, BEFORE anything is started into the folder.
    // `trusted` means "this agent will not stop on a folder-trust question
    // here": either an entry was written, or this agent has no trust list at
    // all (Pi). Either way it is ASKED, never assumed.
    const prepared = await prepareWorktreeImpl({ seat, agent: launch.agent, worktreePath });
    if (prepared?.trusted !== true) {
      return stop(`the worktree could not be trusted for ${launch.agent} (${prepared?.reason ?? 'no reason given'}), and an untrusted folder is exactly what a TUI stops dead on`);
    }

    // (2) The agent, interactively, on its own model and effort.
    const terminalCreated = await agentTerminalCreateImpl({
      seat,
      worktreePath,
      title: `${SEAT_TERMINAL_TITLE_PREFIX}${seat}`,
      command: launch.command,
    });
    terminal = terminalCreated?.terminal?.handle ?? null;
    if (!terminal) {
      return stop(`orca terminal create answered no terminal handle (${JSON.stringify(terminalCreated ?? null).slice(0, 200)})`);
    }

    // (3) Fully started, per Orca, not per a sleep.
    const waited = await terminalWaitImpl({ terminal, timeoutMs: tuiWaitMs });
    if (waited?.wait?.satisfied !== true) {
      return stop(`${launch.agent} never reached an idle prompt within ${tuiWaitMs} ms, so adopting it now would lose the brief the way JUL-109's Pi lost it twice`);
    }

    // (4) The adoption, carrying the real brief and nothing else. No --agent,
    // no --model, no --effort: `worker-start --help` says neither can combine
    // with --terminal, and the model is already on the launch command above.
    const result = await workerStartImpl({
      run: runId,
      from,
      spec,
      worktree: `path:${worktreePath}`,
      terminal,
      requestId,
    });
    if (result?.state === 'failed') {
      return stop(`worker-start failed at ${result.failedStage ?? result.stage ?? 'an unnamed stage'} (${result.lastError ?? 'no error given'})`);
    }

    // FROM HERE ON THE WORKER EXISTS. Orca has issued its task and dispatch
    // ids, the brief has been delivered, and the agent may already be running
    // tools and spending allowance. Nothing below may tear any of that down --
    // see `adopted` and the outer catch.
    adopted = result;

    // (4b) PI IS TYPED ITS BRIEF BY THE CONTROLLER, not by Orca. JUL-92
    // attempts 6, 7 and 8 (23 Sep) and the 22 Sep 23:45Z probe: for a Pi
    // started through `node run-pi-seat.mjs`, `worker-start --terminal`
    // answers `input_accepted` and nothing reaches Pi -- empty editor, no
    // session file, for as long as anyone waited. Orca's own `terminal send`
    // into the same Pi calls its input provider "unsupported" (it cannot see
    // an agent behind the node wrapper), yet the text it types DOES arrive and
    // a multi-line text arrives as ONE prompt (measured live on attempt 8's
    // terminal, 03:24Z and 03:28Z). So the text Orca meant to deliver -- its
    // own preamble, which already carries the brief -- is fetched and typed.
    // Gemini is untouched: Orca's delivery works there.
    // A throw here lands in the catch below AFTER `adopted` is set, so the
    // worker keeps its identity and is reconciled, never torn down.
    // TODO(technical-debt): no screen check before typing; if a later Orca
    // does deliver to this Pi, it would receive the brief twice.
    if (launch.agent === 'pi') {
      const preamble = await dispatchPreambleImpl({ taskId: result?.taskId, from });
      if (typeof preamble !== 'string' || !preamble.includes(spec.trim().split('\n')[0])) {
        throw new Error(`orca dispatch-show gave no preamble carrying this brief for task ${result?.taskId ?? '(none)'}, so nothing was typed into Pi`);
      }
      await terminalSendImpl({ terminal, text: preamble });
    }

    // (5) The turn-start reading. It never fails the START -- the adoption
    // itself succeeded -- it travels out and ./turn-start.mjs judges it, the
    // same way every other seat's observation does.
    //
    // AND IT MAY ITSELF FAIL (JUL-98 step 6, round 2, finding 5). A throw here
    // is the OBSERVATION failing, not the worker: a stale terminal handle, a
    // daemon that did not answer. Round 1 let it fall into the catch below,
    // which closed the terminal, removed the worktree, discarded the dispatch
    // identity and answered "refused" -- so ./dispatch.mjs marked it
    // `launchRefused`, ./step-runner.mjs invented a zero cost, and a backup
    // could be started beside a worker that was still running. An unread
    // terminal is not an idle one, so nothing is claimed about the turn:
    // `busy` travels out as null with the error beside it, and
    // ./step-runner.mjs reconciles it through the mailbox.
    let busy = null;
    let observationError = null;
    try {
      const reading = await terminalWaitImpl({ terminal, timeoutMs: busyWindowMs });
      busy = { terminal, satisfied: reading?.wait?.satisfied === true };
    } catch (error) {
      observationError = error.message;
    }

    return {
      ok: true,
      seat,
      entry,
      result,
      worktree,
      worktreePath,
      terminal,
      allowanceBefore: prepared.allowance ?? null,
      observed: { busy },
      observationError,
    };
  } catch (error) {
    // A failure AFTER the adoption succeeded is never a refusal: there is a
    // real worker behind it, so its identity is preserved and the caller
    // reconciles it rather than destroying it.
    if (adopted) {
      return {
        ok: true,
        seat,
        entry,
        result: adopted,
        worktree,
        worktreePath,
        terminal,
        allowanceBefore: null,
        observed: { busy: null },
        observationError: error.message,
      };
    }
    return stop(error.message);
  }
}
