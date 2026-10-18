# Main-process modules

- `main.ts` creates the application window and registers validated IPC handlers.
- `store.ts` persists profile metadata atomically under Electron's user-data directory. It uses Electron `safeStorage` to encrypt the whole profile file where OS-backed encryption is available; when unavailable, it writes profiles without proxy passwords.
- `browser-manager.ts` creates one persistent Chromium session partition per profile, manages independent windows, applies proxy settings, checks connectivity, and clears per-profile site data.

Security notes: never log proxy credentials. Validate every IPC payload. Profile session isolation is not a substitute for fingerprint management and does not imply a unique device identity.
