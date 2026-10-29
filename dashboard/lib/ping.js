// ping.js -- the dashboard's one outbound notice to Todd (JUL-276 PR-2, decision D6).
//
// A comment written with Todd's own key does not notify him, so the notice is the pair the
// existing stop-ping route uses: a comment on JUL-276, then an issueReminder he is
// notified about. No service issue is created. The sender lives here, outside the dashboard
// process, so it still works while the dashboard is down.
import { linearGraphQL, postCommentToIssueId } from '../../scripts/linear-cli.mjs';

export const DASHBOARD_CARD = 'JUL-276';
export const TODD_PROFILE = 'https://linear.app/julia-next/profiles/toddwyder';
const REMINDER_LEAD_MS = 30_000;
const ISSUE_ID_QUERY = 'query DashboardIssueId($id: String!) { issue(id: $id) { id } }';
const REMINDER_MUTATION = `mutation DashboardReminder($id: String!, $at: DateTime!) { issueReminder(id: $id, reminderAt: $at) { success } }`;

const oneLine = (value, limit = 400) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);

export const KINDS = Object.freeze(['down', 'recovery']);

// The notice text. It names the dashboard, the address probed and, on the way down, the
// last failure, so the notification is usable on a phone without opening anything.
export function dashboardNotice({ kind, detail = '', address = '', at = new Date().toISOString(), downSince = null } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`unknown dashboard notice kind: ${kind}`);
  const where = address ? ` at ${address}` : '';
  if (kind === 'down') {
    return [
      `${TODD_PROFILE} Julia dashboard is down.`,
      '',
      `Its health check${where} failed three times in a row, about a minute apart.`,
      `Last failure at ${at}: ${oneLine(detail) || 'the health check did not answer'}.`,
      '',
      'The unit restarts on its own, and this is the only notice while it stays down: one more follows when it answers again.',
      'Nothing is needed from you.',
    ].join('\n');
  }
  const since = downSince ? ` It went down at ${downSince}.` : '';
  return [
    `${TODD_PROFILE} Julia dashboard is answering again.`,
    '',
    `Its health check${where} passed at ${at}, after three failures in a row.${since}`,
    'Nothing is needed from you.',
  ].join('\n');
}

// Posts the comment, then sets the reminder that actually notifies. `sender` is injectable so
// the watchdog tests can prove the decision without reaching Linear.
export async function sendDashboardNotice(notice, { apiKey, fetchImpl = fetch, card = DASHBOARD_CARD } = {}) {
  const body = dashboardNotice(notice);
  const { issue } = await linearGraphQL(ISSUE_ID_QUERY, { id: card }, { apiKey, fetchImpl });
  if (typeof issue?.id !== 'string' || !issue.id) throw new Error(`no issue id for ${card}`);
  const comment = await postCommentToIssueId(issue.id, body, { apiKey, fetchImpl });
  const remindAt = new Date(Date.now() + REMINDER_LEAD_MS).toISOString();
  const { issueReminder } = await linearGraphQL(REMINDER_MUTATION, { id: issue.id, at: remindAt }, { apiKey, fetchImpl });
  if (!issueReminder?.success) throw new Error(`issueReminder did not report success for ${card}`);
  return { kind: notice.kind, comment: comment.url ?? null, commentId: comment.id ?? null, reminded: issueReminder.success, remindAt };
}
