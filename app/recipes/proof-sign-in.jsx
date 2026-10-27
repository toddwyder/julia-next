'use client';

import { useState } from 'react';

import styles from './recipes.module.css';

// Test users only. Rendered when the build is pointed at the proof project
// (lib/firebase-project.js), never against the household project.
export default function ProofSignIn({ onSignIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form
      className={styles.stack}
      onSubmit={event => {
        event.preventDefault();
        onSignIn(email, password);
      }}
    >
      <div>
        <label className={styles.label} htmlFor="proof-email">Test user email</label>
        <input
          id="proof-email"
          className={styles.input}
          type="email"
          autoComplete="off"
          value={email}
          onChange={event => setEmail(event.target.value)}
        />
      </div>
      <div>
        <label className={styles.label} htmlFor="proof-password">Test user password</label>
        <input
          id="proof-password"
          className={styles.input}
          type="password"
          autoComplete="off"
          value={password}
          onChange={event => setPassword(event.target.value)}
        />
      </div>
      <button type="submit" className={styles.solid}>Sign in as a test user</button>
    </form>
  );
}
