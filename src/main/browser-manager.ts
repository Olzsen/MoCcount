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
  syncInteractions: boolean;
  initializing: boolean;
  closing: boolean;
}
const running = new Map<string, RunningProfile>();
const groups = new Map<string, BrowserGroup>();
const proxyCredentials = new Map<string, { username: string; password: string }>();

function partitionFor(id: string) { return `persist:moccount-${id}`; }

const GROUP_CONTROLLER_HTML = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MoCcount</title><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111218;color:#eef0f7;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.toolbar{height:64px;display:flex;align-items:center;gap:8px;padding:0 14px;background:#171920;border-bottom:1px solid #2d303b;box-shadow:0 3px 12px #0002}
.brand{font-weight:750;letter-spacing:-.4px;color:#a99bff;margin-right:5px;white-space:nowrap}.group-label{font-size:10px;color:#8c91a1;border:1px solid #343743;padding:5px 8px;border-radius:6px;white-space:nowrap}
button{height:34px;min-width:34px;padding:0 10px;border:1px solid #353946;border-radius:8px;background:#22252e;color:#e2e5ef;cursor:pointer;transition:background .16s,border-color .16s,transform .16s}
button:hover{background:#303441;border-color:#4a4e60}button:active{transform:scale(.97)}button:disabled{opacity:.4;cursor:default}.pane-labels{height:24px;display:flex;background:#101116;border-bottom:1px solid #2d303b;overflow:hidden;pointer-events:none}.pane-label{display:flex;align-items:center;gap:7px;flex:1;min-width:0;padding:0 10px;border-right:1px solid #2d303b;color:#a5a9b8;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pane-dot{width:6px;height:6px;flex:0 0 6px;border-radius:50%}
.address{height:36px;min-width:70px;flex:1;background:#0e1015;border:1px solid #383c49;border-radius:9px;color:#f0f1f5;padding:0 12px;font:inherit;font-size:12px;outline:none;user-select:text;-webkit-user-select:text;pointer-events:auto}
.address:focus{border-color:#9486f4;box-shadow:0 0 0 3px #9486f41c}.go{background:#9486f4;color:#171522;border-color:#a89dff;font-weight:700}.go:hover{background:#a99dfc}
@media(max-width:800px){.group-label{display:none}.brand{display:none}.toolbar{padding:0 7px;gap:5px}button{padding:0 7px}}
</style></head><body><div class="toolbar">
<span class="brand">MoCcount</span><span class="group-label" id="mode">Профиль</span>
<button id="back" title="Назад" aria-label="Назад">←</button><button id="forward" title="Вперёд" aria-label="Вперёд">→</button><button id="reload" title="Обновить" aria-label="Обновить">↻</button>
<input id="address" class="address" autocomplete="off" spellcheck="false" placeholder="Введите адрес или поисковый запрос" aria-label="Адрес или поисковый запрос">
<button id="go" class="go">Перейти</button><button id="sync-actions" style="display:none" data-enabled="false" title="Повторять клики и обычный текст во всех окнах">Действия выкл.</button>
</div><div id="pane-labels" class="pane-labels"><!--PANE_LABELS--></div><script>
const groupId = new URLSearchParams(location.search).get('group') || '';
const api = window.moccountGroup;
const address = document.getElementById('address');
const navigate = () => { const value = address.value.trim(); if(value) void api.navigate(groupId, value); };
document.getElementById('back').addEventListener('click', () => void api.back(groupId));
document.getElementById('forward').addEventListener('click', () => void api.forward(groupId));
document.getElementById('reload').addEventListener('click', () => void api.reload(groupId));
document.getElementById('go').addEventListener('click', navigate);
const syncButton = document.getElementById('sync-actions');
syncButton.addEventListener('click', async () => {
  const enabled = syncButton.dataset.enabled === 'true';
  if (!enabled && !window.confirm('Включить повторение кликов и обычного текста во всех профилях? Парольные поля не копируются. Внимание: отправка форм, покупки и удаление могут повториться в каждой сессии.')) return;
  try {
    const next = await api.setInteractionSync(groupId, !enabled);
    syncButton.dataset.enabled = String(next);
    syncButton.textContent = next ? 'Действия вкл.' : 'Действия выкл.';
  } catch { window.alert('Не удалось изменить режим синхронизации действий.'); }
});
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
}

function normalizeAddressOrSearch(value: string): string {
  const candidate = value.trim();
  if (!candidate) throw new Error('Введите адрес или поисковый запрос.');
  const looksLikeUrl = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(candidate) ||
    /^(localhost|\d{1,3}(\.\d{1,3}){3}|[^\s]+\.[^\s]+)(:\d+)?(\/.*)?$/i.test(candidate);
  if (looksLikeUrl) return safeUrl(candidate);
  return `https://www.google.com/search?q=${encodeURIComponent(candidate)}`;
}

function layoutGroup(group: BrowserGroup) {
  if (group.window.isDestroyed()) return;
  const items = [...group.views.values()];
  if (!items.length) return;
  const [width, totalHeight] = group.window.getContentSize();
  const toolbarHeight = 88;
  const visibleHeight = Math.max(120, totalHeight - toolbarHeight);
  // Keep one visible controller; follower profiles remain loaded off-screen.
  items.forEach(({ view }, index) => {
    if (index === 0) {
      view.setBounds({ x: 0, y: toolbarHeight, width, height: visibleHeight });
    } else {
      view.setBounds({ x: -10000 - index, y: toolbarHeight, width: 1, height: 1 });
    }
  });
}

function updateGroupChrome(group: BrowserGroup) {
  if (group.window.isDestroyed() || group.window.webContents.isDestroyed()) return;
  const items = [...group.views.values()];
  const columns = group.isMulti ? Math.ceil(Math.sqrt(items.length)) : 1;
  const labels = items.map(({ profile }) => {
    const color = /^#[0-9a-f]{6}$/i.test(profile.color) ? profile.color : '#9486f4';
    return `<div class="pane-label" title="${escapeHtml(profile.name)}"><span class="pane-dot" style="background:${color}"></span>${escapeHtml(profile.name)}${profile.id === items[0]?.profile.id ? ' · управляющий' : ' · фон'}</div>`;
  }).join('');
  const mode = group.isMulti ? `Управление · ${items.length}` : 'Одиночный профиль';
  const script = `const labels=document.getElementById('pane-labels'); if(labels){labels.style.gridTemplateColumns=${JSON.stringify(`repeat(${columns},minmax(0,1fr))`)}; labels.innerHTML=${JSON.stringify(labels)};} const mode=document.getElementById('mode'); if(mode) mode.textContent=${JSON.stringify(mode)}; const sync=document.getElementById('sync-actions'); if(sync){sync.style.display=${JSON.stringify(group.isMulti ? 'inline-flex' : 'none')}; sync.dataset.enabled=${JSON.stringify(String(group.syncInteractions))}; sync.textContent=${JSON.stringify(group.syncInteractions ? 'Действия вкл.' : 'Действия выкл.')};}`;
  void group.window.webContents.executeJavaScript(script).catch(() => undefined);
}

function updateGroupAddress(group: BrowserGroup, url: string) {
  if (!group.window.isDestroyed()) group.window.webContents.send('group:url', url);
}

function syncGroupNavigation(group: BrowserGroup, sourceId: string, url: string) {
  // During initial loading, each profile is allowed to follow its own redirects.
  // After startup, only the visible leader drives group navigation, preventing redirect loops.
  if (group.initializing) return;
  const leaderId = group.views.keys().next().value as string | undefined;
  if (!leaderId || sourceId !== leaderId) return;
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

function userAgentForProfile(profile: BrowserProfile, ses: Session): string {
  const custom = (profile.browser.userAgent ?? '').trim();
  if (custom) return custom;
  const selectedPlatform = profile.browser.osPlatform ?? '';
  const current = ses.getUserAgent().replace(/\sElectron\/[\d.]+/g, '');
  if (!selectedPlatform) return current;
  const chrome = process.versions.chrome || current.match(/Chrome\/([^ ]+)/)?.[1] || 'Chromium';
  const os = selectedPlatform === 'Win32'
    ? 'Windows NT 10.0; Win64; x64'
    : selectedPlatform === 'MacIntel'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
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
  const group: BrowserGroup = { id: groupId, window, views: new Map(), lastSynchronizedUrl: startUrl, isMulti, syncInteractions: false, initializing: true, closing: false };
  groups.set(groupId, group);
  window.on('resize', () => layoutGroup(group));
  window.on('closed', () => {
    for (const [id, item] of group.views) {
      running.delete(id);
      if (!item.view.webContents.isDestroyed()) item.view.webContents.close();
    }
    groups.delete(groupId);
  });

  try {
    for (const profile of profiles) {
      const partition = partitionFor(profile.id);
      const ses = session.fromPartition(partition, { cache: true });
      await configureSession(profile, partition, ses);
      const userAgent = userAgentForProfile(profile, ses);
      ses.setUserAgent(userAgent, profile.browser.locale);
      const fingerprint = Buffer.from(JSON.stringify({
        hardwareConcurrency: profile.browser.hardwareConcurrency ?? 8,
        deviceMemory: profile.browser.deviceMemory ?? 8,
        locale: profile.browser.locale,
        timezone: profile.browser.timezone,
        osPlatform: profile.browser.osPlatform ?? '',
        screenWidth: profile.browser.screenWidth ?? 0,
        screenHeight: profile.browser.screenHeight ?? 0,
        webglVendor: profile.browser.webglVendor ?? '',
        webglRenderer: profile.browser.webglRenderer ?? '',
      })).toString('base64');
      const view = new WebContentsView({
        webPreferences: {
          partition,
          preload: path.join(__dirname, '../preload/fingerprint.js'),
          additionalArguments: [`--moccount-fingerprint=${fingerprint}`, `--moccount-group=${groupId}`, `--moccount-profile=${profile.id}`],
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

    const columns = isMulti ? Math.ceil(Math.sqrt(profiles.length)) : 1;
    const paneLabels = profiles.map((profile) => {
      const color = /^#[0-9a-f]{6}$/i.test(profile.color) ? profile.color : '#9486f4';
      return `<div class="pane-label" title="${escapeHtml(profile.name)}"><span class="pane-dot" style="background:${color}"></span>${escapeHtml(profile.name)}</div>`;
    }).join('');
    const controllerHtml = GROUP_CONTROLLER_HTML
      .replace("const groupId = new URLSearchParams(location.search).get('group') || '';", `const groupId = '${groupId}';`)
      .replace('id="mode">Профиль', `id="mode">${isMulti ? `Управление · ${profiles.length}` : 'Одиночный профиль'}`)
      .replace('id="sync-actions" style="display:none"', `id="sync-actions" style="display:${isMulti ? 'inline-flex' : 'none'}"`)
      .replace('id="pane-labels" class="pane-labels"><!--PANE_LABELS-->', `id="pane-labels" class="pane-labels" style="grid-template-columns:repeat(${columns},minmax(0,1fr))">${paneLabels}`);
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(controllerHtml)}`);
    layoutGroup(group);
    // Load each isolated session independently. ERR_ABORTED is common when a
    // navigation is superseded/redirected; it must not tear down the whole group.
    const results = await Promise.all([...group.views.values()].map(async ({ view }) => {
      try {
        await view.webContents.loadURL(startUrl);
        return null;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('ERR_ABORTED') || view.webContents.isDestroyed()) return null;
        return message;
      }
    }));
    const failures = results.filter((message): message is string => Boolean(message));
    if (failures.length === group.views.size) {
      throw new Error(`Не удалось загрузить страницу ни в одном профиле: ${failures[0]}`);
    }
    group.initializing = false;
    const leader = group.views.values().next().value as GroupView | undefined;
    const actualUrl = leader?.view.webContents.getURL() || startUrl;
    group.lastSynchronizedUrl = actualUrl;
    updateGroupAddress(group, actualUrl);
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
  if (!group || group.window.isDestroyed() || group.closing) return;
  const item = group.views.get(id);
  if (!item) { running.delete(id); return; }
  group.window.contentView.removeChildView(item.view);
  group.views.delete(id);
  running.delete(id);
  if (!item.view.webContents.isDestroyed()) item.view.webContents.close();
  if (!group.views.size) {
    group.closing = true;
    group.window.close();
    return;
  }
  group.isMulti = group.views.size > 1;
  if (!group.isMulti) group.syncInteractions = false;
  const remaining = [...group.views.values()].map((view) => view.profile.name);
  group.window.setTitle(group.isMulti ? `MoCcount — Управление (${group.views.size})` : `MoCcount — ${remaining[0]}`);
  layoutGroup(group);
  updateGroupChrome(group);
}

export function setGroupInteractionSync(groupId: string, enabled: boolean): boolean {
  const group = groups.get(groupId);
  if (!group || group.closing || !group.isMulti || group.views.size < 2) return false;
  group.syncInteractions = enabled;
  return group.syncInteractions;
}

export function relayGroupInteraction(groupId: string, profileId: string, senderWebContentsId: number, value: unknown): void {
  const group = groups.get(groupId);
  if (!group || !group.syncInteractions || group.closing || !group.isMulti) return;
  const source = group.views.get(profileId);
  if (!source || source.view.webContents.isDestroyed() || source.view.webContents.id !== senderWebContentsId) return;
  if (!value || typeof value !== 'object') return;
  const action = value as { kind?: unknown; selector?: unknown; value?: unknown };
  if (typeof action.selector !== 'string' || !action.selector.trim() || action.selector.length > 1200) return;
  if (action.kind !== 'click' && action.kind !== 'value') return;
  if (action.kind === 'value' && (typeof action.value !== 'string' || action.value.length > 8000)) return;
  const selector = JSON.stringify(action.selector);
  let script: string;
  if (action.kind === 'click') {
    script = `(() => { const target=document.querySelector(${selector}); if(!(target instanceof HTMLElement) || target.hasAttribute('disabled') || target.getAttribute('aria-disabled')==='true') return; if(target instanceof HTMLInputElement && ['password','file','hidden'].includes(target.type)) return; target.click(); })()`;
  } else {
    const valueJson = JSON.stringify(action.value);
    script = `(() => { const target=document.querySelector(${selector}); if(!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return; if(target instanceof HTMLInputElement && ['password','file','hidden','checkbox','radio'].includes(target.type)) return; const descriptor=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target),'value'); if(descriptor?.set) descriptor.set.call(target,${valueJson}); else target.value=${valueJson}; target.dispatchEvent(new Event('input',{bubbles:true,composed:true})); if(target instanceof HTMLSelectElement) target.dispatchEvent(new Event('change',{bubbles:true,composed:true})); })()`;
  }
  for (const [id, item] of group.views) {
    if (id === profileId || item.view.webContents.isDestroyed()) continue;
    void item.view.webContents.executeJavaScript(script).catch(() => undefined);
  }
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
  const first = group.views.values().next().value as GroupView | undefined;
  if (first?.view.webContents.canGoBack()) first.view.webContents.goBack();
}

export function forwardGroup(groupId: string): void {
  const group = groups.get(groupId);
  if (!group) return;
  const first = group.views.values().next().value as GroupView | undefined;
  if (first?.view.webContents.canGoForward()) first.view.webContents.goForward();
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
