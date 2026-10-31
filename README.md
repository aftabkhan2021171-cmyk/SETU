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

## Important limitations

This is a clickable React shell around the original Stitch HTML screens. The original screens use Tailwind's CDN and Google Fonts, so their original styling requires an internet connection. The React navigation works locally after npm dependencies are installed. The original buttons and forms are only as functional as their supplied HTML/JavaScript. This is not yet the completed offline database, packet sync, HLC, Automerge, encryption or backend implementation.

Use synthetic demonstration data only. Do not enter real patient information.
