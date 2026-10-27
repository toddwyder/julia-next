import { getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

import { EMULATED, FIREBASE_WEB_CONFIG } from './firebase-project.js';

/** The browser's one Firebase app, its sign-in and its database. */
export function household() {
  if (getApps().length) return { auth: getAuth(), db: getFirestore() };
  const app = initializeApp(FIREBASE_WEB_CONFIG);
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (EMULATED) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  return { auth, db };
}
