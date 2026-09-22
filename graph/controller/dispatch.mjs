// dispatch.mjs -- JUL-98 step 3, item 1: every step is handed to a FRESH
// worker, through Orca's own worker-start.
//
// WHAT "FRESH" MEANS HERE, mechanically rather than as a wish:
//
//   * one `worker-start` per step, so Orca issues a new task id and a new
//     dispatch id (recorded: worker-start.claude-model-effort.json);
//   * a worktree made for THIS step and no other -- `--worktree new-top-level`
//     on the `--agent` route, and a worktree ./adopt.mjs creates for this step
//     alone on the adopt route;
//   * NEVER a terminal that was already in use. Adopting a terminal is a real
//     Orca route (worker-start.adopt-terminal-pi.json) and JUL-98 step 6 uses
//     it -- but only for a terminal this dispatch started itself, seconds
//     earlier, in its own new worktree. What a fresh worker must not have is
//     somebody else's session, and it does not have one;
//   * the brief is built from ONE step. `buildStepBrief` takes a single step
//     object and has no way to reach the rest of the plan, so another step's
//     words cannot travel by accident.
//
// The brief carries exactly four things: the card, that step, the files the
// step names, and the path of the worker's own skill -- the builder skill for a
// build step, the reviewer skill for a review step (both merged in step 1).
// The standing orders themselves live in those files and are not repeated here;
// a second copy would drift.
//
// WHAT THIS MODULE DOES NOT DO. It does not JUDGE whether the worker started.
// `worker-start` answers `stage: "input_accepted"` even for a start that went
// on to succeed, so the verdict is ./turn-start.mjs's job and the caller's.
// On the adopt route the dispatch does CARRY an observation (`observed`),
// because Orca can answer nothing about such a worker afterwards -- but it is
// a reading passed along, not a verdict reached here.

import { MODEL_CATALOG } from '../../scripts/seat-labels.mjs';
import { wasReplayed } from './inflight.mjs';
import { startAdoptedWorker } from './adopt.mjs';

// The two worker skills, and only two (the card is explicit that there are no
// others until there is work for one). Paths, not contents: the worker reads
// the file in its own worktree.
export const WORKER_SKILLS = Object.freeze({
  builder: '.claude/skills/julia-builder/SKILL.md',
  reviewer: '.claude/skills/julia-reviewer/SKILL.md',
});

// The vendor model id `worker-start --model` is given, per MODEL_SPECS model
// name. These are the ids graph/rate-table.mjs prices, deliberately: a seat
// dispatched on a model the table cannot price could only ever produce a blank
// cost line, and a blank cost line fails the step. Two of them are recorded in
// real worker-start answers (`claude-sonnet-5`, `gpt-6-astra`).
export const LAUNCH_MODEL_IDS = Object.freeze({
  opus: 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5-20251001',
  codex: 'gpt-6-astra',
  'deepseek-v4-pro': 'deepseek-v4-pro',
  'deepseek-v4-flash': 'deepseek-v4-flash',
  // JUL-98 step 6. `agy models`' own id, and graph/rate-table.mjs holds an
  // entry for it -- an allowance entry rather than a per-token price, because
  // that is how the seat is actually billed. ONE Gemini model, which is what
  // the step asked for: a second would be a label nothing resolves to.
  'gemini-3.8-flash': 'gemini-3.8-flash',
});

// The seat-table entry -> the `--agent` name Orca launches. It is a short list
// because Orca's is: `worker-start --agent` knows claude, codex and cursor, and
// there is no flag that teaches it another TUI.
const AGENT_FOR_ENTRY = Object.freeze({ claude: 'claude', codex: 'codex' });

// THE OTHER ROUTE, and why there is exactly one of it.
//
// Until JUL-98 step 6 a DeepSeek seat was REFUSED here, and the refusal's own
// words said what had to be built instead: "the only recorded route that
// reports to the mailbox is an interactive Pi adopted with worker-start
// --terminal once it has fully started (JUL-109 findings, section 4)". Gemini,
// through the Antigravity CLI (`agy`), needs that same route for exactly the
// same reason -- Orca has no launcher for it either. So the route is built once
// (./adopt.mjs) and both seats take it; a second copy would drift.
//
// `command` is what the interactive terminal runs, in the worktree's own
// directory (so a relative path is the checkout's). It carries the MODEL AND
// EFFORT, which is how the card keeps showing exactly what runs even though
// `--model`/`--effort` cannot be passed with `--terminal`.
const ADOPTED_ENTRIES = Object.freeze({
  gemini: Object.freeze({
    // The command the agent really is. It is NOT passed to `worker-start
    // --agent` (`route: 'adopt'` is what keeps it away from there): it is the
    // name the trust list (./agent-trust.mjs) and the cost read
    // (./cost-read.mjs) are both keyed by, so the seat that ran and the figures
    // read for it can never be two different agents.
    agent: 'agy',
    // `--dangerously-skip-permissions` is the same posture Todd accepted for
    // `runner`'s Claude Code on 2026-09-20 (`skipDangerousModePermissionPrompt`,
    // JUL-109 findings section 6): without it agy stops on every tool call and
    // the worker cannot do the step it was dispatched for.
    command: ({ model, effort }) => `agy --model ${model} --effort ${effort} --dangerously-skip-permissions`,
  }),
  'pi-deepseek': Object.freeze({
    agent: 'pi',
    // The repo's own seat launcher, in its interactive mode: it is what reads
    // the DeepSeek key in-process, and reusing it keeps ONE place that knows
    // how a Pi seat authenticates.
    // A model outside `PI_SEAT_ROUTE` has no seat to launch, so this returns
    // NOTHING and `launchForChoice` refuses. It used to interpolate
    // `undefined` into a shell command that would then have run.
    command: ({ model, effort }) => (PI_SEAT_ROUTE[model]
      ? `node ops/service-dropbox/run-pi-seat.mjs ${PI_SEAT_ROUTE[model]} --interactive --effort ${effort}`
      : null),
  }),
});

// Which `run-pi-seat.mjs` seat route runs which model. The routes are that
// file's own (`SEATS`), and the model is what picks one -- never the other way
// round, so the card's label still decides.
const PI_SEAT_ROUTE = Object.freeze({
  'deepseek-v4-pro': 'reviewer-backup',
  'deepseek-v4-flash': 'builder-backup',
});

// `choice` is one seat's entry from scripts/seat-labels.mjs
// (`{ entry, modelLabel, effort }`). Returns what the launch actually is --
// `route: 'agent'` for a `worker-start --agent` seat, `route: 'adopt'` for one
// that has to be started and then adopted -- or a refusal with a reason.
export function launchForChoice(choice) {
  const entry = choice?.entry;
  const agent = AGENT_FOR_ENTRY[entry];
  const adopted = ADOPTED_ENTRIES[entry];
  if (!agent && !adopted) {
    return { ok: false, reason: `no Orca agent and no adopt route is known for seat-table entry ${JSON.stringify(entry ?? null)}` };
  }
  const spec = MODEL_CATALOG[choice.modelLabel];
  const modelName = spec?.model ?? (entry === 'codex' ? 'codex' : null);
  const model = LAUNCH_MODEL_IDS[modelName];
  if (!model) {
    // The same gate on BOTH routes: a seat dispatched on a model the cost table
    // cannot account for could only ever produce a blank cost line.
    return { ok: false, reason: `no launch model id for model label ${JSON.stringify(choice.modelLabel)}` };
  }
  const effort = choice.effort;
  if (agent) return { route: 'agent', agent, model, effort };
  const command = adopted.command({ model, effort });
  if (!command) {
    // The same refusal shape, for the same reason as a missing launch model id:
    // a seat that cannot be launched must say so, not be launched into a shape
    // nothing supports.
    return { ok: false, reason: `no ${adopted.agent} launch command is known for model ${JSON.stringify(model)} (model label ${JSON.stringify(choice.modelLabel)})` };
  }
  return { route: 'adopt', agent: adopted.agent, command, model, effort };
}

function bullets(items) {
  return (items ?? []).map((item) => `- ${item}`).join('\n');
}

// The brief one fresh worker is started with. One step in, one brief out.
export function buildStepBrief({ seat, card, step, files = [] }) {
  const skill = WORKER_SKILLS[seat];
  if (!skill) throw new Error(`buildStepBrief: no worker skill for seat ${JSON.stringify(seat)} (seats: ${Object.keys(WORKER_SKILLS).join(', ')})`);
  if (!step?.title) throw new Error('buildStepBrief: the step needs a title');

  const lines = [
    `# ${card.identifier} -- ${step.title}`,
    '',
    `You are the ${seat} for this ONE step. Your standing orders are \`${skill}\` in your own`,
    'worktree: read it before anything else and follow it. You have no memory of any other step',
    'and you are not given one.',
    '',
    '## The card',
    '',
    `${card.identifier}: ${card.title}`,
  ];
  if (card.url) lines.push(card.url);
  lines.push('', '## This step', '', step.brief ?? '');
  if (step.criteria?.length) {
    lines.push('', '### What this step is judged on', '', bullets(step.criteria));
  }
  if (files.length) {
    lines.push('', '## The files this step is about', '', bullets(files));
  }
  if (step.priorFinding) {
    // The ONE thing that may travel from an earlier round: the finding this
    // round exists to fix. It is this step's input, not another step's context.
    lines.push('', '## The finding you are fixing', '', step.priorFinding);
  }
  lines.push('');
  return lines.join('\n');
}

// Start the worker. Returns the dispatch record, or `{ ok: false }` with Orca's
// own failure detail when the start itself failed (the trust-screen case:
// `failedStage: agent_readiness`, `lastError: timeout`, and a
// `residualResources` list naming the worktree and terminal left behind).
export async function dispatchWorker({
  workerStartImpl,
  // The other route, injected so a test can stand in front of it. The default
  // is the real one; ./wiring.mjs supplies its Orca boundaries.
  startAdoptedWorkerImpl = startAdoptedWorker,
  adoptBoundaries = {},
  environment,
  runId,
  from,
  repo,
  seat,
  card,
  step,
  choice,
  files = [],
  worktreeName,
  requestId,
  // The controller's own clock. An allowance-billed seat writes no session
  // file, so there is no first/last line timestamp to take a duration from --
  // the controller starts it and sees it report, which is exactly what JUL-109
  // concluded for Pi (findings section 5).
  now = () => new Date().toISOString(),
}) {
  const launch = launchForChoice(choice);
  if (launch.ok === false) {
    // `launchRefused` marks the ONE case where nothing at all was created:
    // this seat's entry cannot be started, so there is no worker, no terminal
    // and no worktree behind this failure. ../controller/step-runner.mjs
    // branches on it to resolve the seat's backup (JUL-98 step 5, fifth fix);
    // a `worker-start` that FAILED is a different thing and keeps `ok: false`
    // without the mark, because it may have left residual resources.
    return { ok: false, seat, launchRefused: true, entry: choice?.entry ?? null, reason: launch.reason, residualResources: [] };
  }
  const spec = buildStepBrief({ seat, card, step, files });

  // THE ADOPT ROUTE. The brief above is handed to it unchanged: the real brief
  // is the one dispatch, never a placeholder followed by a second delivery.
  if (launch.route === 'adopt') {
    const adopted = await startAdoptedWorkerImpl({
      seat,
      entry: choice.entry,
      launch,
      spec,
      worktreeName,
      runId,
      from,
      requestId,
      ...adoptBoundaries,
      workerStartImpl,
    });
    if (!adopted.ok) {
      // The route takes back everything it made before it answers, so this is
      // the SAME refusal a seat with no launch route at all gives, and
      // ./step-runner.mjs's existing seat-backup path (JUL-98 step 5, fifth
      // fix) catches it with nothing new. `residualResources` is non-empty only
      // when the teardown ITSELF failed, and then it is not empty and says so.
      return {
        ok: false,
        seat,
        launchRefused: true,
        entry: choice.entry,
        reason: adopted.reason,
        residualResources: adopted.residualResources ?? [],
      };
    }
    return {
      ok: true,
      seat,
      stepKey: step.key ?? step.title,
      taskId: adopted.result.taskId,
      dispatchId: adopted.result.dispatchId,
      runId: adopted.result.runId,
      terminal: adopted.terminal,
      worktree: adopted.worktree,
      stage: adopted.result.stage ?? null,
      state: adopted.result.state ?? null,
      launch: { ...launch },
      startedAt: now(),
      // The turn-start reading the route took for itself. Orca can observe no
      // turn for this provider and tracks no agent for it, so `worktree ps` --
      // the ONLY observation the --agent route has -- would answer nothing at
      // all here. See ./turn-start.mjs for the measurement.
      observed: adopted.observed ?? null,
      // The allowance reading taken BEFORE the agent ran. ./step-runner.mjs
      // hands it to the cost read, which differences it against a second
      // reading -- the only figure an allowance-billed seat has.
      allowanceBefore: adopted.allowanceBefore ?? null,
      replayed: wasReplayed(adopted.result),
      spec,
    };
  }

  const result = await workerStartImpl({
    environment,
    run: runId,
    from,
    repo,
    // A fresh worktree and no terminal: the two mechanical halves of "fresh".
    worktree: 'new-top-level',
    name: worktreeName,
    spec,
    agent: launch.agent,
    model: launch.model,
    effort: launch.effort,
    requestId,
  });

  if (result.state === 'failed') {
    return {
      ok: false,
      seat,
      taskId: result.taskId ?? null,
      dispatchId: result.dispatchId ?? null,
      failedStage: result.failedStage ?? result.stage ?? null,
      lastError: result.lastError ?? null,
      residualResources: result.residualResources ?? [],
      reason: `worker-start failed at ${result.failedStage ?? result.stage} (${result.lastError ?? 'no error given'})`,
    };
  }

  const terminal = (result.effects ?? []).find((effect) => effect.kind === 'terminal')?.id ?? null;
  const worktree = (result.effects ?? []).find((effect) => effect.kind === 'worktree')?.id ?? null;

  return {
    ok: true,
    seat,
    stepKey: step.key ?? step.title,
    taskId: result.taskId,
    dispatchId: result.dispatchId,
    runId: result.runId,
    terminal,
    worktree,
    // Orca's own stage. Deliberately surfaced and deliberately NOT read as
    // "started": ./turn-start.mjs is what decides that.
    stage: result.stage ?? null,
    state: result.state ?? null,
    launch: { ...launch },
    replayed: wasReplayed(result),
    spec,
  };
}
