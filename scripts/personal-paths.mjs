// personal-paths.mjs -- detects hardcoded personal-machine paths
// (single-backslash, escaped double-backslash, and forward-slash forms).
//
// A personal-machine path default works on exactly one machine and fails with a
// raw, unactionable error everywhere else (caught live during JUL-61).
// This module detects personal paths across scripts so they can be required
// from environment variables instead.

export const PERSONAL_PATH = /C:(?:\\\\|[\/\\])Users(?:\\\\|[\/\\])[A-Za-z0-9_.-]+/i;

/**
 * Returns the personal-machine paths found in a piece of text:
 * single-backslash, escaped double-backslash and forward-slash forms.
 *
 * @param {string} text - The text to search for personal-machine paths
 * @returns {string[]} Array of matched personal-machine paths
 */
export function findPersonalPaths(text) {
  if (typeof text !== 'string') return [];
  const matches = text.match(new RegExp(PERSONAL_PATH.source, 'gi'));
  return matches ? Array.from(matches) : [];
}
