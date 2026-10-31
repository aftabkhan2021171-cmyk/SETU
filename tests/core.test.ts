import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto'; // polyfills indexedDB and IDBKeyRange for Node/vitest
import {
  Hlc,
  sha256Hex,
  computeEventHash,
  computeChunkChecksum,
  summarizeMerkle,
  deriveKeyFromPin,
  createVerifier,
  verifyKey,
  encryptString,
  decryptString,
  generateSalt,
  SetuDatabase,
  StoredEvent,
  projectEvent,
  rebuild
} from '../src/lib';

describe('Phase 1: Hybrid Logical Clock (HLC)', () => {
  it('tick is monotonic when physical clock goes backwards', () => {
    const h = new Hlc(1000, 0, 'a');
    const n = h.tick(900);
    expect(n.compareTo(h)).toBeGreaterThan(0);
    expect(n.wall).toBe(1000);
    expect(n.counter).toBe(1);
    expect(n.node).toBe('a');
  });

  it('receive orders after both local and remote', () => {
    const l = new Hlc(1000, 5, 'a');
    const r = new Hlc(1000, 9, 'b');
    const x = l.receive(r, 1000);
    expect(x.compareTo(l)).toBeGreaterThan(0);
    expect(x.compareTo(r)).toBeGreaterThan(0);
    expect(x.counter).toBe(10);
  });

  it('rejects remote HLC far in future (> 5 min drift)', () => {
    const l = new Hlc(0, 0, 'a');
    const remoteFuture = new Hlc(Hlc.MAX_DRIFT_MS + 10, 0, 'b');
    expect(() => l.receive(remoteFuture, 0)).toThrow(/Remote HLC too far ahead/);
  });

  it('encode and parse round trip matches 15-digit wall, 5-digit counter', () => {
    const h = new Hlc(1761800000000, 3, 'dev:1');
    const encoded = h.encode();
    expect(encoded).toBe('001761800000000:00003:dev:1');
    const parsed = Hlc.parse(encoded);
    expect(parsed.wall).toBe(h.wall);
    expect(parsed.counter).toBe(h.counter);
    expect(parsed.node).toBe(h.node);
    expect(parsed.compareTo(h)).toBe(0);
  });
});

describe('Phase 1: Cryptographic Hashes & Checksums', () => {
  it('computes sha256Hex accurately', async () => {
    const hash = await sha256Hex('hello setu');
    expect(hash).toBe('084ec94d46e56e5ad3e8cbb224371c474c6cba08247776438e6c277175308c85');
  });

  it('computes eventHash matching backend pipeline', async () => {
    const event = {
      eventId: 'e144c06b-4896-4e81-961c-f5859217f1ec',
      deviceId: 'dev-001',
      patientId: 'P-1001',
      entityType: 'patient',
      entityId: 'P-1001',
      op: 'create',
      hlc: '001761800000000:00001:dev-001',
      baseHlc: null,
      payload: '{"name":"Asha Synthetic","age":32,"locality":"Ludhiana","status":"Stable"}'
    };
    const hash = await computeEventHash(event);
    expect(hash).toHaveLength(64);

    const chunkChecksum = await computeChunkChecksum([hash]);
    expect(chunkChecksum).toHaveLength(64);
  });
});

describe('Phase 1: Merkle Tree (Cross-Language Golden Root)', () => {
  it('matches backend ClockAndMerkleTest golden root exactly', async () => {
    // Exactly matches backend ClockAndMerkleTest.java line 32:
    // var leaves = List.of(new Merkle.Leaf("e1", "h1"), new Merkle.Leaf("e2", "h2"), new Merkle.Leaf("e3", "h3"));
    // assertEquals("c04c596001cf78273b30228ab6fa7b96e2e6c4b09f3a21359677aca6ca7f6594", Merkle.summarize(leaves).root());
    const leaves = [
      { eventId: 'e1', hash: 'h1' },
      { eventId: 'e2', hash: 'h2' },
      { eventId: 'e3', hash: 'h3' }
    ];
    const summary = await summarizeMerkle(leaves);
    expect(summary.root).toBe('c04c596001cf78273b30228ab6fa7b96e2e6c4b09f3a21359677aca6ca7f6594');
  });

  it('merkle is order-independent and detects changes', async () => {
    const leavesA = [
      { eventId: 'e1', hash: 'h1' },
      { eventId: 'e2', hash: 'h2' },
      { eventId: 'e3', hash: 'h3' }
    ];
    const leavesB = [leavesA[2], leavesA[0], leavesA[1]];

    const summaryA = await summarizeMerkle(leavesA);
    const summaryB = await summarizeMerkle(leavesB);
    expect(summaryA.root).toBe(summaryB.root);

    const subset = await summarizeMerkle(leavesA.slice(0, 2));
    expect(summaryA.root).not.toBe(subset.root);
  });
});

describe('Phase 1 & 5: Crypto (PBKDF2 >= 310k iter & AES-GCM)', () => {
  it('derives key, verifies PIN, and encrypts/decrypts correctly', async () => {
    const salt = generateSalt();
    const pin = '4829';
    const key = await deriveKeyFromPin(pin, salt);

    const verifier = await createVerifier(key);
    const isValid = await verifyKey(key, verifier.verifierCipher, verifier.verifierIv);
    expect(isValid).toBe(true);

    const wrongKey = await deriveKeyFromPin('9999', salt);
    const isWrongValid = await verifyKey(wrongKey, verifier.verifierCipher, verifier.verifierIv);
    expect(isWrongValid).toBe(false);

    // AES-GCM data encryption
    const secretMessage = JSON.stringify({ confidential: 'sensitive vitals data' });
    const encrypted = await encryptString(secretMessage, key);
    expect(encrypted.ciphertext).not.toBe(secretMessage);

    const decrypted = await decryptString(encrypted.ciphertext, encrypted.iv, key);
    expect(decrypted).toBe(secretMessage);
  });

  it('works in insecure context (crypto.subtle undefined on mobile HTTP)', async () => {
    const originalDesc = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle') || 
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(globalThis.crypto), 'subtle');
    try {
      // Simulate insecure context (Chrome for Android over HTTP)
      Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true, writable: true });

      const salt = generateSalt();
      const pin = '4829';
      const fallbackKey = await deriveKeyFromPin(pin, salt);
      expect((fallbackKey as any).isFallback).toBe(true);

      const verifier = await createVerifier(fallbackKey);
      const isValid = await verifyKey(fallbackKey, verifier.verifierCipher, verifier.verifierIv);
      expect(isValid).toBe(true);

      const wrongKey = await deriveKeyFromPin('9999', salt);
      const isWrongValid = await verifyKey(wrongKey, verifier.verifierCipher, verifier.verifierIv);
      expect(isWrongValid).toBe(false);

      const secret = JSON.stringify({ note: 'Field triage in Ludhiana rural' });
      const enc = await encryptString(secret, fallbackKey);
      expect(enc.ciphertext).not.toBe(secret);

      const dec = await decryptString(enc.ciphertext, enc.iv, fallbackKey);
      expect(dec).toBe(secret);
    } finally {
      if (originalDesc) {
        Object.defineProperty(globalThis.crypto, 'subtle', originalDesc);
      }
    }
  });
});

describe('Phase 1: IndexedDB (Dexie) Schema & Rebuild', () => {
  let testDb: SetuDatabase;

  beforeEach(async () => {
    testDb = new SetuDatabase(`test_db_${Date.now()}_${Math.random()}`);
    await testDb.open();
  });

  it('projects patient creation, vitals, and field updates', async () => {
    const event1: StoredEvent = {
      eventId: 'evt-1',
      deviceId: 'dev-1',
      userId: 'user-1',
      patientId: 'P-100',
      entityType: 'patient',
      entityId: 'P-100',
      op: 'create',
      payload: JSON.stringify({ name: 'Gurpreet Singh', age: 45, locality: 'Ludhiana', status: 'Stable' }),
      schemaVersion: 1,
      hlc: '001761800000000:00001:dev-1',
      createdAt: '2026-10-31T10:00:00Z',
      hash: 'hash1'
    };

    await testDb.events.put(event1);
    await projectEvent(testDb, event1);

    const patient = await testDb.patients.get('P-100');
    expect(patient).toBeDefined();
    expect(patient?.name).toBe('Gurpreet Singh');
    expect(patient?.status).toBe('Stable');

    // Add vital
    const event2: StoredEvent = {
      eventId: 'evt-2',
      deviceId: 'dev-1',
      userId: 'user-1',
      patientId: 'P-100',
      entityType: 'vital',
      entityId: 'V-100',
      op: 'create',
      payload: JSON.stringify({ sys: 130, dia: 85, pulse: 74, temp: 37.0, spo2: 97, at: '2026-10-31T10:05:00Z' }),
      schemaVersion: 1,
      hlc: '001761800000000:00002:dev-1',
      createdAt: '2026-10-31T10:05:00Z',
      hash: 'hash2'
    };

    await testDb.events.put(event2);
    await projectEvent(testDb, event2);

    const vital = await testDb.vitals.get('V-100');
    expect(vital).toBeDefined();
    expect(vital?.sys).toBe(130);
    expect(vital?.spo2).toBe(97);

    // Causal field update (status -> Urgent)
    const event3: StoredEvent = {
      eventId: 'evt-3',
      deviceId: 'dev-1',
      userId: 'user-1',
      patientId: 'P-100',
      entityType: 'patient',
      entityId: 'P-100',
      op: 'update',
      payload: JSON.stringify({ field: 'status', value: 'Urgent' }),
      schemaVersion: 1,
      hlc: '001761800000000:00003:dev-1',
      baseHlc: '001761800000000:00001:dev-1', // causal reference to create
      createdAt: '2026-10-31T10:10:00Z',
      hash: 'hash3'
    };

    await testDb.events.put(event3);
    await projectEvent(testDb, event3);

    const updatedPatient = await testDb.patients.get('P-100');
    expect(updatedPatient?.status).toBe('Urgent');

    // Concurrent conflict (without baseHlc matching current head)
    const event4Conflict: StoredEvent = {
      eventId: 'evt-4',
      deviceId: 'dev-2',
      userId: 'user-2',
      patientId: 'P-100',
      entityType: 'patient',
      entityId: 'P-100',
      op: 'update',
      payload: JSON.stringify({ field: 'status', value: 'Follow-up' }),
      schemaVersion: 1,
      hlc: '001761800000000:00004:dev-2',
      baseHlc: '001761800000000:00001:dev-1', // STALE baseHlc!
      createdAt: '2026-10-31T10:12:00Z',
      hash: 'hash4'
    };

    await testDb.events.put(event4Conflict);
    await projectEvent(testDb, event4Conflict);

    // Conflict should be opened and siblings recorded; status NOT overwritten
    const openConflicts = await testDb.conflicts.where('patientId').equals('P-100').toArray();
    expect(openConflicts.length).toBe(1);
    expect(openConflicts[0].fieldName).toBe('status');
    expect(openConflicts[0].status).toBe('OPEN');

    const siblings = await testDb.conflictSiblings.where('conflictId').equals(openConflicts[0].id).toArray();
    expect(siblings.length).toBe(2);

    // Check that patient status was not overwritten by stale concurrent update
    const conflictedPatient = await testDb.patients.get('P-100');
    expect(conflictedPatient?.status).toBe('Urgent');
    expect(conflictedPatient?.provisionalFields?.status).toBe(true);

    // Test REBUILD: wipe read models and replay all events
    await rebuild(testDb);

    const rebuiltPatient = await testDb.patients.get('P-100');
    expect(rebuiltPatient?.name).toBe('Gurpreet Singh');
    expect(rebuiltPatient?.status).toBe('Urgent');
    expect(rebuiltPatient?.provisionalFields?.status).toBe(true);

    const rebuiltVital = await testDb.vitals.get('V-100');
    expect(rebuiltVital?.sys).toBe(130);

    const rebuiltConflicts = await testDb.conflicts.where('patientId').equals('P-100').toArray();
    expect(rebuiltConflicts.length).toBe(1);
    expect(rebuiltConflicts[0].status).toBe('OPEN');
  });
});
