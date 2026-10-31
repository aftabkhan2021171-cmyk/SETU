/**
 * Local IndexedDB database using Dexie.
 * Complete offline-first storage with append-only event log and read-model projections.
 */

import Dexie, { Table } from 'dexie';

export type OutboxStatus = 'pending' | 'inflight' | 'synced' | 'rejected';
export type PatientStatus = 'Stable' | 'Follow-up' | 'Urgent';

export interface StoredEvent {
  eventId: string;
  deviceId: string;
  userId: string;
  patientId: string;
  entityType: string;
  entityId: string;
  op: 'create' | 'update' | 'resolve';
  payload: string; // Plaintext or decrypted JSON string
  encryptedPayload?: string; // If encrypted at rest
  payloadIv?: string;
  schemaVersion: number;
  hlc: string;
  baseHlc?: string | null;
  createdAt: string;
  hash: string;
  receivedAt?: string;
}

export interface OutboxItem {
  eventId: string;
  status: OutboxStatus;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  chunkId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PatientRecord {
  id: string;
  name: string;
  age: number;
  locality: string;
  status: PatientStatus;
  district: string;
  createdBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  customFields?: Record<string, string>;
  provisionalFields?: Record<string, boolean>; // True if conflict is open on this field
}

export interface VitalRecord {
  id: string;
  patientId: string;
  sys: number;
  dia: number;
  pulse: number;
  temp: number;
  spo2: number;
  at: string;
  eventId: string;
  hlc: string;
}

export interface FieldHead {
  entityId: string;
  fieldName: string;
  hlc: string;
  valueText: string;
  eventId: string;
  deviceId: string;
  userId: string;
}

export interface ConflictRecord {
  id: string;
  patientId: string;
  fieldName: string;
  status: 'OPEN' | 'RESOLVED';
  createdAt: string;
  resolvedAt?: string;
  resolution?: string;
}

export interface ConflictSibling {
  conflictId: string;
  eventId: string;
  valueText: string;
  deviceId: string;
  userId: string;
  hlc: string;
}

export interface MetaItem {
  key: string;
  value: any;
}

export interface AuditRecord {
  id?: number;
  timestamp: string;
  action: string;
  details: string;
  userId?: string;
  deviceId?: string;
}

export class SetuDatabase extends Dexie {
  events!: Table<StoredEvent, string>;
  outbox!: Table<OutboxItem, string>;
  patients!: Table<PatientRecord, string>;
  vitals!: Table<VitalRecord, string>;
  fieldHeads!: Table<FieldHead, [string, string]>;
  conflicts!: Table<ConflictRecord, string>;
  conflictSiblings!: Table<ConflictSibling, [string, string]>;
  meta!: Table<MetaItem, string>;
  audit!: Table<AuditRecord, number>;

  constructor(dbName = 'setu_offline_db') {
    super(dbName);
    this.version(1).stores({
      events: 'eventId, deviceId, patientId, entityType, entityId, op, hlc, createdAt, hash',
      outbox: 'eventId, status, attempts, chunkId, createdAt, updatedAt',
      patients: 'id, name, locality, status, district, updatedAt',
      vitals: 'id, patientId, at, eventId, hlc',
      fieldHeads: '[entityId+fieldName], entityId, fieldName, hlc',
      conflicts: 'id, patientId, fieldName, status, createdAt',
      conflictSiblings: '[conflictId+eventId], conflictId, eventId, hlc',
      meta: 'key',
      audit: '++id, timestamp, action'
    });
  }
}

// Default database instance
export const db = new SetuDatabase();
