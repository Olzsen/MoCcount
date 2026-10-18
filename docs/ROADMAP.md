# Implementation status and validation plan

## Implemented in the initial scaffold

- [x] Responsive dark profile library UI with search and running/stopped filter
- [x] Create, edit, duplicate, and remove profile metadata
- [x] Persistent local profile metadata and stable per-profile Chromium session partition
- [x] Independent browser windows; repeated launch focuses an existing window
- [x] Basic HTTP/HTTPS/SOCKS5 proxy configuration, optional proxy auth, and connectivity test
- [x] Clear cached/site data for a stopped profile
- [x] Narrow preload bridge and main-process validation
- [x] Honest indication that full browser fingerprint spoofing is not supported

## Before production

- [ ] Install dependencies and run `npm run build` on a clean checkout
- [ ] Add automated unit/integration tests for profile lifecycle and IPC validation
- [ ] Verify proxy types and proxy authentication for each supported Electron release and OS
- [ ] Move proxy passwords to a dedicated OS keychain integration; current `safeStorage` encrypts the metadata file where available, while its fallback omits saved passwords
- [ ] Make language/timezone effective per profile or present those fields as disabled until supported; Chromium/Electron do not expose all of these as independent, comprehensive per-session settings
- [ ] Add logging with secret redaction, profile corruption recovery, and crash-safe migrations
- [ ] Add installers/signing and test app lifecycle on Windows, macOS, and Linux
- [ ] Add a clear destructive option for deleting profile data from disk (deleting metadata currently preserves data for recovery)
- [ ] Add CSP and pin a known-good dependency lockfile before release

## Fingerprint limitation

Chromium session partitions separate cookies, local storage, cache, and login sessions; proxy support separates network routing. These are not equivalent to full user-agent/canvas/WebGL/font/audio fingerprint control or a separate physical device identity.
