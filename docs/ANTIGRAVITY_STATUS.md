# SETU Antigravity Implementation Status

**Current Branch:** `feature/offline-crdt`  
**Baseline Verification:** `npm run build` PASS, `npm test` 24/24 PASS (5 test suites).

---

## Phase 0 – Safety Net (Baseline & Docs)
- [x] **0.1 Baseline & Branch**: Created branch `feature/offline-crdt`. Baseline build and tests passing.
- [x] **0.2 Feature Flags**: Added `src/config/features.ts` with typed feature flags and safe defaults.
- [x] **0.3 Smoke Test**: Added `tests/smoke.test.ts` covering login, create patient, save vitals, reload persistence, offline edit, and sync.
- [x] **0.4 Documentation Sync**: Updated `README.md` and `docs/IMPLEMENTATION_STATUS.md` to reflect true IndexedDB/HLC/encryption/serverless architecture.

---

## Phase 1 – Encryption at Rest (AES-256-GCM) + Local PIN
- [x] **1.1 Key hierarchy**: Random 256-bit DEK wrapped by PIN-derived key (PBKDF2 $\ge$ 310k iter). Re-wrapping DEK on PIN change.
- [x] **1.2 Encrypt at rest**: `events.payload`, patient names/locality/customFields, vital values. Background migration via `db.version(2)`.
- [x] **1.3 WebCrypto + @noble fallback**: AES-256-GCM fallback for insecure contexts without hardcoded keys. Tamper-rejection tests.
- [x] **1.4 Secure restorePersistentSession**: Eliminate literal derivation; prompt PIN unlock if key is evicted from memory.
- [x] **1.5 Demo mode guard**: Demo accounts enabled only when `VITE_DEMO_MODE !== "false"`.
- [x] **1.6 Local PIN lock screen**: Auto-lock on inactivity (default 5 min), lock on app background (Capacitor App), exponential attempt back-off.
- [x] **1.7 Server-side SQL + AES-256**: Encrypt PostgreSQL columns with AES-256-GCM using `SETU_DATA_KEY`.
- [ ] **1.8 (Optional) SQLCipher**: For Android local database (pending approval).
- [x] **1.9 Health Worker Cadres, Pediatric Vaccination Chart (<15y), & Field Catch-Up Summary**:
  - Frontline cadres: ASHA, ANM, AWW, CHW, Doctor, Admin with 1-click login selector, profile badges, and seeded offline accounts (`asha1`, `anm1`, `aww1`, `chw1`, `doctor1`, `admin1`).
  - Pediatric Vaccination Chart: National Immunization Schedule config (`config/vaccination-schedule.json`, labeled `needs clinical review`), milestone calculation, checkboxes for all vaccines, table badges, and modal record updater for children under 15.
  - Field Catch-Up Periodic Summary: Evaluates multi-day entries (72h) generating summarized banner text like `"5 new entries with 2 severe"` with quick severe filtering.
- [x] **1.10 Auto-Sync on Reconnect (Offline to Online)**:
  - When patient or clinical records are created/edited offline, they are safely written to local IndexedDB (`db.events`) and outbox (`db.outbox` as `pending`).
  - Network state listener (`window.addEventListener('online')`) and in-app online toggle immediately unpause the sync engine and dispatch a debounced sync chunk (`triggerSyncDebounced(100)`).
  - Transparent toast notifications: alerts the user when network is restored (`🟢 Network connected: auto-syncing X offline record(s)...`) and confirms when upload finishes (`☁️ Auto-sync complete: offline records successfully synced to cloud!`).
  - Seamless token exchange: allows offline demo unlock sessions to acquire live server tokens upon reconnecting without session eviction.
- [x] **1.11 Mobile LAN Plain-HTTP Insecure Context Compatibility (Fixed `ReferenceError: CryptoKey is not defined`)**:
  - In non-secure contexts (such as accessing `http://<LAN_IP>:5173/` over WiFi from a mobile phone browser), WebCrypto restricts `globalThis.CryptoKey` and `globalThis.crypto.subtle`.
  - Replaced naked `key instanceof CryptoKey` expressions with `isWebCryptoKey(key)` and declared a safe global fallback class for `globalThis.CryptoKey`.
  - Added test in `tests/phase1_crypto.test.ts` verifying complete PBKDF2/AES-GCM encryption, decryption, key wrapping, and verifier verification when `CryptoKey` and `crypto.subtle` are both missing.

---

## Phase 2 – Insert / Update / Delete + Unique IDs
- [ ] **2.1 Soft deletes & tombstones**: `op: 'delete'` with field-level clears and server archive mapping.
- [ ] **2.2 Patient & vitals management UI**: Edit patient, delete with 10s undo, edit/delete vitals reading.
- [ ] **2.3 Full UUID v4 IDs**: Replace short hex IDs with full UUID v4 while retaining short display codes.
- [ ] **2.4 Concurrency tests**: Delete then concurrent edit, double delete replay, identical rebuild state.

---

## Phase 3 – CRDT + HLC Core
- [ ] **3.1 Deterministic projection**: Strict HLC ordering and deterministic conflict IDs.
- [ ] **3.2 CRDT building blocks**: LWW-Register, OR-Set, tombstones, and state-hash in `src/lib/crdt/`.
- [ ] **3.3 Property tests**: 1,000 randomized shuffles and duplicates across 2-5 simulated devices.
- [ ] **3.4 Automerge for notes**: Flag-guarded `@automerge/automerge` for free-text notes (if Vite/Capacitor builds remain green).

---

## Phase 4 – Domain-Aware Smart Merge + Contradiction Resolution
- [ ] **4.1 Merge rule registry**: Append-only vitals, set-union allergies/meds, provisional status, typo-tolerant demographic merge.
- [ ] **4.2 Interactive contradiction UI**: Keep existing / Accept incoming / Write my own / Smart-merge suggestion.
- [ ] **4.3 Emergency conflict popups**: High-priority alert modal for unresolved allergy/medication conflicts.
- [ ] **4.4 Audit trail**: Log every manual/automatic resolution as a syncable event.

---

## Phase 5 – Resumable Delta Sync & Sync Meter
- [ ] **5.1 Idempotent replay**: Server/client deduplication by `eventId` and deterministic `chunkId`.
- [ ] **5.2 Resumable chunking**: Inflight progress persistence, 401 token refresh on download, exponential retry back-off with jitter.
- [ ] **5.3 Incremental Delta Merkle**: Incremental bucket hashing without full log re-scans.
- [ ] **5.4 Monotonic sequence counters**: Per-device counters replacing timestamps.
- [ ] **5.5 Sync meter & progress UI**: Events, bytes uploaded/downloaded, % progress, and last sync timestamp.
- [ ] **5.6 Interrupted sync test**: Crash/kill during sync with automatic recovery and verification.

---

## Phase 6 – Clinical Decision Support & Offline Features
- [ ] **6.1 Emergency popups**: Decision support rules from `config/emergency-rules.json`.
- [ ] **6.2 Priority score calculation**: Transparent clinical score and triage ordering.
- [ ] **6.3 Offline emergency protocols**: Local protocol cards and `tel:` links from `config/emergency-protocols.json`.
- [ ] **6.4 Vaccination checkpoint**: Dynamic schedule checklist from `config/vaccination-schedule.json` with OR-Set doses.
- [ ] **6.5 Community diseases dashboard**: Locality aggregate disease heatmaps and cluster alerts.
- [ ] **6.6 Offline clinical summary**: Deterministic template summary (optional online AI summary flag strictly false by default).

---

## Phase 7 – Voice & Handwriting
- [ ] **7.1 Web Speech API voice-to-text**: Honest offline/online badge, required user confirmation before saving.
- [ ] **7.2 Offline handwriting canvas**: Stroke vector capture + note attachment, honest offline recognition messaging.

---

## Phase 8 – Device-Loss Recovery & Backups
- [ ] **8.1 Device revocation admin**: Server-side device revocation flag enforcement.
- [ ] **8.2 Remote wipe**: Zero-wipe local IndexedDB and keys on next contact.
- [ ] **8.3 New device recovery**: Full zero-state recovery from `since=0` with Merkle validation.
- [ ] **8.4 Encrypted backup export/import**: AES-256-GCM file export for multi-day field isolation.
- [ ] **8.5 Unsynced data indicator**: Persistent visual reminder for un-replicated records.
