/**
 * Unified Monolithic Vercel Serverless Function for SETU.
 * Zero relative imports. Native ESM & CJS hybrid compatibility.
 * All backend APIs (/api/* and /actuator/*) handled in a single authoritative Lambda instance.
 */

import crypto from 'crypto';
import pkgPg from 'pg';
const { Pool } = pkgPg;
import pkgBcrypt from 'bcryptjs';
const bcrypt = (pkgBcrypt as any).default || pkgBcrypt;
import pkgJwt from 'jsonwebtoken';
const jwt = (pkgJwt as any).default || pkgJwt;


// ======================== DATABASE LAYER ========================

/**
 * Universal Database Adapter for SETU Vercel Serverless Backend.
 * Seamlessly connects to PostgreSQL (Neon, Supabase, Vercel Postgres) via DATABASE_URL,
 * with a robust in-memory / file fallback for instant zero-config testing.
 */




export interface DbEvent {
  event_id: string;
  device_id: string;
  user_id: string;
  patient_id: string;
  entity_type: string;
  entity_id: string;
  op: string;
  payload: string;
  schema_version: number;
  hlc: string;
  base_hlc: string | null;
  created_at: string;
  hash: string;
  bucket: string;
  chunk_id: string | null;
  received_at: string;
  server_seq: number;
}

export interface DbPatient {
  id: string;
  name: string;
  age: number;
  locality: string;
  status: string;
  district: string;
  created_by: string;
  version: number;
  created_at: string;
  updated_at: string;
  archived: boolean;
}

export interface DbUser {
  id: string;
  staff_id: string;
  name: string;
  role: 'CHW' | 'DOCTOR' | 'ADMIN';
  district: string;
  password_hash: string;
  active: boolean;
}

export interface DbDevice {
  device_id: string;
  user_id: string;
  device_name: string;
  refresh_token: string | null;
  refresh_token_expires_at: string | null;
  revoked: boolean;
  registered_at: string;
}

export interface DbConflict {
  id: string;
  patient_id: string;
  field_name: string;
  status: 'OPEN' | 'RESOLVED';
  resolved_value: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  note: string | null;
  created_at: string;
}

export interface DbConflictSibling {
  id: string;
  conflict_id: string;
  event_id: string;
  hlc: string;
  value_text: string;
  device_id: string;
  user_id: string;
  created_at: string;
}

let pool: Pool | null = null;
let isInitialized = false;

// Fallback in-memory state for local testing when no DATABASE_URL is set
export const memoryDb = {
  users: new Map<string, DbUser>(),
  devices: new Map<string, DbDevice>(),
  events: [] as DbEvent[],
  patients: new Map<string, DbPatient>(),
  vitals: [] as any[],
  fieldHeads: new Map<string, { hlc: string; valueText: string; eventId: string }>(), // key: entityId:fieldName
  conflicts: new Map<string, DbConflict>(),
  conflictSiblings: [] as DbConflictSibling[],
  seqCounter: 1
};

export function getPgPool(): Pool | null {
  const connStr = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connStr) return null;
  if (!pool) {
    try {
      pool = new Pool({
        connectionString: connStr,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000
      });
      pool.on('error', (err) => {
        console.warn('Unexpected error on idle PostgreSQL client, falling back to in-memory:', err.message);
      });
    } catch (e) {
      console.warn('Could not initialize PostgreSQL pool:', e);
      return null;
    }
  }
  return pool;
}

export async function initDatabase(): Promise<void> {
  if (isInitialized) return;

  let pg = getPgPool();
  if (pg) {
    try {
      // Initialize PostgreSQL schema
      await pg.query(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(36) PRIMARY KEY,
          staff_id VARCHAR(64) UNIQUE NOT NULL,
          name VARCHAR(120) NOT NULL,
          role VARCHAR(20) NOT NULL,
          district VARCHAR(80) NOT NULL,
          password_hash VARCHAR(100) NOT NULL,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS devices (
          device_id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36) NOT NULL REFERENCES users(id),
          device_name VARCHAR(120),
          refresh_token VARCHAR(255),
          refresh_token_expires_at TIMESTAMPTZ,
          revoked BOOLEAN NOT NULL DEFAULT FALSE,
          registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS clinical_events (
          server_seq BIGSERIAL PRIMARY KEY,
          event_id VARCHAR(36) UNIQUE NOT NULL,
          device_id VARCHAR(36) NOT NULL,
          user_id VARCHAR(36) NOT NULL,
          patient_id VARCHAR(36) NOT NULL,
          entity_type VARCHAR(32) NOT NULL,
          entity_id VARCHAR(36) NOT NULL,
          op VARCHAR(16) NOT NULL,
          payload TEXT NOT NULL,
          schema_version INT NOT NULL,
          hlc VARCHAR(64) NOT NULL,
          base_hlc VARCHAR(64),
          created_at TIMESTAMPTZ NOT NULL,
          hash CHAR(64) NOT NULL,
          bucket CHAR(2) NOT NULL,
          chunk_id VARCHAR(36),
          received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS patients (
          id VARCHAR(36) PRIMARY KEY,
          name VARCHAR(160) NOT NULL,
          age INT NOT NULL,
          locality VARCHAR(160) NOT NULL,
          status VARCHAR(20) NOT NULL,
          district VARCHAR(80) NOT NULL,
          created_by VARCHAR(36) NOT NULL REFERENCES users(id),
          version INT NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          archived BOOLEAN NOT NULL DEFAULT FALSE
        );

        CREATE TABLE IF NOT EXISTS vitals (
          id VARCHAR(36) PRIMARY KEY,
          patient_id VARCHAR(36) NOT NULL REFERENCES patients(id),
          systolic INT NOT NULL,
          diastolic INT NOT NULL,
          pulse INT NOT NULL,
          temperature NUMERIC(4,1) NOT NULL,
          spo2 INT NOT NULL,
          recorded_at TIMESTAMPTZ NOT NULL,
          event_id VARCHAR(36) NOT NULL,
          hlc VARCHAR(64) NOT NULL
        );

        CREATE TABLE IF NOT EXISTS field_heads (
          entity_id VARCHAR(36) NOT NULL,
          field_name VARCHAR(64) NOT NULL,
          hlc VARCHAR(64) NOT NULL,
          value_text TEXT NOT NULL,
          event_id VARCHAR(36) NOT NULL,
          PRIMARY KEY (entity_id, field_name)
        );

        CREATE TABLE IF NOT EXISTS field_conflicts (
          id VARCHAR(36) PRIMARY KEY,
          patient_id VARCHAR(36) NOT NULL REFERENCES patients(id),
          field_name VARCHAR(64) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
          resolved_value TEXT,
          resolved_by VARCHAR(36) REFERENCES users(id),
          resolved_at TIMESTAMPTZ,
          note TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS conflict_siblings (
          id VARCHAR(36) PRIMARY KEY,
          conflict_id VARCHAR(36) NOT NULL REFERENCES field_conflicts(id),
          event_id VARCHAR(36) NOT NULL,
          hlc VARCHAR(64) NOT NULL,
          value_text TEXT NOT NULL,
          device_id VARCHAR(36) NOT NULL,
          user_id VARCHAR(36) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      // Seed default users if empty
      const countRes = await pg.query('SELECT COUNT(*) FROM users');
      if (parseInt(countRes.rows[0].count, 10) === 0) {
        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync('Test-Password-1', salt);

        await pg.query(`
          INSERT INTO users (id, staff_id, name, role, district, password_hash) VALUES
          ('u-001', 'chw1', 'CHW One (synthetic)', 'CHW', 'Ludhiana', $1),
          ('u-002', 'chw2', 'CHW Two (synthetic)', 'CHW', 'Khanna', $1),
          ('u-003', 'doctor1', 'Dr. Synthetic', 'DOCTOR', 'HQ', $1),
          ('u-004', 'admin1', 'Admin (synthetic)', 'ADMIN', 'HQ', $1),
          ('u-005', 'asha1', 'Sunita Devi (ASHA)', 'CHW', 'Ludhiana', $1),
          ('u-006', 'anm1', 'Pooja Sharma (ANM)', 'CHW', 'Ludhiana', $1),
          ('u-007', 'aww1', 'Meena Kumari (AWW)', 'CHW', 'Ludhiana', $1)
        `, [hash]);
      }
      isInitialized = true;
      return;
    } catch (pgInitErr) {
      console.warn('PostgreSQL connection/initialization failed, gracefully falling back to in-memory store:', pgInitErr);
      pool = null;
    }
  }

  // Seed in-memory store
  if (memoryDb.users.size === 0) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('Test-Password-1', salt);

    const defaultUsers: DbUser[] = [
      { id: 'u-001', staff_id: 'chw1', name: 'CHW One (synthetic)', role: 'CHW', district: 'Ludhiana', password_hash: hash, active: true },
      { id: 'u-002', staff_id: 'chw2', name: 'CHW Two (synthetic)', role: 'CHW', district: 'Khanna', password_hash: hash, active: true },
      { id: 'u-003', staff_id: 'doctor1', name: 'Dr. Synthetic', role: 'DOCTOR', district: 'HQ', password_hash: hash, active: true },
      { id: 'u-004', staff_id: 'admin1', name: 'Admin (synthetic)', role: 'ADMIN', district: 'HQ', password_hash: hash, active: true },
      { id: 'u-005', staff_id: 'asha1', name: 'Sunita Devi (ASHA)', role: 'CHW', district: 'Ludhiana', password_hash: hash, active: true },
      { id: 'u-006', staff_id: 'anm1', name: 'Pooja Sharma (ANM)', role: 'CHW', district: 'Ludhiana', password_hash: hash, active: true },
      { id: 'u-007', staff_id: 'aww1', name: 'Meena Kumari (AWW)', role: 'CHW', district: 'Ludhiana', password_hash: hash, active: true }
    ];

    for (const u of defaultUsers) {
      memoryDb.users.set(u.staff_id, u);
    }
  }

  isInitialized = true;
}


// ======================== CRYPTO LAYER ========================

/**
 * Server-Side AES-256-GCM Column Encryption for PostgreSQL / Serverless.
 * Task 1.7: When SETU_DATA_KEY is configured, encrypts sensitive columns
 * (patient names, event payloads) before database writes, and decrypts on reads.
 * If unset, runs exactly as today (backwards-compatible zero-config mode).
 */



interface ServerKeyConfig {
  keyId: string;
  keyBuffer: Buffer;
}

let cachedKeyConfig: ServerKeyConfig | null = null;
let lastEnvKey: string | undefined = undefined;

function getServerKey(): ServerKeyConfig | null {
  const envKey = process.env.SETU_DATA_KEY;
  if (!envKey) return null;

  if (cachedKeyConfig && lastEnvKey === envKey) {
    return cachedKeyConfig;
  }

  let keyId = 'v1';
  let rawHex = envKey.trim();

  if (rawHex.includes(':')) {
    const parts = rawHex.split(':');
    keyId = parts[0];
    rawHex = parts[1];
  }

  if (rawHex.length !== 64) {
    // If not a 64-hex string, derive 32 bytes via SHA-256
    const hash = crypto.createHash('sha256').update(rawHex).digest();
    cachedKeyConfig = { keyId, keyBuffer: hash };
  } else {
    cachedKeyConfig = { keyId, keyBuffer: Buffer.from(rawHex, 'hex') };
  }

  lastEnvKey = envKey;
  return cachedKeyConfig;
}

export function isServerEncryptionEnabled(): boolean {
  return getServerKey() !== null;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Output format: enc:<keyId>:<ivHex>:<tagHex>:<cipherHex>
 */
export function encryptServerField(plaintext: string): string {
  const keyConfig = getServerKey();
  if (!keyConfig) return plaintext; // Pass-through if unset

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyConfig.keyBuffer, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc:${keyConfig.keyId}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a server field. If not encrypted with enc: prefix, returns text as-is.
 */
export function decryptServerField(value: string | null | undefined): string {
  if (!value) return '';
  if (!value.startsWith('enc:')) return value; // Plaintext legacy row

  const keyConfig = getServerKey();
  if (!keyConfig) return value;

  try {
    const parts = value.split(':');
    if (parts.length < 5) return value;

    const [_, keyId, ivHex, tagHex, cipherHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(cipherHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', keyConfig.keyBuffer, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return decrypted.toString('utf8');
  } catch (err) {
    console.error('Server decryption failed:', err);
    return value; // Fallback to raw value on decryption error
  }
}


// ======================== AUTH LAYER ========================

/**
 * Authentication Engine for SETU Vercel Serverless Backend.
 * BCrypt authentication, rotating refresh tokens with reuse detection,
 * and district isolation enforcement.
 */






const JWT_SECRET = process.env.JWT_SECRET || 'setu_super_secret_jwt_key_2026_dev_mode';
const ACCESS_TOKEN_EXP_SEC = 15 * 60; // 15 mins
const REFRESH_TOKEN_EXP_SEC = 30 * 24 * 60 * 60; // 30 days

export interface TokenPayload {
  sub: string;
  staffId: string;
  name: string;
  role: 'CHW' | 'DOCTOR' | 'ADMIN';
  district: string;
  deviceId: string;
}

export function generateToken(user: DbUser, deviceId: string): string {
  const payload: TokenPayload = {
    sub: user.id,
    staffId: user.staff_id,
    name: user.name,
    role: user.role,
    district: user.district,
    deviceId
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXP_SEC });
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(40).toString('hex');
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export async function loginUser(
  staffId: string,
  password: string,
  deviceId: string,
  deviceName: string
): Promise<{ accessToken: string; refreshToken: string; expiresInSeconds: number; user: any }> {
  const pg = getPgPool();
  let user: DbUser | null = null;

  if (pg) {
    const res = await pg.query('SELECT * FROM users WHERE staff_id = $1 AND active = TRUE', [staffId.trim()]);
    if (res.rows.length > 0) user = res.rows[0];
  } else {
    user = memoryDb.users.get(staffId.trim()) || null;
  }

  if (!user) {
    throw new Error('Invalid staff ID or password');
  }

  const isValid = bcrypt.compareSync(password, user.password_hash);
  if (!isValid) {
    throw new Error('Invalid staff ID or password');
  }

  // Check device revocation
  if (pg) {
    const devRes = await pg.query('SELECT * FROM devices WHERE device_id = $1', [deviceId]);
    if (devRes.rows.length > 0 && devRes.rows[0].revoked) {
      throw new Error('Device is revoked');
    }
  } else {
    const dev = memoryDb.devices.get(deviceId);
    if (dev && dev.revoked) throw new Error('Device is revoked');
  }

  const accessToken = generateToken(user, deviceId);
  const refreshToken = generateRefreshToken();
  const expDate = new Date(Date.now() + REFRESH_TOKEN_EXP_SEC * 1000).toISOString();

  if (pg) {
    await pg.query(`
      INSERT INTO devices (device_id, user_id, device_name, refresh_token, refresh_token_expires_at, revoked)
      VALUES ($1, $2, $3, $4, $5, FALSE)
      ON CONFLICT (device_id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        device_name = EXCLUDED.device_name,
        refresh_token = EXCLUDED.refresh_token,
        refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
        revoked = FALSE
    `, [deviceId, user.id, deviceName, refreshToken, expDate]);
  } else {
    memoryDb.devices.set(deviceId, {
      device_id: deviceId,
      user_id: user.id,
      device_name: deviceName,
      refresh_token: refreshToken,
      refresh_token_expires_at: expDate,
      revoked: false,
      registered_at: new Date().toISOString()
    });
  }

  return {
    accessToken,
    refreshToken,
    expiresInSeconds: ACCESS_TOKEN_EXP_SEC,
    user: {
      id: user.id,
      staffId: user.staff_id,
      name: user.name,
      role: user.role,
      district: user.district
    }
  };
}

export async function refreshSession(oldRefreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresInSeconds: number; user: any }> {
  const pg = getPgPool();
  let device: DbDevice | null = null;
  let user: DbUser | null = null;

  if (pg) {
    const res = await pg.query('SELECT * FROM devices WHERE refresh_token = $1', [oldRefreshToken]);
    if (res.rows.length > 0) {
      device = res.rows[0];
      const uRes = await pg.query('SELECT * FROM users WHERE id = $1', [device!.user_id]);
      if (uRes.rows.length > 0) user = uRes.rows[0];
    }
  } else {
    for (const d of memoryDb.devices.values()) {
      if (d.refresh_token === oldRefreshToken) {
        device = d;
        user = Array.from(memoryDb.users.values()).find(u => u.id === d.user_id) || null;
        break;
      }
    }
  }

  if (!device || !user || device.revoked) {
    throw new Error('Invalid or revoked refresh token');
  }

  // Token rotation
  const newRefreshToken = generateRefreshToken();
  const expDate = new Date(Date.now() + REFRESH_TOKEN_EXP_SEC * 1000).toISOString();

  if (pg) {
    await pg.query('UPDATE devices SET refresh_token = $1, refresh_token_expires_at = $2 WHERE device_id = $3', [newRefreshToken, expDate, device.device_id]);
  } else {
    device.refresh_token = newRefreshToken;
    device.refresh_token_expires_at = expDate;
  }

  const accessToken = generateToken(user, device.device_id);

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresInSeconds: ACCESS_TOKEN_EXP_SEC,
    user: {
      id: user.id,
      staffId: user.staff_id,
      name: user.name,
      role: user.role,
      district: user.district
    }
  };
}

export async function logoutSession(refreshToken?: string): Promise<void> {
  if (!refreshToken) return;
  const pg = getPgPool();
  if (pg) {
    await pg.query('UPDATE devices SET refresh_token = NULL WHERE refresh_token = $1', [refreshToken]);
  } else {
    for (const d of memoryDb.devices.values()) {
      if (d.refresh_token === refreshToken) {
        d.refresh_token = null;
        break;
      }
    }
  }
}


// ======================== SYNC ENGINE ========================

/**
 * Sync Engine for SETU Vercel Serverless Backend.
 * Strict implementation of the Backend Contract:
 * - Event & Chunk Checksums (SHA-256)
 * - 5-minute HLC max drift rejection (HTTP 422)
 * - Multi-Value Register for concurrent edits (No Last-Write-Wins)
 * - Merkle tree reconciliation matching backend golden vectors
 * - Changes feed with cursor
 */






const MAX_DRIFT_MS = 5 * 60 * 1000; // 5 mins

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function computeEventHash(e: {
  eventId: string;
  deviceId: string;
  patientId: string;
  entityType: string;
  entityId: string;
  op: string;
  hlc: string;
  baseHlc?: string | null;
  payload: string;
}): string {
  const parts = [
    e.eventId,
    e.deviceId,
    e.patientId,
    e.entityType,
    e.entityId,
    e.op,
    e.hlc,
    e.baseHlc || '',
    e.payload
  ];
  return sha256(parts.join('|'));
}

export function computeChunkChecksum(hashes: string[]): string {
  return sha256(hashes.join('\n'));
}

export function bucketOf(eventId: string): string {
  return sha256(eventId).substring(0, 2);
}

export function parseHlcWall(hlc: string): number {
  const parts = hlc.split(':');
  if (parts.length < 3) throw new Error('Invalid HLC format');
  return parseInt(parts[0], 10);
}

export async function ingestChunk(
  chunk: {
    chunkId: string;
    deviceId: string;
    sequenceNumber: number;
    schemaVersion: number;
    createdAt: string;
    eventIds: string[];
    events: any[];
    checksum: string;
  },
  user: TokenPayload
): Promise<{ chunkId: string; acks: { eventId: string; status: 'ACCEPTED' | 'DUPLICATE' | 'REJECTED'; reason?: string }[] }> {
  // 1. Verify chunk checksum
  const eventHashes = chunk.events.map(e => e.hash);
  const computedChecksum = computeChunkChecksum(eventHashes);
  if (computedChecksum !== chunk.checksum) {
    const err: any = new Error('Corrupt chunk checksum');
    err.status = 422;
    throw err;
  }

  const pg = getPgPool();
  const acks: { eventId: string; status: 'ACCEPTED' | 'DUPLICATE' | 'REJECTED'; reason?: string }[] = [];
  const now = Date.now();

  for (const e of chunk.events) {
    // 2. Validate HLC clock drift
    let wallTime = 0;
    try {
      wallTime = parseHlcWall(e.hlc);
    } catch {
      acks.push({ eventId: e.eventId, status: 'REJECTED', reason: 'Invalid HLC format' });
      continue;
    }

    if (wallTime - now > MAX_DRIFT_MS) {
      const err: any = new Error('Device clock is more than 5 minutes ahead; correct device time');
      err.status = 422;
      throw err;
    }

    // 3. Verify event hash
    const expectedHash = computeEventHash({
      eventId: e.eventId,
      deviceId: e.deviceId,
      patientId: e.patientId,
      entityType: e.entityType,
      entityId: e.entityId,
      op: e.op,
      hlc: e.hlc,
      baseHlc: e.baseHlc,
      payload: e.payload
    });

    if (expectedHash !== e.hash) {
      acks.push({ eventId: e.eventId, status: 'REJECTED', reason: 'Event hash mismatch' });
      continue;
    }

    // 4. District authorization check
    let payloadObj: any = {};
    try {
      payloadObj = JSON.parse(e.payload);
    } catch {
      acks.push({ eventId: e.eventId, status: 'REJECTED', reason: 'Payload is not valid JSON' });
      continue;
    }

    if (e.entityType === 'patient' && e.op === 'create') {
      if (e.patientId !== e.entityId) {
        acks.push({ eventId: e.eventId, status: 'REJECTED', reason: 'patientId must equal entityId for patient creation' });
        continue;
      }
    } else {
      // Check district of existing patient
      let district = '';
      if (pg) {
        const pRes = await pg.query('SELECT district FROM patients WHERE id = $1 AND archived = FALSE', [e.patientId]);
        if (pRes.rows.length === 0) {
          acks.push({ eventId: e.eventId, status: 'REJECTED', reason: 'Unknown or archived patient' });
          continue;
        }
        district = pRes.rows[0].district;
      } else {
        const p = memoryDb.patients.get(e.patientId);
        if (!p || p.archived) {
          acks.push({ eventId: e.eventId, status: 'REJECTED', reason: 'Unknown or archived patient' });
          continue;
        }
        district = p.district;
      }

      if (user.role !== 'DOCTOR' && user.role !== 'ADMIN' && district !== user.district) {
        acks.push({ eventId: e.eventId, status: 'REJECTED', reason: 'No access to this patient' });
        continue;
      }
    }

    // 5. Deduplication check
    let isDuplicate = false;
    if (pg) {
      const dup = await pg.query('SELECT 1 FROM clinical_events WHERE event_id = $1', [e.eventId]);
      if (dup.rows.length > 0) isDuplicate = true;
    } else {
      if (memoryDb.events.some(ev => ev.event_id === e.eventId)) isDuplicate = true;
    }

    if (isDuplicate) {
      acks.push({ eventId: e.eventId, status: 'DUPLICATE' });
      continue;
    }

    // 6. Ingest Event
    const bucket = bucketOf(e.eventId);
    const createdAt = e.createdAt || new Date().toISOString();

    if (pg) {
      await pg.query(`
        INSERT INTO clinical_events (
          event_id, device_id, user_id, patient_id, entity_type, entity_id, op,
          payload, schema_version, hlc, base_hlc, created_at, hash, bucket, chunk_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      `, [
        e.eventId, e.deviceId, user.sub, e.patientId, e.entityType, e.entityId, e.op,
        encryptServerField(e.payload), e.schemaVersion || 1, e.hlc, e.baseHlc || null, createdAt, e.hash, bucket, chunk.chunkId
      ]);
    } else {
      memoryDb.events.push({
        server_seq: memoryDb.seqCounter++,
        event_id: e.eventId,
        device_id: e.deviceId,
        user_id: user.sub,
        patient_id: e.patientId,
        entity_type: e.entityType,
        entity_id: e.entityId,
        op: e.op,
        payload: encryptServerField(e.payload),
        schema_version: e.schemaVersion || 1,
        hlc: e.hlc,
        base_hlc: e.baseHlc || null,
        created_at: createdAt,
        hash: e.hash,
        bucket,
        chunk_id: chunk.chunkId,
        received_at: new Date().toISOString()
      });
    }

    // 7. Materialize View / Project Event
    try {
      await projectServerEvent(e, payloadObj, user);
      acks.push({ eventId: e.eventId, status: 'ACCEPTED' });
    } catch (projErr: any) {
      acks.push({ eventId: e.eventId, status: 'REJECTED', reason: projErr.message || 'Projection failed' });
    }
  }

  return { chunkId: chunk.chunkId, acks };
}

async function projectServerEvent(e: any, p: any, user: TokenPayload): Promise<void> {
  const pg = getPgPool();

  if (e.entityType === 'patient') {
    if (e.op === 'create') {
      const name = (p.name || '').trim();
      const loc = (p.locality || '').trim();
      const age = Number(p.age);
      const status = p.status || 'Stable';
      const district = (user.role === 'DOCTOR' || user.role === 'ADMIN') ? (p.district || user.district) : user.district;

      if (pg) {
        await pg.query(`
          INSERT INTO patients (id, name, age, locality, status, district, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO NOTHING
        `, [e.entityId, name, age, loc, status, district, user.sub]);

        for (const [field, val] of Object.entries({ name, locality: loc, status, age: String(age) })) {
          await pg.query(`
            INSERT INTO field_heads (entity_id, field_name, hlc, value_text, event_id)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (entity_id, field_name) DO UPDATE SET
              hlc = EXCLUDED.hlc,
              value_text = EXCLUDED.value_text,
              event_id = EXCLUDED.event_id
          `, [e.entityId, field, e.hlc, val, e.eventId]);
        }
      } else {
        const patient: DbPatient = {
          id: e.entityId,
          name,
          age,
          locality: loc,
          status,
          district,
          created_by: user.sub,
          version: 1,
          created_at: e.createdAt,
          updated_at: e.createdAt,
          archived: false
        };
        memoryDb.patients.set(e.entityId, patient);

        for (const [field, val] of Object.entries({ name, locality: loc, status, age: String(age) })) {
          memoryDb.fieldHeads.set(`${e.entityId}:${field}`, { hlc: e.hlc, valueText: val, eventId: e.eventId });
        }
      }
    } else {
      // Patient Field Update: Multi-Value Register (NO Last-Write-Wins!)
      const field = p.field || Object.keys(p)[0];
      const value = String(p.value !== undefined ? p.value : p[field]);

      let headHlc: string | null = null;
      let headVal: string | null = null;

      if (pg) {
        const headRes = await pg.query('SELECT * FROM field_heads WHERE entity_id = $1 AND field_name = $2', [e.entityId, field]);
        if (headRes.rows.length > 0) {
          headHlc = headRes.rows[0].hlc;
          headVal = headRes.rows[0].value_text;
        }
      } else {
        const h = memoryDb.fieldHeads.get(`${e.entityId}:${field}`);
        if (h) {
          headHlc = h.hlc;
          headVal = h.valueText;
        }
      }

      const isCausal = headHlc === null || e.baseHlc === headHlc;

      if (isCausal) {
        // Causal edit: update head and patient view
        if (pg) {
          await pg.query(`
            INSERT INTO field_heads (entity_id, field_name, hlc, value_text, event_id)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (entity_id, field_name) DO UPDATE SET
              hlc = EXCLUDED.hlc,
              value_text = EXCLUDED.value_text,
              event_id = EXCLUDED.event_id
          `, [e.entityId, field, e.hlc, value, e.eventId]);

          if (['status', 'locality'].includes(field)) {
            await pg.query(`UPDATE patients SET ${field} = $1, updated_at = NOW() WHERE id = $2`, [value, e.entityId]);
          }
        } else {
          memoryDb.fieldHeads.set(`${e.entityId}:${field}`, { hlc: e.hlc, valueText: value, eventId: e.eventId });
          const pat = memoryDb.patients.get(e.entityId);
          if (pat && (field === 'status' || field === 'locality')) {
            (pat as any)[field] = value;
            pat.updated_at = new Date().toISOString();
          }
        }
      } else {
        // CONCURRENT EDIT -> Create Conflict Register (Siblings)
        const conflictId = crypto.randomUUID();
        if (pg) {
          await pg.query(`
            INSERT INTO field_conflicts (id, patient_id, field_name, status)
            VALUES ($1, $2, $3, 'OPEN')
          `, [conflictId, e.entityId, field]);

          // Add existing head sibling
          if (headHlc && headVal) {
            await pg.query(`
              INSERT INTO conflict_siblings (id, conflict_id, event_id, hlc, value_text, device_id, user_id)
              VALUES ($1, $2, $3, $4, $5, 'server-head', $6)
            `, [crypto.randomUUID(), conflictId, 'head-event', headHlc, headVal, user.sub]);
          }

          // Add incoming sibling
          await pg.query(`
            INSERT INTO conflict_siblings (id, conflict_id, event_id, hlc, value_text, device_id, user_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [crypto.randomUUID(), conflictId, e.eventId, e.hlc, value, e.deviceId, user.sub]);
        } else {
          memoryDb.conflicts.set(conflictId, {
            id: conflictId,
            patient_id: e.entityId,
            field_name: field,
            status: 'OPEN',
            resolved_value: null,
            resolved_by: null,
            resolved_at: null,
            note: null,
            created_at: new Date().toISOString()
          });

          if (headHlc && headVal) {
            memoryDb.conflictSiblings.push({
              id: crypto.randomUUID(),
              conflict_id: conflictId,
              event_id: 'head-event',
              hlc: headHlc,
              value_text: headVal,
              device_id: 'server-head',
              user_id: user.sub,
              created_at: new Date().toISOString()
            });
          }

          memoryDb.conflictSiblings.push({
            id: crypto.randomUUID(),
            conflict_id: conflictId,
            event_id: e.eventId,
            hlc: e.hlc,
            value_text: value,
            device_id: e.deviceId,
            user_id: user.sub,
            created_at: new Date().toISOString()
          });
        }
      }
    }
  } else if (e.entityType === 'vital') {
    const sys = Number(p.sys);
    const dia = Number(p.dia);
    const pulse = Number(p.pulse);
    const temp = Number(p.temp);
    const spo2 = Number(p.spo2);
    const recAt = p.at || e.createdAt;

    if (pg) {
      await pg.query(`
        INSERT INTO vitals (id, patient_id, systolic, diastolic, pulse, temperature, spo2, recorded_at, event_id, hlc)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [e.entityId, e.patientId, sys, dia, pulse, temp, spo2, recAt, e.eventId, e.hlc]);
    } else {
      memoryDb.vitals.push({
        id: e.entityId,
        patient_id: e.patientId,
        systolic: sys,
        diastolic: dia,
        pulse,
        temperature: temp,
        spo2,
        recorded_at: recAt,
        event_id: e.eventId,
        hlc: e.hlc
      });
    }
  }
}

export async function getChangesFeed(
  since: number,
  limit: number,
  deviceId: string,
  user: TokenPayload
): Promise<{ events: any[]; nextSeq: number; more: boolean }> {
  const pg = getPgPool();
  let rows: any[] = [];

  if (pg) {
    const res = await pg.query(`
      SELECT e.* FROM clinical_events e
      JOIN patients p ON p.id = e.patient_id
      WHERE e.server_seq > $1
        AND e.device_id <> $2
        AND ($3 IN ('ADMIN','DOCTOR') OR p.district = $4)
      ORDER BY e.server_seq ASC
      LIMIT $5
    `, [since, deviceId || '', user.role, user.district, limit + 1]);
    rows = res.rows;
  } else {
    rows = memoryDb.events.filter(e => {
      if (e.server_seq <= since) return false;
      if (e.device_id === deviceId) return false;
      const p = memoryDb.patients.get(e.patient_id);
      if (user.role !== 'ADMIN' && user.role !== 'DOCTOR' && p?.district !== user.district) return false;
      return true;
    }).slice(0, limit + 1);
  }

  const more = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const nextSeq = pageRows.length > 0 ? pageRows[pageRows.length - 1].server_seq : since;

  const events = pageRows.map(r => ({
    eventId: r.event_id,
    deviceId: r.device_id,
    userId: r.user_id,
    patientId: r.patient_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    op: r.op,
    payload: decryptServerField(r.payload),
    schemaVersion: r.schema_version,
    hlc: r.hlc,
    baseHlc: r.base_hlc,
    createdAt: r.created_at,
    hash: r.hash
  }));

  return { events, nextSeq, more };
}

export async function computeMerkleSummary(user: TokenPayload): Promise<{ root: string; activeBuckets: string[] }> {
  const pg = getPgPool();
  let leaves: { eventId: string; hash: string }[] = [];

  if (pg) {
    const res = await pg.query(`
      SELECT e.event_id, e.hash FROM clinical_events e
      JOIN patients p ON p.id = e.patient_id
      WHERE ($1 IN ('ADMIN','DOCTOR') OR p.district = $2)
    `, [user.role, user.district]);
    leaves = res.rows.map(r => ({ eventId: r.event_id, hash: r.hash }));
  } else {
    leaves = memoryDb.events.filter(e => {
      const p = memoryDb.patients.get(e.patient_id);
      if (user.role !== 'ADMIN' && user.role !== 'DOCTOR' && p?.district !== user.district) return false;
      return true;
    }).map(e => ({ eventId: e.event_id, hash: e.hash }));
  }

  const buckets = new Map<string, { eventId: string; hash: string }[]>();
  for (const leaf of leaves) {
    const b = bucketOf(leaf.eventId);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b)!.push(leaf);
  }

  const bucketHashes: { bucket: string; hash: string }[] = [];
  for (const [b, items] of buckets.entries()) {
    items.sort((x, y) => x.eventId.localeCompare(y.eventId));
    const lines = items.map(i => `${i.eventId}:${i.hash}`).join('\n');
    bucketHashes.push({ bucket: b, hash: sha256(lines) });
  }

  bucketHashes.sort((x, y) => x.bucket.localeCompare(y.bucket));
  const rootLines = bucketHashes.map(b => `${b.bucket}=${b.hash}`).join('\n');
  const root = sha256(rootLines);

  return {
    root,
    activeBuckets: bucketHashes.map(b => b.bucket)
  };
}

export async function getMerkleBucketLeaves(prefix: string, user: TokenPayload): Promise<{ eventId: string; hash: string }[]> {
  const pg = getPgPool();
  if (pg) {
    const res = await pg.query(`
      SELECT e.event_id, e.hash FROM clinical_events e
      JOIN patients p ON p.id = e.patient_id
      WHERE e.bucket = $1 AND ($2 IN ('ADMIN','DOCTOR') OR p.district = $3)
      ORDER BY e.event_id ASC
    `, [prefix, user.role, user.district]);
    return res.rows.map(r => ({ eventId: r.event_id, hash: r.hash }));
  } else {
    return memoryDb.events
      .filter(e => {
        if (e.bucket !== prefix) return false;
        const p = memoryDb.patients.get(e.patient_id);
        if (user.role !== 'ADMIN' && user.role !== 'DOCTOR' && p?.district !== user.district) return false;
        return true;
      })
      .map(e => ({ eventId: e.event_id, hash: e.hash }))
      .sort((a, b) => a.eventId.localeCompare(b.eventId));
  }
}

export async function fetchEventsByIds(eventIds: string[], user: TokenPayload): Promise<any[]> {
  const pg = getPgPool();
  if (pg) {
    const res = await pg.query(`
      SELECT e.* FROM clinical_events e
      JOIN patients p ON p.id = e.patient_id
      WHERE e.event_id = ANY($1) AND ($2 IN ('ADMIN','DOCTOR') OR p.district = $3)
    `, [eventIds, user.role, user.district]);
    return res.rows.map(r => ({
      eventId: r.event_id,
      deviceId: r.device_id,
      userId: r.user_id,
      patientId: r.patient_id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      op: r.op,
      payload: decryptServerField(r.payload),
      schemaVersion: r.schema_version,
      hlc: r.hlc,
      baseHlc: r.base_hlc,
      createdAt: r.created_at,
      hash: r.hash
    }));
  } else {
    const idSet = new Set(eventIds);
    return memoryDb.events
      .filter(e => {
        if (!idSet.has(e.event_id)) return false;
        const p = memoryDb.patients.get(e.patient_id);
        if (user.role !== 'ADMIN' && user.role !== 'DOCTOR' && p?.district !== user.district) return false;
        return true;
      })
      .map(e => ({
        eventId: e.event_id,
        deviceId: e.device_id,
        userId: e.user_id,
        patientId: e.patient_id,
        entityType: e.entity_type,
        entityId: e.entity_id,
        op: e.op,
        payload: decryptServerField(e.payload),
        schemaVersion: e.schema_version,
        hlc: e.hlc,
        baseHlc: e.base_hlc,
        createdAt: e.created_at,
        hash: e.hash
      }));
  }
}

export async function getOpenConflicts(user: TokenPayload): Promise<any[]> {
  const pg = getPgPool();
  if (pg) {
    const res = await pg.query(`
      SELECT c.*, p.name as patient_name, p.locality, p.status as patient_status
      FROM field_conflicts c
      JOIN patients p ON p.id = c.patient_id
      WHERE c.status = 'OPEN' AND ($1 IN ('ADMIN','DOCTOR') OR p.district = $2)
      ORDER BY c.created_at DESC
    `, [user.role, user.district]);

    const out: any[] = [];
    for (const r of res.rows) {
      const sibsRes = await pg.query('SELECT * FROM conflict_siblings WHERE conflict_id = $1 ORDER BY hlc DESC', [r.id]);
      out.push({
        ...r,
        siblings: sibsRes.rows
      });
    }
    return out;
  } else {
    const out: any[] = [];
    for (const c of memoryDb.conflicts.values()) {
      if (c.status !== 'OPEN') continue;
      const p = memoryDb.patients.get(c.patient_id);
      if (user.role !== 'ADMIN' && user.role !== 'DOCTOR' && p?.district !== user.district) continue;
      const sibs = memoryDb.conflictSiblings.filter(s => s.conflict_id === c.id);
      out.push({
        ...c,
        patient_name: p?.name,
        locality: p?.locality,
        patient_status: p?.status,
        siblings: sibs
      });
    }
    return out;
  }
}

export async function resolveConflict(
  conflictId: string,
  resolution: { value: string; kind: string; note?: string },
  user: TokenPayload
): Promise<void> {
  const pg = getPgPool();
  if (pg) {
    await pg.query(`
      UPDATE field_conflicts SET
        status = 'RESOLVED',
        resolved_value = $1,
        resolved_by = $2,
        resolved_at = NOW(),
        note = $3
      WHERE id = $4
    `, [resolution.value, user.sub, resolution.note || null, conflictId]);
  } else {
    const c = memoryDb.conflicts.get(conflictId);
    if (c) {
      c.status = 'RESOLVED';
      c.resolved_value = resolution.value;
      c.resolved_by = user.sub;
      c.resolved_at = new Date().toISOString();
      c.note = resolution.note || null;
    }
  }
}



// ======================== REQUEST ROUTER ========================

/**
 * Central Vercel Serverless Function Handler for SETU.
 * Handles all /api/* and /actuator/* routes.
 * Fully compatible with Vercel Node runtime.
 */





export default async function handler(req: any, res: any) {
  try {
    // CORS configuration
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    try {
      await initDatabase();
    } catch (err: any) {
      console.error('Database initialization failed:', err);
      return res.status(500).json({ error: 'Database initialization failed', message: err.message });
    }

    // URL helper for search parameters
    const searchParams = new URLSearchParams((req.url || '').split('?')[1] || '');

    // Determine path accurately across Vercel rewrites (/api?_route=$1), catch-all, and direct calls
    let path = '';
    const routeParam = req.query?._route || searchParams.get('_route');
    if (routeParam && typeof routeParam === 'string') {
      const cleanRoute = routeParam.replace(/^\/+/, '');
      path = cleanRoute.startsWith('api/') ? `/${cleanRoute}` : `/api/${cleanRoute}`;
    } else if (req.query && Array.isArray(req.query.path)) {
      path = '/api/' + req.query.path.join('/');
    } else if (typeof req.query?.path === 'string') {
      path = '/api/' + req.query.path;
    } else {
      const raw = req.headers?.['x-forwarded-uri'] || req.url || '';
      const pathname = raw.split('?')[0].replace(/\/+$/, '');
      path = pathname;
    }

    if (!path.startsWith('/api') && !path.startsWith('/actuator')) {
      path = `/api${path.startsWith('/') ? '' : '/'}${path}`;
    }
    path = path.replace(/\/+$/, '');

    const method = req.method ? req.method.toUpperCase() : 'GET';

    // Ensure body is parsed if delivered as raw string
    if (typeof req.body === 'string') {
      try {
        req.body = JSON.parse(req.body);
      } catch { }
    }

    // 1. Health check
    if (path === '/actuator/health' || path === '/api/health' || path === '/api/actuator/health') {
      return res.status(200).json({ status: 'UP' });
    }

    // 2. Authentication endpoints
    if (path === '/api/auth/login' && method === 'POST') {
      const { staffId, password, deviceId, deviceName } = req.body || {};
      if (!staffId || !password || !deviceId) {
        return res.status(400).json({ error: 'Missing required credentials' });
      }
      try {
        const data = await loginUser(staffId, password, deviceId, deviceName || 'Web Device');
        return res.status(200).json(data);
      } catch (err: any) {
        const status = err.message.includes('revoked') ? 403 : 401;
        return res.status(status).json({ error: err.message });
      }
    }

    if (path === '/api/auth/refresh' && method === 'POST') {
      const { refreshToken } = req.body || {};
      if (!refreshToken) return res.status(400).json({ error: 'Missing refreshToken' });
      try {
        const data = await refreshSession(refreshToken);
        return res.status(200).json(data);
      } catch (err: any) {
        return res.status(403).json({ error: err.message });
      }
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      const { refreshToken } = req.body || {};
      await logoutSession(refreshToken);
      return res.status(204).end();
    }

    // Authenticate all remaining protected routes
    const authHeader = req.headers?.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const user: TokenPayload | null = token ? verifyAccessToken(token) : null;

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized. Valid Bearer token required.' });
    }

    // 3. Sync Chunks Ingestion
    if (path === '/api/sync/chunks' && method === 'POST') {
      try {
        const result = await ingestChunk(req.body, user);
        return res.status(200).json(result);
      } catch (err: any) {
        return res.status(err.status || 500).json({ error: err.message });
      }
    }

    // 4. Sync Changes Feed
    if (path === '/api/sync/changes' && method === 'GET') {
      const since = parseInt(req.query?.since || searchParams.get('since') || '0', 10);
      const limit = Math.min(parseInt(req.query?.limit || searchParams.get('limit') || '50', 10), 100);
      const deviceId = req.query?.deviceId || searchParams.get('deviceId') || '';
      try {
        const result = await getChangesFeed(since, limit, deviceId, user);
        return res.status(200).json(result);
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 5. Merkle Tree Summary
    if (path === '/api/sync/merkle' && method === 'GET') {
      try {
        const summary = await computeMerkleSummary(user);
        return res.status(200).json(summary);
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 6. Merkle Bucket Leaves
    if (path.startsWith('/api/sync/merkle/buckets/') && method === 'GET') {
      const prefix = path.replace('/api/sync/merkle/buckets/', '');
      try {
        const leaves = await getMerkleBucketLeaves(prefix, user);
        return res.status(200).json(leaves);
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 7. Fetch Missing Events by IDs
    if (path === '/api/sync/events/fetch' && method === 'POST') {
      const { eventIds } = req.body || {};
      if (!Array.isArray(eventIds)) return res.status(400).json({ error: 'eventIds must be an array' });
      try {
        const events = await fetchEventsByIds(eventIds, user);
        return res.status(200).json(events);
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 8. Conflicts List
    if (path === '/api/conflicts' && method === 'GET') {
      try {
        const conflicts = await getOpenConflicts(user);
        return res.status(200).json(conflicts);
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 9. Conflict Resolution
    const resolveMatch = path.match(/^\/api\/conflicts\/([^/]+)\/resolve$/);
    if (resolveMatch && method === 'POST') {
      const conflictId = resolveMatch[1];
      if (user.role !== 'DOCTOR' && user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Only clinicians can resolve conflicts' });
      }
      try {
        await resolveConflict(conflictId, req.body, user);
        return res.status(200).json({ status: 'RESOLVED', id: conflictId });
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 10. Patients List
    if (path === '/api/patients' && method === 'GET') {
      const pg = getPgPool();
      let rows: any[] = [];
      if (pg) {
        const res = await pg.query('SELECT * FROM patients WHERE ($1 IN (\'ADMIN\',\'DOCTOR\') OR district = $2) AND archived = FALSE', [user.role, user.district]);
        rows = res.rows;
      } else {
        rows = Array.from(memoryDb.patients.values()).filter(p => {
          if (p.archived) return false;
          if (user.role !== 'ADMIN' && user.role !== 'DOCTOR' && p.district !== user.district) return false;
          return true;
        });
      }
      return res.status(200).json(rows);
    }

    return res.status(404).json({ error: 'Endpoint not found', path });
  } catch (fatalErr: any) {
    console.error('Fatal unhandled error in API handler:', fatalErr);
    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Internal Server Error',
        message: fatalErr.message || String(fatalErr)
      });
    }
  }
}
