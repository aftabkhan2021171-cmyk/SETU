/**
 * Phase 0.3: Smoke Test Suite
 * 
 * Verifies the end-to-end user lifecycle:
 * 1. Offline login
 * 2. Create patient
 * 3. Save vitals
 * 4. Reload persistence (session and DB durability across restarts)
 * 5. Offline edit
 * 6. Sync outbox to backend API with ACK
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  SetuDatabase,
  loginWithCredentials,
  getStoredSessionUser,
  restorePersistentSession,
  Hlc,
  projectEvent,
  computeEventHash,
  computeChunkChecksum
} from '../src/lib';
import handler from '../api/index';

describe('Phase 0.3: End-to-End Vitest Smoke Test', () => {
  let db: SetuDatabase;
  const dbName = 'setu_smoke_test_db';

  beforeEach(async () => {
    // Clear storage polyfill
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    db = new SetuDatabase(dbName);
    await db.events.clear();
    await db.outbox.clear();
    await db.patients.clear();
    await db.vitals.clear();
    await db.fieldHeads.clear();
    await db.conflicts.clear();
    await db.conflictSiblings.clear();
  });

  it('completes the full lifecycle: login, create patient, save vitals, reload persistence, offline edit, sync', async () => {
    // 1. LOGIN (Offline mode, day 1)
    const user = await loginWithCredentials('chw1', 'Test-Password-1', 'Smoke Device', true);
    expect(user).toBeDefined();
    expect(user.id).toBe('U-CHW1');
    expect(user.role.toLowerCase()).toBe('chw');

    const currentUser = user;
    const deviceId = 'smoke-device-001';
    let hlc = new Hlc(Date.now(), 0, deviceId);

    // 2. CREATE PATIENT
    hlc = hlc.tick();
    const patientPayload = {
      name: 'Rani Devi',
      age: 29,
      locality: 'Ward 4',
      status: 'Stable',
      district: 'district-north'
    };

    const createPatientEvent = {
      eventId: 'evt-create-pat-1',
      deviceId,
      userId: currentUser.id,
      patientId: 'P-SMOKE-001',
      entityType: 'patient',
      entityId: 'P-SMOKE-001',
      op: 'create' as const,
      payload: JSON.stringify(patientPayload),
      schemaVersion: 1,
      hlc: hlc.encode(),
      createdAt: new Date().toISOString(),
      hash: ''
    };
    createPatientEvent.hash = await computeEventHash(createPatientEvent);

    await db.events.put(createPatientEvent);
    await db.outbox.put({
      eventId: createPatientEvent.eventId,
      status: 'pending',
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    await projectEvent(db, createPatientEvent);

    const storedPatient = await db.patients.get('P-SMOKE-001');
    expect(storedPatient).toBeDefined();
    expect(storedPatient?.name).toBe('Rani Devi');
    expect(storedPatient?.status).toBe('Stable');

    // 3. SAVE VITALS
    hlc = hlc.tick();
    const vitalsPayload = {
      sys: 118,
      dia: 78,
      pulse: 74,
      temp: 36.6,
      spo2: 99,
      at: new Date().toISOString()
    };

    const saveVitalsEvent = {
      eventId: 'evt-save-vit-1',
      deviceId,
      userId: currentUser.id,
      patientId: 'P-SMOKE-001',
      entityType: 'vital',
      entityId: 'V-SMOKE-001',
      op: 'create' as const,
      payload: JSON.stringify(vitalsPayload),
      schemaVersion: 1,
      hlc: hlc.encode(),
      createdAt: new Date().toISOString(),
      hash: ''
    };
    saveVitalsEvent.hash = await computeEventHash(saveVitalsEvent);

    await db.events.put(saveVitalsEvent);
    await db.outbox.put({
      eventId: saveVitalsEvent.eventId,
      status: 'pending',
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    await projectEvent(db, saveVitalsEvent);

    const storedVitals = await db.vitals.get('V-SMOKE-001');
    expect(storedVitals).toBeDefined();
    expect(storedVitals?.sys).toBe(118);
    expect(storedVitals?.spo2).toBe(99);

    // 4. RELOAD PERSISTENCE (Simulate app restart & db reload)
    db.close();
    const reloadedDb = new SetuDatabase(dbName);

    const reloadedPatient = await reloadedDb.patients.get('P-SMOKE-001');
    const reloadedVitals = await reloadedDb.vitals.get('V-SMOKE-001');
    expect(reloadedPatient).toBeDefined();
    expect(reloadedPatient?.name).toBe('Rani Devi');
    expect(reloadedVitals).toBeDefined();
    expect(reloadedVitals?.spo2).toBe(99);

    // Also verify session persistence
    const restoredSession = await restorePersistentSession();
    expect(restoredSession).toBeDefined();
    expect(restoredSession?.user?.id).toBe('U-CHW1');

    // 5. OFFLINE EDIT (Update patient status to Urgent while offline)
    hlc = hlc.tick();
    const editPayload = {
      field: 'status',
      value: 'Urgent'
    };

    const editEvent = {
      eventId: 'evt-edit-pat-1',
      deviceId,
      userId: currentUser.id,
      patientId: 'P-SMOKE-001',
      entityType: 'patient',
      entityId: 'P-SMOKE-001',
      op: 'update' as const,
      payload: JSON.stringify(editPayload),
      schemaVersion: 1,
      hlc: hlc.encode(),
      baseHlc: createPatientEvent.hlc,
      createdAt: new Date().toISOString(),
      hash: ''
    };
    editEvent.hash = await computeEventHash(editEvent);

    await reloadedDb.events.put(editEvent);
    await reloadedDb.outbox.put({
      eventId: editEvent.eventId,
      status: 'pending',
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    await projectEvent(reloadedDb, editEvent);

    const updatedPatient = await reloadedDb.patients.get('P-SMOKE-001');
    expect(updatedPatient?.status).toBe('Urgent');

    // 6. SYNC (Sync all pending outbox events to serverless backend API)
    const pendingOutbox = await reloadedDb.outbox.where('status').equals('pending').toArray();
    expect(pendingOutbox.length).toBe(3); // create patient, save vitals, edit patient

    const pendingEvents = await reloadedDb.events
      .where('eventId')
      .anyOf(pendingOutbox.map((o) => o.eventId))
      .toArray();

    // Authenticate with serverless backend to get sync token
    let authCode = 200;
    let authData: any = null;
    const authReq: any = {
      method: 'POST',
      url: '/api/auth/login',
      body: {
        staffId: 'chw1',
        password: 'Test-Password-1',
        deviceId,
        deviceName: 'Smoke Test Device'
      },
      headers: {}
    };
    const authRes: any = {
      setHeader: () => {},
      status: (c: number) => { authCode = c; return authRes; },
      json: (d: any) => { authData = d; return authRes; }
    };
    await handler(authReq, authRes);
    expect(authCode).toBe(200);
    const token = authData.accessToken;

    // Calculate chunk checksum using computeChunkChecksum
    const eventIds = pendingEvents.map((e) => e.eventId);
    const checksum = await computeChunkChecksum(pendingEvents);

    // Send chunk to /api/sync/chunks
    let statusCode = 200;
    let responseData: any = null;
    const mockReq: any = {
      method: 'POST',
      url: '/api/sync/chunks',
      body: {
        chunkId: 'chunk-smoke-001',
        deviceId,
        sequenceNumber: 1,
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        eventIds,
        events: pendingEvents,
        checksum
      },
      headers: {
        authorization: `Bearer ${token}`
      }
    };
    const mockRes: any = {
      setHeader: () => {},
      status: (c: number) => { statusCode = c; return mockRes; },
      json: (d: any) => { responseData = d; return mockRes; }
    };

    await handler(mockReq, mockRes);

    expect(statusCode).toBe(200);
    expect(responseData).toBeDefined();
    expect(responseData.acks).toBeDefined();
    expect(responseData.acks).toHaveLength(3);
    for (const ack of responseData.acks) {
      expect(ack.status).toBe('ACCEPTED');
    }

    // Mark outbox as synced
    for (const ack of responseData.acks) {
      await reloadedDb.outbox.update(ack.eventId, {
        status: 'synced',
        updatedAt: new Date().toISOString()
      });
    }

    const remainingPending = await reloadedDb.outbox.where('status').equals('pending').count();
    expect(remainingPending).toBe(0);

    reloadedDb.close();
  });
});
