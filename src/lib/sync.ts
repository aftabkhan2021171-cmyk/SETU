/**
 * SETU Offline-First Bidirectional Sync Engine.
 * Implements chunk upload with checksums, changes download feed,
 * Merkle reconciliation, exponential backoff, and crash resilience.
 */

import { db, OutboxItem, StoredEvent } from './db';
import { generateUUID } from './uuid';
import { Hlc } from './hlc';
import { computeChunkChecksum } from './hash';
import { summarizeMerkle } from './merkle';
import { projectEvent } from './projector';
import { getActiveSession, refreshAccessToken, getApiBaseUrl, getOrCreateDeviceId } from './auth';

export interface SyncStats {
  pendingCount: number;
  inflightCount: number;
  syncedCount: number;
  rejectedCount: number;
  lastSyncTime: string | null;
  lastError: string | null;
  isSyncing: boolean;
}

type SyncListener = (stats: SyncStats) => void;
const listeners = new Set<SyncListener>();

let stats: SyncStats = {
  pendingCount: 0,
  inflightCount: 0,
  syncedCount: 0,
  rejectedCount: 0,
  lastSyncTime: null,
  lastError: null,
  isSyncing: false
};

function notify() {
  for (const fn of listeners) {
    try { fn({ ...stats }); } catch { }
  }
}

export function subscribeSyncStats(fn: SyncListener): () => void {
  listeners.add(fn);
  fn({ ...stats });
  return () => listeners.delete(fn);
}

export async function refreshOutboxStats(): Promise<SyncStats> {
  const pending = await db.outbox.where('status').equals('pending').count();
  const inflight = await db.outbox.where('status').equals('inflight').count();
  const synced = await db.outbox.where('status').equals('synced').count();
  const rejected = await db.outbox.where('status').equals('rejected').count();

  stats.pendingCount = pending;
  stats.inflightCount = inflight;
  stats.syncedCount = synced;
  stats.rejectedCount = rejected;
  notify();
  return { ...stats };
}

let syncTimeout: any = null;
let writeDebounceTimeout: any = null;
let syncPaused = false;

export function setSyncPaused(paused: boolean): void {
  syncPaused = paused;
  if (!paused) {
    triggerSyncDebounced(100);
  }
}

export function isSyncPaused(): boolean {
  return syncPaused;
}

export function triggerSyncDebounced(delayMs = 500): void {
  if (syncPaused) return;
  if (writeDebounceTimeout) clearTimeout(writeDebounceTimeout);
  writeDebounceTimeout = setTimeout(() => {
    if (!syncPaused) {
      runSync().catch(err => console.error('Sync error:', err));
    }
  }, delayMs);
}

/**
 * Initializes the sync engine on app startup.
 * Converts any orphaned 'inflight' items back to 'pending'.
 */
export async function initSyncEngine(): Promise<void> {
  // 1. Crash recovery: recover inflight -> pending
  await db.transaction('rw', db.outbox, async () => {
    const inflight = await db.outbox.where('status').equals('inflight').toArray();
    for (const item of inflight) {
      item.status = 'pending';
      item.updatedAt = new Date().toISOString();
      await db.outbox.put(item);
    }
  });

  await refreshOutboxStats();

  // 2. Listen to network changes
  window.addEventListener('online', () => {
    if (!syncPaused) triggerSyncDebounced(200);
  });

  // 3. Periodic background sync every 30 seconds
  if (syncTimeout) clearInterval(syncTimeout);
  syncTimeout = setInterval(() => {
    if (!syncPaused && navigator.onLine && getActiveSession()) {
      runSync().catch(() => {});
    }
  }, 30000);
}

/**
 * Executes a full sync cycle:
 * 1. Upload local pending chunks
 * 2. Download remote changes feed
 * 3. Reconcile via Merkle comparison
 */
export async function runSync(): Promise<void> {
  if (stats.isSyncing) return;
  if (syncPaused) {
    await refreshOutboxStats();
    return;
  }
  const session = getActiveSession();
  if (!session || !navigator.onLine) {
    await refreshOutboxStats();
    return;
  }

  stats.isSyncing = true;
  stats.lastError = null;
  notify();

  try {
    // Phase A: Upload Pending Events
    await uploadPendingEvents(session);

    // Phase B: Download Changes Feed
    await downloadServerChanges(session);

    // Phase C: Merkle Reconciliation
    await reconcileMerkle(session);

    stats.lastSyncTime = new Date().toLocaleTimeString();
  } catch (err: any) {
    console.error('Sync run encountered an error:', err);
    stats.lastError = err.message || 'Sync failed';
  } finally {
    stats.isSyncing = false;
    await refreshOutboxStats();
  }
}

async function uploadPendingEvents(session: ReturnType<typeof getActiveSession>): Promise<void> {
  if (!session) return;
  const baseUrl = await getApiBaseUrl();
  const deviceId = await getOrCreateDeviceId();

  const CHUNK_SIZE = 25;
  const pendingItems = await db.outbox.where('status').equals('pending').sortBy('createdAt');
  if (pendingItems.length === 0) return;

  for (let i = 0; i < pendingItems.length; i += CHUNK_SIZE) {
    const slice = pendingItems.slice(i, i + CHUNK_SIZE);
    const eventIds = slice.map(s => s.eventId);
    const events: StoredEvent[] = [];

    for (const eid of eventIds) {
      const ev = await db.events.get(eid);
      if (ev) events.push(ev);
    }

    if (events.length === 0) continue;

    // Mark as inflight
    await db.transaction('rw', db.outbox, async () => {
      for (const item of slice) {
        item.status = 'inflight';
        item.attempts += 1;
        item.lastAttemptAt = new Date().toISOString();
        item.updatedAt = new Date().toISOString();
        await db.outbox.put(item);
      }
    });
    await refreshOutboxStats();

    const chunkId = generateUUID();
    const checksum = await computeChunkChecksum(events);
    const chunkPayload = {
      chunkId,
      deviceId,
      sequenceNumber: Date.now(),
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      eventIds: events.map(e => e.eventId),
      events: events.map(e => ({
        eventId: e.eventId,
        deviceId: e.deviceId,
        userId: e.userId,
        patientId: e.patientId,
        entityType: e.entityType,
        entityId: e.entityId,
        op: e.op,
        payload: e.payload,
        schemaVersion: e.schemaVersion,
        hlc: e.hlc,
        baseHlc: e.baseHlc || null,
        createdAt: e.createdAt,
        hash: e.hash
      })),
      checksum
    };

    let token = session.accessToken;
    let resp = await fetch(`${baseUrl}/api/sync/chunks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(chunkPayload)
    });

    if (resp.status === 401) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        token = newToken;
        resp = await fetch(`${baseUrl}/api/sync/chunks`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(chunkPayload)
        });
      }
    }

    if (!resp.ok) {
      const errText = await resp.text();
      // Rollback to pending or record rejection
      await db.transaction('rw', db.outbox, async () => {
        for (const item of slice) {
          if (resp.status === 422) {
            item.status = 'rejected';
            item.lastError = `422 Unprocessable: ${errText}`;
          } else {
            item.status = 'pending';
            item.lastError = `HTTP ${resp.status}: ${errText}`;
          }
          item.updatedAt = new Date().toISOString();
          await db.outbox.put(item);
        }
      });
      continue;
    }

    const chunkResp = await resp.json();
    const ackMap = new Map<string, { status: string; reason?: string }>();
    for (const ack of chunkResp.acks || []) {
      ackMap.set(ack.eventId, ack);
    }

    await db.transaction('rw', db.outbox, async () => {
      for (const item of slice) {
        const ack = ackMap.get(item.eventId);
        if (ack) {
          if (ack.status === 'ACCEPTED' || ack.status === 'DUPLICATE') {
            item.status = 'synced';
            item.chunkId = chunkId;
          } else if (ack.status === 'REJECTED') {
            item.status = 'rejected';
            item.lastError = ack.reason || 'Rejected by server';
          }
        } else {
          // Missing ack: leave pending to retry
          item.status = 'pending';
        }
        item.updatedAt = new Date().toISOString();
        await db.outbox.put(item);
      }
    });
  }
}

async function downloadServerChanges(session: ReturnType<typeof getActiveSession>): Promise<void> {
  if (!session) return;
  const baseUrl = await getApiBaseUrl();
  const deviceId = await getOrCreateDeviceId();

  let hasMore = true;
  while (hasMore) {
    const lastSeqMeta = await db.meta.get('last_server_seq');
    const since = lastSeqMeta?.value || 0;

    let token = session.accessToken;
    const resp = await fetch(`${baseUrl}/api/sync/changes?since=${since}&limit=100&deviceId=${deviceId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!resp.ok) break;

    const changes = await resp.json();
    const events: any[] = changes.events || [];

    for (const remoteEv of events) {
      const existing = await db.events.get(remoteEv.eventId);
      if (!existing) {
        const stored: StoredEvent = {
          eventId: remoteEv.eventId,
          deviceId: remoteEv.deviceId,
          userId: remoteEv.userId,
          patientId: remoteEv.patientId,
          entityType: remoteEv.entityType,
          entityId: remoteEv.entityId,
          op: remoteEv.op,
          payload: remoteEv.payload,
          schemaVersion: remoteEv.schemaVersion,
          hlc: remoteEv.hlc,
          baseHlc: remoteEv.baseHlc,
          createdAt: remoteEv.createdAt,
          hash: remoteEv.hash,
          receivedAt: new Date().toISOString()
        };

        // Advance logical clock
        const currentClockMeta = await db.meta.get('hlc_clock');
        const localHlc = currentClockMeta?.value ? Hlc.parse(currentClockMeta.value) : new Hlc(0, 0, deviceId);
        const remoteHlc = Hlc.parse(remoteEv.hlc);
        const advanced = localHlc.receive(remoteHlc, Date.now());
        await db.meta.put({ key: 'hlc_clock', value: advanced.encode() });

        // Store event and project into read-models
        await db.events.put(stored);
        await projectEvent(db, stored);
      }
    }

    await db.meta.put({ key: 'last_server_seq', value: changes.nextSeq });
    hasMore = changes.more === true && events.length > 0;
  }
}

async function reconcileMerkle(session: ReturnType<typeof getActiveSession>): Promise<void> {
  if (!session) return;
  const baseUrl = await getApiBaseUrl();

  const allEvents = await db.events.toArray();
  const leaves = allEvents.map(e => ({ eventId: e.eventId, hash: e.hash }));
  const localSummary = await summarizeMerkle(leaves);

  const resp = await fetch(`${baseUrl}/api/sync/merkle`, {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!resp.ok) return;

  const serverSummary = await resp.json();
  if (localSummary.root === serverSummary.root) {
    // Roots match: local and server logs are in complete agreement
    return;
  }

  // Find mismatched buckets
  const allBucketKeys = new Set([
    ...Object.keys(localSummary.buckets),
    ...Object.keys(serverSummary.buckets || {})
  ]);

  const differingBuckets: string[] = [];
  for (const b of allBucketKeys) {
    if (localSummary.buckets[b] !== serverSummary.buckets?.[b]) {
      differingBuckets.push(b);
    }
  }

  for (const b of differingBuckets) {
    const bucketResp = await fetch(`${baseUrl}/api/sync/merkle/buckets/${b}`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    });
    if (!bucketResp.ok) continue;

    const serverBucketLeaves: { eventId: string; hash: string }[] = await bucketResp.json();
    const localEventIds = new Set(allEvents.map(e => e.eventId));
    const missingEventIds = serverBucketLeaves
      .filter(l => !localEventIds.has(l.eventId))
      .map(l => l.eventId);

    if (missingEventIds.length > 0) {
      const fetchResp = await fetch(`${baseUrl}/api/sync/events/fetch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessToken}`
        },
        body: JSON.stringify({ eventIds: missingEventIds })
      });

      if (fetchResp.ok) {
        const fetchedEvents = await fetchResp.json();
        for (const ev of fetchedEvents) {
          const stored: StoredEvent = {
            ...ev,
            receivedAt: new Date().toISOString()
          };
          await db.events.put(stored);
          await projectEvent(db, stored);
        }
      }
    }
  }
}
