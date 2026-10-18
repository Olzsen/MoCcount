import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { profileDraftSchema } from '../shared/validation';
import { BrowserProfile, ProfileDraft, ProfileSummary } from '../shared/types';
import { createProfile, deleteProfile, listProfiles, updateProfile } from './store';
import { backGroup, checkProxy, clearSiteData, forwardGroup, getRunningIds, installProxyAuthHandler, launchProfile, launchProfilesTogether, navigateGroup, reloadGroup, stopProfile } from './browser-manager';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | undefined;

function redact(profile: BrowserProfile, status: 'stopped' | 'starting' | 'running'): ProfileSummary {
  const { proxy, ...rest } = profile;
  return {
    ...rest,
    proxy: proxy ? {
      type: proxy.type, host: proxy.host, port: proxy.port, username: proxy.username,
      hasPassword: Boolean(proxy.password),
    } : undefined,
    status,
  };
}

function validatedDraft(value: unknown): ProfileDraft {
  const parsed = profileDraftSchema.safeParse(value);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid profile settings.');
  const url = parsed.data.browser.startUrl.trim();
  const normalized = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url) ? url : `https://${url}`;
  let parsedUrl: URL;
  try { parsedUrl = new URL(normalized); } catch { throw new Error('Enter a valid start page URL.'); }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Start page must use HTTP or HTTPS.');
  return { ...parsed.data, browser: { ...parsed.data.browser, startUrl: parsedUrl.toString() } };
}

function registerIpc() {
  ipcMain.handle('profiles:list', () => {
    const running = new Set(getRunningIds());
    return listProfiles().map((profile) => redact(profile, running.has(profile.id) ? 'running' : 'stopped'));
  });
  ipcMain.handle('profiles:create', (_event, draft: unknown) => redact(createProfile(validatedDraft(draft)), 'stopped'));
  ipcMain.handle('profiles:update', (_event, id: string, draft: unknown) => {
    if (typeof id !== 'string' || id.length > 100) throw new Error('Invalid profile id.');
    if (getRunningIds().includes(id)) throw new Error('Stop the profile before changing its settings.');
    return redact(updateProfile(id, validatedDraft(draft)), 'stopped');
  });
  ipcMain.handle('profiles:delete', (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid profile id.');
    if (getRunningIds().includes(id)) throw new Error('Stop the profile before deleting it.');
    deleteProfile(id);
  });
  ipcMain.handle('browser:launch', async (_event, id: string) => {
    const profile = listProfiles().find((p) => p.id === id);
    if (!profile) throw new Error('Profile not found.');
    await launchProfile(profile);
  });
  ipcMain.handle('browser:stop', (_event, id: string) => stopProfile(id));
  ipcMain.handle('browser:launch-together', async (_event, ids: unknown) => {
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 16 || ids.some((id) => typeof id !== 'string')) {
      throw new Error('Выберите от 2 до 16 профилей для мульти-режима.');
    }
    const uniqueIds = [...new Set(ids as string[])];
    if (uniqueIds.length !== ids.length) throw new Error('В списке есть повторяющиеся профили.');
    const profiles = listProfiles();
    const selected = uniqueIds.map((id) => {
      const profile = profiles.find((item) => item.id === id);
      if (!profile) throw new Error('Один из выбранных профилей не найден.');
      return profile;
    });
    await launchProfilesTogether(selected);
  });
  ipcMain.handle('group:navigate', (_event, id: unknown, value: unknown) => {
    if (typeof id !== 'string' || typeof value !== 'string' || value.length > 4096) throw new Error('Некорректный адрес или поисковый запрос.');
    navigateGroup(id, value);
  });
  ipcMain.handle('group:back', (_event, id: unknown) => { if (typeof id === 'string') backGroup(id); });
  ipcMain.handle('group:forward', (_event, id: unknown) => { if (typeof id === 'string') forwardGroup(id); });
  ipcMain.handle('group:reload', (_event, id: unknown) => { if (typeof id === 'string') reloadGroup(id); });

  ipcMain.handle('proxy:check', (_event, draft: unknown) => checkProxy(validatedDraft(draft)));
  ipcMain.handle('browser:clear-data', async (_event, id: string) => {
    if (getRunningIds().includes(id)) throw new Error('Close the profile before clearing its site data.');
    await clearSiteData(id);
  });
  ipcMain.handle('browser:running', () => getRunningIds());
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    title: 'MoCcount',
    backgroundColor: '#101114',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (isDev) void mainWindow.loadURL('http://127.0.0.1:5173');
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  installProxyAuthHandler();
  registerIpc();
  createMainWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
