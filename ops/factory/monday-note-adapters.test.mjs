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

import { createDiscussionsClient, createDiscordNotifier } from './monday-note-adapters.mjs';

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
