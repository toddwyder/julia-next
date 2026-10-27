// Firebase web config identifies the project; it is not a secret. Access is
// decided by firestore.rules. NEXT_PUBLIC_FIREBASE_EMULATOR=1 points the app at
// the local emulators (firebase.json) under a demo project instead.
import { HOUSEHOLD_WEB_CONFIG } from './firebase-household-config.js';

export const EMULATED = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR === '1';

// The proof project is a throwaway one used to record the proof. It is the only
// project with test users, and its sign-in door opens only when the build is
// pointed at it, so the household project keeps Google sign-in alone.
export const PROOF_PROJECT_ID = 'julia-household-proof';

const DEMO = { apiKey: 'demo-key', authDomain: 'demo-julia.firebaseapp.com', projectId: 'demo-julia' };

// Read as literals so Next inlines them into the browser bundle.
function fromEnv() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  return apiKey && authDomain && projectId && appId ? { apiKey, authDomain, projectId, appId } : null;
}

export function resolveConfig({ emulated, envConfig, household }) {
  if (emulated) return DEMO;
  return envConfig ?? household ?? null;
}

export function usesProofProject(config) {
  return Boolean(config) && config.projectId === PROOF_PROJECT_ID;
}

export const FIREBASE_WEB_CONFIG = resolveConfig({ emulated: EMULATED, envConfig: fromEnv(), household: HOUSEHOLD_WEB_CONFIG });

export const ON_PROOF_PROJECT = usesProofProject(FIREBASE_WEB_CONFIG);
