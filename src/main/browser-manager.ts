import { BrowserWindow, session, Session } from 'electron';
import { BrowserProfile, ProfileDraft } from '../shared/types';

interface RunningProfile { window: BrowserWindow; session: Session }
const running = new Map<string, RunningProfile>();
const proxyLoginRegistered = new Set<string>();

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
  if ((!username && !password) || proxyLoginRegistered.has(partition)) return;
  proxyLoginRegistered.add(partition);
  ses.on('login', (event, _details, authInfo, callback) => {
    if (authInfo.isProxy) {
      event.preventDefault();
      callback(username ?? '', password ?? '');
    }
  });
}

export async function launchProfile(profile: BrowserProfile): Promise<void> {
  const current = running.get(profile.id);
  if (current && !current.window.isDestroyed()) { current.window.focus(); return; }
  const partition = partitionFor(profile.id);
  const ses = session.fromPartition(partition, { cache: true });
  const proxy = proxyRule(profile);
  if (proxy) await ses.setProxy({ proxyRules: proxy });
  else await ses.setProxy({ mode: 'system' });
  // Reuse a single handler per persistent session to avoid duplicate login listeners.
  // Profile settings can only be edited while stopped; first initialization supplies current credentials.
  configureProxyAuth(ses, partition, profile.proxy?.username, profile.proxy?.password);
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
    const response = await ses.fetch('https://www.google.com/generate_204', { signal: AbortSignal.timeout(9000) });
    return response.ok || response.status === 204
      ? { ok: true, message: 'Proxy connection succeeded.' }
      : { ok: false, message: `Proxy responded with HTTP ${response.status}.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Proxy connection failed.' };
  } finally {
    await ses.clearStorageData().catch(() => undefined);
    await ses.clearCache().catch(() => undefined);
    proxyLoginRegistered.delete(partition);
  }
}

export async function clearSiteData(id: string): Promise<void> {
  const ses = session.fromPartition(partitionFor(id), { cache: true });
  await ses.clearStorageData();
  await ses.clearCache();
}
