# SETU Implementation Status (Updated 2026-11-01)

## Architecture & Verified Capabilities
- **Storage:** Dexie / IndexedDB schema v1 with append-only event log (`events`), persistent `outbox`, read-model projections (`patients`, `vitals`, `fieldHeads`, `conflicts`, `conflictSiblings`), `meta`, and `audit`.
- **Causality & Ordering:** Hybrid Logical Clocks (`src/lib/hlc.ts`) enforcing strict monotonic ticks and maximum 5-minute drift protection.
- **Cryptography & Sessions:** PBKDF2 (>= 310,000 iterations) + AES-256-GCM authenticated encryption for session storage and verification (`src/lib/crypto.ts`), with 30-day session durability and seamless offline unlock.
- **Sync Protocol:** Chunked sync with SHA-256 event hashing, chunk checksum verification, deduplication, and Merkle reconciliation (`src/lib/sync.ts`).
- **Serverless Backend:** Universal Vercel serverless API in `api/index.ts` supporting PostgreSQL persistence with automatic in-memory fallback.
- **Build & Quality:** Clean TypeScript compilation (`tsc -b`), production Vite build with Workbox service worker precaching, and full Vitest automated test suite passing (24/24 tests).
- **Field Usability:** 16 languages (all 7 Sisters of North-East India + Pan-India regional languages), High-Contrast Outdoor Sunlight Mode, quick column presets, duplicate entry detection, and RFC 4180 CSV export.

## Active Roadmap
See `docs/ANTIGRAVITY_STATUS.md` for phase-by-phase implementation tracking.
