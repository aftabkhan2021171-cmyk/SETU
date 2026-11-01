/**
 * Universal Database Adapter for SETU Vercel Serverless Backend.
 * Seamlessly connects to PostgreSQL (Neon, Supabase, Vercel Postgres) via DATABASE_URL,
 * with a robust in-memory / file fallback for instant zero-config testing.
 */

import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

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

export { default } from './index';
