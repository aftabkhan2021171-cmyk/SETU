/**
 * Phase 1 Unit Tests: Secure Session Restoration, Inactivity Lock, Back-off & PIN Change
 */

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
  isSessionLocked,
  lockSession,
  unlockSessionWithPin,
  changeUserPin,
  getLockCooldownRemainingSeconds,
  resetLockCooldownForTesting,
  setInactivityTimeout
} from '../src/lib';

describe('Phase 1.4, 1.5, 1.6: Secure Session Persistence, Auto-Lock & Back-off', () => {
  beforeEach(async () => {
    await db.meta.clear();
    await logoutUser();
    getStorage().removeItem('setu_persistent_session');
    resetLockCooldownForTesting();
  });

  it('restores persistent session in locked state without using hardcoded PIN', async () => {
    // 1. Initial login (online or offline with PIN)
    const user = await loginWithCredentials('chw1', 'Test-Password-1', 'Field Device', true);
    expect(user.staffId).toBe('chw1');
    const initialSession = getActiveSession();
    expect(initialSession?.cryptoKey).not.toBeNull();
    expect(isSessionLocked()).toBe(false);

    // 2. Simulate app restart (evict in-memory activeSession, keep storage)
    // Manually lock / clear in-memory state
    lockSession();
    expect(isSessionLocked()).toBe(true);

    // 3. Restore session: user identity is restored, but cryptoKey is null until PIN is entered
    const restored = await restorePersistentSession();
    expect(restored).not.toBeNull();
    expect(restored?.user.staffId).toBe('chw1');
    expect(restored?.cryptoKey).toBeNull();
    expect(isSessionLocked()).toBe(true);

    // 4. Entering correct PIN restores the un-wrapped DEK
    const unlockedUser = await unlockSessionWithPin('Test-Password-1');
    expect(unlockedUser.staffId).toBe('chw1');
    expect(isSessionLocked()).toBe(false);
    expect(getActiveSession()?.cryptoKey).not.toBeNull();
  });

  it('enforces exponential back-off cooldown on repeated invalid PIN attempts', async () => {
    await loginWithCredentials('chw1', 'Test-Password-1', 'Field Device', true);
    lockSession();

    // 1st failed attempt -> 1s cooldown
    await expect(unlockSessionWithPin('Bad-PIN-1')).rejects.toThrow(/Cooldown: 1s/);
    expect(getLockCooldownRemainingSeconds()).toBeGreaterThanOrEqual(0);

    // Immediate attempt while in cooldown must be rejected
    await expect(unlockSessionWithPin('Bad-PIN-2')).rejects.toThrow(/temporarily locked/);

    // Wait out cooldown
    await new Promise((r) => setTimeout(r, 1100));

    // 2nd failed attempt -> 2s cooldown
    await expect(unlockSessionWithPin('Bad-PIN-3')).rejects.toThrow(/Cooldown: 2s/);
  });

  it('changes user PIN and re-wraps DEK without data loss', async () => {
    await loginWithCredentials('chw1', 'Test-Password-1', 'Field Device', true);
    const initialDek = getActiveSession()?.cryptoKey;
    expect(initialDek).not.toBeNull();

    // Change PIN from Test-Password-1 to New-Secret-PIN-456
    const success = await changeUserPin('Test-Password-1', 'New-Secret-PIN-456');
    expect(success).toBe(true);

    // Lock session
    lockSession();
    expect(isSessionLocked()).toBe(true);

    // Old PIN should now FAIL
    await expect(unlockSessionWithPin('Test-Password-1')).rejects.toThrow();

    // Wait out 1s cooldown
    await new Promise((r) => setTimeout(r, 1300));

    // New PIN succeeds and restores the exact same DEK key bytes
    await unlockSessionWithPin('New-Secret-PIN-456');
    expect(isSessionLocked()).toBe(false);
    expect(getActiveSession()?.cryptoKey?.keyBytes).toEqual(initialDek?.keyBytes);
  });
});
