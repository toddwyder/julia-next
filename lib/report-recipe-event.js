// Tells the server what happened to a sign-in, a save or the move. The body
// holds only the action, the outcome, a Firebase error code and a count.
export async function reportRecipeEvent(user, event) {
  try {
    await fetch('/api/recipe-events', {
      method: 'POST',
      keepalive: true,
      headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  } catch {
    // Reporting must never block a save or a sign-in.
  }
}

/** @param {unknown} thrown */
export function errorCode(thrown) {
  return typeof thrown?.code === 'string' ? thrown.code : 'unknown';
}
