import { contextBridge, ipcRenderer } from 'electron';

const api = {
  navigate: (groupId: string, profileId: string, value: string) => ipcRenderer.invoke('group:navigate', groupId, profileId, value),
  back: (groupId: string, profileId: string) => ipcRenderer.invoke('group:back', groupId, profileId),
  forward: (groupId: string, profileId: string) => ipcRenderer.invoke('group:forward', groupId, profileId),
  reload: (groupId: string, profileId: string) => ipcRenderer.invoke('group:reload', groupId, profileId),
  openTab: (groupId: string) => ipcRenderer.invoke('group:tab-open', groupId) as Promise<boolean>,
  selectTab: (groupId: string, tabId: string) => ipcRenderer.invoke('group:tab-select', groupId, tabId) as Promise<boolean>,
  closeTab: (groupId: string, tabId: string) => ipcRenderer.invoke('group:tab-close', groupId, tabId) as Promise<boolean>,
  toggleAlwaysOnTop: (groupId: string) => ipcRenderer.invoke('group:toggle-always-on-top', groupId) as Promise<boolean>,
  setInteractionSync: (groupId: string, enabled: boolean) => ipcRenderer.invoke('group:interaction-sync', groupId, enabled) as Promise<boolean>,
  onUrlChange: (callback: (message: { profileId: string; url: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: { profileId: string; url: string }) => callback(message);
    ipcRenderer.on('group:url', listener);
    return () => ipcRenderer.removeListener('group:url', listener);
  },
};
contextBridge.exposeInMainWorld('moccountGroup', api);
