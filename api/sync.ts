/**
 * Sync Engine for SETU Vercel Serverless Backend.
 * Strict implementation of the Backend Contract:
 * - Event & Chunk Checksums (SHA-256)
 * - 5-minute HLC max drift rejection (HTTP 422)
 * - Multi-Value Register for concurrent edits (No Last-Write-Wins)
 * - Merkle tree reconciliation matching backend golden vectors
 * - Changes feed with cursor
 */

import crypto from 'crypto';
import { getPgPool, memoryDb, DbEvent, DbPatient, DbConflict, DbConflictSibling } from './db';
import { TokenPayload } from './auth';

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
        e.payload, e.schemaVersion || 1, e.hlc, e.baseHlc || null, createdAt, e.hash, bucket, chunk.chunkId
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
        payload: e.payload,
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
    payload: r.payload,
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
      payload: r.payload,
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
        payload: e.payload,
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
