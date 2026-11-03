// The determination is the Shipping agent's answer, set beside each criterion,
// with the commands it ran and what they returned taken from Mastra's own
// record of the run. Everything here is a pure function so it can be tested
// without a model, a network, or a trace file.

const VERDICT = /(PASS\+NOTES|PASS|FAIL)/i;

// A slice card carries its done-means under "Done means:", the house wording from
// docs/advisor-notes/linear/front-door-process.md, where the parent card carries
// them under an "Acceptance criteria" heading. Reading only the heading left every
// slice unreviewable: "JUL-330 names no acceptance criteria, so there is nothing
// for Shipping to judge." Both shapes are read here so a card is judged as written.
const CRITERIA_HEADING =
  /^(?:#{1,6}[ \t]*(?:acceptance[ \t]+)?criteria[ \t]*|\**[ \t]*done[ \t]+means[ \t]*\**:?[ \t]*)$/im;

export function criteriaFromCard(description) {
  const text = String(description ?? '');
  const heading = CRITERIA_HEADING.exec(text);
  if (!heading) return [];
  const after = text.slice(heading.index + heading[0].length);
  const next = /^#{1,6}[ \t]+\S/m.exec(after);
  const section = next ? after.slice(0, next.index) : after;
  return section
    .split(/\r?\n/)
    .map(line => line.match(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?(.+)$/))
    .filter(Boolean)
    .map(match => match[1].trim())
    .filter(line => line.length > 0);
}

export function parseVerdict(answer) {
  const raw = String(answer ?? '').trim();
  const lines = raw.split(/\r?\n/);
  let verdict = null;
  let notes = '';
  let inNotes = false;
  const criteria = [];
  for (const line of lines) {
    const verdictLine = line.match(/^[ \t>*#-]*verdict[ \t]*:[ \t>]*([a-z+]+)/i);
    if (verdictLine && !verdict) {
      const found = VERDICT.exec(verdictLine[1].toUpperCase());
      verdict = found ? found[1].toUpperCase() : null;
      inNotes = false;
      continue;
    }
    const criterionLine = line.match(/^[ \t>*#-]*criterion[ \t]*(\d+)[ \t]*:[ \t>]*([a-z+]+)[ \t]*(?:[—–:-]+[ \t]*)?(.*)$/i);
    if (criterionLine) {
      const found = VERDICT.exec(criterionLine[2].toUpperCase());
      const reason = criterionLine[3].replace(/^[—–:-]+[ \t]*/, '').trim();
      criteria.push({ number: Number(criterionLine[1]), verdict: found ? found[1].toUpperCase() : null, reason });
      inNotes = false;
      continue;
    }
    const notesLine = line.match(/^[ \t>*#-]*notes[ \t]*:[ \t>]*(.*)$/i);
    if (notesLine) {
      inNotes = true;
      notes = notesLine[1];
      continue;
    }
    if (inNotes) notes += `\n${line}`;
  }
  if (!verdict) {
    const first = raw.match(/^[ \t>*#-]*(PASS\+NOTES|PASS|FAIL)\b/im);
    verdict = first ? first[1].toUpperCase() : null;
  }
  return { verdict, criteria, notes: notes.trim(), raw };
}

export function toolName(spanName) {
  const match = /tool:[ \t]*['"]([^'"]+)['"]/.exec(String(spanName ?? ''));
  return match ? match[1] : null;
}

function parseJson(value) {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// The agent's shell keeps the colours it wrote for a terminal, and a determination
// is read in a browser, so the escape codes come out before anything is quoted.
function plain(text) {
  return String(text ?? '').replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function collapse(text) {
  return plain(text)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
}

export function describeReturn(output) {
  if (output === null || output === undefined || output === '') {
    return { text: null, refused: false };
  }
  const parsed = parseJson(output);
  if (parsed && typeof parsed === 'object') {
    if (parsed.error) {
      return { text: `refused before it ran, the tool said: ${collapse(parsed.message ?? parsed.error)}`, refused: true };
    }
    if (typeof parsed.value === 'string' && parsed.type === 'text') {
      return { text: parsed.value.trim() || '(no output)', refused: false };
    }
    if (typeof parsed.message === 'string' && parsed.type === 'error-json') {
      return { text: `refused before it ran, the tool said: ${collapse(parsed.message)}`, refused: true };
    }
    return { text: JSON.stringify(parsed), refused: false };
  }
  if (typeof parsed === 'string') {
    const text = plain(parsed).trim();
    return { text: text || '(no output)', refused: false };
  }
  return { text: String(parsed), refused: false };
}

export function commandsFromSpans(spans) {
  const agentRuns = new Set(
    spans.filter(span => span.spanType === 'agent_run' && span.runId).map(span => span.runId)
  );
  const commands = [];
  const otherTools = new Map();
  for (const span of spans) {
    if (span.spanType !== 'tool_call' || span.eventType !== 'end') continue;
    if (agentRuns.size > 0 && !agentRuns.has(span.runId)) continue;
    const name = toolName(span.name);
    const args = parseJson(span.input);
    if (name === 'execute_command') {
      const command = args && typeof args === 'object' && typeof args.command === 'string' ? args.command : null;
      const returned = describeReturn(span.output);
      commands.push({
        command,
        description: args && typeof args === 'object' && typeof args.description === 'string' ? args.description : '',
        returned: returned.text,
        refused: returned.refused,
        spanName: span.name,
      });
    } else if (name) {
      otherTools.set(name, (otherTools.get(name) ?? 0) + 1);
    }
  }
  return {
    commands,
    otherTools: [...otherTools].map(([name, count]) => ({ name, count })),
  };
}

export function playbookSteps(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map(line => line.match(/^\s*(\d+)[.)]\s+\*\*(.+?)\*\*/))
    .filter(Boolean)
    .map(match => ({ number: Number(match[1]), title: match[2].trim() }));
}

function code(text) {
  const value = String(text ?? '');
  const fence = value.includes('`') ? '``' : '`';
  return `${fence}${value}${fence}`;
}

function cell(text) {
  return String(text ?? '')
    .replace(/\r?\n/g, '<br>')
    .replace(/\|/g, '\\|');
}

export function determinationComment({
  pr,
  sha,
  card,
  model,
  playbook,
  workflowRunId,
  workflowId,
  traceFile,
  criteria = [],
  verdict,
  commands = [],
  otherTools = [],
  steps = [],
  failed = null,
  review = null,
}) {
  const badge = verdict?.verdict ?? 'NO VERDICT';
  const lines = [];
  lines.push(`Shipping agent: ${badge}${review ? ` (review ${review.round} of ${review.of})` : ''}`, '');
  lines.push(`**Card** ${card?.identifier ?? 'unknown'} · **Pull request** #${pr} · **Commit** ${code(sha)}`, '');
  if (failed) lines.push(`The machine could not get a verdict: ${failed}`, '');
  lines.push('| Which | What |', '| --- | --- |');
  lines.push(`| Model that decided | ${code(model)} (Beam, free on CommandCode) |`);
  lines.push(`| pstack playbook | ${code(playbook)} (stock Shipping) |`);
  lines.push(`| Mastra workflow run | ${code(workflowRunId)} (workflow ${code(workflowId)}) |`);
  lines.push(`| Mastra's record of the run | ${code(traceFile)} |`, '');

  lines.push('### Beside each criterion', '');
  if (criteria.length === 0) {
    lines.push('The card named no criteria to judge.', '');
  }
  criteria.forEach((criterion, index) => {
    const said = verdict?.criteria?.find(item => item.number === index + 1);
    const state = said?.verdict ?? 'no verdict';
    lines.push(`**${index + 1}. ${state}**${said?.reason ? ` — ${said.reason}` : ''}`, '');
    lines.push(`> ${criterion.replace(/\r?\n/g, ' ')}`, '');
  });

  lines.push("### Commands the agent ran, from Mastra's own record of this run", '');
  if (commands.length === 0) {
    lines.push('The record holds no command for this run.', '');
  } else {
    lines.push('| # | Command | What it returned |', '| --- | --- | --- |');
    commands.forEach((item, index) => {
      const ran = item.command === null ? 'a tool call the record kept without its arguments' : cell(item.command);
      const returned = item.returned === null || item.returned === undefined
        ? 'the record kept the command but not what it returned'
        : cell(item.returned);
      lines.push(`| ${index + 1} | \`${ran}\` | ${returned} |`);
    });
    lines.push('');
  }
  if (otherTools.length > 0) {
    lines.push(`Also ran, without a shell: ${otherTools.map(item => `${code(item.name)} (${item.count})`).join(', ')}.`, '');
  }

  const missing = commands.filter(item => item.returned === null || item.returned === undefined);
  if (missing.length > 0) {
    lines.push('### What the record did not keep', '');
    lines.push(
      `${missing.length} of these commands came back with no result in the record, so nothing above claims what they printed. ` +
        'The playbook this run followed, in its own words, lists these steps:',
      ''
    );
    if (steps.length === 0) {
      lines.push(`- The playbook's steps are in ${code(playbook)}.`);
    }
    steps.forEach(step => lines.push(`${step.number}. ${step.title}`));
    lines.push('');
  }

  lines.push('### What the Shipping agent said', '');
  lines.push('```');
  lines.push(verdict?.raw || '(nothing)');
  lines.push('```', '');
  lines.push(
    `<sub>The machine wrote this from Mastra's record of run ${code(workflowRunId)}. ` +
      'The commands and their returns are copied out of that record, not retyped by the builder.</sub>'
  );
  return `${lines.join('\n')}\n`;
}
