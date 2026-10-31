# SETU implementation status (updated 2026-10-31)

## Done and tested (esbuild bundle + Playwright, Chromium)
- All six screens are native React (no iframes): Login, Field dashboard, Vitals, Doctor triage, Conflicts, Sync manager. Original Stitch HTML kept in public/screens/ as reference.
- Hash routing with 404 page, sidebar, mobile drawer menu, sign out.
- Shared Button / IconButton system (sm 32, md 40, lg 46 px; primary, secondary, outlined, text, danger, icon), toasts, accessible dialogs.
- Working: login validation, patient add/search/filter, vitals validation and save, conflict decisions with confirmation and audit log, simulated sync, offline demo toggle.
- Data persists across refresh (localStorage).
- No horizontal overflow at 1440, 1024, 768, 430, 390, 320 px on all routes. No console errors.

## Not done
- `tsc` type check and `vite build` were NOT run (no network here; vite, @types/react missing). Run `npm install && npm run build` locally and fix any type errors.
- Visual fidelity to the Stitch screens is not matched: the six layouts were rebuilt from the design system only, not copied. Only the 390px dashboard screenshot was reviewed.
- Edit/delete patient, patient detail page, doctor patient history view, manual-merge audit detail, empty-state polish.
- Storage is localStorage, not Dexie/IndexedDB. No service worker, HLC, Automerge, encryption or PIN lock yet (the demo PIN is only validated, never stored).
- Button audit: one shared component used everywhere; not yet visually reviewed on every screen.

## Simulated
Sync acknowledgements, online/offline toggle, sign-in. All data is synthetic.

## Run
npm install && npm run dev

## Stitch restoration pass (2026-10-31)
- Login: rebuilt to follow the original Stitch composition (header badge and chip, centred title, role cards with check mark, ID and PIN fields with icons and show/hide, offline mode switch, full-width gold action, footer row). Compared against screen.png at 600px; layout matches, text is rewritten (SETU brand, no HIPAA/encryption/network claims, demo labels). Logic preserved (validation, role routing, offline switch drives the demo online flag).
- Fixed: invalid font shorthand in .btn that dropped button font weight everywhere.
- Font: Plus Jakarta Sans added via Google Fonts link in index.html. Not loaded in my test browser (no network), so spacing may shift slightly once it loads.
- NOT yet restored: Field dashboard, Vitals, Doctor triage, Conflicts, Sync manager still use the earlier simplified layouts.
- Original screens are about 600px wide mobile designs; desktop layouts for them are an interpretation.
- `tsc` and `vite build` still not run (no network).
