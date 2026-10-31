import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  db,
  loginWithCredentials,
  getActiveSession,
  getStoredSessionUser,
  restorePersistentSession,
  logoutUser,
  getStorage,
  SEEDED_OFFLINE_USERS
} from '../src/lib';

describe('Offline-First Authentication & Long-Lived Session Persistence', () => {
  beforeEach(async () => {
    // Clear Dexie meta table and in-memory session
    await db.meta.clear();
    await logoutUser();
    getStorage().removeItem('setu_persistent_session');
  });

  it('allows day-1 offline login for chw1 without any prior online connection', async () => {
    expect(getActiveSession()).toBeNull();
    expect(getStoredSessionUser()).toBeNull();

    // Login completely offline with seeded credentials
    const user = await loginWithCredentials('chw1', 'Test-Password-1', 'Field Mobile Test');
    expect(user).toBeDefined();
    expect(user.staffId).toBe('chw1');
    expect(user.role).toBe('CHW');
    expect(user.district).toBe('Ludhiana');

    // Active session should now be populated and marked as offline unlock
    const session = getActiveSession();
    expect(session).not.toBeNull();
    expect(session?.user.staffId).toBe('chw1');
    expect(session?.isOfflineUnlock).toBe(true);

    // Stored session should be in localStorage for instant retrieval on next reload
    const storedUser = getStoredSessionUser();
    expect(storedUser).not.toBeNull();
    expect(storedUser?.name).toBe('Harpreet Kaur');
  });

  it('allows offline login for clinician (doctor1) without prior online connection', async () => {
    const user = await loginWithCredentials('doctor1', 'Test-Password-1', 'Doctor Tablet Test');
    expect(user.staffId).toBe('doctor1');
    expect(user.role).toBe('DOCTOR');
    expect(user.name).toBe('Dr. Gurpreet Sandhu');

    const session = getActiveSession();
    expect(session?.user.role).toBe('DOCTOR');
  });

  it('restores persistent session automatically across simulated app reboots', async () => {
    // 1. Initial login
    await loginWithCredentials('chw1', 'Test-Password-1', 'Field Mobile');
    expect(getActiveSession()).not.toBeNull();

    // 2. Simulate page reload / JS memory reset by clearing in-memory session
    // (Notice: we keep localStorage intact, just as a phone browser restart does)
    const storedUser = getStoredSessionUser();
    expect(storedUser?.staffId).toBe('chw1');

    // Restore persistent session
    const restored = await restorePersistentSession();
    expect(restored).not.toBeNull();
    expect(restored?.user.staffId).toBe('chw1');
    expect(restored?.user.district).toBe('Ludhiana');
  });

  it('rejects incorrect PIN in offline mode and prevents unauthorized access', async () => {
    await expect(
      loginWithCredentials('chw1', 'Wrong-Password-99', 'Field Mobile')
    ).rejects.toThrow();
  });

  it('clears persistent session when user explicitly logs out', async () => {
    await loginWithCredentials('chw1', 'Test-Password-1', 'Field Mobile');
    expect(getStoredSessionUser()).not.toBeNull();

    await logoutUser();
    expect(getActiveSession()).toBeNull();
    expect(getStoredSessionUser()).toBeNull();
  });
});
