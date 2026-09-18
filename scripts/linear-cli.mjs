#!/usr/bin/env node
// linear-cli.mjs -- JUL-77: a small command-line tool that reaches Linear
// with an API key, usable from any agent tool (Claude Code, Codex, Pi),
// not only an MCP-capable client. Replaces both of the orchestrator's
// former MCP-based Linear routes (Decision comment, JUL-77).
//
// The key is never accepted on the command line or read from stdin in the
// clear here -- callers pass it via LINEAR_API_KEY (the orchestrator-svc
// identity gets it from ops/service-dropbox/read-secret.mjs, in-process,
// never through argv or a shell string -- see that module's own comment
// for why).
const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';

export async function linearGraphQL(query, variables, { apiKey, fetchImpl = fetch, url = LINEAR_GRAPHQL_URL } = {}) {
  if (!apiKey) {
    throw new Error('linearGraphQL: apiKey is required (pass LINEAR_API_KEY)');
  }
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) {
    throw new Error(`Linear API error: ${res.status} ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.data;
}

const GET_ISSUE_QUERY = `
  query GetIssue($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      url
      state { name type }
    }
  }
`;

export async function getIssue(identifier, opts) {
  const data = await linearGraphQL(GET_ISSUE_QUERY, { id: identifier }, opts);
  return data.issue;
}

const ISSUE_ID_QUERY = `
  query IssueIdByIdentifier($id: String!) {
    issue(id: $id) { id }
  }
`;

const COMMENT_CREATE_MUTATION = `
  mutation CommentCreate($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) {
      success
      comment { id url }
    }
  }
`;

// ---------------------------------------------------------------------------
// The For-Todd guard (JUL-79 step 4)
// ---------------------------------------------------------------------------
//
// The rule (coordinator skill / CLAUDE.md, enforced here): only three kinds of
// thing may ask for Todd -- (a) an action only his account can take (sign-in,
// payment), (b) a money decision, (c) a product decision or acceptance.
// Everything else (merges, git, restarts, installs, free-tier resources in
// approved services) the agent decides, does and logs itself.
//
// This guard is deliberately strict and fail-closed, with no intent detection:
// a forbidden word anywhere in a `For Todd:` line refuses the post outright,
// even when the agent meant it as information. Rule 1 gates any body that says
// WAITING ON YOU on naming one of the three categories; rule 2 keeps git
// vocabulary out of the For Todd trailer. Both return a result object instead
// of throwing, so callers (postComment, the Ready queue) decide what to do with
// a refusal; postComment turns it into the error a forced post deserves.

const WAITING_ON_YOU_MARKER = /\bwaiting on you\b/i;
const CATEGORY_MARKER = /\((?:a|b|c)\)/i;
const ACCOUNT_ONLY_VOCABULARY = /\b(?:sign[- ]?in|log[- ]?in|payment|payments)\b/i;
const MONEY_VOCABULARY = /\b(?:money|cost|costs|spend|spent|spending|budget|budgets|billing|subscription|subscriptions|purchase|purchases|price|prices)\b/i;
const PRODUCT_VOCABULARY = /\b(?:product|products|decision|decisions|accept|accepts|accepted|accepting|acceptance|approve|approves|approved|approving|approval|spec|specs|scope)\b/i;

// Stem-aware, word-boundary patterns. Each matches the bare word and its common
// inflections, and deliberately NOT inside an unrelated word: `\bmerg` misses
// "emerge" (a word character precedes the "m"), `\bcommit\b` misses
// "commitment" (no boundary before the trailing "ment"), and `\bprs?\b` misses
// "approach"/"imprint" (no boundary before the "pr") and "PRint" (no boundary
// after it). The inflection trap is real: `\bpush\b` alone misses "pushed".
const FOR_TODD_GIT_WORDS = [
  { word: 'merge', pattern: /\bmerg(?:e|es|ed|ing)\b/i },
  { word: 'push', pattern: /\bpush(?:es|ed|ing)?\b/i },
  { word: 'branch', pattern: /\bbranch(?:es|ed|ing)?\b/i },
  { word: 'PR', pattern: /\bprs?\b/i },
  { word: 'commit', pattern: /\bcommit(?:s|ted|ting)?\b/i },
  { word: 'rebase', pattern: /\brebas(?:e|es|ed|ing)\b/i },
];

const FOR_TODD_HEADER = /^\s*(?:[#>*_]+\s*)*For Todd:/i;

function namesACategory(text) {
  return CATEGORY_MARKER.test(text)
    || ACCOUNT_ONLY_VOCABULARY.test(text)
    || MONEY_VOCABULARY.test(text)
    || PRODUCT_VOCABULARY.test(text);
}

// The `For Todd:` trailer is the section headed exactly `For Todd:` at the end
// of the report; everything from that header to the first blank line (or the
// end of the body) is "a For Todd line". The same words above the header -- in
// the report body -- are ordinary prose and are not the guard's business.
function forToddSectionLines(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => FOR_TODD_HEADER.test(line));
  if (start === -1) return [];
  const section = [];
  for (let i = start; i < lines.length; i += 1) {
    if (i > start && lines[i].trim() === '') break;
    section.push(lines[i]);
  }
  return section;
}

// Exported and pure: returns `{ ok: true }` or `{ ok: false, rule, reason }`,
// never throws, whatever the body is. Rule names `category` and
// `git-vocabulary` are what the thrown error names too.
export function checkForToddGuard(body) {
  const text = typeof body === 'string' ? body : '';
  if (WAITING_ON_YOU_MARKER.test(text) && !namesACategory(text)) {
    return {
      ok: false,
      rule: 'category',
      reason: 'a "WAITING ON YOU" comment must name one of the three kinds of Todd-only thing: (a) an action only his account can take (sign-in, payment), (b) a money decision, or (c) a product decision or acceptance -- via the marker (a)/(b)/(c) or that vocabulary',
    };
  }
  for (const line of forToddSectionLines(text)) {
    const hit = FOR_TODD_GIT_WORDS.find(({ pattern }) => pattern.test(line));
    if (hit) {
      return {
        ok: false,
        rule: 'git-vocabulary',
        reason: `a For Todd: line must not mention "${hit.word}" or an inflection of it -- merges, git, branches and the rest are the agent's own to decide, do and log`,
      };
    }
  }
  return { ok: true };
}

// Every refusal ends with this: the agent must act, not ask. A genuine
// Todd-only thing outside the three kinds is a design defect to log, not a
// post to force through.
const GUARD_ACTING_INSTRUCTION = 'Act instead of asking: the agent decides, does and logs this itself; a genuinely Todd-only thing outside those three kinds is a design defect -- log it on the ticket or in docs/agents/jul43-coordinator-runbook.md, never force this comment through.';

function guardRefusalError(result) {
  return new Error(`postComment refused by the For-Todd guard (rule: ${result.rule}): ${result.reason}. ${GUARD_ACTING_INSTRUCTION}`);
}

export async function postComment(identifier, body, opts) {
  // The guard runs before the first network call, so a refused post costs no
  // API request and no Linear write.
  const guard = checkForToddGuard(body);
  if (!guard.ok) {
    throw guardRefusalError(guard);
  }
  const { issue } = await linearGraphQL(ISSUE_ID_QUERY, { id: identifier }, opts);
  const data = await linearGraphQL(COMMENT_CREATE_MUTATION, { issueId: issue.id, body }, opts);
  if (!data.commentCreate.success) {
    throw new Error(`commentCreate did not report success for ${identifier}`);
  }
  return data.commentCreate.comment;
}

async function main() {
  const [command, identifier, ...rest] = process.argv.slice(2);
  const apiKey = process.env.LINEAR_API_KEY;
  try {
    if (command === 'get-issue') {
      const issue = await getIssue(identifier, { apiKey });
      console.log(JSON.stringify(issue, null, 2));
    } else if (command === 'comment') {
      const body = rest.join(' ');
      const comment = await postComment(identifier, body, { apiKey });
      console.log(JSON.stringify(comment, null, 2));
    } else {
      console.error('usage: linear-cli.mjs get-issue <ID> | comment <ID> <body>');
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
