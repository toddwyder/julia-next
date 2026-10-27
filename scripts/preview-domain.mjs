// Lets Todd sign in with Google on a branch's preview before it merges.
// Authorise only the branch's stable preview address (the one Vercel keeps
// across pushes), and remove it once the branch merges:
//   node scripts/preview-domain.mjs add <host>
//   node scripts/preview-domain.mjs remove <host>

import { accessToken } from './firebase-session.mjs';
import { HOUSEHOLD, ensureAuthorisedDomain, removeAuthorisedDomain } from './provision-firebase.mjs';

export function previewHost(value) {
  const host = value?.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!host || !/^julia-next-git-[a-z0-9-]+\.vercel\.app$/.test(host)) {
    throw new Error(`${value} is not a branch preview address; expected julia-next-git-<branch>-<team>.vercel.app`);
  }
  return host;
}

async function main([action, value]) {
  const host = previewHost(value);
  const step = { add: ensureAuthorisedDomain, remove: removeAuthorisedDomain }[action];
  if (!step) throw new Error('usage: node scripts/preview-domain.mjs add|remove <host>');
  console.log(`${host}: ${await step(HOUSEHOLD, await accessToken(), host)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch(thrown => {
    console.error(thrown.message);
    process.exitCode = 1;
  });
}
