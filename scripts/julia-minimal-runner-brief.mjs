// julia-minimal-runner-brief.mjs -- what the minimal runner (JUL-122) tells
// its two model workers, and how it reads their answers back.
//
// The rules are the committed Orca role files (.claude/skills/julia-builder
// and independent reviewer, main at 8206fcd) mapped to today's separated workers,
// not pasted: Gemini edits files and runs nothing, a test worker runs the
// tests, the runner commits, and two DeepSeek sessions review one axis each
// without access to the working copy. Kept (Todd, 24 Sep): per-criterion
// builder evidence, per-criterion independent review, the test result in the
// review brief, the reviewer's attack list, and "preferences do not block".
import { evidenceListsForBrief } from './acceptance-check.mjs';

export const AXIS_NAMES = { spec: 'Spec', standards: 'Standards' };

export const cardText = (card) => [
  `# Card ${card.identifier}: ${card.title}`,
  card.description,
  ...card.comments.filter((comment) => !comment.body.includes('\nrunner: ')).map((comment) => `## Comment on the card\n\n${comment.body}`),
].join('\n\n');

// The builder's standing orders, as they apply to a Gemini that edits files
// and nothing else.
const BUILDER_ORDERS = [
  '# Your role in this run',
  'You are the builder for one card. You were started fresh, as one command, with no memory of earlier turns: everything you know is this brief and the files in your working folder. Build the card\'s change in your working folder, test-first, and hand in your evidence at the end. You do not commit, publish, move the card, or decide whether the work is accepted.',
  '## What the runner does, not you',
  '- The seams are pre-agreed in the card\'s Seams section below. Test only there.',
  '- Do not run /code-review: a separate reviewer, from another model maker, checks your change.',
  '- Do not run git and do not commit: the runner commits your change and reads its id from git.',
  '- Read only files inside your working folder, and never git\'s own data (`.git`): reading anywhere else is refused and ends your turn as a failure.',
  '- Do not run any shell command. Read, search and edit files with your file tools only; any command is refused and ends your turn as a failure. Write the failing test at the seam first, then the code that makes it pass: the runner\'s test worker runs the tests after your turn (the red proof, the lint and the suite), the reviewer sees that result, and any failure comes back to you. Tests that already fail before your change are not yours to fix. There is no typecheck command.',
  '## Rules',
  '- Work the card\'s acceptance criteria, all of them and only them. Something that plainly needs doing but is not in the criteria goes in your hand-in, not in the change.',
  '- Write each test so that it would fail if the code it guards were deleted; the red proof checks this for the seam tests.',
  '- Every claim in your hand-in names its source: the file and line you wrote or read. You cannot run commands, so never claim a test result you did not see.',
  '- Remove any scratch file you create. Leave only the change.',
  '- Stop and hand in as blocked, rather than working around it, if two criteria contradict each other or the Seams section, if the change needs an access you do not have (a command, a credential, a file outside your folder), or if the card asks for something this brief forbids.',
  '## Your hand-in',
  'End your final reply with one JSON object in a ```json block, and nothing after it: either',
  '`{"outcome":"done","summary":"<what you changed, and any gap you left open>","acceptance":[{"id":"AC1","criterion":"<its exact words>","evidence":"<what shows it is met, naming its source>"}, ...one per criterion],"uat":[{"id":"UAT1","text":"<the plain-English answer Todd reads for that item>"}, ...one per UAT-plan item]}`',
  'or `{"outcome":"blocked","summary":"<why you stopped>"}`. Every criterion and UAT-plan item listed below gets an entry, by id, echoing the criterion\'s exact words. The reviewer checks each of your claims, and a plain script (the acceptance check) refuses the change if any entry is missing.',
].join('\n\n');

export function implementPrompt(card, skills, findings) {
  const correction = findings ? ['# Correction round', 'Your previous change was not accepted. Fix this before anything else, then hand in again:', findings] : [];
  return ['# Skills', skills, BUILDER_ORDERS, evidenceListsForBrief(card.description), cardText(card), ...correction].join('\n\n');
}

// The reviewer's attack list, split along the code-review skill's two axes so
// each DeepSeek session attacks what its axis owns.
const ATTACKS = {
  spec: [
    '**The criteria.** Does the change do what the card asked, all of it, and only it?',
    '**Test theatre.** Would a test pass with the thing it claims to guard deleted? Does a test assert on its own fixture instead of on real behaviour?',
    '**Wiring.** Is the new code called by something real, or only by its own test?',
    '**Scope.** Anything in the change that the criteria did not ask for.',
    '**Evidence.** Every claim in the builder\'s hand-in must name a source you can follow in the diff or the checks. A claim with no source is a finding, whether or not the thing turns out to be true.',
  ],
  standards: [
    '**Security.** Any secret, key or token that could be printed, committed or logged. Any permission granted wider than the one thing it is for.',
    '**Observability.** When this fails, does anything say so? A command that prints nothing and returns non-zero is a silent failure, and reads exactly like success.',
  ],
};

const REVIEW_RULES = [
  '- Every finding names its source (the file and line in the diff, or the line of the checks) and says what breaks if it stays.',
  '- Rank what you find: a defect that makes the change wrong comes before a preference. Mark preferences as preferences; they do not block a pass. If your only findings are preferences, your verdict is CLEAN.',
  '- The card gets at most one correction round, so report the defects that matter now, with enough detail to fix them without you.',
  '- Never pass to be agreeable, and never invent a finding to look thorough. Say what you could not check, and why.',
].join('\n');

const handInText = (builder) => (builder ? `\`\`\`json\n${JSON.stringify(builder, null, 2)}\n\`\`\`` : '(the builder gave no hand-in)');

// The code-review skill's own method, with its step 4 sub-agent brief for one
// axis, and the material that brief needs pasted in full: the reviewer runs
// in another account and can open nothing itself.
export function reviewPrompt(axis, { card, skill, standards, commits, diff, builder = null, checks = '' }) {
  const source = axis === 'spec'
    ? ['## The spec: the card and its comments', cardText(card), evidenceListsForBrief(card.description),
      '## The builder\'s hand-in (a claim to check, not a check)', handInText(builder)]
    : ['## The standards sources (from the start commit)', standards];
  const answer = axis === 'spec'
    ? 'Check every acceptance criterion listed above yourself, one at a time, by id and by its exact words. Before the verdict line, give a ```json block `{"criteria":[{"id":"AC1","criterion":"<its exact words>","verdict":"met"|"not_met","how":"<how you checked it, naming the source>"}, ...one per criterion]}`. "met" only when you checked it and it holds; a criterion that is not met means `VERDICT: FINDINGS`. Then end'
    : 'End';
  return [
    `# Review axis: ${AXIS_NAMES[axis]}`,
    `You are the ${AXIS_NAMES[axis]} sub-agent in the code-review skill below. Follow that skill's step 4 brief for the ${AXIS_NAMES[axis]} axis, and only that axis. You did not build this change, and you are from a different model maker than the builder: attack it. You cannot open the working copy; everything you need is below.`,
    skill,
    ...source,
    '## The runner\'s checks on this commit', checks || '(no checks result was recorded)',
    '## What you attack on this axis', ATTACKS[axis].map((item) => `- ${item}`).join('\n'),
    '## How you judge', REVIEW_RULES,
    '## Commits under review', commits,
    '## The complete diff', diff,
    `${answer} your report with exactly one line: \`VERDICT: CLEAN\` if there are no actionable findings, or \`VERDICT: FINDINGS\` if there are.`,
  ].join('\n\n');
}

// The verdict line, bare or wrapped as `code` or **bold** (DeepSeek does both).
export const verdictOf = (text) => /^[\s`*]*VERDICT:\s*(CLEAN|FINDINGS)[\s`*]*$/m.exec(text)?.[1] ?? null;

// The last JSON object a worker wrote: a ```json block, else a bare object
// at the very end. null when there is none.
export function handInOf(text) {
  const blocks = [...String(text ?? '').matchAll(/```json\s*\n([\s\S]*?)\n\s*```/g)].map((match) => match[1]);
  const bare = /(\{[\s\S]*\})\s*$/.exec(String(text ?? ''))?.[1];
  for (const candidate of [...blocks.reverse(), bare].filter(Boolean)) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* not this one */ }
  }
  return null;
}
