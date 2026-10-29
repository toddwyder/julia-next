#!/usr/bin/env node
// linear-cli.mjs -- JUL-77: a small command-line tool that reaches Linear
// with an API key, usable from any agent tool (Claude Code, Codex, Pi),
// not only an MCP-capable client. Replaces both of the orchestrator's
// former MCP-based Linear routes (Decision comment, JUL-77).
//
// The key is never accepted on the command line or read from stdin in the
// clear here -- callers pass it via LINEAR_API_KEY. Laptop delivery commands
// receive it from the vault wrapper, never through argv or a shell string.
const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';
import { existsSync, readFileSync } from 'node:fs';

// Two identities reach Linear through this one function, and they are sent
// DIFFERENTLY. A personal API key (`lin_api_...`) is sent raw, with no scheme
// prefix -- Linear expects exactly that, and scripts/linear-cli.test.mjs pins
// it. An OAuth access token, which is what the "Julia controller" app gets from
// a client-credentials grant, is a bearer token
// and must be sent as `Bearer <token>`; sent raw it is refused.
//
// JUL-98 step 2: `accessToken` is the app path and is what
// an authenticated caller passes, so it writes to the board as
// its own identity. The `apiKey` path is untouched -- the coordinator, the
// Ready queue and every existing caller still use it.
export async function linearGraphQL(query, variables, { apiKey, accessToken, fetchImpl = fetch, url = LINEAR_GRAPHQL_URL } = {}) {
  if (!apiKey && !accessToken) {
    throw new Error('linearGraphQL: apiKey is required (pass LINEAR_API_KEY), or an accessToken for the app identity');
  }
  const authorization = accessToken ? `Bearer ${accessToken}` : apiKey;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) {
    // JUL-98 step 2: the controller has to tell an EXPIRED TOKEN (renew and
    // retry once) from a scope error, a rate limit or a bad query (do not).
    // A message string cannot carry that, so the status and the parsed body
    // travel on the error itself; callers can classify an auth refusal from
    // the one place that reads them. The message is unchanged, so every
    // existing caller and test still matches on it.
    const error = new Error(`Linear API error: ${res.status} ${JSON.stringify(body.errors ?? body)}`);
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return body.data;
}

// The delivery intake reads the card state and labels through this shared query.
const GET_ISSUE_QUERY = `
  query GetIssue($id: String!) {
    viewer { id name }
    issue(id: $id) {
      id
      identifier
      title
      description
      url
      state { name type }
      labels { nodes { name } }
    }
  }
`;

export async function getIssue(identifier, opts) {
  const query = opts?.includeComments ? GET_ISSUE_QUERY.replace('labels { nodes { name } }', 'labels { nodes { name } }\n      comments(first: 250) { nodes { id body createdAt updatedAt user { name } } pageInfo { hasNextPage } }') : GET_ISSUE_QUERY;
  const data = await linearGraphQL(query, { id: identifier }, opts);
  if (opts?.includeComments && data.issue && (data.issue.comments?.pageInfo?.hasNextPage !== false || !Array.isArray(data.issue.comments?.nodes))) throw new Error('incomplete specification comments; refusing truncated intake');
  return data.issue ? { ...data.issue, linearActor: data.viewer ?? null } : data.issue;
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
const GUARD_ACTING_INSTRUCTION = 'Act instead of asking: the agent decides, does and logs this itself; a genuinely Todd-only thing outside those three kinds is a design defect -- log it on the ticket or in docs/agents/server-runbook.md, never force this comment through.';

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
  return postCommentToIssueId(issue.id, body, opts);
}

export async function postCommentToIssueId(issueId, body, opts) {
  const guard = checkForToddGuard(body);
  if (!guard.ok) throw guardRefusalError(guard);
  const data = await linearGraphQL(COMMENT_CREATE_MUTATION, { issueId, body }, opts);
  if (!data.commentCreate.success) {
    throw new Error(`commentCreate did not report success for ${issueId}`);
  }
  return data.commentCreate.comment;
}

// ---------------------------------------------------------------------------
// Moving a card to another workflow state
// ---------------------------------------------------------------------------
//
// A card is finished only when it sits in Complete with the merge commit on it,
// so the tool that comments the commit also has to move the card. The state is
// named, never guessed by id: the name is what a person reads on the board, and
// an exact match is what keeps this from silently picking "Backlog".

const ISSUE_TEAM_STATES_QUERY = `
  query IssueTeamStates($id: String!) {
    issue(id: $id) {
      id
      team { states { nodes { id name type } } }
    }
  }
`;

const ISSUE_UPDATE_MUTATION = `
  mutation IssueUpdate($id: String!, $stateId: String!) {
    issueUpdate(id: $id, input: { stateId: $stateId }) {
      success
      issue { id identifier state { name type } }
    }
  }
`;

export function findStateId(states, wanted) {
  const names = (states ?? []).map(state => state.name);
  const match = (states ?? []).find(state => String(state.name).toLowerCase() === String(wanted).toLowerCase());
  if (!match) {
    throw new Error(`the team has no state named "${wanted}"; it has ${names.map(name => `"${name}"`).join(', ')}`);
  }
  return match.id;
}

export async function setIssueState(identifier, stateName, opts) {
  const { issue } = await linearGraphQL(ISSUE_TEAM_STATES_QUERY, { id: identifier }, opts);
  const stateId = findStateId(issue.team?.states?.nodes, stateName);
  const data = await linearGraphQL(ISSUE_UPDATE_MUTATION, { id: issue.id, stateId }, opts);
  if (!data.issueUpdate.success) {
    throw new Error(`issueUpdate did not report success for ${identifier}`);
  }
  return data.issueUpdate.issue;
}

// ---------------------------------------------------------------------------
// Reading the comment body off the command line (JUL-284 retro)
// ---------------------------------------------------------------------------
//
// A long comment is easier to get right when it is written to a file first, and
// on 29 October 2026 that habit cost the board its two most important records:
// the JUL-276 and JUL-284 merge comments both arrived as the twelve-character
// text `/tmp/c276.md` and `/tmp/c284.md`. `comment <ID> <body>` had no way to
// say "the body is in this file", so the path was passed where the body goes,
// and nothing in the tool could tell the difference: a path is a string, and
// the post succeeded.
//
// Three things now make that refusal loud instead of silent: `--file` reads the
// body from a path, `-` reads it from stdin, and a body that IS the path of an
// existing file is refused with the command that would have worked.
export function commentBodyFromArgs(args, { readFileImpl = readFileSync, fileExists = existsSync } = {}) {
  const [first, second, ...extra] = args;
  if (first === '--file') {
    if (!second || extra.length) throw new Error('usage: linear-cli.mjs comment <ID> --file <path>   (use - for stdin)');
    try {
      return readFileImpl(second, 'utf8');
    } catch (error) {
      throw new Error(`comment --file could not read ${second}: ${error.message}`);
    }
  }
  if (args.length === 1 && first === '-') {
    return readFileImpl(0, 'utf8');
  }
  const body = args.join(' ');
  if (args.length === 1 && fileExists(body)) {
    throw new Error(`refusing to post "${body}": that is the path of an existing file, not a comment body. Post its contents with: linear-cli.mjs comment <ID> --file ${body}`);
  }
  return body;
}

async function main() {
  const [command, identifier, ...rest] = process.argv.slice(2);
  const apiKey = process.env.LINEAR_API_KEY;
  try {
    if (command === 'list-ready') {
      const { listReady } = await import('../dashboard/lib/linear.js');
      console.log(JSON.stringify(await listReady({ apiKey }), null, 2));
    } else if (command === 'get-issue') {
      const issue = await getIssue(identifier, { apiKey });
      console.log(JSON.stringify(issue, null, 2));
    } else if (command === 'comments') {
      const issue = await getIssue(identifier, { apiKey, includeComments: true });
      const comments = (issue.comments?.nodes ?? []).map(comment => ({ id: comment.id, createdAt: comment.createdAt, author: comment.user?.name ?? null, body: comment.body }));
      console.log(JSON.stringify({ identifier: issue.identifier, count: comments.length, comments }, null, 2));
    } else if (command === 'comment') {
      const body = commentBodyFromArgs(rest);
      const comment = await postComment(identifier, body, { apiKey });
      // The length is the point: the two lost records were eleven characters
      // long where they should have been thousands.
      console.log(`posted ${body.length} characters to ${identifier}: ${comment.url}`);
    } else if (command === 'state') {
      const stateName = rest.join(' ').trim();
      if (!stateName) throw new Error('usage: linear-cli.mjs state <ID> <state name>');
      const issue = await setIssueState(identifier, stateName, { apiKey });
      console.log(JSON.stringify(issue, null, 2));
    } else {
      console.error('usage: linear-cli.mjs list-ready | get-issue <ID> | comments <ID> | comment <ID> <body> | comment <ID> --file <path> | comment <ID> - | state <ID> <state name>');
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
