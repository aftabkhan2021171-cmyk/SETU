/**
 * Event Projection Engine.
 * Matches backend com.setu.sync.SyncService projection logic:
 * Applies events to local read-models (patients, vitals, fieldHeads, conflicts).
 * Concurrent edits create siblings in conflicts; causal edits advance field heads.
 */

import { SetuDatabase, StoredEvent, PatientRecord, VitalRecord, FieldHead, ConflictRecord, ConflictSibling } from './db';

export async function projectEvent(db: SetuDatabase, e: StoredEvent): Promise<void> {
  const p = JSON.parse(e.payload);

  switch (e.entityType) {
    case 'patient': {
      if (e.op === 'create') {
        const name = (p.name || '').trim();
        const locality = (p.locality || '').trim();
        const age = Number(p.age);
        const status = p.status || 'Stable';
        const district = p.district || 'Ludhiana';

        const reserved = new Set(['name', 'locality', 'age', 'status', 'district']);
        const customFields: Record<string, string> = {};
        for (const [k, v] of Object.entries(p)) {
          if (!reserved.has(k) && typeof v === 'string') {
            customFields[k] = v;
          }
        }

        const patient: PatientRecord = {
          id: e.entityId,
          name,
          age,
          locality,
          status,
          district,
          createdBy: e.userId,
          version: 1,
          createdAt: e.createdAt,
          updatedAt: e.createdAt,
          customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
          provisionalFields: {}
        };
        await db.patients.put(patient);

        // Record heads for all patient initial fields
        const fields: Record<string, string> = { name, locality, status, age: String(age) };
        for (const [fieldName, val] of Object.entries(fields)) {
          const head: FieldHead = {
            entityId: e.entityId,
            fieldName,
            hlc: e.hlc,
            valueText: val,
            eventId: e.eventId,
            deviceId: e.deviceId,
            userId: e.userId
          };
          await db.fieldHeads.put(head);
        }
      } else if (e.op === 'update') {
        const field = p.field;
        const value = String(p.value).trim();

        const head = await db.fieldHeads.get([e.entityId, field]);
        const openConflict = await db.conflicts
          .filter(c => c.patientId === e.entityId && c.fieldName === field && c.status === 'OPEN')
          .first();

        if (!head) {
          await applyField(db, e.entityId, field, value, e);
          return;
        }

        const causal = e.baseHlc != null && e.baseHlc === head.hlc;
        if (!openConflict && causal) {
          await applyField(db, e.entityId, field, value, e);
          return;
        }

        if (!openConflict && value === head.valueText) {
          // Concurrent edit with identical value: nothing to review
          return;
        }

        // Concurrent or conflicting edit: keep both values as siblings
        let conflictId = openConflict ? openConflict.id : `C-${e.entityId}-${field}-${Date.now()}`;
        if (!openConflict) {
          const conflict: ConflictRecord = {
            id: conflictId,
            patientId: e.entityId,
            fieldName: field,
            status: 'OPEN',
            createdAt: e.createdAt
          };
          await db.conflicts.put(conflict);

          // Add existing head as first sibling
          const siblingExisting: ConflictSibling = {
            conflictId,
            eventId: head.eventId,
            valueText: head.valueText,
            deviceId: head.deviceId,
            userId: head.userId,
            hlc: head.hlc
          };
          await db.conflictSiblings.put(siblingExisting);

          // Mark field as provisional in patient record
          const pat = await db.patients.get(e.entityId);
          if (pat) {
            pat.provisionalFields = { ...(pat.provisionalFields || {}), [field]: true };
            await db.patients.put(pat);
          }
        }

        // Add incoming event as sibling
        const siblingIncoming: ConflictSibling = {
          conflictId,
          eventId: e.eventId,
          valueText: value,
          deviceId: e.deviceId,
          userId: e.userId,
          hlc: e.hlc
        };
        await db.conflictSiblings.put(siblingIncoming);
      } else if (e.op === 'resolve') {
        const field = p.field;
        const value = String(p.value).trim();
        await applyField(db, e.entityId, field, value, e);

        // Close any open conflicts on this field
        const openConflicts = await db.conflicts
          .filter(c => c.patientId === e.entityId && c.fieldName === field && c.status === 'OPEN')
          .toArray();

        for (const c of openConflicts) {
          c.status = 'RESOLVED';
          c.resolvedAt = e.createdAt;
          c.resolution = `${p.kind || 'Resolved'}: ${value}`;
          await db.conflicts.put(c);
        }

        const pat = await db.patients.get(e.entityId);
        if (pat && pat.provisionalFields) {
          delete pat.provisionalFields[field];
          await db.patients.put(pat);
        }
      }
      break;
    }

    case 'vital': {
      if (e.op === 'create') {
        const vital: VitalRecord = {
          id: e.entityId,
          patientId: e.patientId,
          sys: Number(p.sys),
          dia: Number(p.dia),
          pulse: Number(p.pulse),
          temp: Number(p.temp),
          spo2: Number(p.spo2),
          at: p.at || e.createdAt,
          eventId: e.eventId,
          hlc: e.hlc
        };
        await db.vitals.put(vital);
      }
      break;
    }
  }
}

async function applyField(db: SetuDatabase, patientId: string, field: string, value: string, e: StoredEvent) {
  const pat = await db.patients.get(patientId);
  if (pat) {
    if (field === 'status') {
      pat.status = value as any;
    } else if (field === 'locality') {
      pat.locality = value;
    } else if (field === 'name') {
      pat.name = value;
    } else if (field === 'age') {
      pat.age = Number(value);
    }
    pat.version += 1;
    pat.updatedAt = e.createdAt;
    await db.patients.put(pat);
  }

  const head: FieldHead = {
    entityId: patientId,
    fieldName: field,
    hlc: e.hlc,
    valueText: value,
    eventId: e.eventId,
    deviceId: e.deviceId,
    userId: e.userId
  };
  await db.fieldHeads.put(head);
}
