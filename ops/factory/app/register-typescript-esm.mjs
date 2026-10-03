// register-typescript-esm.mjs -- load the `.js` -> `.ts` resolver hook.
//
// Register it with `node --import ./register-typescript-esm.mjs` so a test can
// import the app's real TypeScript modules under Node's built-in type
// stripping. See `typescript-esm-loader.mjs` for why this is needed.
import { register } from 'node:module';

register('./typescript-esm-loader.mjs', import.meta.url);

// Test environment default settings for Mastra Factory models:
process.env.JULIA_BUILDER_MODEL ??= 'deepseek/deepseek-v4-pro';
process.env.JULIA_REVIEWER_MODELS ??= 'moonshotai/Kimi-K2.7-Code';
process.env.JULIA_CHEAP_MODEL ??= 'deepseek/deepseek-v4-flash';
process.env.JULIA_FALLBACK_MODEL ??= 'deepseek/deepseek-v4-pro';
