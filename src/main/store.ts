import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { BrowserProfile, ProfileDraft } from '../shared/types';

interface StoredProfile extends BrowserProfile {
  proxy?: BrowserProfile['proxy'] & { password?: string };
}

const storePath = () => path.join(app.getPath('userData'), 'profiles.json');

function ensureDirectory() {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
}

function encodeProfiles(profiles: StoredProfile[]): string {
  const data = JSON.stringify(profiles, null, 2);
  if (safeStorage.isEncryptionAvailable()) {
    return JSON.stringify({ encrypted: true, data: safeStorage.encryptString(data).toString('base64') });
  }
  // Metadata remains usable on systems without OS-backed encryption. Do not save proxy passwords unencrypted.
  const safeProfiles = profiles.map((p) => ({ ...p, proxy: p.proxy ? { ...p.proxy, password: undefined } : undefined }));
  return JSON.stringify({ encrypted: false, data: JSON.stringify(safeProfiles, null, 2) }, null, 2);
}

function readProfiles(): StoredProfile[] {
  ensureDirectory();
  if (!fs.existsSync(storePath())) return [];
  try {
    const envelope = JSON.parse(fs.readFileSync(storePath(), 'utf8')) as { encrypted?: boolean; data?: string };
    if (!envelope.data) return [];
    const decoded = envelope.encrypted
      ? safeStorage.decryptString(Buffer.from(envelope.data, 'base64'))
      : envelope.data;
    return JSON.parse(decoded) as StoredProfile[];
  } catch {
    throw new Error('Profile storage could not be read. Back up the data directory before attempting recovery.');
  }
}

function writeProfiles(profiles: StoredProfile[]) {
  ensureDirectory();
  const target = storePath();
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, encodeProfiles(profiles), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, target);
}

export function listProfiles(): StoredProfile[] {
  return readProfiles();
}

export function createProfile(draft: ProfileDraft): StoredProfile {
  const profiles = readProfiles();
  const id = crypto.randomUUID();
  const profile: StoredProfile = {
    ...draft,
    id,
    createdAt: new Date().toISOString(),
    userDataPath: path.join(app.getPath('userData'), 'profiles', id),
  };
  profiles.unshift(profile);
  writeProfiles(profiles);
  return profile;
}

export function updateProfile(id: string, draft: ProfileDraft): StoredProfile {
  const profiles = readProfiles();
  const index = profiles.findIndex((p) => p.id === id);
  if (index < 0) throw new Error('Profile not found.');
  const previous = profiles[index];
  const nextProxy = draft.proxy ? { ...draft.proxy } : undefined;
  if (nextProxy && !nextProxy.password && previous.proxy?.password) nextProxy.password = previous.proxy.password;
  const profile: StoredProfile = {
    ...previous,
    ...draft,
    proxy: nextProxy,
    id,
    createdAt: previous.createdAt,
    userDataPath: previous.userDataPath,
  };
  profiles[index] = profile;
  writeProfiles(profiles);
  return profile;
}

export function deleteProfile(id: string): void {
  const profiles = readProfiles();
  writeProfiles(profiles.filter((p) => p.id !== id));
}
