// The observability context is what lets a step ask for its own span. It is not
// wired by the boot: a process that wants `getCurrentSpan()` inside a step must
// install the storage first, from the same installed program the harness loads
// (@mastra/core/dist/observability/context-storage.js).

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { harness } from '../shipping/harness.mjs';

export async function loadTracing() {
  const location = path.join(harness.modules, '@mastra', 'core', 'dist', 'observability', 'context-storage.js');
  const module = await import(pathToFileURL(location).href);
  module.initContextStorage();
  return { getCurrentSpan: module.getCurrentSpan };
}
