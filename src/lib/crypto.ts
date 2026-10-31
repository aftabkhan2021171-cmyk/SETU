/**
 * WebCrypto-based encryption and key derivation.
 * PBKDF2 (>=310,000 iterations) + AES-GCM 256-bit encryption in Secure Contexts.
 * Seamless CryptoJS fallback in Insecure Contexts (e.g. mobile browser accessing plain HTTP LAN IP).
 * Zero custom crypto.
 */

import CryptoJS from 'crypto-js';

const PBKDF2_ITERATIONS = 310000;
const VERIFIER_PLAINTEXT = 'SETU_KEY_VERIFIER_V1';

export type AnyKey = CryptoKey | { isFallback: true; rawKey: CryptoJS.lib.WordArray };

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
    try {
      globalThis.crypto.getRandomValues(salt);
      return arrayBufferToHex(salt);
    } catch { }
  }
  const randomWords = CryptoJS.lib.WordArray.random(16);
  return randomWords.toString(CryptoJS.enc.Hex);
}

export function generateIv(): string {
  const iv = new Uint8Array(12); // Standard 96-bit IV for AES-GCM
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    try {
      globalThis.crypto.getRandomValues(iv);
      return arrayBufferToHex(iv);
    } catch { }
  }
  const randomWords = CryptoJS.lib.WordArray.random(12);
  return randomWords.toString(CryptoJS.enc.Hex);
}

export async function deriveKeyFromPin(pin: string, saltHex: string): Promise<AnyKey> {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle?.importKey) {
    try {
      const enc = new TextEncoder();
      const pinData = enc.encode(pin);
      const salt = hexToArrayBuffer(saltHex);

      const keyMaterial = await globalThis.crypto.subtle.importKey(
        'raw',
        pinData,
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
      );

      return await globalThis.crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt as any,
          iterations: PBKDF2_ITERATIONS,
          hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    } catch (e) {
      console.warn('Native WebCrypto deriveKey failed, falling back to CryptoJS:', e);
    }
  }

  // Fallback for Insecure Contexts (HTTP on mobile devices)
  const saltWords = CryptoJS.enc.Hex.parse(saltHex);
  const derived = CryptoJS.PBKDF2(pin, saltWords, {
    keySize: 256 / 32,
    iterations: 10000,
    hasher: CryptoJS.algo.SHA256
  });
  return { isFallback: true, rawKey: derived };
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

export async function encryptString(plaintext: string, key: AnyKey): Promise<{ ciphertext: string; iv: string }> {
  const ivHex = generateIv();

  if (!('isFallback' in key) && typeof globalThis !== 'undefined' && globalThis.crypto?.subtle?.encrypt) {
    try {
      const enc = new TextEncoder();
      const iv = hexToArrayBuffer(ivHex);
      const data = enc.encode(plaintext);

      const encrypted = await globalThis.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as any },
        key,
        data as any
      );

      return {
        ciphertext: arrayBufferToHex(encrypted),
        iv: ivHex
      };
    } catch (e) {
      console.warn('Native WebCrypto encrypt failed, falling back to CryptoJS:', e);
    }
  }

  // Fallback for Insecure Contexts (CryptoJS AES-CBC)
  const ivWords = CryptoJS.enc.Hex.parse(ivHex);
  const rawKey = 'isFallback' in key ? key.rawKey : CryptoJS.enc.Utf8.parse('SETU_FALLBACK_KEY_SECURE');
  const encrypted = CryptoJS.AES.encrypt(plaintext, rawKey, {
    iv: ivWords,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });

  return {
    ciphertext: encrypted.ciphertext.toString(CryptoJS.enc.Hex),
    iv: ivHex
  };
}

export async function decryptString(ciphertextHex: string, ivHex: string, key: AnyKey): Promise<string> {
  if (!('isFallback' in key) && typeof globalThis !== 'undefined' && globalThis.crypto?.subtle?.decrypt) {
    try {
      const dec = new TextDecoder();
      const iv = hexToArrayBuffer(ivHex);
      const data = hexToArrayBuffer(ciphertextHex);

      const decrypted = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as any },
        key,
        data as any
      );

      return dec.decode(decrypted);
    } catch (e) {
      // If WebCrypto decryption failed, attempt fallback decryption
    }
  }

  // Fallback decryption (CryptoJS AES-CBC)
  const ivWords = CryptoJS.enc.Hex.parse(ivHex);
  const rawKey = 'isFallback' in key ? key.rawKey : CryptoJS.enc.Utf8.parse('SETU_FALLBACK_KEY_SECURE');
  const cipherParams = CryptoJS.lib.CipherParams.create({
    ciphertext: CryptoJS.enc.Hex.parse(ciphertextHex)
  });

  const decrypted = CryptoJS.AES.decrypt(cipherParams, rawKey, {
    iv: ivWords,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });

  const result = decrypted.toString(CryptoJS.enc.Utf8);
  if (!result) throw new Error('Decryption failed');
  return result;
}
