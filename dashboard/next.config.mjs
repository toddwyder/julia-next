import { fileURLToPath } from 'node:url';

export default {
  serverExternalPackages: ['@mastra/code-sdk'],
  turbopack: { root: fileURLToPath(new URL('.', import.meta.url)) },
};
