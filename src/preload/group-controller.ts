import { contextBridge, ipcRenderer } from 'electron';

const api = {
  navigate: (groupId: string, value: string) => ipcRenderer.invoke('group:navigate', groupId, value),
  back: (groupId: string) => ipcRenderer.invoke('group:back', groupId),
  forward: (groupId: string) => ipcRenderer.invoke('group:forward', groupId),
  reload: (groupId: string) => ipcRenderer.invoke('group:reload', groupId),
  onUrlChange: (callback: (url: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string) => callback(url);
    ipcRenderer.on('group:url', listener);
    return () => ipcRenderer.removeListener('group:url', listener);
  },
};
contextBridge.exposeInMainWorld('moccountGroup', api);
