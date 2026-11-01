/**
 * WebCrypto & @noble/ciphers based authenticated encryption (AES-256-GCM).
 * PBKDF2 (>=310,000 iterations) + AES-GCM 256-bit encryption in Secure Contexts.
 * Seamless @noble/ciphers/aes GCM + @noble/hashes PBKDF2 fallback in Insecure Contexts (e.g. mobile HTTP).
 * Zero custom crypto. No hardcoded fallback keys. Authenticated cipher rejects tampered data.
 */

import { gcm } from '@noble/ciphers/aes';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';

export const PBKDF2_ITERATIONS = 310000;
export const VERIFIER_PLAINTEXT = 'SETU_KEY_VERIFIER_V1';

// Prevent ReferenceError: CryptoKey is not defined in insecure contexts (plain-HTTP mobile LAN access)
if (typeof globalThis !== 'undefined' && typeof (globalThis as any).CryptoKey === 'undefined') {
  try {
    (globalThis as any).CryptoKey = class CryptoKey {};
  } catch { }
}

function isWebCryptoKey(key: any): key is CryptoKey {
  return typeof globalThis !== 'undefined' &&
    typeof (globalThis as any).CryptoKey !== 'undefined' &&
    key instanceof (globalThis as any).CryptoKey;
}

export interface SetuKey {
  keyBytes: Uint8Array; // 32 bytes (256-bit)
  webCryptoKey?: CryptoKey;
  keyId?: string;
  isFallback?: boolean; // backwards compatibility flag
}

export type AnyKey = CryptoKey | SetuKey | { isFallback: true; rawKey?: any; keyBytes?: Uint8Array };

export function arrayBufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function hexToArrayBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function generateSalt(): string {
  const salt = new Uint8Array(16);
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(salt);
  } else {
    for (let i = 0; i < 16; i++) salt[i] = Math.floor(Math.random() * 256);
  }
  return arrayBufferToHex(salt);
}

export function generateIv(): string {
  const iv = new Uint8Array(12); // Standard 96-bit nonce for AES-GCM
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(iv);
  } else {
    for (let i = 0; i < 12; i++) iv[i] = Math.floor(Math.random() * 256);
  }
  return arrayBufferToHex(iv);
}

/**
 * Generates a random 256-bit Data Encryption Key (DEK).
 */
export async function generateDataKey(keyId = 'dek-v1'): Promise<SetuKey> {
  const keyBytes = new Uint8Array(32);
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(keyBytes);
  } else {
    for (let i = 0; i < 32; i++) keyBytes[i] = Math.floor(Math.random() * 256);
  }

  let webCryptoKey: CryptoKey | undefined;
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle?.importKey) {
    try {
      webCryptoKey = await globalThis.crypto.subtle.importKey(
        'raw',
        keyBytes as any,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
    } catch { }
  }

  return {
    keyBytes,
    webCryptoKey,
    keyId
  };
}

/**
 * Derives a 256-bit Key Encryption Key (KEK) from a PIN and salt using PBKDF2 >= 310,000 iterations.
 */
export async function deriveKeyFromPin(pin: string, saltHex: string): Promise<SetuKey> {
  const salt = hexToArrayBuffer(saltHex);
  const enc = new TextEncoder();
  const pinBytes = enc.encode(pin);

  let keyBytes: Uint8Array;
  let webCryptoKey: CryptoKey | undefined;

  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle?.deriveBits) {
    try {
      const keyMaterial = await globalThis.crypto.subtle.importKey(
        'raw',
        pinBytes,
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
      );

      const bits = await globalThis.crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: salt as any,
          iterations: PBKDF2_ITERATIONS,
          hash: 'SHA-256'
        },
        keyMaterial,
        256
      );

      keyBytes = new Uint8Array(bits);
      webCryptoKey = await globalThis.crypto.subtle.importKey(
        'raw',
        keyBytes as any,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );

      return { keyBytes, webCryptoKey, isFallback: false };
    } catch (e) {
      console.warn('Native WebCrypto deriveKey failed, using @noble/hashes PBKDF2 fallback:', e);
    }
  }

  // Audited noble fallback for Insecure Contexts (mobile HTTP LAN)
  keyBytes = pbkdf2(sha256, pinBytes, salt, { c: PBKDF2_ITERATIONS, dkLen: 32 });
  return { keyBytes, isFallback: true };
}

/**
 * Wraps (encrypts) the Data Encryption Key (DEK) with the Key Encryption Key (KEK).
 */
export async function wrapDataKey(dek: SetuKey, kek: SetuKey): Promise<{ wrappedDekCipher: string; wrappedDekIv: string }> {
  const enc = await encryptBytes(dek.keyBytes, kek);
  return {
    wrappedDekCipher: enc.ciphertext,
    wrappedDekIv: enc.iv
  };
}

/**
 * Unwraps (decrypts) the Data Encryption Key (DEK) using the Key Encryption Key (KEK).
 */
export async function unwrapDataKey(
  wrappedDekCipher: string,
  wrappedDekIv: string,
  kek: SetuKey,
  keyId = 'dek-v1'
): Promise<SetuKey> {
  const keyBytes = await decryptBytes(wrappedDekCipher, wrappedDekIv, kek);
  if (keyBytes.length !== 32) {
    throw new Error(`Invalid unwrapped DEK length: expected 32 bytes, got ${keyBytes.length}`);
  }

  let webCryptoKey: CryptoKey | undefined;
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle?.importKey) {
    try {
      webCryptoKey = await globalThis.crypto.subtle.importKey(
        'raw',
        keyBytes as any,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
    } catch { }
  }

  return { keyBytes, webCryptoKey, keyId };
}

/**
 * Re-wraps the DEK with a new KEK when the user changes their PIN.
 */
export async function rewrapDataKey(dek: SetuKey, newKek: SetuKey): Promise<{ wrappedDekCipher: string; wrappedDekIv: string }> {
  return wrapDataKey(dek, newKek);
}

export async function createVerifier(key: AnyKey): Promise<{ verifierCipher: string; verifierIv: string }> {
  const enc = await encryptString(VERIFIER_PLAINTEXT, key);
  return { verifierCipher: enc.ciphertext, verifierIv: enc.iv };
}

export async function verifyKey(key: AnyKey, verifierCipher: string, verifierIv: string): Promise<boolean> {
  try {
    const text = await decryptString(verifierCipher, verifierIv, key);
    return text === VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}

/**
 * Extracts raw 32-byte key buffer from SetuKey or CryptoKey.
 */
async function getKeyBytes(key: AnyKey): Promise<Uint8Array> {
  if (key && typeof key === 'object' && 'keyBytes' in key && (key as SetuKey).keyBytes) {
    return (key as SetuKey).keyBytes;
  }
  if (key && typeof key === 'object' && 'rawKey' in key && (key as any).rawKey instanceof Uint8Array) {
    return (key as any).rawKey;
  }
  const isWebKey = isWebCryptoKey(key);
  if (isWebKey || (key && typeof key === 'object' && 'webCryptoKey' in key && (key as SetuKey).webCryptoKey)) {
    const cryptoKey = isWebKey ? (key as CryptoKey) : (key as SetuKey).webCryptoKey!;
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle?.exportKey) {
      try {
        const raw = await globalThis.crypto.subtle.exportKey('raw', cryptoKey);
        return new Uint8Array(raw);
      } catch { }
    }
  }
  throw new Error('Unable to extract raw key bytes from key');
}

export async function encryptBytes(data: Uint8Array, key: AnyKey): Promise<{ ciphertext: string; iv: string }> {
  const ivHex = generateIv();
  const iv = hexToArrayBuffer(ivHex);

  const isWebKey = isWebCryptoKey(key);
  const cryptoKey = isWebKey ? (key as CryptoKey) : (key && typeof key === 'object' && 'webCryptoKey' in key ? (key as SetuKey).webCryptoKey : undefined);
  if (cryptoKey && typeof globalThis !== 'undefined' && globalThis.crypto?.subtle?.encrypt) {
    try {
      const encrypted = await globalThis.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as any },
        cryptoKey,
        data as any
      );
      return {
        ciphertext: arrayBufferToHex(encrypted),
        iv: ivHex
      };
    } catch { }
  }

  // Audited @noble/ciphers AES-256-GCM fallback (authenticated, tampered tag rejected)
  const rawKey = await getKeyBytes(key);
  const cipher = gcm(rawKey, iv);
  const encrypted = cipher.encrypt(data);
  return {
    ciphertext: arrayBufferToHex(encrypted),
    iv: ivHex
  };
}

export async function decryptBytes(ciphertextHex: string, ivHex: string, key: AnyKey): Promise<Uint8Array> {
  const iv = hexToArrayBuffer(ivHex);
  const ciphertext = hexToArrayBuffer(ciphertextHex);

  const isWebKey = isWebCryptoKey(key);
  const cryptoKey = isWebKey ? (key as CryptoKey) : (key && typeof key === 'object' && 'webCryptoKey' in key ? (key as SetuKey).webCryptoKey : undefined);
  if (cryptoKey && typeof globalThis !== 'undefined' && globalThis.crypto?.subtle?.decrypt) {
    try {
      const decrypted = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as any },
        cryptoKey,
        ciphertext as any
      );
      return new Uint8Array(decrypted);
    } catch { }
  }

  // Audited @noble/ciphers AES-256-GCM fallback
  const rawKey = await getKeyBytes(key);
  const cipher = gcm(rawKey, iv);
  // throws if tag is invalid or tampered
  return cipher.decrypt(ciphertext);
}

export async function encryptString(plaintext: string, key: AnyKey): Promise<{ ciphertext: string; iv: string }> {
  const enc = new TextEncoder();
  return encryptBytes(enc.encode(plaintext), key);
}

export async function decryptString(ciphertextHex: string, ivHex: string, key: AnyKey): Promise<string> {
  const bytes = await decryptBytes(ciphertextHex, ivHex, key);
  const dec = new TextDecoder();
  return dec.decode(bytes);
}
