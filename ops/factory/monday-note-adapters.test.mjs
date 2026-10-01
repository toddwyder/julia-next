// monday-note-adapters.test.mjs -- issue #140, blocker 1: the production
// clients that actually post the note and tell Todd.
//
// Both clients are driven by an injected `fetchImpl`, so these tests capture
// the exact HTTP request (URL, method, headers, JSON body) and assert on it --
// the note never leaves this process. The tests never reach GitHub or Discord.
//
// GitHub Discussions is reached over GitHub's GraphQL API at api.github.com,
// the same injected-fetch pattern scripts/linear-cli.mjs uses for Linear. The
// phone notification reuses the installed Discord wait-alert route
// (ops/factory/wait-alerts.py): one channel webhook, `?wait=true`, a confirmed
// message id, and no mentions.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDiscussionsClient, createDiscordNotifier, createIssuesClient } from './monday-note-adapters.mjs';

const DISCORD_URL = 'https://discord.com/api/webhooks/123456789012345678/' + 'a'.repeat(68);

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

function recordingFetch(handler) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return handler(String(url), init);
    },
  };
}

// --- GitHub Issues Adapter (Issue #180)

test('issues.find queries GitHub REST API with factory:machine and cost-note labels and finds matching title', async () => {
  const fake = recordingFetch(() => jsonResponse([
    { id: 101, number: 181, title: 'Monday note — week ending 2026-09-28', html_url: 'https://github.com/o/r/issues/181' },
  ]));
  const client = createIssuesClient({ fetchImpl: fake.fetch, token: 't', owner: 'o', repo: 'r' });

  const found = await client.find({ title: 'Monday note — week ending 2026-09-28' });

  assert.equal(found.url, 'https://github.com/o/r/issues/181');
  assert.equal(found.number, 181);
  assert.equal(fake.calls.length, 1);
  assert.match(fake.calls[0].url, /https:\/\/api\.github\.com\/repos\/o\/r\/issues/);
  assert.match(fake.calls[0].url, /labels=factory%3Amachine%2Ccost-note|labels=factory:machine,cost-note/);
  assert.equal(fake.calls[0].init.headers.Authorization, 'Bearer t');
});

test('issues.find returns null when no issue matches the title', async () => {
  const fake = recordingFetch(() => jsonResponse([]));
  const client = createIssuesClient({ fetchImpl: fake.fetch, token: 't', owner: 'o', repo: 'r' });

  const found = await client.find({ title: 'Monday note — week ending 2026-09-28' });

  assert.equal(found, null);
});

test('issues.find paginates until the title is found', async () => {
  const fake = recordingFetch((url) => {
    if (/[?&]page=1(?=&|$)/.test(url)) {
      // Return 100 dummy issues for page 1
      const page1 = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        number: i + 1,
        title: `Other issue ${i}`,
        html_url: `https://github.com/o/r/issues/${i + 1}`,
      }));
      return jsonResponse(page1);
    }
    return jsonResponse([
      { id: 200, number: 181, title: 'Monday note — week ending 2026-09-28', html_url: 'https://github.com/o/r/issues/181' },
    ]);
  });
  const client = createIssuesClient({ fetchImpl: fake.fetch, token: 't', owner: 'o', repo: 'r' });


  const found = await client.find({ title: 'Monday note — week ending 2026-09-28' });

  assert.equal(found.url, 'https://github.com/o/r/issues/181');
  assert.equal(fake.calls.length, 2);
});

test('issues.post creates a GitHub issue with factory:machine and cost-note labels and returns its URL', async () => {
  const fake = recordingFetch((url, init) => {
    return jsonResponse({
      id: 501,
      number: 182,
      title: 'Monday note — week ending 2026-09-28',
      html_url: 'https://github.com/o/r/issues/182',
    });
  });
  const client = createIssuesClient({ fetchImpl: fake.fetch, token: 't', owner: 'o', repo: 'r' });

  const issue = await client.post({
    title: 'Monday note — week ending 2026-09-28',
    body: '## Weekly cost note...',
  });

  assert.equal(issue.url, 'https://github.com/o/r/issues/182');
  assert.equal(issue.number, 182);
  const call = fake.calls[0];
  assert.equal(call.init.method, 'POST');
  assert.equal(call.url, 'https://api.github.com/repos/o/r/issues');
  const payload = JSON.parse(call.init.body);
  assert.equal(payload.title, 'Monday note — week ending 2026-09-28');
  assert.equal(payload.body, '## Weekly cost note...');
  assert.deepEqual(payload.labels, ['factory:machine', 'cost-note']);
});

test('issues.post surfaces HTTP errors when GitHub rejects the request', async () => {
  const fake = recordingFetch(() => jsonResponse({ message: 'Validation Failed' }, 422));
  const client = createIssuesClient({ fetchImpl: fake.fetch, token: 't', owner: 'o', repo: 'r' });

  await assert.rejects(
    () => client.post({ title: 'T', body: 'B' }),
    /GitHub Issues API error: 422/,
  );
});

// --- GitHub Discussions Adapter (Legacy compatibility)

test('discussions.find asks GitHub for the note title in the category', async () => {

  const fake = recordingFetch(() => jsonResponse({
    data: {
      repository: {
        id: 'REPO',
        discussionCategories: { nodes: [{ id: 'CAT', name: 'Monday notes' }] },
        discussions: { nodes: [{ id: 'D1', title: 'Monday note — week ending 2026-09-28', url: 'https://github.com/o/r/discussions/1' }] },
      },
    },
  }));
  const client = createDiscussionsClient({ fetchImpl: fake.fetch, token: 't', owner: 'o', repo: 'r' });

  const found = await client.find({ category: 'Monday notes', title: 'Monday note — week ending 2026-09-28' });

  assert.equal(found.url, 'https://github.com/o/r/discussions/1');
  const body = JSON.parse(fake.calls[0].init.body);
  assert.match(body.query, /discussionCategories/);
  assert.equal(body.variables.owner, 'o');
  assert.equal(body.variables.repo, 'r');
  assert.equal(fake.calls[0].init.headers.Authorization, 'Bearer t');
});

test('discussions.find returns null when the week has no discussion yet', async () => {
  const fake = recordingFetch(() => jsonResponse({
    data: {
      repository: {
        id: 'REPO',
        discussionCategories: { nodes: [{ id: 'CAT', name: 'Monday notes' }] },
        discussions: { nodes: [] },
      },
    },
  }));
  const client = createDiscussionsClient({ fetchImpl: fake.fetch, token: 't', owner: 'o', repo: 'r' });

  assert.equal(await client.find({ category: 'Monday notes', title: 'Monday note — week ending 2026-09-28' }), null);
});

test('discussions.find pages through every discussion so an old title is still found', async () => {
  // The cursor must be reliable: a week whose note is older than the first
  // page must still be seen, or the backfill would re-post it.
  const fake = recordingFetch((url, init) => {
    const body = JSON.parse(init.body);
    if (/discussionCategories/.test(body.query)) {
      return jsonResponse({ data: { repository: { id: 'REPO', discussionCategories: { nodes: [{ id: 'CAT', name: 'Monday notes' }] }, discussions: { nodes: [] } } } });
    }
    const after = body.variables.after;
    if (!after) {
      return jsonResponse({
        data: {
          repository: {
            discussions: {
              pageInfo: { hasNextPage: true, endCursor: 'CURSOR-1' },
              nodes: [{ id: 'D-new', title: 'Monday note — week ending 2026-10-05', url: 'https://example.test/2' }],
            },
          },
        },
      });
    }
    return jsonResponse({
      data: {
        repository: {
          discussions: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{ id: 'D-old', title: 'Monday note — week ending 2026-09-28', url: 'https://example.test/1' }],
          },
        },
      },
    });
  });
  const client = createDiscussionsClient({ fetchImpl: fake.fetch, token: 't', owner: 'o', repo: 'r' });

  const found = await client.find({ category: 'Monday notes', title: 'Monday note — week ending 2026-09-28' });

  assert.equal(found.url, 'https://example.test/1');
  const discussionCalls = fake.calls.filter((c) => /ExistingDiscussion|discussions\(/.test(JSON.parse(c.init.body).query));
  assert.equal(discussionCalls.length, 2, 'find paginates until the title is found');
});

test('discussions.find fails closed when the category does not exist', async () => {
  const fake = recordingFetch(() => jsonResponse({
    data: { repository: { id: 'REPO', discussionCategories: { nodes: [{ id: 'CAT', name: 'General' }] }, discussions: { nodes: [] } } },
  }));
  const client = createDiscussionsClient({ fetchImpl: fake.fetch, token: 't', owner: 'o', repo: 'r' });

  await assert.rejects(
    () => client.find({ category: 'Monday notes', title: 'x' }),
    /category .*Monday notes.* not found|discussion category/i,
  );
});

test('discussions.post creates the discussion in the category and returns its URL', async () => {
  const fake = recordingFetch((url, init) => {
    const body = JSON.parse(init.body);
    if (/discussionCategories/.test(body.query)) {
      return jsonResponse({ data: { repository: { id: 'REPO', discussionCategories: { nodes: [{ id: 'CAT', name: 'Monday notes' }] }, discussions: { nodes: [] } } } });
    }
    return jsonResponse({ data: { createDiscussion: { discussion: { id: 'D1', url: 'https://github.com/o/r/discussions/1' } } } });
  });
  const client = createDiscussionsClient({ fetchImpl: fake.fetch, token: 't', owner: 'o', repo: 'r' });

  const discussion = await client.post({ category: 'Monday notes', title: 'Monday note — week ending 2026-09-28', body: 'hello' });

  assert.equal(discussion.url, 'https://github.com/o/r/discussions/1');
  const mutation = fake.calls.at(-1);
  const body = JSON.parse(mutation.init.body);
  assert.match(body.query, /createDiscussion/);
  assert.equal(body.variables.categoryId, 'CAT');
  assert.equal(body.variables.body, 'hello');
});

test('discussions surfaces a GraphQL error instead of pretending it posted', async () => {
  const fake = recordingFetch(() => jsonResponse({ errors: [{ message: 'Resource not accessible' }] }));
  const client = createDiscussionsClient({ fetchImpl: fake.fetch, token: 't', owner: 'o', repo: 'r' });

  await assert.rejects(() => client.find({ category: 'Monday notes', title: 'x' }), /Resource not accessible/);
});

test('the Discord notifier posts one confirmed message with the link', async () => {
  const fake = recordingFetch(() => jsonResponse({ id: '123456789012345678', channel_id: '123456789012345679' }));
  const notifier = createDiscordNotifier({ fetchImpl: fake.fetch, webhookUrl: DISCORD_URL });

  const result = await notifier.notify({ title: 'Monday note', body: 'Quiet week.', url: 'https://github.com/o/r/discussions/1' });

  assert.equal(result.messageId, '123456789012345678');
  const call = fake.calls[0];
  assert.equal(call.url, `${DISCORD_URL}?wait=true`);
  const payload = JSON.parse(call.init.body);
  assert.equal(payload.allowed_mentions.parse.length, 0);
  assert.match(payload.content, /https:\/\/github\.com\/o\/r\/discussions\/1/);
});

test('the Discord notifier rejects a non-Discord webhook and a missing confirmation', async () => {
  assert.throws(
    () => createDiscordNotifier({ fetchImpl: async () => jsonResponse({}), webhookUrl: 'https://example.com/api/webhooks/1/x' }),
    /Discord webhook/,
  );

  const fake = recordingFetch(() => jsonResponse({ channel_id: '1' }));
  const notifier = createDiscordNotifier({ fetchImpl: fake.fetch, webhookUrl: DISCORD_URL });
  await assert.rejects(() => notifier.notify({ title: 't', body: 'b', url: 'u' }), /confirm a message ID/);
});
