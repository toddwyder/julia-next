// read-secret.mjs -- the retained read-only boundary for loading one known
// field from the protected secret directory into this process.
//
// Never source, eval, or exec a secret file's content, and never pass it to
// a child process as a shell command or argv entry. An incident on this
// exact ticket (JUL-72, 2026-09-17) did exactly that: an agent `source`-d a
// raw-value (non-KEY=VALUE) token file, which caused bash to try to execute
// the token itself as a command -- "command not found" echoed the full
// value into the calling agent's own tool output. readSecret() below is the
// durable fix: it reads the file's bytes directly via readFileSync, strips
// exactly one trailing newline from the established file format, and returns
// the value in-process. It performs no shell
// interpretation of the content, under any circumstance, regardless of the
// file's format -- this module must never shell out to read a secret (see
// the static guard in read-secret.test.mjs).
import { readFileSync } from 'node:fs';

export const KNOWN_FIELDS = [
  'sentry', 'supabase', 'powersync', 'axiom', 'deepseek', 'linear',
  'linear-app-id', 'linear-app-secret', 'commandcode',
];

const DEFAULT_DIR = '/etc/orca-runner/dropbox-secrets';

export function readSecret(field, { dir = DEFAULT_DIR, readFileImpl = readFileSync } = {}) {
  if (!KNOWN_FIELDS.includes(field)) {
    throw new Error(`readSecret: unknown field '${field}' -- must be one of ${KNOWN_FIELDS.join('|')}`);
  }
  const raw = readFileImpl(`${dir}/${field}.env`, 'utf8');
  // Strip exactly one trailing newline, not arbitrary whitespace -- a token
  // Any other whitespace survives for the caller to validate; this read-only
  // boundary must not silently normalize secret material.
  return raw.replace(/\n$/, '');
}

// Convenience for the common case: an Authorization header value, built
// in-process and handed straight to fetch() -- never logged, never passed
// through a shell.
export function secretAuthHeader(field, opts) {
  return `Bearer ${readSecret(field, opts)}`;
}
