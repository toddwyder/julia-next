import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

import { EMULATOR_HOSTS, EMULATOR_PROJECT_ID, startEmulators } from '../scripts/firebase-emulators.mjs';

export const TODD = { uid: 'todd', email: 'todd@household.test' };
export const KATINA = { uid: 'katina', email: 'katina@household.test' };
export const STRANGER = { uid: 'stranger', email: 'stranger@elsewhere.test' };

// Real emulators running the real firestore.rules, with the household list
// holding Todd and Katina. Call clear() between tests and stop() at the end.
export async function householdEmulator() {
  const emulators = await startEmulators();
  const [host, port] = EMULATOR_HOSTS.firestore.split(':');
  const env = await initializeTestEnvironment({
    projectId: EMULATOR_PROJECT_ID,
    firestore: { host, port: Number(port), rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
  const seed = () => env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'household', 'members'), { emails: [TODD.email, KATINA.email] }));
  await seed();
  return {
    /** @param {{ uid: string, email: string }} person */
    as: (person, { verified = true } = {}) => env.authenticatedContext(person.uid, { email: person.email, email_verified: verified }).firestore(),
    signedOut: () => env.unauthenticatedContext().firestore(),
    async admin(callback) {
      let result;
      await env.withSecurityRulesDisabled(async context => { result = await callback(context.firestore()); });
      return result;
    },
    async clear() {
      await env.clearFirestore();
      await seed();
    },
    async stop() {
      await env.cleanup();
      await emulators.stop();
    },
  };
}
