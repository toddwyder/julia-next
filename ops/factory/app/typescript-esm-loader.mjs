// typescript-esm-loader.mjs -- resolve `./x.js` to its `./x.ts` sibling.
//
// The app source is TypeScript with `moduleResolution: bundler`, so it imports
// local modules with `.js` specifiers that the bundler rewrites to the `.ts`
// source. Node's built-in type stripping (`--experimental-strip-types`) strips
// the types but does not rewrite that `.js` specifier, so a test that imports
// the real TypeScript modules cannot resolve them. This is a Node module
// customisation hook (`module.register`, a built-in Node feature), not a build
// step or a new dependency: it maps a local `.js` specifier to the `.ts` file
// when the `.js` file does not exist, exactly as the bundler would.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    specifier.endsWith('.js') &&
    context.parentURL
  ) {
    try {
      const js = fileURLToPath(new URL(specifier, context.parentURL));
      const ts = js.replace(/\.js$/, '.ts');
      if (!existsSync(js) && existsSync(ts)) {
        return { url: new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL).href, shortCircuit: true };
      }
    } catch {
      // Fall through to the default resolver.
    }
  }
  return next(specifier, context);
}
