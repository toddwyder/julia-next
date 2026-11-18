// The font services a build must never reach. The source check refuses these
// names in served code and the build step makes them unreachable, so both read
// this one list instead of restating it.
export const FONT_HOSTS = Object.freeze([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'use.typekit.net',
  'fonts.bunny.net',
]);
