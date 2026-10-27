import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, getDocs, collection, setDoc, updateDoc } from 'firebase/firestore';

import { householdEmulator, KATINA, STRANGER, TODD } from './household-emulator.mjs';

let household;
before(async () => { household = await householdEmulator(); });
after(() => household?.stop());
beforeEach(() => household.clear());

const recipe = (id, extra = {}) => ({ id, title: 'Coq au Vin', ingredients: '1 chicken', steps: 'Simmer.', createdAt: '2026-10-27T00:00:00.000Z', ...extra });
const stored = id => household.admin(db => setDoc(doc(db, 'recipes', id), recipe(id)));

test('both household members can read the household list, save a recipe, and read each other\'s recipes', async () => {
  await assertSucceeds(getDoc(doc(household.as(TODD), 'household', 'members')));
  await assertSucceeds(getDoc(doc(household.as(KATINA), 'household', 'members')));
  await assertSucceeds(setDoc(doc(household.as(TODD), 'recipes', 'r1'), recipe('r1')));
  await assertSucceeds(getDoc(doc(household.as(KATINA), 'recipes', 'r1')));
  await assertSucceeds(getDocs(collection(household.as(KATINA), 'recipes')));
});

test('a signed-in Google account outside the household can read and write nothing', async () => {
  await stored('r1');
  const db = household.as(STRANGER);
  await assertFails(getDoc(doc(db, 'household', 'members')));
  await assertFails(getDoc(doc(db, 'recipes', 'r1')));
  await assertFails(getDocs(collection(db, 'recipes')));
  await assertFails(setDoc(doc(db, 'recipes', 'r2'), recipe('r2')));
});

test('a household email that Google has not verified, and a signed-out browser, are refused', async () => {
  await stored('r1');
  for (const db of [household.as(TODD, { verified: false }), household.signedOut()]) {
    await assertFails(getDoc(doc(db, 'household', 'members')));
    await assertFails(getDoc(doc(db, 'recipes', 'r1')));
    await assertFails(setDoc(doc(db, 'recipes', 'r2'), recipe('r2')));
  }
});

test('no browser can change the household list, even a member\'s', async () => {
  const db = household.as(TODD);
  await assertFails(setDoc(doc(db, 'household', 'members'), { emails: [TODD.email, STRANGER.email] }));
  await assertFails(updateDoc(doc(db, 'household', 'members'), { emails: [STRANGER.email] }));
  await assertFails(deleteDoc(doc(db, 'household', 'members')));
});

test('a stored recipe cannot be overwritten, changed or deleted', async () => {
  await stored('r1');
  const db = household.as(TODD);
  await assertFails(setDoc(doc(db, 'recipes', 'r1'), recipe('r1', { title: 'Something else' })));
  await assertFails(updateDoc(doc(db, 'recipes', 'r1'), { title: 'Something else' }));
  await assertFails(deleteDoc(doc(db, 'recipes', 'r1')));
});

test('only a whole recipe stored under its own id is accepted', async () => {
  const db = household.as(TODD);
  const { steps, ...withoutSteps } = recipe('r1');
  await assertFails(setDoc(doc(db, 'recipes', 'r1'), withoutSteps));
  await assertFails(setDoc(doc(db, 'recipes', 'r1'), recipe('r1', { createdBy: TODD.email })));
  await assertFails(setDoc(doc(db, 'recipes', 'r1'), recipe('other-id')));
  await assertFails(setDoc(doc(db, 'recipes', 'r1'), recipe('r1', { title: '   ' })));
  await assertFails(setDoc(doc(db, 'recipes', 'r1'), recipe('r1', { ingredients: 12 })));
  await assertFails(setDoc(doc(db, 'recipes', 'r1'), recipe('r1', { steps: 'x'.repeat(100_001) })));
  await assertSucceeds(setDoc(doc(db, 'recipes', 'r1'), recipe('r1', { steps })));
});
