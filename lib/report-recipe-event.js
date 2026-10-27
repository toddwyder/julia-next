// Tells the server what happened to a sign-in, a save or the move. The body
// holds only the action, the outcome, a Firebase error code and a count.
// Returns nothing so no caller can make the screen wait on reporting; the
// token is asked for at once, so a signOut right after still gets reported.
export function reportRecipeEvent(user, event) {
  user.getIdToken()
    .then(token => fetch('/api/recipe-events', {
      method: 'POST',
      keepalive: true,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    }))
    .catch(() => {});
}

/** @param {unknown} thrown */
export function errorCode(thrown) {
  return typeof thrown?.code === 'string' ? thrown.code : 'unknown';
}
