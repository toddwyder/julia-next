import { expect } from '@playwright/test';

// Browser specs run against the local Auth and Firestore emulators started by
// playwright.config.mjs. "Bearer owner" is the emulator's admin access: it
// skips firestore.rules, the way only the Firebase console can in production.
const PROJECT = 'demo-julia';
const FIRESTORE = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const OWNER = { Authorization: 'Bearer owner' };

export const TODD = 'todd@household.test';
export const KATINA = 'katina@household.test';
export const STRANGER = 'stranger@elsewhere.test';

async function ok(response) {
  if (!response.ok) throw new Error(`${response.url} answered ${response.status}: ${await response.text()}`);
}

/** Empties both emulators and makes Todd and Katina the household. */
export async function resetHousehold() {
  await ok(await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' }));
  await ok(await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' }));
  await ok(await fetch(`${FIRESTORE}/household/members`, {
    method: 'PATCH',
    headers: { ...OWNER, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { emails: { arrayValue: { values: [{ stringValue: TODD }, { stringValue: KATINA }] } } } }),
  }));
}

/** Number of recipes stored in the household library. */
export async function storedRecipeCount() {
  const response = await fetch(`${FIRESTORE}/recipes?pageSize=1000`, { headers: OWNER });
  await ok(response);
  return ((await response.json()).documents ?? []).length;
}

/** Opens the app's "Sign in with Google" button and returns the emulator popup, loaded and ready to fill. */
export async function googlePopup(page) {
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: 'Sign in with Google' }).click(),
  ]);
  await popup.waitForLoadState();
  return popup;
}

/** Signs in through the app's own "Sign in with Google" button and the emulator's Google popup. */
export async function signIn(page, email) {
  await page.goto('/recipes');
  const popup = await googlePopup(page);
  await popup.locator('#add-account-button button').click();
  await popup.locator('#email-input').fill(email);
  await popup.locator('#sign-in').click();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
}
