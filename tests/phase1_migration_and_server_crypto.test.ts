/**
 * Phase 1 Unit Tests:
 * - 1.2 Encrypt at Rest & Resumable Background Migration
 * - 1.7 Server-Side SQL + AES-256-GCM Column Encryption
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  SetuDatabase,
  generateDataKey,
  encryptEventForStorage,
  decryptEventFromStorage,
  resumableBackgroundEncryptionMigration,
  StoredEvent
} from '../src/lib';
import {
  encryptServerField,
  decryptServerField,
  isServerEncryptionEnabled
} from '../api/_lib/crypto';

describe('Phase 1.2: Local Encryption At Rest & Resumable Migration', () => {
  let db: SetuDatabase;
  const dbName = 'test_encryption_migration_db';

  beforeEach(async () => {
    db = new SetuDatabase(dbName);
    await db.events.clear();
    await db.meta.clear();
  });

  afterEach(() => {
    db.close();
  });

  it('encrypts event payload at rest and decrypts back into memory', async () => {
    const dek = await generateDataKey('dek-v1');
    const rawEvent: StoredEvent = {
      eventId: 'evt-001',
      deviceId: 'dev-001',
      userId: 'user-001',
      patientId: 'P-001',
      entityType: 'patient',
      entityId: 'P-001',
      op: 'create',
      payload: JSON.stringify({ name: 'Asha Rani', age: 30 }),
      schemaVersion: 1,
      hlc: '001000000000000:00001:dev-001',
      createdAt: new Date().toISOString(),
      hash: 'hash-001'
    };

    const stored = await encryptEventForStorage(rawEvent, dek);
    expect(stored.encryptedPayload).toBeDefined();
    expect(stored.payloadIv).toBeDefined();
    expect(stored.keyId).toBe('dek-v1');

    const restored = await decryptEventFromStorage(stored, dek);
    expect(restored.payload).toBe(rawEvent.payload);
  });

  it('runs resumable background migration in batches without dropping records', async () => {
    const dek = await generateDataKey('dek-v1');

    // Seed 10 legacy unencrypted events
    for (let i = 1; i <= 10; i++) {
      await db.events.put({
        eventId: `legacy-evt-${i}`,
        deviceId: 'dev-001',
        userId: 'user-001',
        patientId: 'P-001',
        entityType: 'vital',
        entityId: `V-${i}`,
        op: 'create',
        payload: JSON.stringify({ sys: 120 + i, dia: 80 }),
        schemaVersion: 1,
        hlc: `001000000000000:0000${i}:dev-001`,
        createdAt: new Date().toISOString(),
        hash: `hash-${i}`
      });
    }

    // Run batch 1 with batchSize = 4
    const batch1 = await resumableBackgroundEncryptionMigration(db, dek, 4);
    expect(batch1.completed).toBe(false);
    expect(batch1.migratedEvents).toBe(4);
    expect(batch1.remainingEvents).toBe(6);

    // Run batch 2 with batchSize = 4
    const batch2 = await resumableBackgroundEncryptionMigration(db, dek, 4);
    expect(batch2.completed).toBe(false);
    expect(batch2.migratedEvents).toBe(8);
    expect(batch2.remainingEvents).toBe(2);

    // Run batch 3 with remaining
    const batch3 = await resumableBackgroundEncryptionMigration(db, dek, 4);
    expect(batch3.completed).toBe(true);
    expect(batch3.migratedEvents).toBe(10);
    expect(batch3.remainingEvents).toBe(0);

    // Verify all 10 are now encrypted and decryptable
    const all = await db.events.toArray();
    expect(all).toHaveLength(10);
    for (const e of all) {
      expect(e.encryptedPayload).toBeDefined();
      expect(e.payloadIv).toBeDefined();
      const dec = await decryptEventFromStorage(e, dek);
      expect(dec.payload).toContain('sys');
    }
  });
});

describe('Phase 1.7: Server-Side SQL + AES-256-GCM Column Encryption', () => {
  const originalEnvKey = process.env.SETU_DATA_KEY;

  afterEach(() => {
    if (originalEnvKey) {
      process.env.SETU_DATA_KEY = originalEnvKey;
    } else {
      delete process.env.SETU_DATA_KEY;
    }
  });

  it('runs in pass-through mode when SETU_DATA_KEY is unset', () => {
    delete process.env.SETU_DATA_KEY;
    expect(isServerEncryptionEnabled()).toBe(false);

    const plaintext = 'Plaintext server payload';
    expect(encryptServerField(plaintext)).toBe(plaintext);
    expect(decryptServerField(plaintext)).toBe(plaintext);
  });

  it('encrypts and decrypts with AES-256-GCM when SETU_DATA_KEY is configured', () => {
    // 64 hex characters (32 bytes)
    process.env.SETU_DATA_KEY = 'v1:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    expect(isServerEncryptionEnabled()).toBe(true);

    const confidentialData = 'Sensitive server medical diagnosis: Tuberculosis';
    const encrypted = encryptServerField(confidentialData);
    expect(encrypted.startsWith('enc:v1:')).toBe(true);
    expect(encrypted).not.toContain(confidentialData);

    const decrypted = decryptServerField(encrypted);
    expect(decrypted).toBe(confidentialData);
  });

  it('transparently reads legacy unencrypted rows even when encryption is enabled', () => {
    process.env.SETU_DATA_KEY = 'v1:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const legacyPlaintext = '{"name":"Amina Legacy","age":28}';
    // String without enc: prefix must return as-is
    expect(decryptServerField(legacyPlaintext)).toBe(legacyPlaintext);
  });
});
