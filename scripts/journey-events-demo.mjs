import { recordEvent } from './journey-events.mjs';

const branch = 'jul43-axiom-boundary';
const worktree = process.cwd();

const started = await recordEvent({
  event: 'julia.journey0.worker_started',
  attempted: 'worker checkout ready',
  reason: 'isolated worktree created for JUL-43',
  context: `branch=${branch} worktree=${worktree}`,
});
console.log('started ->', JSON.stringify(started));

const pushDenied = await recordEvent({
  event: 'julia.journey0.worker_push_denied',
  attempted: 'git push origin HEAD:refs/heads/jul43-axiom-boundary',
  reason: 'push URL is DISABLED_READ_ONLY_RUNNER',
  context: `branch=${branch} worktree=${worktree}`,
});
console.log('push_denied ->', JSON.stringify(pushDenied));
