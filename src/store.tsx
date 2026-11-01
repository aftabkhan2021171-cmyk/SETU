import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import {
  db,
  PatientRecord,
  VitalRecord,
  ConflictRecord,
  ConflictSibling,
  StoredEvent,
  Hlc,
  computeEventHash,
  projectEvent,
  AuthUser,
  getActiveSession,
  getOrCreateDeviceId,
  initSyncEngine,
  subscribeSyncStats,
  runSync,
  triggerSyncDebounced,
  SyncStats,
  PatientStatus,
  setSyncPaused,
  getStoredSessionUser,
  restorePersistentSession
} from './lib';
import { generateUUID } from './lib/uuid';

export type Status = PatientStatus;
export type { PatientRecord as Patient, VitalRecord as Vital };

export interface FormattedConflict {
  id: string;
  patientId: string;
  field: string;
  existing: string;
  incoming: string;
  device: string;
  hlc: string;
  state: 'open' | 'resolved';
  decision?: string;
  siblings: ConflictSibling[];
  isCritical?: boolean;
}

export interface StoreContextType {
  s: {
    user: AuthUser | null;
    online: boolean;
    patients: PatientRecord[];
    vitals: VitalRecord[];
    conflicts: FormattedConflict[];
    syncStats: SyncStats;
    audit: string[];
    isLocked: boolean;
  };
  setOnline: (online: boolean) => void;
  createPatient: (data: { name: string; age: number; locality: string; status?: PatientStatus; customFields?: Record<string, string> }) => Promise<string>;
  updatePatientField: (patientId: string, field: string, value: string) => Promise<void>;
  saveVitals: (patientId: string, data: { sys: number; dia: number; pulse: number; temp: number; spo2: number }) => Promise<string>;
  resolveConflict: (conflictId: string, field: string, value: string, kind: string) => Promise<void>;
  triggerSync: () => Promise<void>;
  log: (msg: string) => Promise<void>;
  reloadLocalData: () => Promise<void>;
}

const StoreContext = createContext<StoreContextType>(null as never);
export const useStore = () => useContext(StoreContext);

export function Store({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getActiveSession()?.user || getStoredSessionUser() || null);
  const [online, setOnlineState] = useState<boolean>(() => navigator.onLine);
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [vitals, setVitals] = useState<VitalRecord[]>([]);
  const [conflicts, setConflicts] = useState<FormattedConflict[]>([]);
  const [auditLogs, setAuditLogs] = useState<string[]>([]);
  const [syncStats, setSyncStats] = useState<SyncStats>({
    pendingCount: 0,
    inflightCount: 0,
    syncedCount: 0,
    rejectedCount: 0,
    lastSyncTime: null,
    lastError: null,
    isSyncing: false
  });

  const reloadLocalData = useCallback(async () => {
    const session = getActiveSession();
    const currentUser = session?.user || null;
    setUser(currentUser);

    // Patients: CHW sees only their district; Doctor / Admin sees all
    let allPatients: PatientRecord[] = [];
    if (currentUser && currentUser.role === 'CHW' && currentUser.district) {
      allPatients = await db.patients.where('district').equals(currentUser.district).toArray();
    } else {
      allPatients = await db.patients.toArray();
    }
    setPatients(allPatients);

    // Vitals
    const allVitals = await db.vitals.reverse().sortBy('at');
    setVitals(allVitals);

    // Conflicts with siblings
    const openConflicts = await db.conflicts.toArray();
    const formatted: FormattedConflict[] = [];

    for (const c of openConflicts) {
      const sibs = await db.conflictSiblings.where('conflictId').equals(c.id).toArray();
      const existing = sibs[0]?.valueText || 'N/A';
      const incoming = sibs[1]?.valueText || sibs[0]?.valueText || 'N/A';
      const device = sibs[1]?.deviceId || sibs[0]?.deviceId || 'Unknown';
      const hlc = sibs[1]?.hlc || sibs[0]?.hlc || '';

      const isMedOrAllergy = c.fieldName.toLowerCase().includes('allergy') || c.fieldName.toLowerCase().includes('medication');

      formatted.push({
        id: c.id,
        patientId: c.patientId,
        field: c.fieldName,
        existing,
        incoming,
        device,
        hlc,
        state: c.status === 'OPEN' ? 'open' : 'resolved',
        decision: c.resolution,
        siblings: sibs,
        isCritical: isMedOrAllergy
      });
    }

    // Sort critical conflicts first per clinical rule
    formatted.sort((a, b) => (b.isCritical ? 1 : 0) - (a.isCritical ? 1 : 0));
    setConflicts(formatted);

    // Audit logs
    const auditRecords = await db.audit.reverse().limit(50).toArray();
    setAuditLogs(auditRecords.map(a => `${new Date(a.timestamp).toLocaleString()}  ${a.action}: ${a.details}`));
  }, []);

  useEffect(() => {
    // Request persistent storage from browser to prevent Android eviction
    if (typeof navigator !== 'undefined' && (navigator as any).storage?.persist) {
      (navigator as any).storage.persist().catch(() => {});
    }

    // Ensure persistent session is actively loaded
    restorePersistentSession().then(() => {
      reloadLocalData();
    });

    initSyncEngine();
    const unsubscribeSync = subscribeSyncStats(s => setSyncStats(s));

    const handleOnline = () => {
      setOnlineState(true);
      setSyncPaused(false);
      triggerSyncDebounced(100);
    };
    const handleOffline = () => {
      setOnlineState(false);
      setSyncPaused(true);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    reloadLocalData();

    // Auto-reload on table changes
    const interval = setInterval(reloadLocalData, 2000);

    return () => {
      unsubscribeSync();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [reloadLocalData]);

  const log = async (msg: string) => {
    const session = getActiveSession();
    const record = {
      timestamp: new Date().toISOString(),
      action: 'ACTION',
      details: msg,
      userId: session?.user.id,
      deviceId: await getOrCreateDeviceId()
    };
    await db.audit.add(record);
    await reloadLocalData();
  };

  const getNextHlc = async (deviceId: string): Promise<string> => {
    const meta = await db.meta.get('hlc_clock');
    const prevHlc = meta?.value ? Hlc.parse(meta.value) : new Hlc(0, 0, deviceId);
    const next = prevHlc.tick(Date.now());
    await db.meta.put({ key: 'hlc_clock', value: next.encode() });
    return next.encode();
  };

  const createPatient = async (data: { name: string; age: number; locality: string; status?: PatientStatus; customFields?: Record<string, string> }): Promise<string> => {
    const session = getActiveSession();
    if (!session) throw new Error('Must be signed in to create patient');

    const deviceId = await getOrCreateDeviceId();
    const patientId = `P-${generateUUID().slice(0, 6).toUpperCase()}`;
    const eventId = generateUUID();
    const hlc = await getNextHlc(deviceId);
    const createdAt = new Date().toISOString();

    const payload = JSON.stringify({
      name: data.name.trim(),
      age: data.age,
      locality: data.locality.trim(),
      status: data.status || 'Stable',
      district: session.user.district || 'Ludhiana',
      ...(data.customFields || {})
    });

    const hash = await computeEventHash({
      eventId,
      deviceId,
      patientId,
      entityType: 'patient',
      entityId: patientId,
      op: 'create',
      hlc,
      baseHlc: null,
      payload
    });

    const event: StoredEvent = {
      eventId,
      deviceId,
      userId: session.user.id,
      patientId,
      entityType: 'patient',
      entityId: patientId,
      op: 'create',
      payload,
      schemaVersion: 1,
      hlc,
      baseHlc: null,
      createdAt,
      hash
    };

    // 1. Local write first
    await db.transaction('rw', [db.events, db.outbox, db.patients, db.fieldHeads], async () => {
      await db.events.put(event);
      await db.outbox.put({
        eventId,
        status: 'pending',
        attempts: 0,
        createdAt,
        updatedAt: createdAt
      });
      await projectEvent(db, event);
    });

    await log(`Created patient ${patientId} (${data.name}) locally`);
    await reloadLocalData();
    triggerSyncDebounced();
    return patientId;
  };

  const updatePatientField = async (patientId: string, field: string, value: string): Promise<void> => {
    const session = getActiveSession();
    if (!session) throw new Error('Must be signed in to update patient');

    const deviceId = await getOrCreateDeviceId();
    const head = await db.fieldHeads.get([patientId, field]);
    const baseHlc = head ? head.hlc : null;
    const eventId = generateUUID();
    const hlc = await getNextHlc(deviceId);
    const createdAt = new Date().toISOString();

    const payload = JSON.stringify({ field, value: value.trim() });
    const hash = await computeEventHash({
      eventId,
      deviceId,
      patientId,
      entityType: 'patient',
      entityId: patientId,
      op: 'update',
      hlc,
      baseHlc,
      payload
    });

    const event: StoredEvent = {
      eventId,
      deviceId,
      userId: session.user.id,
      patientId,
      entityType: 'patient',
      entityId: patientId,
      op: 'update',
      payload,
      schemaVersion: 1,
      hlc,
      baseHlc,
      createdAt,
      hash
    };

    // Local write first
    await db.transaction('rw', [db.events, db.outbox, db.patients, db.fieldHeads, db.conflicts, db.conflictSiblings], async () => {
      await db.events.put(event);
      await db.outbox.put({
        eventId,
        status: 'pending',
        attempts: 0,
        createdAt,
        updatedAt: createdAt
      });
      await projectEvent(db, event);
    });

    await log(`Updated ${field} for patient ${patientId} locally`);
    await reloadLocalData();
    triggerSyncDebounced();
  };

  const saveVitals = async (patientId: string, data: { sys: number; dia: number; pulse: number; temp: number; spo2: number }): Promise<string> => {
    const session = getActiveSession();
    if (!session) throw new Error('Must be signed in to save vitals');

    const deviceId = await getOrCreateDeviceId();
    const vitalId = `V-${generateUUID().slice(0, 6).toUpperCase()}`;
    const eventId = generateUUID();
    const hlc = await getNextHlc(deviceId);
    const createdAt = new Date().toISOString();

    const payload = JSON.stringify({
      sys: data.sys,
      dia: data.dia,
      pulse: data.pulse,
      temp: data.temp,
      spo2: data.spo2,
      at: createdAt
    });

    const hash = await computeEventHash({
      eventId,
      deviceId,
      patientId,
      entityType: 'vital',
      entityId: vitalId,
      op: 'create',
      hlc,
      baseHlc: null,
      payload
    });

    const event: StoredEvent = {
      eventId,
      deviceId,
      userId: session.user.id,
      patientId,
      entityType: 'vital',
      entityId: vitalId,
      op: 'create',
      payload,
      schemaVersion: 1,
      hlc,
      baseHlc: null,
      createdAt,
      hash
    };

    // Local write first
    await db.transaction('rw', [db.events, db.outbox, db.vitals], async () => {
      await db.events.put(event);
      await db.outbox.put({
        eventId,
        status: 'pending',
        attempts: 0,
        createdAt,
        updatedAt: createdAt
      });
      await projectEvent(db, event);
    });

    await log(`Saved vitals reading ${vitalId} for patient ${patientId} locally`);
    await reloadLocalData();
    triggerSyncDebounced();
    return vitalId;
  };

  const resolveConflict = async (conflictId: string, field: string, value: string, kind: string): Promise<void> => {
    const session = getActiveSession();
    if (!session) throw new Error('Must be signed in to resolve conflict');

    const conflict = await db.conflicts.get(conflictId);
    if (!conflict) return;

    const deviceId = await getOrCreateDeviceId();
    const eventId = generateUUID();
    const hlc = await getNextHlc(deviceId);
    const createdAt = new Date().toISOString();

    const payload = JSON.stringify({ field, value, kind });
    const hash = await computeEventHash({
      eventId,
      deviceId,
      patientId: conflict.patientId,
      entityType: 'patient',
      entityId: conflict.patientId,
      op: 'resolve',
      hlc,
      baseHlc: null,
      payload
    });

    const event: StoredEvent = {
      eventId,
      deviceId,
      userId: session.user.id,
      patientId: conflict.patientId,
      entityType: 'patient',
      entityId: conflict.patientId,
      op: 'resolve',
      payload,
      schemaVersion: 1,
      hlc,
      baseHlc: null,
      createdAt,
      hash
    };

    await db.transaction('rw', [db.events, db.outbox, db.patients, db.fieldHeads, db.conflicts], async () => {
      await db.events.put(event);
      await db.outbox.put({
        eventId,
        status: 'pending',
        attempts: 0,
        createdAt,
        updatedAt: createdAt
      });
      await projectEvent(db, event);
    });

    // Also call backend resolution endpoint if online
    if (navigator.onLine && session.accessToken) {
      try {
        const baseUrl = await (await import('./lib/auth')).getApiBaseUrl();
        await fetch(`${baseUrl}/api/conflicts/${conflictId}/resolve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.accessToken}`
          },
          body: JSON.stringify({ value, kind, note: `Resolved on ${deviceId}` })
        });
      } catch { }
    }

    await log(`Conflict ${conflictId} resolved. ${kind}: ${value}`);
    await reloadLocalData();
    triggerSyncDebounced();
  };

  const triggerSync = async () => {
    await runSync();
    await reloadLocalData();
  };

  const contextValue: StoreContextType = {
    s: {
      user,
      online,
      patients,
      vitals,
      conflicts,
      syncStats,
      audit: auditLogs,
      isLocked: !user
    },
    setOnline: (isOnline: boolean) => {
      setOnlineState(isOnline);
      setSyncPaused(!isOnline);
      if (isOnline) {
        triggerSyncDebounced(100);
      }
    },
    createPatient,
    updatePatientField,
    saveVitals,
    resolveConflict,
    triggerSync,
    log,
    reloadLocalData
  };

  return <StoreContext.Provider value={contextValue}>{children}</StoreContext.Provider>;
}
