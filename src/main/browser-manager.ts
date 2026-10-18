import { BrowserWindow, session, Session } from 'electron';
import path from 'node:path';
import { BrowserProfile, ProfileDraft } from '../shared/types';
import { updateProfile } from './store';

interface RunningProfile { window: BrowserWindow; session: Session }
const running = new Map<string, RunningProfile>();

function partitionFor(id: string) { return `persist:moccount-${id}`; }

function safeUrl(value: string): string {
  const candidate = value.trim();
  const url = new URL(/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(candidate) ? candidate : `https://${candidate}`);
  if (!['http:', 'https:', 'file:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS start pages are supported.');
  return url.toString();
}

function proxyRule(profile: BrowserProfile): string | undefined {
  const proxy = profile.proxy;
  if (!proxy?.host || !proxy.port) return undefined;
  if (proxy.username || proxy.password) {
    // Chromium does not support embedding proxy authentication in proxy-server URLs reliably.
    // Credentials are handled through Electron's login event on the owning session.
  }
  const scheme = proxy.type === 'socks5' ? 'socks5' : proxy.type === 'https' ? 'https' : 'http';
  return `${scheme}://${proxy.host}:${proxy.port}`;
}

export async function launchProfile(profile: BrowserProfile): Promise<void> {
  const current = running.get(profile.id);
  if (current && !current.window.isDestroyed()) { current.window.focus(); return; }
  const partition = partitionFor(profile.id);
  const ses = session.fromPartition(partition, { cache: true });
  const proxy = proxyRule(profile);
  if (proxy) await ses.setProxy({ proxyRules: proxy });
  else await ses.setProxy({ mode: 'system' });
  if (profile.proxy?.username || profile.proxy?.password) {
    ses.on('login', (event, _details, authInfo, callback) => {
      if (authInfo.isProxy) {
        event.preventDefault();
        callback(profile.proxy?.username ?? '', profile.proxy?.password ?? '');
      }
    });
  }
  const win = new BrowserWindow({
    width: profile.browser.width,
    height: profile.browser.height,
    title: `MoCcount — ${profile.name}`,
    backgroundColor: profile.color,
    webPreferences: {
      session: ses,
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
export function isRunning(id: string): boolean { return running.has(id); }

export async function checkProxy(draft: ProfileDraft): Promise<{ ok: boolean; message: string }> {
  if (!draft.proxy) return { ok: false, message: 'Add proxy details before testing the connection.' };
  const { host, port, type, username, password } = draft.proxy;
  if (!host.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, message: 'Enter a valid proxy host and port.' };
  }
  const ses = session.fromPartition(`temp:moccount-proxy-test-${Date.now()}`);
  try {
    const scheme = type === 'socks5' ? 'socks5' : type === 'https' ? 'https' : 'http';
    await ses.setProxy({ proxyRules: `${scheme}://${host}:${port}` });
    if (username || password) {
      ses.on('login', (event, _details, authInfo, callback) => {
        if (authInfo.isProxy) { event.preventDefault(); callback(username ?? '', password ?? ''); }
      });
    }
    const response = await ses.fetch('https://www.google.com/generate_204', { signal: AbortSignal.timeout(9000) });
    return response.ok || response.status === 204
      ? { ok: true, message: 'Proxy connection succeeded.' }
      : { ok: false, message: `Proxy responded with HTTP ${response.status}.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Proxy connection failed.' };
  } finally {
    await ses.clearStorageData().catch(() => undefined);
  }
}

export async function clearSiteData(id: string): Promise<void> {
  const ses = session.fromPartition(partitionFor(id), { cache: true });
  await ses.clearStorageData();
  await ses.clearCache();
}
