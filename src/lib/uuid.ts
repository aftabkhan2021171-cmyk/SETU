/**
 * Cryptographically secure UUID v4 generator with fallbacks.
 * Works seamlessly in both Secure Contexts (HTTPS, localhost) and Insecure Contexts (HTTP on LAN IP).
 */

export function generateUUID(): string {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch { }

  try {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10
      const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    }
  } catch { }

  // RFC 4122 pseudo-random fallback for mobile browsers accessing plain HTTP LAN addresses
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Safely polyfill globalThis.crypto.randomUUID if missing
if (typeof globalThis !== 'undefined') {
  try {
    if (!globalThis.crypto) {
      (globalThis as any).crypto = {};
    }
    if (typeof (globalThis.crypto as any).randomUUID !== 'function') {
      try {
        Object.defineProperty(globalThis.crypto, 'randomUUID', {
          value: generateUUID,
          configurable: true,
          writable: true
        });
      } catch {
        try {
          (globalThis.crypto as any).randomUUID = generateUUID;
        } catch { }
      }
    }
  } catch { }
}
