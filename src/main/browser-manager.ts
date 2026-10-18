import { BrowserWindow, session, Session } from 'electron';
import { BrowserProfile, ProfileDraft } from '../shared/types';

interface RunningProfile { window: BrowserWindow; session: Session }
const running = new Map<string, RunningProfile>();
const proxyCredentials = new Map<string, { username: string; password: string }>();

function partitionFor(id: string) { return `persist:moccount-${id}`; }
const browserToolbarScript = String.raw`(() => {
  if (document.getElementById('moccount-toolbar-host')) return;
  const host = document.createElement('div');
  host.id = 'moccount-toolbar-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = ":host{all:initial;position:fixed;z-index:2147483647;top:0;left:0;right:0;height:48px;display:block;font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e8eaf0} .bar{height:48px;box-sizing:border-box;display:flex;align-items:center;gap:7px;padding:0 12px;background:#171920;border-bottom:1px solid #343744;box-shadow:0 2px 10px #0005}button{height:30px;min-width:30px;border:1px solid #363a46;border-radius:7px;background:#222630;color:#dfe2eb;font-size:16px;cursor:pointer}button:hover{background:#303544}.address{height:30px;box-sizing:border-box;flex:1;min-width:40px;border:1px solid #393d4a;border-radius:8px;background:#0f1116;color:#f0f1f5;padding:0 11px;outline:none;font:12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.address:focus{border-color:#9285f6}.brand{font-weight:700;color:#a99bff;white-space:nowrap;padding:0 3px}.go{background:#8e80ef;color:#151321;border-color:#a99dff;font-weight:700;padding:0 12px}";
  const bar = document.createElement('div'); bar.className = 'bar';
  const brand = document.createElement('span'); brand.className = 'brand'; brand.textContent = 'MoCcount';
  const back = document.createElement('button'); back.title = 'Назад'; back.textContent = '‹';
  const forward = document.createElement('button'); forward.title = 'Вперёд'; forward.textContent = '›';
  const reload = document.createElement('button'); reload.title = 'Обновить'; reload.textContent = '↻';
  const address = document.createElement('input'); address.className = 'address'; address.type = 'text'; address.setAttribute('aria-label', 'Адрес или поисковый запрос'); address.placeholder = 'Введите адрес или поисковый запрос';
  const go = document.createElement('button'); go.className = 'go'; go.textContent = 'Перейти';
  const navigate = () => { const value = address.value.trim(); if (!value) return; let target; if (/^[a-zA-Z][a-zA-Z\\d+.-]*:/.test(value)) target = value; else if (/^(localhost|\\d{1,3}(\\.\\d{1,3}){3}|[^\\s]+\\.[^\\s]+)(:\\d+)?(\\/.*)?$/i.test(value)) target = 'https://' + value; else target = 'https://www.google.com/search?q=' + encodeURIComponent(value); try { const parsed = new URL(target); if (parsed.protocol === 'http:' || parsed.protocol === 'https:') location.href = parsed.href; } catch { address.focus(); } };
  back.onclick = () => history.back(); forward.onclick = () => history.forward(); reload.onclick = () => location.reload(); go.onclick = navigate;
  address.addEventListener('keydown', (event) => { if (event.key === 'Enter') navigate(); });
  bar.append(brand, back, forward, reload, address, go); shadow.append(style, bar); document.documentElement.append(host);
  const offset = () => { document.documentElement.style.scrollPaddingTop = '48px'; document.body.style.paddingTop = '48px'; };
  offset();
  window.addEventListener('pageshow', offset);
  window.addEventListener('popstate', () => { address.value = location.href; });
  address.value = location.href;
})();`;


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

export async function launchProfile(profile: BrowserProfile): Promise<void> {
  const current = running.get(profile.id);
  if (current && !current.window.isDestroyed()) { current.window.focus(); return; }
  const partition = partitionFor(profile.id);
  const ses = session.fromPartition(partition, { cache: true });
  await configureSession(profile, partition, ses);
  ses.setUserAgent((profile.browser.userAgent ?? '').trim() || ses.getUserAgent(), profile.browser.locale);
  const win = new BrowserWindow({
    width: profile.browser.width,
    height: profile.browser.height,
    title: `MoCcount — ${profile.name}`,
    backgroundColor: profile.color,
    webPreferences: {
      partition,
      preload: require('node:path').join(__dirname, '../preload/fingerprint.js'),
      additionalArguments: [`--moccount-fingerprint=${Buffer.from(JSON.stringify({ hardwareConcurrency: profile.browser.hardwareConcurrency ?? 8, deviceMemory: profile.browser.deviceMemory ?? 8, locale: profile.browser.locale, timezone: profile.browser.timezone })).toString('base64')}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  running.set(profile.id, { window: win, session: ses });
  win.webContents.on('did-finish-load', () => { void win.webContents.executeJavaScript(browserToolbarScript).catch(() => undefined); });
  win.webContents.on('did-navigate', (_event, url) => { void win.webContents.executeJavaScript(\"const field=document.querySelector('#moccount-toolbar-host')?.shadowRoot?.querySelector('input'); if(field) field.value = \" + JSON.stringify(url) + \";\").catch(() => undefined); });
  win.on('closed', () => running.delete(profile.id));
  try {
    await win.loadURL(safeUrl(profile.browser.startUrl));
  } catch (error) {
    running.delete(profile.id);
    if (!win.isDestroyed()) win.destroy();
    throw new Error(`Could not open ${profile.name}: ${error instanceof Error ? error.message : 'unknown browser error'}`);
  }
}

export function stopProfile(id: string): void {
  const entry = running.get(id);
  if (!entry) return;
  running.delete(id);
  if (!entry.window.isDestroyed()) entry.window.close();
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
