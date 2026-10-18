import { BrowserWindow, WebContentsView, session, Session } from 'electron';
import path from 'node:path';
import { BrowserProfile, ProfileDraft } from '../shared/types';

interface RunningProfile { window: BrowserWindow; session: Session; view: WebContentsView; groupId: string }
interface GroupView { profile: BrowserProfile; session: Session; view: WebContentsView }
interface BrowserGroup {
  id: string;
  window: BrowserWindow;
  views: Map<string, GroupView>;
  lastSynchronizedUrl: string;
  isMulti: boolean;
}
const running = new Map<string, RunningProfile>();
const groups = new Map<string, BrowserGroup>();
const proxyCredentials = new Map<string, { username: string; password: string }>();

const GROUP_CONTROLLER_HTML = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MoCcount</title><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111218;color:#eef0f7;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.toolbar{height:64px;display:flex;align-items:center;gap:8px;padding:0 14px;background:#171920;border-bottom:1px solid #2d303b;box-shadow:0 3px 12px #0002}
.brand{font-weight:750;letter-spacing:-.4px;color:#a99bff;margin-right:5px;white-space:nowrap}.group-label{font-size:10px;color:#8c91a1;border:1px solid #343743;padding:5px 8px;border-radius:6px;white-space:nowrap}
button{height:34px;min-width:34px;padding:0 10px;border:1px solid #353946;border-radius:8px;background:#22252e;color:#e2e5ef;cursor:pointer;transition:background .16s,border-color .16s,transform .16s}
button:hover{background:#303441;border-color:#4a4e60}button:active{transform:scale(.97)}button:disabled{opacity:.4;cursor:default}
.address{height:36px;min-width:70px;flex:1;background:#0e1015;border:1px solid #383c49;border-radius:9px;color:#f0f1f5;padding:0 12px;font:12px inherit;outline:none;user-select:text;-webkit-user-select:text;pointer-events:auto}
.address:focus{border-color:#9486f4;box-shadow:0 0 0 3px #9486f41c}.go{background:#9486f4;color:#171522;border-color:#a89dff;font-weight:700}.go:hover{background:#a99dfc}
@media(max-width:800px){.group-label{display:none}.brand{display:none}.toolbar{padding:0 7px;gap:5px}button{padding:0 7px}}
</style></head><body><div class="toolbar">
<span class="brand">MoCcount</span><span class="group-label" id="mode">Профиль</span>
<button id="back" title="Назад" aria-label="Назад">←</button><button id="forward" title="Вперёд" aria-label="Вперёд">→</button><button id="reload" title="Обновить" aria-label="Обновить">↻</button>
<input id="address" class="address" autocomplete="off" spellcheck="false" placeholder="Введите адрес или поисковый запрос" aria-label="Адрес или поисковый запрос">
<button id="go" class="go">Перейти</button>
</div><script>
const groupId = new URLSearchParams(location.search).get('group') || '';
const api = window.moccountGroup;
const address = document.getElementById('address');
const navigate = () => { const value = address.value.trim(); if(value) void api.navigate(groupId, value); };
document.getElementById('back').addEventListener('click', () => void api.back(groupId));
document.getElementById('forward').addEventListener('click', () => void api.forward(groupId));
document.getElementById('reload').addEventListener('click', () => void api.reload(groupId));
document.getElementById('go').addEventListener('click', navigate);
address.addEventListener('keydown', (event) => { if(event.key === 'Enter'){event.preventDefault();navigate();} });
api.onUrlChange((url) => { if(document.activeElement !== address) address.value = url; });
</script></body></html>`;

function safeUrl(value: string): string {
  const candidate = value.trim();
  const url = new URL(/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(candidate) ? candidate : `https://${candidate}`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS start pages are supported.');
  return url.toString();
}

function proxyRule(profile: BrowserProfile): string | undefined {
  const proxy = profile.proxy;
  if (!proxy?.host || !proxy.port) return undefined;
  const scheme = proxy.type === 'socks5' ? 'socks5' : proxy.type === 'https' ? 'https' : 'http';
  return `${scheme}://${proxy.host}:${proxy.port}`;
}

function configureProxyAuth(ses: Session, partition: string, username?: string, password?: string) {
  if (!username && !password) {
    proxyCredentials.delete(partition);
    return;
  }
  proxyCredentials.set(partition, { username: username ?? '', password: password ?? '' });
  // Electron exposes proxy authentication on the app-level login event, not Session#login.
  // The global handler below routes only proxy-auth challenges to the matching profile credentials.
}

async function configureSession(profile: BrowserProfile, partition: string, ses: Session) {
  const proxy = proxyRule(profile);
  if (proxy) await ses.setProxy({ proxyRules: proxy });
  else await ses.setProxy({ mode: 'system' });
  configureProxyAuth(ses, partition, profile.proxy?.username, profile.proxy?.password);
}

function normalizeAddressOrSearch(value: string): string {
  const candidate = value.trim();
  if (!candidate) throw new Error('Введите адрес или поисковый запрос.');
  const looksLikeUrl = /^[a-zA-Z][a-zA-Z\\d+.-]*:/.test(candidate) ||
    /^(localhost|\\d{1,3}(\\.\\d{1,3}){3}|[^\\s]+\\.[^\\s]+)(:\\d+)?(\\/.*)?$/i.test(candidate);
  if (looksLikeUrl) return safeUrl(candidate);
  return `https://www.google.com/search?q=${encodeURIComponent(candidate)}`;
}

function layoutGroup(group: BrowserGroup) {
  if (group.window.isDestroyed()) return;
  const [width, totalHeight] = group.window.getContentSize();
  const top = 64;
  const contentHeight = Math.max(120, totalHeight - top);
  const items = [...group.views.values()];
  if (!items.length) return;
  const columns = group.isMulti ? Math.ceil(Math.sqrt(items.length)) : 1;
  const rows = Math.ceil(items.length / columns);
  items.forEach(({ view }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cellWidth = Math.floor(width / columns);
    const cellHeight = Math.floor(contentHeight / rows);
    view.setBounds({
      x: column * cellWidth,
      y: top + row * cellHeight,
      width: column === columns - 1 ? width - column * cellWidth : cellWidth,
      height: row === rows - 1 ? contentHeight - row * cellHeight : cellHeight,
    });
  });
}

function updateGroupAddress(group: BrowserGroup, url: string) {
  if (!group.window.isDestroyed()) group.window.webContents.send('group:url', url);
}

function syncGroupNavigation(group: BrowserGroup, sourceId: string, url: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
  if (url === group.lastSynchronizedUrl) {
    updateGroupAddress(group, url);
    return;
  }
  group.lastSynchronizedUrl = url;
  updateGroupAddress(group, url);
  for (const [id, item] of group.views) {
    if (id === sourceId || item.view.webContents.isDestroyed()) continue;
    if (item.view.webContents.getURL() === url) continue;
    void item.view.webContents.loadURL(url).catch(() => undefined);
  }
}

async function openBrowserGroup(profiles: BrowserProfile[], isMulti: boolean): Promise<void> {
  if (!profiles.length) throw new Error('Выберите хотя бы один профиль.');
  const alreadyRunning = profiles.filter((p) => running.has(p.id));
  if (alreadyRunning.length) {
    const first = running.get(alreadyRunning[0].id);
    first?.window.focus();
    throw new Error(`Сначала остановите уже запущенные профили: ${alreadyRunning.map((p) => p.name).join(', ')}.`);
  }
  const groupId = crypto.randomUUID();
  const startUrl = safeUrl(profiles[0].browser.startUrl);
  const window = new BrowserWindow({
    width: isMulti ? Math.max(1440, ...profiles.map((p) => p.browser.width)) : profiles[0].browser.width,
    height: isMulti ? Math.max(900, ...profiles.map((p) => p.browser.height)) : profiles[0].browser.height,
    minWidth: isMulti ? 900 : 600,
    minHeight: isMulti ? 620 : 480,
    title: isMulti ? `MoCcount — Мульти-профиль (${profiles.length})` : `MoCcount — ${profiles[0].name}`,
    backgroundColor: '#111218',
    webPreferences: {
      preload: path.join(__dirname, '../preload/group-controller.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const group: BrowserGroup = { id: groupId, window, views: new Map(), lastSynchronizedUrl: startUrl, isMulti };
  groups.set(groupId, group);
  window.on('resize', () => layoutGroup(group));
  window.on('closed', () => {
    for (const id of group.views.keys()) running.delete(id);
    groups.delete(groupId);
  });

  try {
    for (const profile of profiles) {
      const partition = partitionFor(profile.id);
      const ses = session.fromPartition(partition, { cache: true });
      await configureSession(profile, partition, ses);
      const userAgent = (profile.browser.userAgent ?? '').trim() || ses.getUserAgent();
      ses.setUserAgent(userAgent, profile.browser.locale);
      const fingerprint = Buffer.from(JSON.stringify({
        hardwareConcurrency: profile.browser.hardwareConcurrency ?? 8,
        deviceMemory: profile.browser.deviceMemory ?? 8,
        locale: profile.browser.locale,
        timezone: profile.browser.timezone,
      })).toString('base64');
      const view = new WebContentsView({
        webPreferences: {
          partition,
          preload: path.join(__dirname, '../preload/fingerprint.js'),
          additionalArguments: [`--moccount-fingerprint=${fingerprint}`],
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      const entry: GroupView = { profile, session: ses, view };
      group.views.set(profile.id, entry);
      window.contentView.addChildView(view);
      running.set(profile.id, { window, session: ses, view, groupId });
      view.webContents.on('did-navigate', (_event, url) => syncGroupNavigation(group, profile.id, url));
      view.webContents.on('did-navigate-in-page', (_event, url) => syncGroupNavigation(group, profile.id, url));
    }

    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(GROUP_CONTROLLER_HTML.replace('<title>MoCcount</title>', `<title>MoCcount</title>`).replace('const groupId = new URLSearchParams(location.search).get(\'group\') || \'\';', `const groupId = '${groupId}';`).replace('id="mode">Профиль', `id="mode">${isMulti ? `Мульти · ${profiles.length}` : 'Одиночный профиль'}`))}`);
    layoutGroup(group);
    for (const { view } of group.views.values()) await view.webContents.loadURL(startUrl);
    updateGroupAddress(group, startUrl);
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    groups.delete(groupId);
    for (const profile of profiles) running.delete(profile.id);
    throw error;
  }
}

export async function launchProfile(profile: BrowserProfile): Promise<void> {
  const current = running.get(profile.id);
  if (current && !current.window.isDestroyed()) { current.window.focus(); return; }
  await openBrowserGroup([profile], false);
}

export async function launchProfilesTogether(profiles: BrowserProfile[]): Promise<void> {
  if (profiles.length < 2) throw new Error('Для мульти-режима выберите не менее двух профилей.');
  await openBrowserGroup(profiles, true);
}

export function stopProfile(id: string): void {
  const entry = running.get(id);
  if (!entry) return;
  const group = groups.get(entry.groupId);
  if (group && !group.window.isDestroyed()) group.window.close();
}

export function navigateGroup(groupId: string, value: string): void {
  const group = groups.get(groupId);
  if (!group || group.window.isDestroyed()) throw new Error('Окно группы уже закрыто.');
  const url = normalizeAddressOrSearch(value);
  group.lastSynchronizedUrl = url;
  updateGroupAddress(group, url);
  for (const { view } of group.views.values()) {
    if (!view.webContents.isDestroyed() && view.webContents.getURL() !== url) void view.webContents.loadURL(url).catch(() => undefined);
  }
}

export function backGroup(groupId: string): void {
  const group = groups.get(groupId);
  if (!group) return;
  for (const { view } of group.views.values()) if (view.webContents.canGoBack()) view.webContents.goBack();
}

export function forwardGroup(groupId: string): void {
  const group = groups.get(groupId);
  if (!group) return;
  for (const { view } of group.views.values()) if (view.webContents.canGoForward()) view.webContents.goForward();
}

export function reloadGroup(groupId: string): void {
  const group = groups.get(groupId);
  if (!group) return;
  for (const { view } of group.views.values()) view.webContents.reload();
}

export function getRunningIds(): string[] { return [...running.keys()]; }

export function installProxyAuthHandler() {
  // Register once during startup, then resolve challenges by the Session's stable partition.
  const { app } = require('electron') as typeof import('electron');
  app.on('login', (event: Electron.Event, webContents: Electron.WebContents, _details: unknown, authInfo: Electron.AuthInfo, callback: (username: string, password: string) => void) => {
    if (!authInfo.isProxy) return;
    const ses = webContents.session;
    const matching = [...proxyCredentials.entries()].find(([partition]) => {
      try { return session.fromPartition(partition, { cache: true }) === ses; } catch { return false; }
    });
    if (!matching) return;
    event.preventDefault();
    callback(matching[1].username, matching[1].password);
  });
}

export async function checkProxy(draft: ProfileDraft): Promise<{ ok: boolean; message: string }> {
  if (!draft.proxy) return { ok: false, message: 'Add proxy details before testing the connection.' };
  const { host, port, type, username, password } = draft.proxy;
  if (!host.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, message: 'Enter a valid proxy host and port.' };
  }
  const partition = `moccount-proxy-test-${crypto.randomUUID()}`;
  const ses = session.fromPartition(partition);
  try {
    const scheme = type === 'socks5' ? 'socks5' : type === 'https' ? 'https' : 'http';
    await ses.setProxy({ proxyRules: `${scheme}://${host}:${port}` });
    configureProxyAuth(ses, partition, username, password);
    // Use a temporary BrowserWindow so the app-level login event can associate
    // the proxy challenge with the test session; the request itself is bounded.
    const result = await new Promise<{ ok: boolean; message: string }>((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, message: 'Proxy test timed out.' }), 9000);
      ses.fetch('https://www.google.com/generate_204', { signal: AbortSignal.timeout(8500) })
        .then((response) => resolve(response.ok || response.status === 204
          ? { ok: true, message: 'Proxy connection succeeded.' }
          : { ok: false, message: `Proxy responded with HTTP ${response.status}.` }))
        .catch((error: unknown) => resolve({ ok: false, message: error instanceof Error ? error.message : 'Proxy connection failed.' }))
        .finally(() => clearTimeout(timer));
    });
    return result;
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Proxy connection failed.' };
  } finally {
    proxyCredentials.delete(partition);
    await ses.clearStorageData().catch(() => undefined);
    await ses.clearCache().catch(() => undefined);
  }
}

export async function clearSiteData(id: string): Promise<void> {
  const ses = session.fromPartition(partitionFor(id), { cache: true });
  await ses.clearStorageData();
  await ses.clearCache();
}
