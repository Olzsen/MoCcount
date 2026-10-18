# MoCcount

A desktop profile manager for independent Chromium browsing workspaces.

## Architecture

MoCcount uses Electron + Chromium because Electron provides persistent `session` partitions and independent browser windows. The app separates the renderer UI, a narrow preload bridge, profile persistence, and browser window/session management.

- `src/main/`: Electron main-process services and lifecycle
- `src/preload/`: safe, typed IPC bridge (no arbitrary renderer-to-Node access)
- `src/renderer/`: React UI and profile management screens
- `src/shared/`: shared profile types and validation
- `data/`: local app data at runtime (generated, not checked in)

Profile metadata is stored locally. Each browser profile gets a stable unique Electron session partition and persistent Chromium storage. Proxy passwords should be moved to the OS keychain before production release; the initial scaffold avoids writing secrets to logs.

## Important limitations

Separate Chromium sessions isolate cookies, local storage, and site sessions. This does **not** make profiles separate physical devices and does not provide full browser-fingerprint spoofing. Language, timezone, and proxy support depend on Electron/Chromium APIs and must be verified against the selected Electron version. HTTPS proxy support can vary by Chromium build. The UI must communicate these limitations plainly.

## Development

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Package a local build with:

```bash
npm run build
```

This repository is being initialized with the project structure. Run the app locally and validate browser launch, proxy connectivity, persistent sessions, and packaging on each target OS before treating it as production-ready.
