/**
 * Authentication & Offline Unlock Engine for SETU.
 * Real backend auth with rotating tokens, encrypted storage at rest (AES-256-GCM + PBKDF2),
 * key hierarchy (DEK wrapped by PIN-derived KEK), inactivity auto-lock, and secure offline unlocking.
 */

import { db } from './db';
import { generateUUID } from './uuid';
import {
  generateSalt,
  deriveKeyFromPin,
  generateDataKey,
  wrapDataKey,
  unwrapDataKey,
  rewrapDataKey,
  createVerifier,
  verifyKey,
  encryptString,
  decryptString,
  AnyKey,
  SetuKey
} from './crypto';

export type HealthWorkerCadre = 'ASHA' | 'ANM' | 'AWW' | 'CHW' | 'DOCTOR' | 'ADMIN';

export const CADRE_INFO: Record<HealthWorkerCadre, { code: HealthWorkerCadre; label: string; title: string; color: string; bg: string }> = {
  ASHA: { code: 'ASHA', label: 'ASHA', title: 'Accredited Social Health Activist (ASHA)', color: '#047857', bg: '#D1FAE5' },
  ANM: { code: 'ANM', label: 'ANM', title: 'Auxiliary Nurse Midwife (ANM)', color: '#1D4ED8', bg: '#DBEAFE' },
  AWW: { code: 'AWW', label: 'AWW', title: 'Anganwadi Worker (AWW)', color: '#B45309', bg: '#FEF3C7' },
  CHW: { code: 'CHW', label: 'CHW', title: 'Community Health Worker (General)', color: '#0F766E', bg: '#CCFBF1' },
  DOCTOR: { code: 'DOCTOR', label: 'Doctor', title: 'Medical Officer / Clinician', color: '#6D28D9', bg: '#EDE9FE' },
  ADMIN: { code: 'ADMIN', label: 'Admin', title: 'Program / District Administrator', color: '#334155', bg: '#F1F5F9' }
};

export function getCadreInfo(cadre?: string): { code: HealthWorkerCadre; label: string; title: string; color: string; bg: string } {
  if (cadre && cadre in CADRE_INFO) {
    return CADRE_INFO[cadre as HealthWorkerCadre];
  }
  return CADRE_INFO.CHW;
}

export interface AuthUser {
  id: string;
  staffId: string;
  name: string;
  role: 'CHW' | 'DOCTOR' | 'ADMIN';
  cadre?: HealthWorkerCadre;
  district: string;
}

export interface Session {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  cryptoKey: SetuKey | null;
  isOfflineUnlock: boolean;
  isLocked?: boolean;
}

export const SEEDED_OFFLINE_USERS: Record<string, { user: AuthUser; pin: string }> = {
  chw1: {
    user: { id: 'U-CHW1', staffId: 'chw1', name: 'Harpreet Kaur', role: 'CHW', cadre: 'CHW', district: 'Ludhiana' },
    pin: 'Test-Password-1'
  },
  chw2: {
    user: { id: 'U-CHW2', staffId: 'chw2', name: 'Simran Singh', role: 'CHW', cadre: 'CHW', district: 'Khanna' },
    pin: 'Test-Password-1'
  },
  asha1: {
    user: { id: 'U-ASHA1', staffId: 'asha1', name: 'Sunita Devi (ASHA)', role: 'CHW', cadre: 'ASHA', district: 'Ludhiana' },
    pin: 'Test-Password-1'
  },
  anm1: {
    user: { id: 'U-ANM1', staffId: 'anm1', name: 'Pooja Sharma (ANM)', role: 'CHW', cadre: 'ANM', district: 'Ludhiana' },
    pin: 'Test-Password-1'
  },
  aww1: {
    user: { id: 'U-AWW1', staffId: 'aww1', name: 'Meena Kumari (AWW)', role: 'CHW', cadre: 'AWW', district: 'Ludhiana' },
    pin: 'Test-Password-1'
  },
  doctor1: {
    user: { id: 'U-DOC1', staffId: 'doctor1', name: 'Dr. Gurpreet Sandhu', role: 'DOCTOR', cadre: 'DOCTOR', district: 'HQ' },
    pin: 'Test-Password-1'
  },
  admin1: {
    user: { id: 'U-ADM1', staffId: 'admin1', name: 'Admin HQ', role: 'ADMIN', cadre: 'ADMIN', district: 'HQ' },
    pin: 'Test-Password-1'
  }
};

const PERSISTENT_SESSION_KEY = 'setu_persistent_session';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.get(key) || null; }
  setItem(key: string, val: string) { this.store.set(key, String(val)); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
}

const memoryFallback = new MemoryStorage();

export function getStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch { }
  return memoryFallback;
}

export const isDemoMode = (): boolean => {
  return (import.meta as any).env?.VITE_DEMO_MODE !== 'false';
};

let activeSession: Session | null = null;
let lastActivityTime = Date.now();
let inactivityTimeoutMs = 5 * 60 * 1000; // Default 5 minutes
let failedUnlockAttempts = 0;
let lockCooldownUntil = 0;

// Lock event listeners
type LockListener = (locked: boolean) => void;
const lockListeners = new Set<LockListener>();

export function subscribeLockState(fn: LockListener): () => void {
  lockListeners.add(fn);
  fn(isSessionLocked());
  return () => lockListeners.delete(fn);
}

function notifyLockState(): void {
  const locked = isSessionLocked();
  for (const fn of lockListeners) {
    try { fn(locked); } catch { }
  }
}

export function touchActivity(): void {
  lastActivityTime = Date.now();
}

export function setInactivityTimeout(ms: number): void {
  inactivityTimeoutMs = ms;
}

export function isSessionLocked(): boolean {
  if (!activeSession) return false;
  return !!activeSession.isLocked || !activeSession.cryptoKey;
}

export function getLockCooldownRemainingSeconds(): number {
  const now = Date.now();
  if (now >= lockCooldownUntil) return 0;
  return Math.ceil((lockCooldownUntil - now) / 1000);
}

export function resetLockCooldownForTesting(): void {
  failedUnlockAttempts = 0;
  lockCooldownUntil = 0;
}

export function lockSession(): void {
  if (activeSession) {
    activeSession.cryptoKey = null; // Evict cryptographic DEK from memory
    activeSession.isLocked = true;
    notifyLockState();
  }
}

// Inactivity timer check (runs every 10 seconds in browser)
if (typeof window !== 'undefined') {
  setInterval(() => {
    if (activeSession && !isSessionLocked()) {
      if (Date.now() - lastActivityTime > inactivityTimeoutMs) {
        lockSession();
      }
    }
  }, 10000);

  // Background lock via Capacitor App plugin if available
  try {
    import('@capacitor/app').then(({ App }) => {
      App.addListener('appStateChange', (state) => {
        if (!state.isActive) {
          lockSession();
        }
      });
    }).catch(() => {});
  } catch { }
}

export function savePersistentSession(session: Session): void {
  try {
    getStorage().setItem(PERSISTENT_SESSION_KEY, JSON.stringify({
      user: session.user,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      isOfflineUnlock: session.isOfflineUnlock,
      savedAt: Date.now()
    }));
  } catch { }
}

export function getStoredSessionUser(): AuthUser | null {
  try {
    const stored = getStorage().getItem(PERSISTENT_SESSION_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      if (parsed.user && parsed.savedAt && (Date.now() - parsed.savedAt) < thirtyDaysMs) {
        if (!activeSession) {
          restoreSyncSession(parsed);
        }
        return parsed.user;
      }
    }
  } catch { }
  return null;
}

export function restoreSyncSession(parsed: any): Session {
  const session: Session = {
    user: parsed.user,
    accessToken: parsed.accessToken || '',
    refreshToken: parsed.refreshToken || '',
    cryptoKey: null,
    isOfflineUnlock: parsed.isOfflineUnlock ?? true,
    isLocked: true // Requires PIN unlock to populate DEK
  };
  activeSession = session;
  touchActivity();
  return session;
}

/**
 * Task 1.4: Secure restorePersistentSession.
 * Never derives key from a literal. If DEK is not in memory, marks session locked so PIN screen is shown.
 */
export async function restorePersistentSession(): Promise<Session | null> {
  if (activeSession) return activeSession;
  try {
    const stored = getStorage().getItem(PERSISTENT_SESSION_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      if (parsed.user && parsed.savedAt && (Date.now() - parsed.savedAt) < thirtyDaysMs) {
        activeSession = {
          user: parsed.user,
          accessToken: parsed.accessToken || '',
          refreshToken: parsed.refreshToken || '',
          cryptoKey: null, // DEK evicted: requires PIN
          isOfflineUnlock: parsed.isOfflineUnlock ?? true,
          isLocked: true
        };
        touchActivity();
        notifyLockState();
        return activeSession;
      }
    }
  } catch (e) {
    console.warn('Could not restore persistent session:', e);
  }
  return null;
}

export async function getApiBaseUrl(): Promise<string> {
  const meta = await db.meta.get('api_base_url');
  if (meta && meta.value) {
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' && meta.value.includes('localhost')) {
      // Discard stale localhost setting
    } else {
      return meta.value;
    }
  }
  if ((import.meta as any).env?.VITE_API_BASE_URL) return (import.meta as any).env.VITE_API_BASE_URL;

  if (typeof window !== 'undefined' && window.location) {
    if (window.location.protocol === 'capacitor:' || (window as any).Capacitor?.isNativePlatform?.()) {
      return 'http://10.0.2.2:8080';
    }
    return '';
  }
  return '';
}

export async function setApiBaseUrl(url: string): Promise<void> {
  await db.meta.put({ key: 'api_base_url', value: url.trim().replace(/\/+$/, '') });
}

export async function getOrCreateDeviceId(): Promise<string> {
  const meta = await db.meta.get('device_id');
  if (meta && meta.value) return meta.value;
  const newId = generateUUID();
  await db.meta.put({ key: 'device_id', value: newId });
  return newId;
}

/**
 * Task 1.1: Ensure DEK exists and is wrapped by KEK.
 */
async function ensureDataKey(kek: SetuKey): Promise<SetuKey> {
  const wrappedMeta = await db.meta.get('wrapped_dek');
  if (wrappedMeta?.value) {
    try {
      return await unwrapDataKey(
        wrappedMeta.value.wrappedDekCipher,
        wrappedMeta.value.wrappedDekIv,
        kek,
        'dek-v1'
      );
    } catch (e) {
      console.error('Failed to unwrap existing DEK with provided KEK:', e);
      throw new Error('Invalid PIN: cryptographic key unwrapping failed.');
    }
  }

  // First time on this device: generate a new random 256-bit DEK and wrap it
  const dek = await generateDataKey('dek-v1');
  const wrapped = await wrapDataKey(dek, kek);
  await db.meta.put({ key: 'wrapped_dek', value: wrapped });
  return dek;
}

/**
 * Unlocks the session using PIN (Task 1.6: exponential back-off + DEK unwrapping).
 */
export async function unlockSessionWithPin(pin: string): Promise<AuthUser> {
  touchActivity();
  const remainingCooldown = getLockCooldownRemainingSeconds();
  if (remainingCooldown > 0) {
    throw new Error(`Device temporarily locked due to failed attempts. Please wait ${remainingCooldown}s.`);
  }

  const saltMeta = await db.meta.get('crypto_salt');
  const verifierMeta = await db.meta.get('crypto_verifier');

  if (!saltMeta || !verifierMeta) {
    // If demo mode is active and user is seeded
    if (isDemoMode() && activeSession?.user?.staffId) {
      const seed = SEEDED_OFFLINE_USERS[activeSession.user.staffId.toLowerCase()];
      if (seed && pin === seed.pin) {
        const saltHex = generateSalt();
        await db.meta.put({ key: 'crypto_salt', value: saltHex });
        const kek = await deriveKeyFromPin(pin, saltHex);
        const verifier = await createVerifier(kek);
        await db.meta.put({ key: 'crypto_verifier', value: verifier });
        const dek = await ensureDataKey(kek);
        activeSession.cryptoKey = dek;
        activeSession.isLocked = false;
        failedUnlockAttempts = 0;
        notifyLockState();
        return activeSession.user;
      }
    }
    throw new Error('No cryptographic verifier found on device.');
  }

  const kek = await deriveKeyFromPin(pin, saltMeta.value);
  const valid = await verifyKey(kek, verifierMeta.value.verifierCipher, verifierMeta.value.verifierIv);

  if (!valid) {
    failedUnlockAttempts++;
    // Exponential backoff: 1s, 2s, 4s, 8s... capped at 300s (5 min)
    const backoffSeconds = Math.min(300, Math.pow(2, failedUnlockAttempts - 1));
    lockCooldownUntil = Date.now() + backoffSeconds * 1000;
    throw new Error(`Invalid PIN. Cooldown: ${backoffSeconds}s.`);
  }

  // PIN is valid: unwrap the DEK
  const dek = await ensureDataKey(kek);
  failedUnlockAttempts = 0;
  lockCooldownUntil = 0;

  if (activeSession) {
    activeSession.cryptoKey = dek;
    activeSession.isLocked = false;
    notifyLockState();
    return activeSession.user;
  }

  const user = getStoredSessionUser() || {
    id: 'U-UNKNOWN',
    staffId: 'user',
    name: 'Healthcare Worker',
    role: 'CHW',
    district: 'Ludhiana'
  };
  activeSession = {
    user,
    accessToken: '',
    refreshToken: '',
    cryptoKey: dek,
    isOfflineUnlock: true,
    isLocked: false
  };
  notifyLockState();
  return user;
}

/**
 * Task 1.1: Re-wraps the DEK with a new PIN without re-encrypting patient data.
 */
export async function changeUserPin(currentPin: string, newPin: string): Promise<boolean> {
  const saltMeta = await db.meta.get('crypto_salt');
  const verifierMeta = await db.meta.get('crypto_verifier');
  if (!saltMeta || !verifierMeta) throw new Error('Cannot change PIN: no credentials configured.');

  const currentKek = await deriveKeyFromPin(currentPin, saltMeta.value);
  const valid = await verifyKey(currentKek, verifierMeta.value.verifierCipher, verifierMeta.value.verifierIv);
  if (!valid) throw new Error('Current PIN is incorrect.');

  // Unwrap current DEK
  const currentDek = await ensureDataKey(currentKek);

  // Derive new KEK with fresh salt
  const newSaltHex = generateSalt();
  const newKek = await deriveKeyFromPin(newPin, newSaltHex);
  const newVerifier = await createVerifier(newKek);

  // Re-wrap the SAME DEK with the new KEK
  const newWrapped = await rewrapDataKey(currentDek, newKek);

  await db.meta.put({ key: 'crypto_salt', value: newSaltHex });
  await db.meta.put({ key: 'crypto_verifier', value: newVerifier });
  await db.meta.put({ key: 'wrapped_dek', value: newWrapped });

  if (activeSession) {
    activeSession.cryptoKey = currentDek;
  }
  return true;
}

export async function loginWithCredentials(
  staffId: string,
  pin: string,
  deviceName = 'SETU Device',
  forceOffline = false
): Promise<AuthUser> {
  touchActivity();
  const deviceId = await getOrCreateDeviceId();
  const baseUrl = await getApiBaseUrl();

  const isOnline = !forceOffline && typeof navigator !== 'undefined' && navigator.onLine;

  if (isOnline) {
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), 1500) : null;

      const resp = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller ? controller.signal : undefined,
        body: JSON.stringify({
          staffId: staffId.trim(),
          password: pin,
          deviceId,
          deviceName
        })
      });
      if (timeoutId) clearTimeout(timeoutId);

      if (!resp.ok) {
        if (resp.status === 401) throw new Error('Invalid staff ID or PIN');
        if (resp.status === 403) throw new Error('Device is revoked or not authorized');
        throw new Error(`Server returned ${resp.status}`);
      }

      const data = await resp.json();
      const user: AuthUser = data.user;

      // Online login succeeded: derive KEK, verifier, and DEK
      let saltMeta = await db.meta.get('crypto_salt');
      let saltHex = saltMeta?.value;
      if (!saltHex) {
        saltHex = generateSalt();
        await db.meta.put({ key: 'crypto_salt', value: saltHex });
      }

      const kek = await deriveKeyFromPin(pin, saltHex);
      const verifier = await createVerifier(kek);
      await db.meta.put({ key: 'crypto_verifier', value: verifier });

      const dek = await ensureDataKey(kek);

      // Encrypt session payload at rest
      const sessionData = JSON.stringify({
        user,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken
      });
      const encSession = await encryptString(sessionData, dek);
      await db.meta.put({ key: 'auth_session_encrypted', value: encSession });
      await db.meta.put({ key: 'last_staff_id', value: staffId.trim() });

      activeSession = {
        user,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        cryptoKey: dek,
        isOfflineUnlock: false,
        isLocked: false
      };
      savePersistentSession(activeSession);

      failedUnlockAttempts = 0;
      notifyLockState();
      return user;
    } catch (err: any) {
      return attemptOfflineUnlock(staffId, pin);
    }
  } else {
    return attemptOfflineUnlock(staffId, pin);
  }
}

async function attemptOfflineUnlock(staffId: string, pin: string): Promise<AuthUser> {
  const staffLower = staffId.trim().toLowerCase();
  let saltMeta = await db.meta.get('crypto_salt');
  let verifierMeta = await db.meta.get('crypto_verifier');
  let sessionMeta = await db.meta.get('auth_session_encrypted');
  const lastStaffMeta = await db.meta.get('last_staff_id');

  // Task 1.5: Seeded accounts only when VITE_DEMO_MODE !== "false"
  if (isDemoMode()) {
    const seed = SEEDED_OFFLINE_USERS[staffLower];
    if (seed && pin === seed.pin) {
      if (!saltMeta?.value) {
        const saltHex = generateSalt();
        await db.meta.put({ key: 'crypto_salt', value: saltHex });
        saltMeta = { key: 'crypto_salt', value: saltHex };
      }
      const kek = await deriveKeyFromPin(pin, saltMeta.value);
      const verifier = await createVerifier(kek);
      await db.meta.put({ key: 'crypto_verifier', value: verifier });

      const dek = await ensureDataKey(kek);

      const sessionData = JSON.stringify({
        user: seed.user,
        accessToken: `offline-token-${seed.user.id}`,
        refreshToken: `offline-refresh-${seed.user.id}`
      });
      const encSession = await encryptString(sessionData, dek);
      await db.meta.put({ key: 'auth_session_encrypted', value: encSession });
      await db.meta.put({ key: 'last_staff_id', value: staffLower });

      activeSession = {
        user: seed.user,
        accessToken: `offline-token-${seed.user.id}`,
        refreshToken: `offline-refresh-${seed.user.id}`,
        cryptoKey: dek,
        isOfflineUnlock: true,
        isLocked: false
      };
      savePersistentSession(activeSession);
      failedUnlockAttempts = 0;
      notifyLockState();
      return seed.user;
    }
  }

  // Standard encrypted offline unlock for established accounts
  if (!saltMeta || !verifierMeta || !sessionMeta) {
    throw new Error('No offline credentials found on this device. Sign in online first or use demo credentials if demo mode is active.');
  }

  if (lastStaffMeta?.value && lastStaffMeta.value.toLowerCase() !== staffLower) {
    throw new Error(`Device is signed in as '${lastStaffMeta.value}'. Please use PIN for '${lastStaffMeta.value}'.`);
  }

  const remainingCooldown = getLockCooldownRemainingSeconds();
  if (remainingCooldown > 0) {
    throw new Error(`Too many failed attempts. Please wait ${remainingCooldown}s.`);
  }

  const saltHex = saltMeta.value;
  const kek = await deriveKeyFromPin(pin, saltHex);
  const verifier = verifierMeta.value;

  const valid = await verifyKey(kek, verifier.verifierCipher, verifier.verifierIv);
  if (!valid) {
    failedUnlockAttempts++;
    const backoff = Math.min(300, Math.pow(2, failedUnlockAttempts - 1));
    lockCooldownUntil = Date.now() + backoff * 1000;
    throw new Error(`Invalid PIN for offline unlock. Cooldown: ${backoff}s.`);
  }

  failedUnlockAttempts = 0;
  lockCooldownUntil = 0;
  const dek = await ensureDataKey(kek);

  const decSessionStr = await decryptString(
    sessionMeta.value.ciphertext,
    sessionMeta.value.iv,
    dek
  );
  const decSession = JSON.parse(decSessionStr);

  activeSession = {
    user: decSession.user,
    accessToken: decSession.accessToken || '',
    refreshToken: decSession.refreshToken || '',
    cryptoKey: dek,
    isOfflineUnlock: true,
    isLocked: false
  };
  savePersistentSession(activeSession);
  notifyLockState();

  return decSession.user;
}

export async function refreshAccessToken(): Promise<string | null> {
  if (!activeSession) return null;
  const baseUrl = await getApiBaseUrl();

  // If session was an offline unlock with a seeded account, exchange for real token upon coming online
  if (activeSession.refreshToken?.startsWith('offline-') && isDemoMode() && activeSession.user?.staffId) {
    const seed = SEEDED_OFFLINE_USERS[activeSession.user.staffId.toLowerCase()];
    if (seed) {
      try {
        const deviceId = await getOrCreateDeviceId();
        const resp = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            staffId: seed.user.staffId,
            password: seed.pin,
            deviceId,
            deviceName: 'SETU Web/Mobile Device'
          })
        });
        if (resp.ok) {
          const data = await resp.json();
          activeSession.accessToken = data.accessToken;
          activeSession.refreshToken = data.refreshToken;
          activeSession.isOfflineUnlock = false;
          savePersistentSession(activeSession);
          return data.accessToken;
        }
      } catch { }
    }
  }

  if (!activeSession.refreshToken) return null;

  try {
    const resp = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: activeSession.refreshToken })
    });

    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        if (!activeSession.isOfflineUnlock) {
          activeSession = null;
          getStorage().removeItem(PERSISTENT_SESSION_KEY);
          notifyLockState();
        }
      }
      return null;
    }

    const data = await resp.json();
    activeSession.accessToken = data.accessToken;
    savePersistentSession(activeSession);
    return data.accessToken;
  } catch {
    return null;
  }
}

export function getActiveSession(): Session | null {
  return activeSession;
}

export async function logoutUser(): Promise<void> {
  const baseUrl = await getApiBaseUrl();
  if (activeSession && activeSession.refreshToken && typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: activeSession.refreshToken })
      });
    } catch { }
  }

  activeSession = null;
  getStorage().removeItem(PERSISTENT_SESSION_KEY);
  notifyLockState();
}
