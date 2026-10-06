#!/usr/bin/env node
// Runnable #211 capture seam. It only reads Factory, Mastra and GitHub, then
// delegates the one idempotent database write to issue-cost-records.mjs.
import { captureIssueCostRecord, saveIssueCostRecord } from './issue-cost-records.mjs';
import { readFactoryCards } from './factory-cards.mjs';
import { readTraceSpans, normalizeTraceSpans } from './mastra-traces.mjs';
import { readPackFallbackReasons, readSessionMessages } from './mastra-session-messages.mjs';
import { runPsql } from './run-psql.mjs';

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
  return number;
}

export function parseCaptureArguments(argv) {
  if (argv.length !== 2 || !['--factory-card', '--laptop-pr'].includes(argv[0])) {
    throw new Error('usage: issue-cost-capture.mjs (--factory-card ISSUE_NUMBER | --laptop-pr PR_NUMBER)');
  }
  const value = positiveInteger(argv[1], argv[0]);
  return argv[0] === '--factory-card' ? { kind: 'factory', issueNumber: value } : { kind: 'laptop', pullRequestNumber: value };
}

function requiredEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function githubClient({ env, fetchImpl = fetch, log = console.error }) {
  const owner = env.ISSUE_COST_CAPTURE_GITHUB_OWNER ?? 'toddwyder';
  const repo = env.ISSUE_COST_CAPTURE_GITHUB_REPO ?? 'julia-next';
  const token = env.ISSUE_COST_CAPTURE_GITHUB_TOKEN;
  const headers = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  async function api(path) {
    try {
      const response = await fetchImpl(`https://api.github.com${path}`, { headers });
      if (!response.ok) throw new Error(`GitHub read returned HTTP ${response.status}`);
      log(`issue-cost-capture event=github-read path=${path} outcome=ok`);
      return response.json();
    } catch (error) {
      log(`issue-cost-capture event=github-read path=${path} outcome=failed error=${error.message}`);
      throw error;
    }
  }
  return {
    readIssue: async (number) => api(`/repos/${owner}/${repo}/issues/${number}`),
    readPullRequest: async ({ pullRequestNumber, issueNumber } = {}) => {
      let number = pullRequestNumber;
      if (!number) {
        const issueTimeline = await api(`/repos/${owner}/${repo}/issues/${issueNumber}/timeline`);
        const linkedPullRequests = [...new Map(issueTimeline
          .filter((event) => event.event === 'cross-referenced' && event.source?.issue?.pull_request)
          .map((event) => [event.source.issue.number, event.source.issue])).values()];
        if (linkedPullRequests.length !== 1) {
          throw new Error(`Factory card #${issueNumber} must have exactly one linked pull request`);
        }
        number = linkedPullRequests[0].number;
      }
      const pullRequest = await api(`/repos/${owner}/${repo}/pulls/${number}`);
      // GitHub's issue timeline is the API-backed PR-to-issue relation. It is
      // deliberately required to be singular rather than guessing from text.
      const timeline = await api(`/repos/${owner}/${repo}/issues/${number}/timeline`);
      const linked = timeline.filter((event) => event.event === 'cross-referenced' && event.source?.issue && !event.source.issue.pull_request)
        .map((event) => event.source.issue).filter((issue) => issue.number !== number);
      const closingIssues = [...new Map(linked.map((issue) => [issue.number, issue])).values()].map((issue) => ({
        number: issue.number, title: issue.title, state: issue.state?.toUpperCase(), closedAt: issue.closed_at,
      }));
      return { number: pullRequest.number, commits: pullRequest.commits ?? [], closingIssues };
    },
  };
}

export async function runIssueCostCapture({
  argv = process.argv.slice(2), env = process.env, fetchImpl = fetch, now = () => new Date().toISOString(),
  write = console.log, log = console.error, readIssue, readPullRequest, readCards, readSpans,
  normalizeTraces = normalizeTraceSpans, readMessages, readFallbackReasons = readPackFallbackReasons, saveRecord,
} = {}) {
  const input = parseCaptureArguments(argv);
  const config = { database: env.ISSUE_COST_CAPTURE_DATABASE ?? 'julia_factory_trial', project_id: env.ISSUE_COST_CAPTURE_PROJECT_ID?.trim() };
  const github = githubClient({ env, fetchImpl, log });
  const pullReader = readPullRequest ?? github.readPullRequest;
  const saver = saveRecord ?? ((record) => saveIssueCostRecord({ record, database: config.database, runPsql }));

  let issue;
  if (input.kind === 'factory') {
    const read = readIssue ?? github.readIssue;
    const source = await read(input.issueNumber);
    if (source.state?.toLowerCase() !== 'closed') throw new Error(`Factory card #${input.issueNumber} is not finished`);
    issue = { number: source.number, title: source.title, outcome: 'done', completedAt: source.closed_at ?? source.closedAt ?? null };
  } else {
    const pullRequest = await pullReader({ pullRequestNumber: input.pullRequestNumber });
    if (pullRequest.closingIssues?.length !== 1) throw new Error(`Laptop PR #${input.pullRequestNumber} must have exactly one linked issue`);
    const linked = pullRequest.closingIssues[0];
    if (linked.state?.toLowerCase() !== 'closed') throw new Error(`Laptop PR #${input.pullRequestNumber} linked issue is not finished`);
    issue = { number: linked.number, title: linked.title, outcome: 'done', completedAt: linked.closedAt ?? null };
    const saved = await captureIssueCostRecord({ issue, kind: 'laptop', readPullRequest: async () => pullRequest, saveRecord: saver, log });
    return printSaved(saved, write);
  }

  const factoryUrl = requiredEnv(env, 'ISSUE_COST_CAPTURE_FACTORY_URL');
  if (!config.project_id) throw new Error('ISSUE_COST_CAPTURE_PROJECT_ID is required');
  const cards = await (readCards ?? (() => readFactoryCards({ config, runPsql })))();
  const card = cards.find((candidate) => Number(candidate.number) === issue.number);
  if (!card?.enteredAt) throw new Error(`Factory card #${issue.number} has no capture start time`);
  const saved = await captureIssueCostRecord({
    issue, kind: 'factory', from: card.enteredAt, to: now(), factoryBotLogin: env.ISSUE_COST_CAPTURE_FACTORY_BOT_LOGIN ?? null,
    readCards: async () => cards,
    readSpans: readSpans ?? ((window) => readTraceSpans({ factoryUrl, ...window, fetchImpl })),
    normalizeTraces,
    readMessages: readMessages ?? ((session) => readSessionMessages({ factoryUrl, ...session, fetchImpl })),
    readFallbackReasons, readPullRequest: pullReader, saveRecord: saver, log,
  });
  return printSaved(saved, write);
}

function printSaved(saved, write) {
  write(JSON.stringify(saved));
  return saved;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  runIssueCostCapture().catch((error) => { console.error(`issue-cost-capture: failed: ${error.message}`); process.exitCode = 1; });
}
