'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

import { household } from '../../lib/firebase';
import { moveBrowserRecipes } from '../../lib/recipes';
import { errorCode, reportRecipeEvent } from '../../lib/report-recipe-event';
import styles from './recipes.module.css';

const Household = createContext(null);

/** @returns {{ db: import('firebase/firestore').Firestore, user: import('firebase/auth').User }} */
export function useHousehold() {
  return useContext(Household);
}

// The recipe screens open only for a Google account on the household list.
// Reading household/members is the check: firestore.rules lets only a member
// read it, so a refused read means this account is not in the household.
export default function HouseholdGate({ children }) {
  const [state, setState] = useState({ status: 'loading' });
  const signingIn = useRef(false);

  useEffect(() => {
    const { auth, db } = household();
    return onAuthStateChanged(auth, async user => {
      if (!user) {
        setState(current => (current.status === 'turned-away' ? current : { status: 'signed-out' }));
        return;
      }
      const freshSignIn = signingIn.current;
      signingIn.current = false;
      setState({ status: 'checking' });
      try {
        await getDoc(doc(db, 'household', 'members'));
      } catch (thrown) {
        if (errorCode(thrown) === 'permission-denied') {
          await reportRecipeEvent(user, { action: 'sign-in', outcome: 'turned-away' });
          setState({ status: 'turned-away', email: user.email });
          await signOut(auth);
          return;
        }
        await reportRecipeEvent(user, { action: 'sign-in', outcome: 'failed', code: errorCode(thrown) });
        setState({ status: 'signed-out', error: 'Julia could not reach the recipe library. Check the connection and sign in again.' });
        await signOut(auth);
        return;
      }
      if (freshSignIn) await reportRecipeEvent(user, { action: 'sign-in', outcome: 'ok' });
      let moveError = '';
      try {
        const count = await moveBrowserRecipes(db, window.localStorage);
        if (count > 0) await reportRecipeEvent(user, { action: 'move', outcome: 'ok', count });
      } catch (thrown) {
        await reportRecipeEvent(user, { action: 'move', outcome: 'failed', code: errorCode(thrown) });
        moveError = 'Some recipes saved in this browser could not join the library yet. Julia will try again next time.';
      }
      setState({ status: 'member', db, user, moveError });
    });
  }, []);

  async function signIn() {
    signingIn.current = true;
    setState({ status: 'checking' });
    try {
      await signInWithPopup(household().auth, new GoogleAuthProvider());
    } catch {
      signingIn.current = false;
      setState({ status: 'signed-out', error: 'Sign-in did not finish. Try again.' });
    }
  }

  if (state.status === 'member') {
    return (
      <Household.Provider value={{ db: state.db, user: state.user }}>
        {state.moveError ? <p className={`vintage-column ${styles.error}`} role="alert">{state.moveError}</p> : null}
        {children}
        <p className={`vintage-column ${styles.notice}`}>
          ❧ Signed in as {state.user.email}.{' '}
          <button type="button" className={styles.typewriter} onClick={() => signOut(household().auth)}>Sign out</button>
        </p>
      </Household.Provider>
    );
  }

  if (state.status === 'loading' || state.status === 'checking') {
    return (
      <main className={`vintage-column ${styles.page}`}>
        <p className={styles.loading}>Opening the household library...</p>
      </main>
    );
  }

  return (
    <main className={`vintage-column ${styles.page}`}>
      <div className={styles.stack}>
        <h1 className={styles.title}>The Household Library</h1>
        <div className={styles.emptyBox}>
          {state.status === 'turned-away'
            ? (
              <>
                <p className={styles.emptyHeading} role="alert">{state.email} is not part of this household.</p>
                <p className={styles.emptyLine}>The recipe library is private. Sign in with a household Google account.</p>
              </>
            )
            : <p className={styles.emptyHeading}>The recipe library is private to the household.</p>}
        </div>
        {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
        <div>
          <button type="button" className={styles.solid} onClick={signIn}>
            {state.status === 'turned-away' ? 'Use another Google account' : 'Sign in with Google'}
          </button>
        </div>
      </div>
    </main>
  );
}
