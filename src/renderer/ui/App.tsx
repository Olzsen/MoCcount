import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownUp, Check, ChevronDown, CircleHelp, Clock3, Command, Copy, Ellipsis, FolderOpen, Globe2, LayoutGrid, LockKeyhole, MoreHorizontal, Plus, Search, Settings2, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import type { BrowserSettings, ProfileDraft, ProfileSummary, ProxyType } from '../../shared/types';

const colors = ['#7C8DF7', '#55B7A5', '#E5A45A', '#D77CB0', '#7CBE6A', '#A58AF2'];
const avatars = ['◈', '✳', '◉', '⌘', '✦', '⬡', '✺', '◎'];
const defaultBrowser: BrowserSettings = { startUrl: 'https://www.google.com', width: 1280, height: 850, locale: 'en-US', timezone: 'Europe/Warsaw' };
const blankDraft = (): ProfileDraft => ({ name: '', avatar: avatars[0], color: colors[0], browser: { ...defaultBrowser } });

function prettyHost(proxy?: ProfileSummary['proxy']) { return proxy ? `${proxy.type.toUpperCase()} · ${proxy.host}:${proxy.port}` : 'Direct connection'; }
function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join(''); }

export default function App() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'running' | 'stopped'>('all');
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(blankDraft);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [proxyResult, setProxyResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [items, running] = await Promise.all([window.moccount.listProfiles(), window.moccount.getRunningIds()]);
    const active = new Set(running);
    setProfiles(items.map((p) => ({ ...p, status: active.has(p.id) ? 'running' : 'stopped' })));
  }, []);

  useEffect(() => { void refresh().catch((e) => setToast({ kind: 'error', text: e.message })).finally(() => setLoading(false)); }, [refresh]);
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), 3800); return () => window.clearTimeout(t); }, [toast]);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setModal(null); setMenuId(null); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.querySelector<HTMLInputElement>('.search-field input')?.focus(); } }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, []);

  const filtered = useMemo(() => profiles.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || p.status === filter)), [profiles, query, filter]);
  const runningCount = profiles.filter((p) => p.status === 'running').length;

  function openCreate() { setEditingId(null); setDraft(blankDraft()); setProxyEnabled(false); setProxyResult(null); setShowBrowser(false); setModal('create'); }
  function openEdit(profile: ProfileSummary) {
    setEditingId(profile.id);
    const { status: _status, userDataPath: _path, createdAt: _created, id: _id, proxy, ...rest } = profile;
    setDraft({ ...rest, browser: { ...profile.browser }, proxy: proxy ? { type: proxy.type, host: proxy.host, port: proxy.port, username: proxy.username, password: '' } : undefined });
    setProxyEnabled(Boolean(proxy)); setProxyResult(null); setShowBrowser(true); setMenuId(null); setModal('edit');
  }
  function patchDraft(patch: Partial<ProfileDraft>) { setDraft((prev) => ({ ...prev, ...patch })); }
  function patchBrowser(patch: Partial<BrowserSettings>) { setDraft((prev) => ({ ...prev, browser: { ...prev.browser, ...patch } })); }
  function patchProxy(patch: Partial<NonNullable<ProfileDraft['proxy']>>) { setDraft((prev) => ({ ...prev, proxy: { type: 'http', host: '', port: 8080, ...prev.proxy, ...patch } })); setProxyResult(null); }

  async function saveProfile() {
    const payload: ProfileDraft = { ...draft, name: draft.name.trim(), proxy: proxyEnabled && draft.proxy?.host.trim() ? draft.proxy : undefined };
    if (!payload.name) { setToast({ kind: 'error', text: 'Give your profile a name to continue.' }); return; }
    if (payload.proxy && (!payload.proxy.host.trim() || !Number.isInteger(payload.proxy.port) || payload.proxy.port < 1 || payload.proxy.port > 65535)) { setToast({ kind: 'error', text: 'Enter a valid proxy host and port.' }); return; }
    try {
      if (modal === 'edit' && editingId) await window.moccount.updateProfile(editingId, payload);
      else await window.moccount.createProfile(payload);
      await refresh(); setModal(null); setToast({ kind: 'success', text: modal === 'edit' ? 'Profile settings saved.' : 'Your new profile is ready.' });
    } catch (e) { setToast({ kind: 'error', text: e instanceof Error ? e.message : 'Could not save profile.' }); }
  }

  async function toggleProfile(profile: ProfileSummary) {
    setBusyId(profile.id);
    try {
      if (profile.status === 'running') await window.moccount.stopProfile(profile.id);
      else await window.moccount.launchProfile(profile.id);
      await refresh(); setToast({ kind: 'success', text: profile.status === 'running' ? `${profile.name} has stopped.` : `${profile.name} is opening in a new window.` });
    } catch (e) { setToast({ kind: 'error', text: e instanceof Error ? e.message : 'Could not change profile state.' }); await refresh(); }
    finally { setBusyId(null); }
  }

  async function removeProfile(profile: ProfileSummary) {
    setMenuId(null);
    if (!window.confirm(`Delete “${profile.name}”? Browser data on disk is kept for recovery and is not automatically erased.`)) return;
    try { await window.moccount.deleteProfile(profile.id); await refresh(); setToast({ kind: 'success', text: 'Profile removed from your library.' }); }
    catch (e) { setToast({ kind: 'error', text: e instanceof Error ? e.message : 'Could not delete profile.' }); }
  }

  async function duplicateProfile(profile: ProfileSummary) {
    setMenuId(null);
    const { name, avatar, color, browser, proxy } = profile;
    setDraft({ name: `${name} copy`, avatar, color, browser: { ...browser }, proxy: proxy ? { type: proxy.type, host: proxy.host, port: proxy.port, username: proxy.username, password: '' } : undefined });
    setEditingId(null); setProxyEnabled(Boolean(proxy)); setShowBrowser(true); setProxyResult(null); setModal('create');
  }

  async function testProxy() {
    if (!proxyEnabled || !draft.proxy) { setProxyResult({ ok: false, message: 'Add proxy details before testing the connection.' }); return; }
    setProxyResult(null);
    try { const result = await window.moccount.checkProxy({ ...draft, proxy: draft.proxy }); setProxyResult(result); }
    catch (e) { setProxyResult({ ok: false, message: e instanceof Error ? e.message : 'Proxy check failed.' }); }
  }

  async function clearData(profile: ProfileSummary) {
    setMenuId(null);
    if (!window.confirm(`Clear cookies, cache and site storage for “${profile.name}”?`)) return;
    try { await window.moccount.clearSiteData(profile.id); setToast({ kind: 'success', text: 'Site data cleared.' }); }
    catch (e) { setToast({ kind: 'error', text: e instanceof Error ? e.message : 'Could not clear site data.' }); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Command size={18} strokeWidth={2.2} /></div><span>MoCcount</span><span className="brand-version">BETA</span></div>
      <div className="workspace-label">WORKSPACE</div>
      <button className="nav-item active"><LayoutGrid size={17} /><span>All profiles</span><span className="nav-count">{profiles.length}</span></button>
      <button className="nav-item" onClick={() => setFilter(filter === 'running' ? 'all' : 'running')}><Activity size={17} /><span>Running</span><span className="nav-count">{runningCount}</span></button>
      <button className="nav-item" onClick={() => { setToast({ kind: 'success', text: 'Every profile stores its own cookies and website data.' }); }}><ShieldCheck size={17} /><span>Privacy & isolation</span></button>
      <div className="sidebar-bottom"><div className="usage-card"><div className="usage-head"><span className="usage-icon"><Sparkles size={15} /></span><span>YOUR WORKSPACE</span></div><div className="usage-title">Your sessions, separated.</div><p>Each profile keeps its own cookies, logins and site data.</p><div className="usage-bar"><span style={{ width: `${Math.min(100, profiles.length * 8)}%` }} /></div><div className="usage-foot"><span>{profiles.length} profiles</span><span>Local storage</span></div></div><button className="account-row" onClick={() => setToast({ kind: 'success', text: 'MoCcount stores your profile library locally on this device.' })}><div className="account-avatar">O</div><div className="account-meta"><strong>Local workspace</strong><span>Personal edition</span></div><MoreHorizontal size={18} className="muted-icon" /></button></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>Profiles</strong></div><div className="topbar-actions"><div className="connection-status"><span className="pulse-dot" /> All systems local</div><button className="icon-button help-button" title="About profile isolation" onClick={() => setToast({ kind: 'success', text: 'Separate storage is provided by Chromium sessions. This does not spoof a full device fingerprint.' })}><CircleHelp size={17} /></button><div className="top-avatar">O</div></div></header>
      <section className="page-content">
        <div className="page-heading"><div><div className="eyebrow">BROWSER WORKSPACES</div><h1>Your profiles<span className="title-period">.</span></h1><p className="page-subtitle">A separate space for every account, project and workflow.</p></div><button className="primary-button" onClick={openCreate}><Plus size={17} strokeWidth={2.2} /> Create profile <span className="button-shortcut">⌘ N</span></button></div>
        <div className="stats-row"><div className="stat-item"><div className="stat-icon stat-violet"><LayoutGrid size={17} /></div><div><span>Total profiles</span><strong>{profiles.length.toString().padStart(2, '0')}</strong></div></div><div className="stat-divider" /><div className="stat-item"><div className="stat-icon stat-green"><Activity size={17} /></div><div><span>Active now</span><strong>{runningCount.toString().padStart(2, '0')}</strong></div></div><div className="stat-divider" /><div className="stat-item"><div className="stat-icon stat-amber"><LockKeyhole size={17} /></div><div><span>Isolated sessions</span><strong>{profiles.length.toString().padStart(2, '0')}</strong></div></div><div className="stats-note"><span className="tiny-check"><Check size={12} /></span> Data stays on this device</div></div>
        <div className="library-toolbar"><div className="section-heading"><h2>Profile library</h2><span className="result-count">{filtered.length} {filtered.length === 1 ? 'profile' : 'profiles'}</span></div><div className="toolbar-controls"><div className="search-field"><Search size={15} /><input aria-label="Search profiles" placeholder="Search profiles..." value={query} onChange={(e) => setQuery(e.target.value)} /><kbd>⌘ K</kbd></div><div className="filter-control"><ArrowDownUp size={14} /><select aria-label="Filter profiles" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}><option value="all">All profiles</option><option value="running">Running</option><option value="stopped">Stopped</option></select><ChevronDown size={13} /></div></div></div>
        {loading ? <div className="empty-state"><div className="loader-ring" /><h3>Loading your workspace</h3><p>Reading your local profile library…</p></div> : filtered.length === 0 ? <div className="empty-state"><div className="empty-graphic"><FolderOpen size={25} /></div><h3>{query || filter !== 'all' ? 'No matching profiles' : 'A fresh start.'}</h3><p>{query || filter !== 'all' ? 'Try another search or change the filter.' : 'Create your first profile to keep your browsing sessions separate.'}</p>{!query && filter === 'all' && <button className="primary-button" onClick={openCreate}><Plus size={16} /> Create your first profile</button>}</div> : <div className="profile-grid">{filtered.map((profile, index) => <article className={`profile-card ${profile.status === 'running' ? 'is-running' : ''}`} key={profile.id} style={{ animationDelay: `${index * 45}ms` }}>
          <div className="card-topline"><div className="profile-avatar" style={{ background: `${profile.color}18`, color: profile.color, borderColor: `${profile.color}3a` }}><span>{profile.avatar || initials(profile.name)}</span><span className="avatar-orbit" /></div><div className={`status-pill ${profile.status}`}><span className="status-dot" />{profile.status === 'running' ? 'Running' : 'Not running'}</div><div className="more-wrap"><button className="icon-button card-more" aria-label={`Options for ${profile.name}`} onClick={() => setMenuId(menuId === profile.id ? null : profile.id)}><Ellipsis size={19} /></button>{menuId === profile.id && <div className="dropdown-menu"><button onClick={() => openEdit(profile)}><Settings2 size={14} /> Configure</button><button onClick={() => void duplicateProfile(profile)}><Copy size={14} /> Duplicate</button><button onClick={() => void clearData(profile)}><Trash2 size={14} /> Clear site data</button><div className="menu-divider" /><button className="danger-item" onClick={() => void removeProfile(profile)}><Trash2 size={14} /> Delete profile</button></div>}</div></div>
          <div className="card-title-row"><h3>{profile.name}</h3>{profile.status === 'running' && <span className="running-wave"><i /><i /><i /></span>}</div><div className="profile-description">{profile.status === 'running' ? 'Your browser session is active' : 'Ready when you are'}</div>
          <div className="card-divider" /><div className="card-meta"><span className="meta-label"><Globe2 size={14} /> Connection</span><span className={`proxy-value ${profile.proxy ? 'proxy-set' : ''}`} title={prettyHost(profile.proxy)}>{prettyHost(profile.proxy)}</span></div><div className="card-meta"><span className="meta-label"><LockKeyhole size={14} /> Browser data</span><span className="isolation-value"><span className="mini-shield"><ShieldCheck size={11} /></span> Isolated</span></div>
          <div className="card-actions"><button className={`launch-button ${profile.status === 'running' ? 'stop-button' : ''}`} disabled={busyId === profile.id} onClick={() => void toggleProfile(profile)}>{busyId === profile.id ? <span className="button-spinner" /> : profile.status === 'running' ? <span className="stop-square" /> : <span className="play-triangle" />}{busyId === profile.id ? 'Please wait…' : profile.status === 'running' ? 'Stop session' : 'Launch profile'}</button><button className="configure-button" title="Configure profile" onClick={() => openEdit(profile)}><Settings2 size={16} /></button></div>
        </article>)}</div>}
        <footer className="page-footer"><span><span className="footer-logo"><Command size={12} /></span> MoCcount <span className="footer-dot">·</span> Your browser, organized.</span><span className="footer-right"><span className="tiny-check"><Check size={11} /></span> Local-first by design <span className="footer-dot">·</span> v0.1.0</span></footer>
      </section>
    </main>

    {modal && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(null); }}><section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div><div className="eyebrow">{modal === 'edit' ? 'PROFILE SETTINGS' : 'NEW WORKSPACE'}</div><h2 id="modal-title">{modal === 'edit' ? 'Configure profile' : 'Create a profile'}<span className="title-period">.</span></h2><p>{modal === 'edit' ? 'Fine-tune this workspace and its connection.' : 'Set up a dedicated space for your next workflow.'}</p></div><button className="icon-button modal-close" onClick={() => setModal(null)} aria-label="Close dialog"><X size={18} /></button></div>
        <div className="modal-body"><label className="field-label">Profile name <span>Required</span></label><input className="text-input" autoFocus maxLength={60} placeholder="e.g. Personal Gmail" value={draft.name} onChange={(e) => patchDraft({ name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void saveProfile(); }} />
          <div className="field-label avatar-label">Choose an icon <span>Pick a symbol</span></div><div className="avatar-picker">{avatars.map((avatar) => <button key={avatar} className={`avatar-option ${draft.avatar === avatar ? 'selected' : ''}`} onClick={() => patchDraft({ avatar })} style={{ '--avatar-color': draft.color } as React.CSSProperties}>{avatar}{draft.avatar === avatar && <span className="avatar-selected-check"><Check size={10} /></span>}</button>)}</div>
          <div className="field-label color-label">Accent color</div><div className="color-picker">{colors.map((color) => <button key={color} className={`color-option ${draft.color === color ? 'selected' : ''}`} style={{ background: color }} aria-label={`Select ${color}`} onClick={() => patchDraft({ color })}>{draft.color === color && <Check size={15} />}</button>)}</div>
          <div className="form-divider" /><button className="accordion-heading" onClick={() => setShowBrowser(!showBrowser)}><span className="accordion-icon"><Globe2 size={15} /></span><span><strong>Browser settings</strong><small>Homepage, language and window size</small></span><ChevronDown size={16} className={showBrowser ? 'chevron-open' : ''} /></button>
          {showBrowser && <div className="accordion-content"><label className="field-label">Start page</label><input className="text-input" value={draft.browser.startUrl} onChange={(e) => patchBrowser({ startUrl: e.target.value })} placeholder="https://www.google.com"/><div className="form-two-col"><div><label className="field-label">Language</label><select className="text-input" value={draft.browser.locale} onChange={(e) => patchBrowser({ locale: e.target.value })}><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="pl-PL">Polski</option><option value="de-DE">Deutsch</option><option value="fr-FR">Français</option></select></div><div><label className="field-label">Timezone</label><select className="text-input" value={draft.browser.timezone} onChange={(e) => patchBrowser({ timezone: e.target.value })}><option value="Europe/Warsaw">Europe / Warsaw</option><option value="Europe/London">Europe / London</option><option value="Europe/Berlin">Europe / Berlin</option><option value="America/New_York">America / New York</option><option value="UTC">UTC</option></select></div></div><div className="form-two-col"><div><label className="field-label">Window width</label><input className="text-input" type="number" min={800} max={3840} value={draft.browser.width} onChange={(e) => patchBrowser({ width: Number(e.target.value) })}/></div><div><label className="field-label">Window height</label><input className="text-input" type="number" min={600} max={2160} value={draft.browser.height} onChange={(e) => patchBrowser({ height: Number(e.target.value) })}/></div></div><div className="capability-note"><CircleHelp size={14}/><span>Window size and homepage are applied. Locale and timezone are saved for future engine-level support; they are not currently overridden per profile.</span></div></div>}
          <div className="form-divider" /><div className="proxy-section-header"><div><div className="accordion-heading no-toggle"><span className="accordion-icon"><Globe2 size={15} /></span><span><strong>Proxy connection</strong><small>Route this profile through a proxy</small></span></div></div><button className={`toggle-switch ${proxyEnabled ? 'on' : ''}`} aria-pressed={proxyEnabled} onClick={() => { setProxyEnabled(!proxyEnabled); setProxyResult(null); }}><span /></button></div>
          {proxyEnabled && <div className="proxy-fields"><div className="field-label">Proxy type</div><div className="proxy-type-select">{(['http', 'https', 'socks5'] as ProxyType[]).map((type) => <button key={type} className={draft.proxy?.type === type ? 'chosen' : ''} onClick={() => patchProxy({ type })}>{type.toUpperCase()}</button>)}</div><div className="form-two-col"><div><label className="field-label">Host / IP address</label><input className="text-input" placeholder="proxy.example.com" value={draft.proxy?.host ?? ''} onChange={(e) => patchProxy({ host: e.target.value })}/></div><div><label className="field-label">Port</label><input className="text-input" type="number" placeholder="8080" value={draft.proxy?.port ?? 8080} onChange={(e) => patchProxy({ port: Number(e.target.value) })}/></div></div><div className="form-two-col"><div><label className="field-label">Username <span>Optional</span></label><input className="text-input" autoComplete="off" value={draft.proxy?.username ?? ''} onChange={(e) => patchProxy({ username: e.target.value })} placeholder="Proxy username"/></div><div><label className="field-label">Password <span>Optional</span></label><input className="text-input" type="password" autoComplete="new-password" value={draft.proxy?.password ?? ''} onChange={(e) => patchProxy({ password: e.target.value })} placeholder={modal === 'edit' && profiles.find((p) => p.id === editingId)?.proxy?.hasPassword ? 'Saved — enter to replace' : 'Proxy password'}/></div></div><button className="test-proxy-button" onClick={() => void testProxy()}><Activity size={14}/> Test connection</button>{proxyResult && <div className={`proxy-result ${proxyResult.ok ? 'ok' : 'bad'}`}><span className="status-dot"/>{proxyResult.message}</div>}<div className="capability-note"><LockKeyhole size={14}/><span>Proxy credentials are not sent back to the UI when loading a saved profile. OS-backed encryption is used where available.</span></div></div>}
          {!proxyEnabled && <div className="direct-connection-note"><span className="direct-note-icon"><Check size={13}/></span><span><strong>Direct connection</strong><small>This profile uses your regular network connection.</small></span></div>}
          <div className="isolation-banner"><div className="isolation-banner-icon"><ShieldCheck size={17}/></div><div><strong>Independent browser storage</strong><p>Cookies, site data and sign-ins stay separate from other profiles. This is not full device fingerprint spoofing.</p></div></div>
        </div><div className="modal-footer"><span className="escape-hint"><kbd>ESC</kbd> to close</span><div><button className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" onClick={() => void saveProfile()}><Check size={15}/>{modal === 'edit' ? 'Save changes' : 'Create profile'}</button></div></div>
      </section></div>}
    {toast && <div className={`toast ${toast.kind}`} role="status"><span className="toast-mark">{toast.kind === 'success' ? <Check size={14}/> : <X size={14}/>}</span>{toast.text}<button onClick={() => setToast(null)} aria-label="Dismiss notification"><X size={14}/></button></div>}
  </div>;
}
