# SETU React Clickable Prototype

This project wraps the six supplied Stitch HTML screens in a React + TypeScript + Vite application with a clickable sidebar, page headings, and responsive application shell.

## Run on Windows

1. Extract this ZIP.
2. Open the extracted `SETU-React-Clickable` folder in VS Code.
3. Open Terminal > New Terminal.
4. Run:

```powershell
npm install
npm run dev
```

5. Open the localhost URL printed by Vite (usually http://localhost:5173).

## Included screens

- Sign in
- Field dashboard
- Vitals registration
- Doctor dashboard
- Conflict resolution
- Offline sync manager

## Architecture & Offline Capabilities

SETU is built as an offline-first clinical workspace for frontline health workers:
- **Client Storage:** Dexie / IndexedDB (`events`, `outbox`, `patients`, `vitals`, `fieldHeads`, `conflicts`, `conflictSiblings`, `meta`, `audit`).
- **Causality & Ordering:** Hybrid Logical Clocks (HLC) with 5-minute maximum drift protection.
- **Cryptography:** AES-256-GCM encryption with PBKDF2 key derivation (>= 310,000 iterations).
- **Sync Protocol:** Chunked upload (25 events with SHA-256 event hashes and chunk checksums), `since` cursor download, Merkle tree anti-entropy reconciliation.
- **Backend:** Universal Vercel serverless API (`api/index.ts`) supporting PostgreSQL with automatic in-memory fallback.
- **PWA & Android:** Offline caching via Workbox service worker (`dist/sw.js`) and Capacitor Android integration.
- **Multilingual:** 16 languages covering all 7 Sisters of North-East India and regional scripts.
- **Outdoor Mode:** High-contrast Sunlight mode for field work under direct sun.


