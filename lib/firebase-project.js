// Firebase web config identifies the project; it is not a secret. Access is
// decided by firestore.rules. NEXT_PUBLIC_FIREBASE_EMULATOR=1 points the app at
// the local emulators (firebase.json) under a demo project instead.
export const EMULATED = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR === '1';

export const FIREBASE_WEB_CONFIG = EMULATED
  ? { apiKey: 'demo-key', authDomain: 'demo-julia.firebaseapp.com', projectId: 'demo-julia' }
  : {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
