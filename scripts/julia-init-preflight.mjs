// Preflight card admission and display formatting for $init per ADR 0021.
import { seamsOf } from './julia-delivery-workspace.mjs';

export const ROLE_FLAGS = Object.freeze({
  '--builder': 'builder',
  '--reviewer': 'reviewer',
  '--crash-fixer': 'crashFixer',
  '--crashFixer': 'crashFixer',
  '--fix-reviewer': 'fixReviewer',
  '--fixReviewer': 'fixReviewer',
  '--recovery-reviewer': 'fixReviewer',
  '--recoveryReviewer': 'fixReviewer',
});

export const ISSUE_ID = /^[A-Z][A-Z0-9]*-\d+$/;

export class SelectionRequiredError extends Error {
  constructor(roles, selections) {
    super(`$init needs a current ${roles.join(' and ')} selection`);
    this.name = 'SelectionRequiredError';
    this.roles = roles;
    this.selections = selections;
  }
}

function reject(message) {
  throw new Error(`$init: ${message}`);
}

export function refusalReason(error) {
  if (error instanceof SelectionRequiredError) return 'missing-or-stale-selection';
  if (error.message.startsWith('$init:')) return 'invalid-command';
  if (/model reference .* is unknown|catalog reference .* is ambiguous|thinking .* is not supported|does not support thinking|must use different makers|are from the same|must be from different companies|is unavailable|is disconnected/.test(error.message)) {
    return 'invalid-selection';
  }
  return 'invalid-settings';
}

export function tokenize(command) {
  if (typeof command !== 'string') reject('command must be text');
  const tokens = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(command))) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  if (tokens.join(' ') === '' || /(^|\s)["'](?:\s|$)/.test(command)) reject('contains an empty quoted value');
  return tokens;
}

export function parseInitCommand(command) {
  const tokens = tokenize(command);
  if (tokens[0] !== '$init') reject('must begin with the literal $init command, not /init');
  if (!ISSUE_ID.test(tokens[1] ?? '')) reject('must name an issue such as JUL-195');
  const issueId = tokens[1];
  const choices = {};
  let allowSameService = false;
  let decision = null;

  for (let index = 2; index < tokens.length;) {
    const token = tokens[index];
    if (token === '--allow-same-service' || token === '--allowSameService') {
      allowSameService = true;
      index += 1;
      continue;
    }
    if (token === '--decision' || token === '-d') {
      decision = tokens[index + 1];
      if (!decision) reject('--decision requires Start or Cancel');
      index += 2;
      continue;
    }
    if (token === '--start') {
      decision = 'Start';
      index += 1;
      continue;
    }
    if (token === '--cancel') {
      decision = 'Cancel';
      index += 1;
      continue;
    }
    const role = ROLE_FLAGS[token];
    if (!role) reject(`does not recognise ${JSON.stringify(token)}; use --builder, --reviewer, --crash-fixer, or --fix-reviewer`);
    const normalizedRole = role === 'recoveryReviewer' ? 'fixReviewer' : role;
    if (choices[normalizedRole]) reject(`names --${role} more than once`);
    const [model, thinking] = tokens.slice(index + 1, index + 3);
    if (!model || thinking === undefined) reject(`--${role} requires an exact model name or ID followed by a thinking level`);
    choices[normalizedRole] = { model, thinking: thinking === 'none' ? null : thinking };
    index += 3;
  }
  const result = { issueId, choices };
  if (allowSameService) result.allowSameService = true;
  if (decision) result.decision = decision;
  return result;
}

export function verifyCardAdmission(card, issueId) {
  if (!card) {
    reject(`card ${issueId} could not be retrieved; preflight admission checks cannot be skipped`);
  }
  if (card.identifier && card.identifier !== issueId) {
    reject(`Linear returned card ${card.identifier}, not ${issueId}`);
  }
  const stateType = card.state?.type?.toLowerCase();
  const stateName = card.state?.name?.toLowerCase();
  if (stateType === 'backlog' || stateName === 'backlog') {
    reject(`card ${issueId} is in Backlog; only Ready cards may be admitted to $init`);
  }
  const desc = card.description ?? '';
  const hasCriteria = Boolean(card.acceptanceCriteria || /^##\s+Acceptance criteria\b/mi.test(desc));
  if (!hasCriteria) {
    reject(`card ${issueId} has no approved acceptance criteria; incomplete cards are refused`);
  }
  const hasSeams = Boolean(card.testSeams || seamsOf(desc) || /^##\s+(?:Test seams|Seams)\b/mi.test(desc));
  if (!hasSeams) {
    reject(`card ${issueId} has no agreed test seams; incomplete cards are refused`);
  }
}

export function formatLimitsDisplay(issueId, card, configuration) {
  const builder = configuration.builder;
  const reviewer = configuration.reviewer;
  const crashFixer = configuration.crashFixer;
  const fixReviewer = configuration.fixReviewer;

  return [
    '======================================================================',
    `Card: ${issueId}${card?.title ? ` - ${card.title}` : ''} (${card?.state?.name ?? 'Ready'})`,
    '----------------------------------------------------------------------',
    'Roles:',
    `  Builder:      ${builder?.identity} (maker: ${builder?.maker}, service: ${builder?.service || builder?.connection?.provider}, effort: ${builder?.thinking ?? 'none'})`,
    `  Reviewer:     ${reviewer?.identity} (maker: ${reviewer?.maker}, service: ${reviewer?.service || reviewer?.connection?.provider}, effort: ${reviewer?.thinking ?? 'none'})`,
    `  Crash-fixer:  ${crashFixer?.identity} (maker: ${crashFixer?.maker}, service: ${crashFixer?.service || crashFixer?.connection?.provider}, effort: ${crashFixer?.thinking ?? 'none'})`,
    `  Fix-reviewer: ${fixReviewer?.identity} (maker: ${fixReviewer?.maker}, service: ${fixReviewer?.service || fixReviewer?.connection?.provider}, effort: ${fixReviewer?.thinking ?? 'none'})`,
    '----------------------------------------------------------------------',
    'ADR 0021 Limits:',
    '  Builder:      $2.00 paid API limit | 90 active minutes per card',
    '  Reviewer:     $1.00 paid API limit | 30 active minutes per card',
    '  Crash-fixer:  $0.50 paid API limit | 20 active minutes per incident',
    '  Fix-reviewer: $0.25 paid API limit | 10 active minutes per incident',
    '  (Active time excludes waiting on CI, preview, UAT, or operator.)',
    '======================================================================',
  ].join('\n');
}

export async function fetchCardFromLinear(issueId) {
  try {
    const { getIssue } = await import('./linear-cli.mjs');
    return await getIssue(issueId);
  } catch (error) {
    reject(`unable to fetch card ${issueId} from Linear: ${error.message}`);
  }
}
