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

export async function postComment(identifier, body, opts) {
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
