// The two moments the machine tells Todd something by itself: a stage that
// ended badly, and a run whose process is gone. Both are one comment on the
// card, and both are recorded on the run first (see store.stall and
// run.mjs's failure path), so that a second pass over the same run cannot send
// the same message again.
//
// The comment names what happened, what is true now, and the one thing Todd can
// do about it. It never asks him to decide something the machine can decide.

import { postComment } from '../../scripts/linear-cli.mjs';

const line = (...parts) => parts.filter(Boolean).join(' ');

export function failedMessage({ record, step, limitMinutes }) {
  return [
    `${record.card}: the machine stopped at ${step.id}.`,
    '',
    `What happened: ${step.detail ?? 'the stage ended without saying why'}.`,
    `Run: ${record.id} (started ${record.startedAt}).`,
    limitMinutes ? `Watched before that: ${limitMinutes} minutes without a heartbeat marks a run stalled.` : '',
    '',
    'What is true now: nothing more will happen for this card until the machine is started again.',
    'What you can do: start the card again from the dashboard, or say what you want changed.',
    '',
    `See the run: ${record.id} on the dashboard's Card runs page.`,
  ]
    .filter(part => part !== '')
    .join('\n');
}

export function stalledMessage({ record, step, idleMinutes }) {
  return [
    `${record.card}: the machine's run went quiet.`,
    '',
    line(
      `What happened: ${step ? `the ${step.id} stage` : 'a stage'} stopped writing, and ${
        idleMinutes ? `${idleMinutes} minutes` : 'its idle limit'
      } passed with no heartbeat.`,
      `Last heard from ${record.heartbeatAt ?? record.updatedAt}.`
    ),
    `Run: ${record.id} (started ${record.startedAt}).`,
    '',
    'What is true now: the process behind this run is gone. This is the message for it; a second pass will not send another.',
    'What you can do: start the card again from the dashboard, or leave the run as a record of what happened.',
    '',
    `See the run: ${record.id} on the dashboard's Card runs page.`,
  ]
    .filter(part => part !== '')
    .join('\n');
}

// A refused comment is a note on the console, not a reason to take the machine
// down: the record already says what happened, and the next pass will not
// retry the message because the ping is written down.
export async function pingCard(card, body, { post = postComment, log = console.log } = {}) {
  try {
    const comment = await post(card, body);
    log(`machine: told Todd on ${card}${comment?.url ? ` (${comment.url})` : ''}`);
    return { sent: true, url: comment?.url ?? null };
  } catch (error) {
    log(`machine: could not comment on ${card}: ${error.message}`);
    return { sent: false, error: error.message };
  }
}
