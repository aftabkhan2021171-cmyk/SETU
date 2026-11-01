/**
 * Phase 1 Unit Tests: Key Hierarchy (DEK / KEK) & Authenticated Encryption (AES-256-GCM)
 */

import { describe, it, expect } from 'vitest';
import {
  generateDataKey,
  deriveKeyFromPin,
  wrapDataKey,
  unwrapDataKey,
  rewrapDataKey,
  encryptString,
  decryptString,
  generateSalt,
  createVerifier,
  verifyKey
} from '../src/lib/crypto';

describe('Phase 1.1 & 1.3: Cryptographic Key Hierarchy & Authenticated GCM', () => {
  it('generates a 256-bit DEK and wraps/unwraps it with a PIN-derived KEK', async () => {
    const salt = generateSalt();
    const pin = 'Secret-Pin-123';

    // 1. Generate DEK and derive KEK
    const dek = await generateDataKey('dek-v1');
    expect(dek.keyBytes).toHaveLength(32);

    const kek = await deriveKeyFromPin(pin, salt);
    expect(kek.keyBytes).toHaveLength(32);

    // 2. Wrap DEK
    const { wrappedDekCipher, wrappedDekIv } = await wrapDataKey(dek, kek);
    expect(wrappedDekCipher).toBeDefined();
    expect(wrappedDekIv).toBeDefined();

    // 3. Unwrap DEK with correct KEK
    const unwrappedDek = await unwrapDataKey(wrappedDekCipher, wrappedDekIv, kek, 'dek-v1');
    expect(unwrappedDek.keyBytes).toEqual(dek.keyBytes);

    // 4. Encrypt data with unwrapped DEK and verify decryption
    const secretMessage = 'Confidential patient health record #992';
    const enc = await encryptString(secretMessage, unwrappedDek);
    const dec = await decryptString(enc.ciphertext, enc.iv, unwrappedDek);
    expect(dec).toBe(secretMessage);
  });

  it('PIN change re-wraps the DEK without requiring re-encryption of data', async () => {
    const salt1 = generateSalt();
    const oldPin = 'Old-Pin-000';
    const newPin = 'New-Pin-999';

    const dek = await generateDataKey('dek-v1');
    const oldKek = await deriveKeyFromPin(oldPin, salt1);

    // Initial wrap
    const { wrappedDekCipher: wrapped1, wrappedDekIv: iv1 } = await wrapDataKey(dek, oldKek);

    // Encrypt some patient payload with the DEK
    const payload = JSON.stringify({ name: 'Amina', diagnosis: 'Hypertension' });
    const encryptedRecord = await encryptString(payload, dek);

    // User changes PIN: derive new KEK and re-wrap DEK
    const salt2 = generateSalt();
    const newKek = await deriveKeyFromPin(newPin, salt2);
    const { wrappedDekCipher: wrapped2, wrappedDekIv: iv2 } = await rewrapDataKey(dek, newKek);

    // Old KEK should FAIL to unwrap the new wrapped DEK
    await expect(unwrapDataKey(wrapped2, iv2, oldKek)).rejects.toThrow();

    // New KEK unwraps DEK successfully
    const restoredDek = await unwrapDataKey(wrapped2, iv2, newKek);
    expect(restoredDek.keyBytes).toEqual(dek.keyBytes);

    // Data encrypted earlier can be decrypted by restoredDek without re-encrypting the database!
    const decryptedPayload = await decryptString(encryptedRecord.ciphertext, encryptedRecord.iv, restoredDek);
    expect(decryptedPayload).toBe(payload);
  });

  it('rejects tampered ciphertext with an authentication error (AES-256-GCM tag verification)', async () => {
    const salt = generateSalt();
    const kek = await deriveKeyFromPin('Test-Pin-1', salt);

    const plaintext = 'Sensitive clinical triage payload';
    const enc = await encryptString(plaintext, kek);

    // Flip a hex char in ciphertext to simulate tampering / bit-rot
    const tamperedHex = enc.ciphertext.substring(0, 4) === '0000'
      ? 'ffff' + enc.ciphertext.substring(4)
      : '0000' + enc.ciphertext.substring(4);

    await expect(decryptString(tamperedHex, enc.iv, kek)).rejects.toThrow();
  });

  it('rejects tampered IV with an authentication error', async () => {
    const salt = generateSalt();
    const kek = await deriveKeyFromPin('Test-Pin-1', salt);

    const plaintext = 'Sensitive clinical triage payload';
    const enc = await encryptString(plaintext, kek);

    // Tamper IV
    const tamperedIv = enc.iv.substring(0, 2) === 'ff' ? '00' + enc.iv.substring(2) : 'ff' + enc.iv.substring(2);

    await expect(decryptString(enc.ciphertext, tamperedIv, kek)).rejects.toThrow();
  });

  it('audited @noble fallback works in insecure contexts (no crypto.subtle) and detects tampering', async () => {
    const originalSubtle = globalThis.crypto?.subtle;
    try {
      // Temporarily disable subtle to simulate plain-HTTP mobile context
      Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });

      const salt = generateSalt();
      const pin = 'Insecure-Context-Pin';
      const key = await deriveKeyFromPin(pin, salt);
      expect(key.isFallback).toBe(true);

      const plaintext = 'Offline HTTP LAN Test String';
      const enc = await encryptString(plaintext, key);
      const dec = await decryptString(enc.ciphertext, enc.iv, key);
      expect(dec).toBe(plaintext);

      // Verify tamper rejection in fallback noble mode
      const tamperedHex = enc.ciphertext.substring(0, 4) === '1111'
        ? '2222' + enc.ciphertext.substring(4)
        : '1111' + enc.ciphertext.substring(4);
      await expect(decryptString(tamperedHex, enc.iv, key)).rejects.toThrow();
    } finally {
      // Restore subtle
      Object.defineProperty(globalThis.crypto, 'subtle', { value: originalSubtle, configurable: true });
    }
  });
});
