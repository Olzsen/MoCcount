import { BrowserWindow, session, Session } from 'electron';
import { BrowserProfile, ProfileDraft } from '../shared/types';

interface RunningProfile { window: BrowserWindow; session: Session }
const running = new Map<string, RunningProfile>();
const proxyCredentials = new Map<string, { username: string; password: string }>();

function partitionFor(id: string) { return `persist:moccount-${id}`; }

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
  const win = new BrowserWindow({
    width: profile.browser.width,
    height: profile.browser.height,
    title: `MoCcount — ${profile.name}`,
    backgroundColor: profile.color,
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  running.set(profile.id, { window: win, session: ses });
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
