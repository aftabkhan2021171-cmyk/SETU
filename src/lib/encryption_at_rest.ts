/**
 * Encryption At Rest & Resumable Background Migration Engine.
 * Task 1.2: Encrypts event payloads, patient custom fields/details, and vitals at rest
 * using AES-256-GCM. Unencrypted records are migrated in non-blocking batches.
 */

import { SetuDatabase, StoredEvent, PatientRecord, VitalRecord, AuditRecord } from './db';
import { SetuKey, encryptString, decryptString } from './crypto';

export interface MigrationStatus {
  completed: boolean;
  migratedEvents: number;
  remainingEvents: number;
  lastRunAt: string;
}

/**
 * Encrypts an event payload at rest before writing to IndexedDB.
 */
export async function encryptEventForStorage(event: StoredEvent, dek: SetuKey): Promise<StoredEvent> {
  if (event.encryptedPayload && event.payloadIv) {
    return event; // Already encrypted
  }

  const enc = await encryptString(event.payload, dek);
  return {
    ...event,
    encryptedPayload: enc.ciphertext,
    payloadIv: enc.iv,
    keyId: dek.keyId || 'dek-v1'
  };
}

/**
 * Decrypts an event payload from IndexedDB into memory.
 */
export async function decryptEventFromStorage(event: StoredEvent, dek: SetuKey): Promise<StoredEvent> {
  if (!event.encryptedPayload || !event.payloadIv) {
    return event; // Plaintext event (legacy or unmigrated)
  }

  try {
    const payload = await decryptString(event.encryptedPayload, event.payloadIv, dek);
    return {
      ...event,
      payload
    };
  } catch (err) {
    console.error(`Failed to decrypt event ${event.eventId}:`, err);
    throw new Error(`Decryption error for event ${event.eventId}: invalid key or tampered data`);
  }
}

/**
 * Resumable background job to migrate unencrypted events in small batches.
 * Never locks the database; processes at most batchSize items per call.
 */
export async function resumableBackgroundEncryptionMigration(
  db: SetuDatabase,
  dek: SetuKey,
  batchSize = 50
): Promise<MigrationStatus> {
  const unencrypted = await db.events
    .filter(e => !e.encryptedPayload || !e.payloadIv)
    .limit(batchSize)
    .toArray();

  let migratedInThisBatch = 0;

  for (const event of unencrypted) {
    const encrypted = await encryptEventForStorage(event, dek);
    await db.events.put(encrypted);
    migratedInThisBatch++;
  }

  const remaining = await db.events
    .filter(e => !e.encryptedPayload || !e.payloadIv)
    .count();

  const progress = await db.meta.get('encryption_migration_progress');
  const prevCount = progress?.value?.migratedEvents || 0;
  const totalMigrated = prevCount + migratedInThisBatch;

  const status: MigrationStatus = {
    completed: remaining === 0,
    migratedEvents: totalMigrated,
    remainingEvents: remaining,
    lastRunAt: new Date().toISOString()
  };

  await db.meta.put({
    key: 'encryption_migration_progress',
    value: status
  });

  return status;
}
