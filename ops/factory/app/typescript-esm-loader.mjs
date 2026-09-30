// typescript-esm-loader.mjs -- resolve local `.js`/extensionless specifiers to
// their `.ts` sibling.
//
// The app source is TypeScript with `moduleResolution: bundler`, so it imports
// local modules either with `.js` specifiers that the bundler rewrites to the
// `.ts` source, or with no extension at all. Node's built-in type stripping
// (`--experimental-strip-types`) strips the types but does not rewrite those
// specifiers, so a test that imports the real TypeScript modules cannot resolve
// them. This is a Node module customisation hook (`module.register`, a built-in
// Node feature), not a build step or a new dependency: it maps a local `.js` or
// extensionless specifier to the `.ts` (or `.tsx`) file when the target does not
// exist, exactly as the bundler would.
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Candidate on-disk paths for a local specifier. */
function candidates(file) {
  if (file.endsWith('.js')) return [file.replace(/\.js$/, '.ts'), file.replace(/\.js$/, '.tsx')];
  return [`${file}.ts`, `${file}.tsx`];
}

export async function resolve(specifier, context, next) {
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    !specifier.endsWith('.json') &&
    context.parentURL
  ) {
    try {
      const file = fileURLToPath(new URL(specifier, context.parentURL));
      let isFile = false;
      try {
        isFile = statSync(file).isFile();
      } catch {
        isFile = false;
      }
      if (!isFile) {
        for (const candidate of candidates(file)) {
          if (existsSync(candidate)) {
            return { url: pathToFileURL(candidate).href, shortCircuit: true };
          }
        }
      }
    } catch {
      // Fall through to the default resolver.
    }
  }
  return next(specifier, context);
}
