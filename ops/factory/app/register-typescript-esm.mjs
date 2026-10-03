// register-typescript-esm.mjs -- load the `.js` -> `.ts` resolver hook.
//
// Register it with `node --import ./register-typescript-esm.mjs` so a test can
// import the app's real TypeScript modules under Node's built-in type
// stripping. See `typescript-esm-loader.mjs` for why this is needed.
import { register } from 'node:module';

register('./typescript-esm-loader.mjs', import.meta.url);

