import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createModelJournal } from '../../src/model-journal.mjs';
import { checkedFetch } from '../../src/reviewer.mjs';

test('a real Beam dispatch is durably journaled with its response and usage', async t => {
  assert.ok(process.env.COMMANDCODE_API_KEY, 'COMMANDCODE_API_KEY must be supplied through the approved vault');
  const directory = await mkdtemp(join(tmpdir(), 'jul223-journal-real-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'model-events.json');
  const journal = await createModelJournal({ path });

  const response = await checkedFetch('https://api.commandcode.ai/provider/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.COMMANDCODE_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'reflection/beam:free',
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      max_tokens: 8,
    }),
  }, async () => {}, null, async () => {}, journal.record);

  assert.equal(response.status, 200);
  const events = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(events.map(event => event.kind), ['request', 'response', 'usage']);
  assert.deepEqual(events[0].body.messages, [{ role: 'user', content: 'Reply with OK.' }]);
  assert.ok(events[1].raw.length > 0);
  assert.ok(events[2].usage.prompt_tokens > 0);
});
