import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { autoUpdater } from 'electron-updater';
import { profileDraftSchema } from '../shared/validation';
import { BrowserProfile, ProfileDraft, ProfileSummary } from '../shared/types';
import { createProfile, deleteProfile, listProfiles, updateProfile } from './store';
import { backGroup, checkProxy, clearSiteData, forwardGroup, getRunningIds, installProxyAuthHandler, launchProfile, launchProfilesTogether, navigateGroup, relayGroupInteraction, reloadGroup, toggleGroupAlwaysOnTop, setGroupInteractionSync, stopProfile } from './browser-manager';

const isDev = !app.isPackaged;
const execFileAsync = promisify(execFile);
let mainWindow: BrowserWindow | undefined;

function updateStatus(type: string, message: string, extras: { version?: string; percent?: number } = {}) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('app:update-status', { type, message, ...extras });
  }
}

function initializeUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => updateStatus('checking', 'Проверяем обновления MoCcount…'));
  autoUpdater.on('update-available', (info) => updateStatus('available', `Найдена версия ${info.version}. Загружаем обновление…`, { version: info.version }));
  autoUpdater.on('update-not-available', (info) => updateStatus('current', `Установлена актуальная версия (${info.version}).`, { version: info.version }));
  autoUpdater.on('download-progress', (progress) => updateStatus('progress', `Загрузка обновления: ${Math.round(progress.percent)}%`, { percent: progress.percent }));
  autoUpdater.on('error', (error) => updateStatus('error', `Ошибка обновления: ${error.message}`));
  autoUpdater.on('update-downloaded', (info) => {
    updateStatus('downloaded', `Обновление ${info.version} загружено.`, { version: info.version });
    void dialog.showMessageBox({
      type: 'info',
      title: 'MoCcount — обновление готово',
      message: `Версия ${info.version} загружена и готова к установке.`,
      detail: 'Приложение закроется и перезапустится.',
      buttons: ['Перезапустить сейчас', 'Позже'],
      defaultId: 0,
      cancelId: 1,
    }).then((result) => {
      if (result.response === 0) autoUpdater.quitAndInstall();
    });
  });
}

async function updateFromSource(): Promise<{ ok: boolean; message: string; restartRequired?: boolean }> {
  const cwd = app.getAppPath();
  const runGit = async (args: string[]) => (await execFileAsync('git', args, { cwd, timeout: 90000, windowsHide: true })).stdout.trim();
  try {
    const root = await runGit(['rev-parse', '--show-toplevel']);
    const normalizedRoot = path.resolve(root).toLowerCase();
    if (normalizedRoot !== path.resolve(cwd).toLowerCase()) {
      return { ok: false, message: 'Папка приложения не совпадает с корнем Git-репозитория.' };
    }
    const remote = await runGit(['remote', 'get-url', 'origin']);
    if (!/github\.com[:/]Olzsen\/MoCcount(?:\.git)?$/i.test(remote)) {
      return { ok: false, message: 'Обновление отменено: origin не указывает на официальный репозиторий MoCcount.' };
    }
    const branch = await runGit(['branch', '--show-current']);
    if (branch !== 'main') return { ok: false, message: `Обновление через Git доступно только на ветке main (сейчас: ${branch || 'detached HEAD'}).` };
    const dirty = await runGit(['status', '--porcelain']);
    const unsafeChanges = dirty.split('\n').filter(Boolean).filter((line) => {
      const file = line.slice(3).replace(/\\/g, '/');
      return !(line.startsWith('?? ') && file === 'package-lock.json');
    });
    if (unsafeChanges.length) return { ok: false, message: 'Есть локальные изменения. Сначала сохрани их или сделай резервную копию — Git-обновление ничего не будет перезаписывать.' };
    await runGit(['fetch', 'origin', 'main']);
    const before = await runGit(['rev-parse', 'HEAD']);
    const latest = await runGit(['rev-parse', 'origin/main']);
    if (before === latest) return { ok: true, message: 'Обновлений нет — установлена последняя версия исходников.' };
    try { await runGit(['merge-base', '--is-ancestor', 'HEAD', 'origin/main']); }
    catch { return { ok: false, message: 'Локальная ветка отличается от GitHub и не может быть обновлена безопасным fast-forward. Обновление отменено.' }; }
    await runGit(['merge', '--ff-only', 'origin/main']);
    updateStatus('updated-source', 'Исходники обновлены. Перезапусти npm run dev, чтобы загрузить новый код.');
    return { ok: true, message: 'Исходники обновлены. Закрой приложение и запусти npm run dev снова.', restartRequired: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Не удалось обновить исходники через Git: ${message}` };
  }
}

function startupProfileId(): string | undefined {
  const joined = process.argv.find((arg) => arg.startsWith('--moccount-profile='));
  if (joined) return joined.slice('--moccount-profile='.length);
  const index = process.argv.indexOf('--moccount-profile');
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function createDesktopShortcut(id: string): { ok: boolean; message: string } {
  if (process.platform !== 'win32') return { ok: false, message: 'Создание ярлыка сейчас поддерживается в Windows.' };
  const profile = listProfiles().find((item) => item.id === id);
  if (!profile) return { ok: false, message: 'Профиль не найден.' };
  const safeName = profile.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 90) || 'MoCcount';
  const shortcutPath = path.join(app.getPath('desktop'), `MoCcount — ${safeName}.lnk`);
  const args = app.isPackaged ? `--moccount-profile=${id}` : `\"${app.getAppPath().replace(/\"/g, '\\\"')}\" --moccount-profile=${id}`;
  const ok = shell.writeShortcutLink(shortcutPath, 'create', {
    target: process.execPath,
    args,
    description: `Открыть профиль MoCcount: ${profile.name}`,
    icon: process.execPath,
  });
  return ok
    ? { ok: true, message: `Ярлык создан на рабочем столе: MoCcount — ${safeName}.` }
    : { ok: false, message: 'Windows не смогла создать ярлык.' };
}

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
  ipcMain.handle('browser:launch-tiled', async (_event, ids: unknown) => {
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 16 || ids.some((id) => typeof id !== 'string')) {
      throw new Error('Выберите от 2 до 16 профилей для запуска плитками.');
    }
    const uniqueIds = [...new Set(ids as string[])];
    if (uniqueIds.length !== ids.length) throw new Error('В списке есть повторяющиеся профили.');
    const allProfiles = listProfiles();
    const selected = uniqueIds.map((id) => {
      const profile = allProfiles.find((item) => item.id === id);
      if (!profile) throw new Error('Один из выбранных профилей не найден.');
      return profile;
    });
    await launchProfilesTogether(selected, 'tiled');
  });
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
  ipcMain.handle('group:navigate', (_event, id: unknown, profileId: unknown, value: unknown) => {
    if (typeof id !== 'string' || typeof profileId !== 'string' || typeof value !== 'string' || value.length > 4096) throw new Error('Некорректный адрес или поисковый запрос.');
    navigateGroup(id, profileId, value);
  });
  ipcMain.handle('group:back', (_event, id: unknown, profileId: unknown) => { if (typeof id === 'string' && typeof profileId === 'string') backGroup(id, profileId); });
  ipcMain.handle('group:forward', (_event, id: unknown, profileId: unknown) => { if (typeof id === 'string' && typeof profileId === 'string') forwardGroup(id, profileId); });
  ipcMain.handle('group:reload', (_event, id: unknown, profileId: unknown) => { if (typeof id === 'string' && typeof profileId === 'string') reloadGroup(id, profileId); });
  ipcMain.handle('group:toggle-always-on-top', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Некорректное окно браузера.');
    return toggleGroupAlwaysOnTop(id);
  });
  ipcMain.handle('group:interaction-sync', (_event, id: unknown, enabled: unknown) => {
    if (typeof id !== 'string' || typeof enabled !== 'boolean') return false;
    return setGroupInteractionSync(id, enabled);
  });
  ipcMain.on('group:interaction', (event, id: unknown, profileId: unknown, action: unknown) => {
    if (typeof id !== 'string' || typeof profileId !== 'string') return;
    relayGroupInteraction(id, profileId, event.sender.id, action);
  });


  ipcMain.handle('proxy:check', (_event, draft: unknown) => checkProxy(validatedDraft(draft)));
  ipcMain.handle('browser:clear-data', async (_event, id: string) => {
    if (getRunningIds().includes(id)) throw new Error('Close the profile before clearing its site data.');
    await clearSiteData(id);
  });
  ipcMain.handle('browser:running', () => getRunningIds());
  ipcMain.handle('profiles:create-shortcut', (_event, id: unknown) => {
    if (typeof id !== 'string') return { ok: false, message: 'Некорректный профиль.' };
    return createDesktopShortcut(id);
  });
  ipcMain.handle('app:update', async () => {
    if (!app.isPackaged) return updateFromSource();
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true, message: 'Проверка обновлений запущена. Статус появится здесь.' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `Не удалось проверить GitHub Releases: ${message}. Для автообновления опубликованный релиз должен содержать установщик и latest.yml.` };
    }
  });

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
  initializeUpdater();
  registerIpc();
  createMainWindow();
  const startupId = startupProfileId();
  if (startupId) {
    const profile = listProfiles().find((item) => item.id === startupId);
    if (profile) mainWindow?.webContents.once('did-finish-load', () => { void launchProfile(profile).catch((error) => updateStatus('error', error instanceof Error ? error.message : String(error))); });
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
