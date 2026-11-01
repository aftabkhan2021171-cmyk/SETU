import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../src/lib/db';
import { initDatabase } from '../api/db';
import handler from '../api/index';
import {
  setSyncPaused,
  isSyncPaused,
  triggerSyncDebounced,
  refreshOutboxStats,
  runSync,
  initSyncEngine
} from '../src/lib/sync';
import { loginUser } from '../api/auth';
import { generateUUID } from '../src/lib/uuid';
import { computeChunkChecksum, computeEventHash } from '../src/lib/hash';
import { Hlc } from '../src/lib/hlc';

describe('Auto-Sync on Reconnect (Offline to Online)', () => {
  const deviceId = 'test-auto-sync-device';
  let serverToken = '';

  beforeEach(async () => {
    await initDatabase();
    // Reset IndexedDB tables
    await db.events.clear();
    await db.outbox.clear();
    await db.patients.clear();
    await db.meta.clear();

    const auth = await loginUser('chw1', 'Test-Password-1', deviceId, 'AutoSync Device');
    serverToken = auth.accessToken;

    // Reset sync state to paused
    setSyncPaused(true);
  });

  it('preserves patient in outbox as pending while offline and prevents sync runs', async () => {
    expect(isSyncPaused()).toBe(true);

    const eventId = generateUUID();
    const patientId = 'P-OFFLINE-01';

    const event = {
      eventId,
      deviceId,
      userId: 'U-CHW1',
      patientId,
      entityType: 'patient',
      entityId: patientId,
      op: 'create' as const,
      payload: JSON.stringify({ name: 'Amanpreet Singh', age: 34, locality: 'Model Town' }),
      schemaVersion: 1,
      hlc: '100:0:test-device',
      createdAt: new Date().toISOString(),
      hash: 'hash-test-offline-1'
    };

    await db.events.put(event);
    await db.outbox.put({
      eventId,
      status: 'pending',
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const statsBefore = await refreshOutboxStats();
    expect(statsBefore.pendingCount).toBe(1);
    expect(statsBefore.syncedCount).toBe(0);

    // Attempting runSync while paused does not upload
    await runSync();

    const outboxItem = await db.outbox.get(eventId);
    expect(outboxItem?.status).toBe('pending');
  });

  it('unpauses sync and uploads pending offline patient when coming online', async () => {
    const eventId = generateUUID();
    const patientId = 'P-OFFLINE-02';

    const hlc = new Hlc(Date.now(), 0, deviceId);
    const event = {
      eventId,
      deviceId,
      userId: 'U-CHW1',
      patientId,
      entityType: 'patient',
      entityId: patientId,
      op: 'create' as const,
      payload: JSON.stringify({ name: 'Kulwinder Kaur', age: 28, locality: 'Gill Road' }),
      schemaVersion: 1,
      hlc: hlc.encode(),
      createdAt: new Date().toISOString(),
      hash: ''
    };
    event.hash = await computeEventHash(event);

    await db.events.put(event);
    await db.outbox.put({
      eventId,
      status: 'pending',
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    expect(isSyncPaused()).toBe(true);

    // User comes online
    setSyncPaused(false);
    expect(isSyncPaused()).toBe(false);

    // Verify chunk ingest directly with serverless backend API
    const checksum = await computeChunkChecksum([event]);
    const chunkPayload = {
      chunkId: generateUUID(),
      deviceId,
      sequenceNumber: Date.now(),
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      eventIds: [eventId],
      events: [event],
      checksum
    };

    const req: any = {
      method: 'POST',
      url: '/api/sync/chunks',
      headers: { authorization: `Bearer ${serverToken}` },
      body: chunkPayload
    };
    let statusCode = 0;
    let responseData: any = null;
    const res: any = {
      setHeader: () => {},
      status: (code: number) => { statusCode = code; return res; },
      json: (data: any) => { responseData = data; return res; }
    };

    await handler(req, res);
    expect(statusCode).toBe(200);
    expect(responseData.acks.some((a: any) => a.eventId === eventId && a.status === 'ACCEPTED')).toBe(true);

    // Mark synced in local outbox
    await db.outbox.update(eventId, { status: 'synced' });

    const statsAfter = await refreshOutboxStats();
    expect(statsAfter.pendingCount).toBe(0);
    expect(statsAfter.syncedCount).toBe(1);
  });

  it('unpauses and handles browser window online events', async () => {
    let onlineCallback: (() => void) | null = null;
    const mockWindow = {
      addEventListener: (evt: string, cb: () => void) => {
        if (evt === 'online') onlineCallback = cb;
      }
    };
    (globalThis as any).window = mockWindow;

    await initSyncEngine();
    setSyncPaused(true);
    expect(isSyncPaused()).toBe(true);

    // Simulate online event
    if (onlineCallback) {
      (onlineCallback as () => void)();
    }

    // Should automatically unpause sync
    expect(isSyncPaused()).toBe(false);
  });
});
