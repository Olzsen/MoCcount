import { BrowserWindow, WebContentsView, session, Session } from 'electron';
import path from 'node:path';
import { BrowserProfile, ProfileDraft } from '../shared/types';

interface RunningProfile { window: BrowserWindow; session: Session; view: WebContentsView; groupId: string }
interface BrowserTab { id: string; view: WebContentsView; url: string; title: string; loading: boolean }
interface GroupView { profile: BrowserProfile; session: Session; view: WebContentsView; tabs: BrowserTab[]; activeTabId: string; fingerprint: string }
interface BrowserGroup {
  id: string;
  window: BrowserWindow;
  views: Map<string, GroupView>;
  lastSynchronizedUrl: string;
  isMulti: boolean;
  layoutMode: 'tiled' | 'focus';
  alwaysOnTop: boolean;
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
.global-bar{height:48px;display:flex;align-items:center;gap:8px;padding:0 148px 0 12px;background:#171920;border-bottom:1px solid #2d303b;box-shadow:0 3px 12px #0002;-webkit-app-region:drag;app-region:drag}
.brand{font-weight:800;letter-spacing:-.4px;color:#a99bff;white-space:nowrap}.group-label{font-size:10px;color:#8c91a1;border:1px solid #343743;padding:5px 8px;border-radius:6px;white-space:nowrap}
button{height:30px;min-width:29px;padding:0 8px;border:1px solid #353946;border-radius:7px;background:#22252e;color:#e2e5ef;cursor:pointer;transition:background .16s,border-color .16s,transform .16s;flex-shrink:0;-webkit-app-region:no-drag;app-region:no-drag}
button:hover{background:#303441;border-color:#4a4e60}button:active{transform:scale(.97)}button:disabled{opacity:.4;cursor:default}
.global-action{height:29px;font-size:10px;white-space:nowrap}.global-action.active{color:#9be0bd;border-color:#3a6b54;background:#1b3028}
.profile-tabs{height:38px;display:none;align-items:center;gap:5px;padding:0 8px;background:#111319;border-bottom:1px solid #2d303b;overflow:hidden;-webkit-app-region:drag;app-region:drag}
body.with-tabs .profile-tabs{display:flex}
.profile-tab{height:28px;min-width:48px;max-width:240px;display:flex;align-items:center;gap:7px;padding:0 7px;background:#1c1f27;border:1px solid #303440;border-bottom-color:#3a3d4a;border-radius:7px 7px 0 0;font-size:11px;flex:0 1 190px;overflow:hidden;cursor:pointer;-webkit-app-region:no-drag;app-region:no-drag}
.profile-tab.active{background:#252331;border-color:#62578a;color:#eeeaff}
.profile-tab-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;text-align:left}
.profile-tab-close{min-width:20px;width:20px;height:20px;padding:0;border-color:transparent;background:transparent;color:#8e93a4;line-height:1;flex-shrink:0}
.profile-tab-close:hover{color:#fff;background:#4a3036;border-color:#68434a}
.profile-tab-add{height:26px;min-width:27px;padding:0 7px;border-radius:6px;color:#bcb4fa;font-size:17px;line-height:1}
body.with-tabs .profile-tiles{height:calc(100vh - 86px)}
.profile-tiles{height:calc(100vh - 48px);display:grid;overflow:hidden;background:#0d0f14}
.profile-pane{min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;border-right:1px solid #2c2f39;border-bottom:1px solid #2c2f39}
.pane-toolbar{height:42px;min-height:42px;display:flex;align-items:center;gap:5px;padding:0 7px;background:#171920;border-bottom:1px solid #343744}
.pane-title{max-width:104px;min-width:30px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#b5b9c8;font-size:10px;flex-shrink:1}
.pane-dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:5px;vertical-align:middle}
.address{height:29px;min-width:35px;flex:1;background:#0e1015;border:1px solid #383c49;border-radius:7px;color:#f0f1f5;padding:0 8px;font:inherit;font-size:10px;outline:none;user-select:text;-webkit-user-select:text;pointer-events:auto}
.address:focus{border-color:#9486f4;box-shadow:0 0 0 2px #9486f41c}
.go{background:#9486f4;color:#171522;border-color:#a89dff;font-weight:700;font-size:10px}.go:hover{background:#a99dfc}
.tiles-status{height:19px;padding:3px 7px;color:#747988;background:#121319;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media(max-width:860px){.pane-title{display:none}.global-bar{gap:5px;padding:0 148px 0 6px}.brand{display:none}.profile-tabs{gap:3px;padding:0 4px}.profile-tab{flex-basis:130px;max-width:180px}.pane-toolbar{gap:3px;padding:0 3px}button{min-width:25px;padding:0 5px}.global-action{font-size:9px}}
</style></head><body>
<div class="global-bar"><span class="brand">MoCcount</span><span class="group-label" id="mode">Мульти-запуск</span><button class="global-action" id="pin-window" title="Закрепить окно поверх остальных">Закрепить</button><button class="global-action" id="sync-actions" data-enabled="false" title="Повторять действия во всех профилях">Действия выкл.</button></div>
<div id="profile-tabs" class="profile-tabs" aria-label="Вкладки браузера"></div><div id="profile-tiles" class="profile-tiles"></div>
<script>
const groupId = new URLSearchParams(location.search).get('group') || '';
const api = window.moccountGroup;
const tiles = document.getElementById('profile-tiles');
const tabStrip = document.getElementById('profile-tabs');
const modeLabel = document.getElementById('mode');
const syncButton = document.getElementById('sync-actions');
const pinButton = document.getElementById('pin-window');

window.renderProfiles = (profiles, layoutMode, alwaysOnTop, syncEnabled, tabs) => {
  const showTabs = profiles.length === 1 && layoutMode === 'focus';
  document.body.classList.toggle('with-tabs', showTabs);
  tabStrip.innerHTML = '';
  if (showTabs && profiles[0]) {
    tabs.forEach((tab) => {
      const button = document.createElement('div');
      button.className = 'profile-tab' + (tab.active ? ' active' : '');
      button.dataset.tabAction = 'select';
      button.dataset.tabId = tab.id;
      button.title = tab.url || tab.title;
      button.setAttribute('role', 'tab');
      button.tabIndex = 0;
      button.setAttribute('aria-label', tab.title || 'Вкладка');
      const label = document.createElement('span');
      label.className = 'profile-tab-label';
      label.textContent = (tab.loading ? '◌ ' : '') + (tab.title || 'Новая вкладка');
      button.append(label);
      if (tabs.length > 1) {
        const close = document.createElement('button');
        close.className = 'profile-tab-close';
        close.dataset.tabAction = 'close';
        close.dataset.tabId = tab.id;
        close.type = 'button';
        close.textContent = '×';
        close.title = 'Закрыть вкладку';
        close.setAttribute('aria-label', 'Закрыть вкладку');
        button.append(close);
      }
      tabStrip.append(button);
    });
    const add = document.createElement('button');
    add.className = 'profile-tab-add';
    add.dataset.tabAction = 'new';
    add.textContent = '+';
    add.title = 'Новая вкладка';
    add.setAttribute('aria-label', 'Новая вкладка');
    tabStrip.append(add);
  }
  modeLabel.textContent = layoutMode === 'tiled' ? 'Плитки · ' + profiles.length : 'Управление · ' + profiles.length;
  pinButton.textContent = alwaysOnTop ? 'Закреплено ✓' : 'Закрепить';
  pinButton.classList.toggle('active', !!alwaysOnTop);
  syncButton.dataset.enabled = String(!!syncEnabled);
  syncButton.textContent = syncEnabled ? 'Действия вкл.' : 'Действия выкл.';
  syncButton.style.display = profiles.length > 1 ? 'inline-flex' : 'none';
  tiles.style.gridTemplateColumns = layoutMode === 'tiled' ? 'repeat(' + Math.ceil(Math.sqrt(profiles.length)) + ',minmax(0,1fr))' : 'minmax(0,1fr)';
  tiles.style.gridTemplateRows = layoutMode === 'tiled' ? 'repeat(' + Math.ceil(profiles.length / Math.ceil(Math.sqrt(profiles.length))) + ',minmax(0,1fr))' : 'minmax(0,1fr)';
  tiles.innerHTML = '';
  profiles.forEach((profile) => {
    const pane = document.createElement('section');
    pane.className = 'profile-pane';
    pane.dataset.profileId = profile.id;
    if (layoutMode === 'focus' && !profile.leader) pane.style.display = 'none';
    const toolbar = document.createElement('div');
    toolbar.className = 'pane-toolbar';
    const title = document.createElement('span');
    title.className = 'pane-title';
    const dot = document.createElement('span');
    dot.className = 'pane-dot';
    dot.style.background = profile.color || '#9486f4';
    title.append(dot, document.createTextNode(profile.name));
    const makeButton = (action, text, titleText) => {
      const button = document.createElement('button');
      button.dataset.action = action;
      button.title = titleText;
      button.setAttribute('aria-label', titleText);
      button.textContent = text;
      return button;
    };
    toolbar.append(title, makeButton('back', '←', 'Назад'), makeButton('forward', '→', 'Вперёд'), makeButton('reload', '↻', 'Обновить'));
    const address = document.createElement('input');
    address.className = 'address';
    address.dataset.address = 'true';
    address.type = 'text';
    address.autocomplete = 'off';
    address.spellcheck = false;
    address.setAttribute('aria-label', 'Адрес или поисковый запрос — ' + profile.name);
    address.placeholder = 'Адрес или поисковый запрос';
    address.value = profile.url || '';
    toolbar.append(address, makeButton('go', '↵', 'Перейти'));
    toolbar.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      if (action === 'go') {
        if (address.value.trim()) void api.navigate(groupId, profile.id, address.value);
      } else if (action === 'back') void api.back(groupId, profile.id);
      else if (action === 'forward') void api.forward(groupId, profile.id);
      else if (action === 'reload') void api.reload(groupId, profile.id);
    });
    address.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (address.value.trim()) void api.navigate(groupId, profile.id, address.value);
      }
    });
    const status = document.createElement('div');
    status.className = 'tiles-status';
    status.textContent = profile.status || 'Готов';
    pane.append(toolbar, status);
    tiles.append(pane);
  });
};

pinButton.addEventListener('click', async () => {
  try {
    const next = await api.toggleAlwaysOnTop(groupId);
    pinButton.textContent = next ? 'Закреплено ✓' : 'Закрепить';
    pinButton.classList.toggle('active', next);
  } catch { window.alert('Не удалось изменить закрепление окна.'); }
});
syncButton.addEventListener('click', async () => {
  const enabled = syncButton.dataset.enabled === 'true';
  if (!enabled && !window.confirm('Включить повторение кликов и обычного текста во всех профилях? Парольные поля не копируются. Отправка форм и покупки могут повториться в каждой сессии.')) return;
  try {
    const next = await api.setInteractionSync(groupId, !enabled);
    syncButton.dataset.enabled = String(next);
    syncButton.textContent = next ? 'Действия вкл.' : 'Действия выкл.';
    syncButton.classList.toggle('active', next);
  } catch { window.alert('Не удалось изменить синхронизацию действий.'); }
});
tabStrip.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tab-action]');
  if (!button) return;
  const action = button.dataset.tabAction;
  const tabId = button.dataset.tabId;
  if (action === 'new') void api.openTab(groupId).catch((error) => window.alert(error instanceof Error ? error.message : 'Не удалось открыть вкладку.'));
  else if (action === 'select' && tabId) void api.selectTab(groupId, tabId);
  else if (action === 'close' && tabId) void api.closeTab(groupId, tabId);
});
api.onUrlChange(({ profileId, url }) => {
  const pane = tiles.querySelector('[data-profile-id="' + CSS.escape(profileId) + '"]');
  const address = pane && pane.querySelector('input[data-address]');
  if (address && document.activeElement !== address) address.value = url;
});
const initialProfiles = /*PANE_CONFIG*/;
window.renderProfiles(initialProfiles, /*LAYOUT_MODE*/, /*PINNED*/, false, /*TAB_CONFIG*/);
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
  const globalToolbarHeight = 48;
  const tabsToolbarHeight = group.views.size === 1 && group.layoutMode === 'focus' ? 38 : 0;
  const paneToolbarHeight = 42;
  const contentHeight = Math.max(150, totalHeight - globalToolbarHeight - tabsToolbarHeight);
  const viewY = globalToolbarHeight + tabsToolbarHeight + paneToolbarHeight;
  const hideView = (view: WebContentsView, index: number) => {
    if (!view.webContents.isDestroyed()) view.setBounds({ x: -10000 - index, y: viewY, width: 1, height: 1 });
  };
  let hiddenIndex = 0;
  for (const item of items) {
    for (const tab of item.tabs) {
      if (tab.view !== item.view) hideView(tab.view, hiddenIndex++);
    }
  }

  if (group.layoutMode === 'focus') {
    items.forEach(({ view }, index) => {
      if (index === 0) view.setBounds({ x: 0, y: viewY, width, height: Math.max(100, totalHeight - viewY) });
      else hideView(view, hiddenIndex++);
    });
    return;
  }

  const columns = Math.ceil(Math.sqrt(items.length));
  const rows = Math.ceil(items.length / columns);
  const cellWidth = Math.floor(width / columns);
  const cellHeight = Math.floor(contentHeight / rows);
  items.forEach(({ view }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * cellWidth;
    const y = globalToolbarHeight + row * cellHeight + paneToolbarHeight;
    const actualWidth = column === columns - 1 ? width - x : cellWidth;
    const actualHeight = row === rows - 1
      ? totalHeight - (globalToolbarHeight + row * cellHeight) - paneToolbarHeight
      : cellHeight - paneToolbarHeight;
    view.setBounds({ x, y, width: Math.max(120, actualWidth), height: Math.max(100, actualHeight) });
  });
}

function groupPaneConfig(group: BrowserGroup) {
  const leaderId = group.views.keys().next().value as string | undefined;
  return [...group.views.entries()].map(([id, { profile, view }]) => ({
    id,
    name: profile.name,
    color: profile.color,
    url: view.webContents.isDestroyed() ? profile.browser.startUrl : (view.webContents.getURL() || profile.browser.startUrl),
    status: view.webContents.isLoading() ? 'Загрузка…' : 'Готов',
    leader: id === leaderId,
  }));
}

function groupTabConfig(group: BrowserGroup) {
  if (group.views.size !== 1 || group.layoutMode !== 'focus') return [];
  const item = group.views.values().next().value as GroupView | undefined;
  if (!item) return [];
  return item.tabs.map((tab) => ({
    id: tab.id,
    title: tab.title || 'Новая вкладка',
    url: tab.view.webContents.isDestroyed() ? tab.url : (tab.view.webContents.getURL() || tab.url),
    active: tab.id === item.activeTabId,
    loading: tab.loading,
  }));
}

function updateGroupChrome(group: BrowserGroup) {
  if (group.window.isDestroyed() || group.window.webContents.isDestroyed()) return;
  const config = JSON.stringify(groupPaneConfig(group)).replace(/</g, '\\u003c');
  const tabs = JSON.stringify(groupTabConfig(group)).replace(/</g, '\\u003c');
  const script = `window.renderProfiles(${config}, ${JSON.stringify(group.layoutMode)}, ${JSON.stringify(group.alwaysOnTop)}, ${JSON.stringify(group.syncInteractions)}, ${tabs});`;
  void group.window.webContents.executeJavaScript(script).catch(() => undefined);
}

function updateGroupAddress(group: BrowserGroup, profileId: string, url: string) {
  if (!group.window.isDestroyed() && !group.window.webContents.isDestroyed()) {
    group.window.webContents.send('group:url', { profileId, url });
  }
}

function syncGroupNavigation(group: BrowserGroup, sourceId: string, url: string) {
  if (group.initializing || group.closing) return;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
  updateGroupAddress(group, sourceId, url);

  const shouldSyncNavigation = group.layoutMode === 'focus' || group.syncInteractions;
  if (!shouldSyncNavigation) return;
  if (url === group.lastSynchronizedUrl && [...group.views.values()].every((item) => item.view.webContents.getURL() === url)) return;
  group.lastSynchronizedUrl = url;
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

function fingerprintForProfile(profile: BrowserProfile): string {
  return Buffer.from(JSON.stringify({
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
}

function createProfileView(profile: BrowserProfile, partition: string, groupId: string, fingerprint: string): WebContentsView {
  return new WebContentsView({
    webPreferences: {
      partition,
      preload: path.join(__dirname, '../preload/fingerprint.js'),
      additionalArguments: [`--moccount-fingerprint=${fingerprint}`, `--moccount-group=${groupId}`, `--moccount-profile=${profile.id}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
}

function attachTabEvents(group: BrowserGroup, profileId: string, tab: BrowserTab): void {
  const refreshTab = (url?: string) => {
    if (tab.view.webContents.isDestroyed()) return;
    tab.url = url || tab.view.webContents.getURL() || tab.url;
    const currentTitle = tab.view.webContents.getTitle().trim();
    tab.title = tab.url === 'about:blank' ? 'Новая вкладка' : (currentTitle || tab.url);
    tab.loading = tab.view.webContents.isLoading();
    const item = group.views.get(profileId);
    if (item?.activeTabId === tab.id) syncGroupNavigation(group, profileId, tab.url);
    updateGroupChrome(group);
  };
  tab.view.webContents.on('did-navigate', (_event, url) => refreshTab(url));
  tab.view.webContents.on('did-navigate-in-page', (_event, url) => refreshTab(url));
  tab.view.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta)) return;
    const key = input.key.toLowerCase();
    const item = group.views.get(profileId);
    if (!item || item.activeTabId !== tab.id) return;
    if (key === 't') {
      event.preventDefault();
      void openGroupTab(group.id).catch(() => undefined);
    } else if (key === 'w') {
      event.preventDefault();
      closeGroupTab(group.id, tab.id);
    } else if (key === 'tab') {
      event.preventDefault();
      const current = item.tabs.findIndex((candidate) => candidate.id === tab.id);
      const step = input.shift ? -1 : 1;
      const next = item.tabs[(current + step + item.tabs.length) % item.tabs.length];
      if (next) selectGroupTab(group.id, next.id);
    }
  });
  tab.view.webContents.on('did-start-loading', () => { tab.loading = true; updateGroupChrome(group); });
  tab.view.webContents.on('did-stop-loading', () => refreshTab());
  tab.view.webContents.on('page-title-updated', (_event, title) => {
    tab.title = title.trim() || tab.url || 'Новая вкладка';
    updateGroupChrome(group);
    const item = group.views.get(profileId);
    if (item?.activeTabId === tab.id && group.views.size === 1) group.window.setTitle(`MoCcount — ${tab.title}`);
  });
}

async function openBrowserGroup(profiles: BrowserProfile[], layoutMode: 'tiled' | 'focus'): Promise<void> {
  if (!profiles.length) throw new Error('Выберите хотя бы один профиль.');
  const isMulti = profiles.length > 1;
  const alreadyRunning = profiles.filter((p) => running.has(p.id));
  if (alreadyRunning.length) {
    const first = running.get(alreadyRunning[0].id);
    first?.window.focus();
    throw new Error(`Сначала остановите уже запущенные профили: ${alreadyRunning.map((p) => p.name).join(', ')}.`);
  }
  const groupId = crypto.randomUUID();
  const startUrl = safeUrl(profiles[0].browser.startUrl);
  const window = new BrowserWindow({
    width: layoutMode === 'tiled' ? Math.max(1440, ...profiles.map((p) => p.browser.width)) : (isMulti ? 1440 : profiles[0].browser.width),
    height: layoutMode === 'tiled' ? Math.max(900, ...profiles.map((p) => p.browser.height)) : (isMulti ? 900 : profiles[0].browser.height),
    minWidth: layoutMode === 'tiled' ? 900 : 600,
    minHeight: layoutMode === 'tiled' ? 620 : 480,
    title: isMulti ? `MoCcount — ${layoutMode === 'tiled' ? 'Плитки' : 'Управление'} (${profiles.length})` : `MoCcount — ${profiles[0].name}`,
    backgroundColor: '#111218',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(process.platform !== 'darwin' ? {
      titleBarOverlay: {
        color: '#171920',
        symbolColor: '#eef0f7',
        height: 36,
      },
    } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/group-controller.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const group: BrowserGroup = {
    id: groupId,
    window,
    views: new Map(),
    lastSynchronizedUrl: startUrl,
    isMulti,
    layoutMode,
    alwaysOnTop: false,
    syncInteractions: false,
    initializing: true,
    closing: false,
  };
  groups.set(groupId, group);
  window.on('resize', () => layoutGroup(group));
  window.on('closed', () => {
    for (const [id, item] of group.views) {
      running.delete(id);
      for (const tab of item.tabs) {
        if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
      }
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
      const fingerprint = fingerprintForProfile(profile);
      const view = createProfileView(profile, partition, groupId, fingerprint);
      const tab: BrowserTab = {
        id: crypto.randomUUID(),
        view,
        url: safeUrl(profile.browser.startUrl),
        title: profile.name,
        loading: true,
      };
      const entry: GroupView = { profile, session: ses, view, tabs: [tab], activeTabId: tab.id, fingerprint };
      group.views.set(profile.id, entry);
      window.contentView.addChildView(view);
      running.set(profile.id, { window, session: ses, view, groupId });
      attachTabEvents(group, profile.id, tab);
    }

    const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
    const controllerHtml = GROUP_CONTROLLER_HTML
      .replace("const groupId = new URLSearchParams(location.search).get('group') || '';", `const groupId = '${groupId}';`)
      .replace('const initialProfiles = /*PANE_CONFIG*/;', `const initialProfiles = ${safeJson(groupPaneConfig(group))};`)
      .replace('/*LAYOUT_MODE*/', JSON.stringify(layoutMode))
      .replace('/*PINNED*/', 'false')
      .replace('/*TAB_CONFIG*/', safeJson(groupTabConfig(group)));
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(controllerHtml)}`);
    layoutGroup(group);

    const results = await Promise.all([...group.views.entries()].map(async ([id, { profile, view }]) => {
      const targetUrl = layoutMode === 'tiled' ? safeUrl(profile.browser.startUrl) : startUrl;
      try {
        await view.webContents.loadURL(targetUrl);
        return { id, error: null as string | null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('ERR_ABORTED') || view.webContents.isDestroyed()) return { id, error: null };
        return { id, error: message };
      }
    }));
    const failures = results.filter((result) => result.error);
    if (failures.length === group.views.size) {
      throw new Error(`Не удалось загрузить страницы профилей: ${failures[0].error}`);
    }

    group.initializing = false;
    const leaderId = group.views.keys().next().value as string | undefined;
    const leader = group.views.values().next().value as GroupView | undefined;
    const actualUrl = leader?.view.webContents.getURL() || startUrl;
    group.lastSynchronizedUrl = actualUrl;
    if (layoutMode === 'focus') {
      for (const [id, item] of group.views) {
        if (id === leaderId || item.view.webContents.isDestroyed()) continue;
        if (item.view.webContents.getURL() !== actualUrl) void item.view.webContents.loadURL(actualUrl).catch(() => undefined);
      }
    }
    for (const [id, item] of group.views) {
      const url = item.view.webContents.getURL() || item.profile.browser.startUrl;
      updateGroupAddress(group, id, url);
    }
    updateGroupChrome(group);
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    groups.delete(groupId);
    for (const profile of profiles) running.delete(profile.id);
    throw error;
  }
}

export async function openGroupTab(groupId: string): Promise<boolean> {
  const group = groups.get(groupId);
  if (!group || group.window.isDestroyed() || group.closing) throw new Error('Окно профиля уже закрыто.');
  if (group.views.size !== 1 || group.layoutMode !== 'focus') throw new Error('Вкладки доступны в окне отдельного профиля.');
  const item = group.views.values().next().value as GroupView | undefined;
  if (!item) throw new Error('Профиль не найден.');
  if (item.tabs.length >= 32) throw new Error('В одном профиле можно открыть не более 32 вкладок.');

  const tab: BrowserTab = {
    id: crypto.randomUUID(),
    view: createProfileView(item.profile, partitionFor(item.profile.id), groupId, item.fingerprint),
    url: 'about:blank',
    title: 'Новая вкладка',
    loading: false,
  };
  item.tabs.push(tab);
  item.activeTabId = tab.id;
  item.view = tab.view;
  group.window.contentView.addChildView(tab.view);
  running.set(item.profile.id, { window: group.window, session: item.session, view: tab.view, groupId });
  attachTabEvents(group, item.profile.id, tab);
  layoutGroup(group);
  updateGroupChrome(group);
  void tab.view.webContents.loadURL('about:blank').catch(() => undefined);
  group.window.setTitle('MoCcount — Новая вкладка');
  return true;
}

export function selectGroupTab(groupId: string, tabId: string): boolean {
  const group = groups.get(groupId);
  if (!group || group.window.isDestroyed() || group.closing || group.views.size !== 1 || group.layoutMode !== 'focus') return false;
  const item = group.views.values().next().value as GroupView | undefined;
  const tab = item?.tabs.find((candidate) => candidate.id === tabId);
  if (!item || !tab || tab.view.webContents.isDestroyed()) return false;
  item.activeTabId = tab.id;
  item.view = tab.view;
  running.set(item.profile.id, { window: group.window, session: item.session, view: tab.view, groupId });
  group.lastSynchronizedUrl = tab.view.webContents.getURL();
  layoutGroup(group);
  updateGroupChrome(group);
  updateGroupAddress(group, item.profile.id, tab.view.webContents.getURL() || tab.url);
  group.window.setTitle(`MoCcount — ${tab.title || item.profile.name}`);
  return true;
}

export function closeGroupTab(groupId: string, tabId: string): boolean {
  const group = groups.get(groupId);
  if (!group || group.window.isDestroyed() || group.closing || group.views.size !== 1 || group.layoutMode !== 'focus') return false;
  const item = group.views.values().next().value as GroupView | undefined;
  if (!item || item.tabs.length <= 1) return false;
  const index = item.tabs.findIndex((candidate) => candidate.id === tabId);
  if (index < 0) return false;
  const [tab] = item.tabs.splice(index, 1);
  group.window.contentView.removeChildView(tab.view);
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  if (item.activeTabId === tab.id) {
    const next = item.tabs[Math.min(index, item.tabs.length - 1)];
    item.activeTabId = next.id;
    item.view = next.view;
    running.set(item.profile.id, { window: group.window, session: item.session, view: next.view, groupId });
    group.lastSynchronizedUrl = next.view.webContents.getURL();
  }
  layoutGroup(group);
  updateGroupChrome(group);
  updateGroupAddress(group, item.profile.id, item.view.webContents.getURL() || 'about:blank');
  const active = item.tabs.find((candidate) => candidate.id === item.activeTabId);
  group.window.setTitle(`MoCcount — ${active?.title || item.profile.name}`);
  return true;
}

export async function launchProfile(profile: BrowserProfile): Promise<void> {
  const current = running.get(profile.id);
  if (current && !current.window.isDestroyed()) { current.window.focus(); return; }
  await openBrowserGroup([profile], 'focus');
}

export async function launchProfilesTogether(profiles: BrowserProfile[], layoutMode: 'tiled' | 'focus' = 'focus'): Promise<void> {
  if (profiles.length < 2) throw new Error('Для мульти-режима выберите не менее двух профилей.');
  await openBrowserGroup(profiles, layoutMode);
}

export function stopProfile(id: string): void {
  const entry = running.get(id);
  if (!entry) return;
  const group = groups.get(entry.groupId);
  if (!group || group.window.isDestroyed() || group.closing) return;
  const item = group.views.get(id);
  if (!item) { running.delete(id); return; }
  group.views.delete(id);
  running.delete(id);
  for (const tab of item.tabs) {
    group.window.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  }
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

export function navigateGroup(groupId: string, profileId: string, value: string): void {
  const group = groups.get(groupId);
  if (!group || group.window.isDestroyed()) throw new Error('Окно группы уже закрыто.');
  const target = group.views.get(profileId);
  if (!target) throw new Error('Профиль больше не запущен в этом окне.');
  const url = normalizeAddressOrSearch(value);
  const targets = group.layoutMode === 'focus' || group.syncInteractions
    ? [...group.views.values()]
    : [target];
  group.lastSynchronizedUrl = url;
  for (const item of targets) {
    if (!item.view.webContents.isDestroyed() && item.view.webContents.getURL() !== url) {
      void item.view.webContents.loadURL(url).catch(() => undefined);
    }
  }
}

export function backGroup(groupId: string, profileId: string): void {
  const group = groups.get(groupId);
  const target = group?.views.get(profileId);
  if (!group || !target) return;
  const items = group.layoutMode === 'focus' || group.syncInteractions ? [...group.views.values()] : [target];
  for (const item of items) if (!item.view.webContents.isDestroyed() && item.view.webContents.canGoBack()) item.view.webContents.goBack();
}

export function forwardGroup(groupId: string, profileId: string): void {
  const group = groups.get(groupId);
  const target = group?.views.get(profileId);
  if (!group || !target) return;
  const items = group.layoutMode === 'focus' || group.syncInteractions ? [...group.views.values()] : [target];
  for (const item of items) if (!item.view.webContents.isDestroyed() && item.view.webContents.canGoForward()) item.view.webContents.goForward();
}

export function reloadGroup(groupId: string, profileId: string): void {
  const group = groups.get(groupId);
  const target = group?.views.get(profileId);
  if (!group || !target) return;
  const items = group.layoutMode === 'focus' || group.syncInteractions ? [...group.views.values()] : [target];
  for (const item of items) if (!item.view.webContents.isDestroyed()) item.view.webContents.reload();
}

export function toggleGroupAlwaysOnTop(groupId: string): boolean {
  const group = groups.get(groupId);
  if (!group || group.window.isDestroyed()) throw new Error('Окно группы уже закрыто.');
  group.alwaysOnTop = !group.alwaysOnTop;
  group.window.setAlwaysOnTop(group.alwaysOnTop);
  return group.alwaysOnTop;
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
