import { contextBridge, ipcRenderer } from 'electron';
import type { BrowserProfile, ProfileDraft, ProfileSummary } from '../shared/types';

const api = {
  listProfiles: () => ipcRenderer.invoke('profiles:list') as Promise<ProfileSummary[]>,
  createProfile: (draft: ProfileDraft) => ipcRenderer.invoke('profiles:create', draft) as Promise<ProfileSummary>,
  updateProfile: (id: string, draft: ProfileDraft) => ipcRenderer.invoke('profiles:update', id, draft) as Promise<ProfileSummary>,
  deleteProfile: (id: string) => ipcRenderer.invoke('profiles:delete', id) as Promise<void>,
  launchProfile: (id: string) => ipcRenderer.invoke('browser:launch', id) as Promise<void>,
  stopProfile: (id: string) => ipcRenderer.invoke('browser:stop', id) as Promise<void>,
  checkProxy: (draft: ProfileDraft) => ipcRenderer.invoke('proxy:check', draft) as Promise<{ ok: boolean; message: string }>,
  clearSiteData: (id: string) => ipcRenderer.invoke('browser:clear-data', id) as Promise<void>,
  getRunningIds: () => ipcRenderer.invoke('browser:running') as Promise<string[]>,
};

contextBridge.exposeInMainWorld('moccount', api);
