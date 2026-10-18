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


## Multi-profile windows

Select two or more stopped profiles in the dashboard and choose one of the multi-profile modes:

- **Manage together** opens one visible browser view and keeps the remaining selected profiles running in the background.
- **Open tiled** arranges the selected browser views evenly inside one window. Each tile has its own address bar, Back, Forward, Reload, and Navigate controls. Turning on action synchronization lets supported clicks and ordinary text entry propagate to the other profiles.
- The browser-window **Pin** control keeps that window above other windows until it is unpinned.

Each profile still uses its own persistent Chromium session and proxy settings. Tiled rendering increases memory and CPU use with each profile. Synchronization is best-effort; sites with complex JavaScript frameworks, CAPTCHAs, payment flows, and password fields may behave differently. Password fields are intentionally not copied.

On Windows, a profile's overflow menu can create a desktop shortcut that starts MoCcount and opens that profile.

## Updates

The dashboard's **Update** button behaves differently by build type:

- In development, it can fast-forward `main` from `origin/main` only when the working tree is clean and `origin` points to this repository. It will not overwrite local edits. After a successful source update, close the app and run `npm run dev` again.
- In a packaged build, the button checks the configured GitHub Releases feed and downloads published updates. Automatic updates require a release containing the installer and electron-builder update metadata; they cannot be fetched directly from Git source in an installed application.

To publish a packaged update, increase the version in `package.json`, configure a GitHub token with permission to publish releases, then run the following from PowerShell:

```powershell
$env:GH_TOKEN = "YOUR_GITHUB_TOKEN"
npm run release
```

Never commit the token. The release script publishes build artifacts to the configured public GitHub repository. Test updates with an installed packaged build, not only with `npm run dev`.
