/**
 * SETU Feature Flags Configuration
 * 
 * Safety Rule 4: Every new user-visible feature goes behind a flag in this file.
 * Defaults are OFF until their corresponding phase tests pass.
 */

export interface FeatureFlags {
  // Phase 1: Encryption at rest & Local PIN
  encryptionAtRest: boolean;
  inactivityPinLock: boolean;
  serverSqlEncryption: boolean;

  // Phase 2: Insert/Update/Delete & Full UUID
  tombstoneDeletes: boolean;
  fullUuidV4: boolean;

  // Phase 3: CRDT & HLC Determinism
  deterministicProjection: boolean;
  crdtSets: boolean;
  automergeNotes: boolean; // Default false (WASM/Automerge guarded)

  // Phase 4: Smart Domain-Aware Merge & Interactive Conflicts
  domainSmartMerge: boolean;

  // Phase 5: Resumable Delta Sync & Sync Meter
  resumableDeltaSync: boolean;

  // Phase 6: Offline Clinical Decision Support
  emergencyPopups: boolean;
  priorityScoring: boolean;
  emergencyProtocols: boolean;
  vaccinationCheckpoint: boolean;
  communityDiseases: boolean;
  offlineSummary: boolean;
  aiSummary: boolean; // STRICTLY false by default, requires explicit user consent

  // Phase 7: Speech-to-Text & Handwriting
  speechToText: boolean;
  handwritingCanvas: boolean;

  // Phase 8: Device-loss Recovery & Backups
  deviceRevocationRecovery: boolean;
  encryptedBackupExport: boolean;
}

export const DEFAULT_FEATURES: FeatureFlags = {
  // Phase 1 (VERIFIED & PASSED)
  encryptionAtRest: true,
  inactivityPinLock: true,
  serverSqlEncryption: true,

  // Phase 2
  tombstoneDeletes: false,
  fullUuidV4: false,

  // Phase 3
  deterministicProjection: false,
  crdtSets: false,
  automergeNotes: false,

  // Phase 4
  domainSmartMerge: false,

  // Phase 5
  resumableDeltaSync: false,

  // Phase 6
  emergencyPopups: false,
  priorityScoring: false,
  emergencyProtocols: false,
  vaccinationCheckpoint: false,
  communityDiseases: false,
  offlineSummary: false,
  aiSummary: false,

  // Phase 7
  speechToText: false,
  handwritingCanvas: false,

  // Phase 8
  deviceRevocationRecovery: false,
  encryptedBackupExport: false,
};

// In-memory or localStorage overrides
export function getFeatureFlags(): FeatureFlags {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_FEATURES };
  }
  try {
    const stored = window.localStorage.getItem('setu_feature_flags');
    if (stored) {
      return { ...DEFAULT_FEATURES, ...JSON.parse(stored) };
    }
  } catch {
    // fallback to defaults on corrupt storage
  }
  return { ...DEFAULT_FEATURES };
}

export function isFeatureEnabled(flag: keyof FeatureFlags): boolean {
  return getFeatureFlags()[flag] ?? false;
}

export function setFeatureFlag(flag: keyof FeatureFlags, enabled: boolean): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const current = getFeatureFlags();
    current[flag] = enabled;
    window.localStorage.setItem('setu_feature_flags', JSON.stringify(current));
  } catch {
    // ignore in constrained contexts
  }
}
