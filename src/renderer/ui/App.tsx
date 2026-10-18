import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownUp, Check, ChevronDown, CircleHelp, Clock3, Command, Copy, Ellipsis, FolderOpen, Globe2, LayoutGrid, LockKeyhole, MoreHorizontal, Plus, Search, Settings2, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import type { BrowserSettings, ProfileDraft, ProfileSummary, ProxyType } from '../../shared/types';

const colors = ['#7C8DF7', '#55B7A5', '#E5A45A', '#D77CB0', '#7CBE6A', '#A58AF2'];
const avatars = ['◈', '✳', '◉', '⌘', '✦', '⬡', '✺', '◎'];
const defaultBrowser: BrowserSettings = { startUrl: 'https://www.google.com', width: 1280, height: 850, locale: 'ru-RU', timezone: 'Europe/Moscow', userAgent: '', hardwareConcurrency: 8, deviceMemory: 8 };
const blankDraft = (): ProfileDraft => ({ name: '', avatar: avatars[0], color: colors[0], browser: { ...defaultBrowser } });

function prettyHost(proxy?: ProfileSummary['proxy']) { return proxy ? `${proxy.type.toUpperCase()} · ${proxy.host}:${proxy.port}` : 'Прямое подключение'; }
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
    if (!payload.name) { setToast({ kind: 'error', text: 'Укажите название профиля.' }); return; }
    if (payload.proxy && (!payload.proxy.host.trim() || !Number.isInteger(payload.proxy.port) || payload.proxy.port < 1 || payload.proxy.port > 65535)) { setToast({ kind: 'error', text: 'Укажите корректный адрес и порт прокси.' }); return; }
    try {
      if (modal === 'edit' && editingId) await window.moccount.updateProfile(editingId, payload);
      else await window.moccount.createProfile(payload);
      await refresh(); setModal(null); setToast({ kind: 'success', text: modal === 'edit' ? 'Настройки профиля сохранены.' : 'Новый профиль готов.' });
    } catch (e) { setToast({ kind: 'error', text: e instanceof Error ? e.message : 'Не удалось сохранить профиль.' }); }
  }

  async function toggleProfile(profile: ProfileSummary) {
    setBusyId(profile.id);
    try {
      if (profile.status === 'running') await window.moccount.stopProfile(profile.id);
      else await window.moccount.launchProfile(profile.id);
      await refresh(); setToast({ kind: 'success', text: profile.status === 'running' ? `${profile.name} has stopped.` : `${profile.name} is opening in a new window.` });
    } catch (e) { setToast({ kind: 'error', text: e instanceof Error ? e.message : 'Не удалось изменить состояние профиля.' }); await refresh(); }
    finally { setBusyId(null); }
  }

  async function removeProfile(profile: ProfileSummary) {
    setMenuId(null);
    if (!window.confirm(`Удалить профиль «${profile.name}»? Данные браузера останутся на диске для возможного восстановления.`)) return;
    try { await window.moccount.deleteProfile(profile.id); await refresh(); setToast({ kind: 'success', text: 'Профиль удалён из списка.' }); }
    catch (e) { setToast({ kind: 'error', text: e instanceof Error ? e.message : 'Не удалось удалить профиль.' }); }
  }

  async function duplicateProfile(profile: ProfileSummary) {
    setMenuId(null);
    const { name, avatar, color, browser, proxy } = profile;
    setDraft({ name: `${name} copy`, avatar, color, browser: { ...browser }, proxy: proxy ? { type: proxy.type, host: proxy.host, port: proxy.port, username: proxy.username, password: '' } : undefined });
    setEditingId(null); setProxyEnabled(Boolean(proxy)); setShowBrowser(true); setProxyResult(null); setModal('create');
  }

  async function testProxy() {
    if (!proxyEnabled || !draft.proxy) { setProxyResult({ ok: false, message: 'Сначала укажите параметры прокси.' }); return; }
    setProxyResult(null);
    try { const result = await window.moccount.checkProxy({ ...draft, proxy: draft.proxy }); setProxyResult(result); }
    catch (e) { setProxyResult({ ok: false, message: e instanceof Error ? e.message : 'Не удалось проверить прокси.' }); }
  }

  async function clearData(profile: ProfileSummary) {
    setMenuId(null);
    if (!window.confirm(`Clear cookies, cache and site storage for “${profile.name}”?`)) return;
    try { await window.moccount.clearSiteData(profile.id); setToast({ kind: 'success', text: 'Данные сайтов очищены.' }); }
    catch (e) { setToast({ kind: 'error', text: e instanceof Error ? e.message : 'Не удалось очистить данные сайтов.' }); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Command size={18} strokeWidth={2.2} /></div><span>MoCcount</span><span className="brand-version">BETA</span></div>
      <div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <button className="nav-item active"><LayoutGrid size={17} /><span>Все профили</span><span className="nav-count">{profiles.length}</span></button>
      <button className="nav-item" onClick={() => setFilter(filter === 'running' ? 'all' : 'running')}><Activity size={17} /><span>Запущены</span><span className="nav-count">{runningCount}</span></button>
      <button className="nav-item" onClick={() => { setToast({ kind: 'success', text: 'У каждого профиля свои cookie и данные сайтов.' }); }}><ShieldCheck size={17} /><span>Приватность и изоляция</span></button>
      <div className="sidebar-bottom"><div className="usage-card"><div className="usage-head"><span className="usage-icon"><Sparkles size={15} /></span><span>ВАШЕ ПРОСТРАНСТВО</span></div><div className="usage-title">Ваши сессии отдельно.</div><p>У каждого профиля свои cookie, входы и данные сайтов.</p><div className="usage-bar"><span style={{ width: `${Math.min(100, profiles.length * 8)}%` }} /></div><div className="usage-foot"><span>{profiles.length} профилей</span><span>Локальное хранение</span></div></div><button className="account-row" onClick={() => setToast({ kind: 'success', text: 'Список профилей хранится локально на этом устройстве.' })}><div className="account-avatar">O</div><div className="account-meta"><strong>Локальное пространство</strong><span>Персональная версия</span></div><MoreHorizontal size={18} className="muted-icon" /></button></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div className="breadcrumbs"><span>Пространство</span><span className="crumb-slash">/</span><strong>Профили</strong></div><div className="topbar-actions"><div className="connection-status"><span className="pulse-dot" /> Всё работает локально</div><button className="icon-button help-button" title="Об изоляции профилей" onClick={() => setToast({ kind: 'success', text: 'Каждый профиль использует отдельное хранилище Chromium. Полная подмена отпечатка устройства не выполняется.' })}><CircleHelp size={17} /></button><div className="top-avatar">O</div></div></header>
      <section className="page-content">
        <div className="page-heading"><div><div className="eyebrow">ПРОФИЛИ БРАУЗЕРА</div><h1>Ваши профили<span className="title-period">.</span></h1><p className="page-subtitle">Отдельное пространство для каждого аккаунта, проекта и задачи.</p></div><button className="primary-button" onClick={openCreate}><Plus size={17} strokeWidth={2.2} /> Создать профиль <span className="button-shortcut">⌘ N</span></button></div>
        <div className="stats-row"><div className="stat-item"><div className="stat-icon stat-violet"><LayoutGrid size={17} /></div><div><span>Всего профилей</span><strong>{profiles.length.toString()}</strong></div></div><div className="stat-divider" /><div className="stat-item"><div className="stat-icon stat-green"><Activity size={17} /></div><div><span>Активны сейчас</span><strong>{runningCount.toString()}</strong></div></div><div className="stat-divider" /><div className="stat-item"><div className="stat-icon stat-amber"><LockKeyhole size={17} /></div><div><span>Изолированные сессии</span><strong>{profiles.length.toString()}</strong></div></div><div className="stats-note"><span className="tiny-check"><Check size={12} /></span> Данные остаются на устройстве</div></div>
        <div className="library-toolbar"><div className="section-heading"><h2>Список профилей</h2><span className="result-count">{filtered.length} {filtered.length === 1 ? 'профиль' : 'профилей'}</span></div><div className="toolbar-controls"><div className="search-field"><Search size={15} /><input aria-label="Поиск профилей" placeholder="Поиск профилей..." value={query} onChange={(e) => setQuery(e.target.value)} /><kbd>⌘ K</kbd></div><div className="filter-control"><ArrowDownUp size={14} /><select aria-label="Фильтр профилей" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}><option value="all">Все профили</option><option value="running">Запущены</option><option value="stopped">Остановлены</option></select><ChevronDown size={13} /></div></div></div>
        {loading ? <div className="empty-state"><div className="loader-ring" /><h3>Загружаем пространство</h3><p>Читаем список локальных профилей…</p></div> : filtered.length === 0 ? <div className="empty-state"><div className="empty-graphic"><FolderOpen size={25} /></div><h3>{query || filter !== 'all' ? 'Профили не найдены' : 'Начнём с чистого листа.'}</h3><p>{query || filter !== 'all' ? 'Измените запрос или выберите другой фильтр.' : 'Создайте первый профиль, чтобы разделить сессии браузера.'}</p>{!query && filter === 'all' && <button className="primary-button" onClick={openCreate}><Plus size={16} /> Создать первый профиль</button>}</div> : <div className="profile-grid">{filtered.map((profile, index) => <article className={`profile-card ${profile.status === 'running' ? 'is-running' : ''}`} key={profile.id} style={{ animationDelay: `${index * 45}ms` }}>
          <div className="card-topline"><div className="profile-avatar" style={{ background: `${profile.color}18`, color: profile.color, borderColor: `${profile.color}3a` }}><span>{profile.avatar || initials(profile.name)}</span><span className="avatar-orbit" /></div><div className={`status-pill ${profile.status}`}><span className="status-dot" />{profile.status === 'running' ? 'Запущен' : 'Не запущен'}</div><div className="more-wrap"><button className="icon-button card-more" aria-label={`Действия для ${profile.name}`} onClick={() => setMenuId(menuId === profile.id ? null : profile.id)}><Ellipsis size={19} /></button>{menuId === profile.id && <div className="dropdown-menu"><button onClick={() => openEdit(profile)}><Settings2 size={14} /> Настроить</button><button onClick={() => void duplicateProfile(profile)}><Copy size={14} /> Дублировать</button><button onClick={() => void clearData(profile)}><Trash2 size={14} /> Очистить данные сайтов</button><div className="menu-divider" /><button className="danger-item" onClick={() => void removeProfile(profile)}><Trash2 size={14} /> Удалить профиль</button></div>}</div></div>
          <div className="card-title-row"><h3>{profile.name}</h3>{profile.status === 'running' && <span className="running-wave"><i /><i /><i /></span>}</div><div className="profile-description">{profile.status === 'running' ? 'Сессия браузера активна' : 'Готов к запуску'}</div>
          <div className="card-divider" /><div className="card-meta"><span className="meta-label"><Globe2 size={14} /> Подключение</span><span className={`proxy-value ${profile.proxy ? 'proxy-set' : ''}`} title={prettyHost(profile.proxy)}>{prettyHost(profile.proxy)}</span></div><div className="card-meta"><span className="meta-label"><LockKeyhole size={14} /> Данные браузера</span><span className="isolation-value"><span className="mini-shield"><ShieldCheck size={11} /></span> Изолирован</span></div>
          <div className="card-actions"><button className={`launch-button ${profile.status === 'running' ? 'stop-button' : ''}`} disabled={busyId === profile.id} onClick={() => void toggleProfile(profile)}>{busyId === profile.id ? <span className="button-spinner" /> : profile.status === 'running' ? <span className="stop-square" /> : <span className="play-triangle" />}{busyId === profile.id ? 'Подождите…' : profile.status === 'running' ? 'Остановить' : 'Запустить'}</button><button className="configure-button" title="Настроить профиль" onClick={() => openEdit(profile)}><Settings2 size={16} /></button></div>
        </article>)}</div>}
        <footer className="page-footer"><span><span className="footer-logo"><Command size={12} /></span> MoCcount <span className="footer-dot">·</span> Ваш браузер — в порядке.</span><span className="footer-right"><span className="tiny-check"><Check size={11} /></span> Локально по умолчанию <span className="footer-dot">·</span> v0.1.0</span></footer>
      </section>
    </main>

    {modal && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(null); }}><section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div><div className="eyebrow">{modal === 'edit' ? 'НАСТРОЙКИ ПРОФИЛЯ' : 'НОВЫЙ ПРОФИЛЬ'}</div><h2 id="modal-title">{modal === 'edit' ? 'Настроить профиль' : 'Создать профиль'}<span className="title-period">.</span></h2><p>{modal === 'edit' ? 'Настройте профиль и подключение.' : 'Создайте отдельное пространство для следующей задачи.'}</p></div><button className="icon-button modal-close" onClick={() => setModal(null)} aria-label="Закрыть окно"><X size={18} /></button></div>
        <div className="modal-body"><label className="field-label">Название профиля <span>Обязательно</span></label><input className="text-input" autoFocus maxLength={60} placeholder="Например, личная почта" value={draft.name} onChange={(e) => patchDraft({ name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void saveProfile(); }} />
          <div className="field-label avatar-label">Выберите значок <span>Выберите символ</span></div><div className="avatar-picker">{avatars.map((avatar) => <button key={avatar} className={`avatar-option ${draft.avatar === avatar ? 'selected' : ''}`} onClick={() => patchDraft({ avatar })} style={{ '--avatar-color': draft.color } as React.CSSProperties}>{avatar}{draft.avatar === avatar && <span className="avatar-selected-check"><Check size={10} /></span>}</button>)}</div>
          <div className="field-label color-label">Цвет акцента</div><div className="color-picker">{colors.map((color) => <button key={color} className={`color-option ${draft.color === color ? 'selected' : ''}`} style={{ background: color }} aria-label={`Выбрать цвет ${color}`} onClick={() => patchDraft({ color })}>{draft.color === color && <Check size={15} />}</button>)}</div>
          <div className="form-divider" /><button className="accordion-heading" onClick={() => setShowBrowser(!showBrowser)}><span className="accordion-icon"><Globe2 size={15} /></span><span><strong>Настройки браузера</strong><small>Главная страница, язык и размер окна</small></span><ChevronDown size={16} className={showBrowser ? 'chevron-open' : ''} /></button>
          {showBrowser && <div className="accordion-content"><label className="field-label">Начальная страница</label><input className="text-input" value={draft.browser.startUrl} onChange={(e) => patchBrowser({ startUrl: e.target.value })} placeholder="https://www.google.com"/><div className="form-two-col"><div><label className="field-label">Язык</label><select className="text-input" value={draft.browser.locale} onChange={(e) => patchBrowser({ locale: e.target.value })}><option value="ru-RU">Русский</option><option value="en-US">Английский (США)</option><option value="en-GB">Английский (Великобритания)</option><option value="pl-PL">Польский</option><option value="de-DE">Немецкий</option><option value="fr-FR">Французский</option></select></div><div><label className="field-label">Часовой пояс</label><select className="text-input" value={draft.browser.timezone} onChange={(e) => patchBrowser({ timezone: e.target.value })}><option value="Europe/Moscow">Европа / Москва</option><option value="Europe/Warsaw">Европа / Варшава</option><option value="Europe/London">Европа / Лондон</option><option value="Europe/Berlin">Европа / Берлин</option><option value="America/New_York">Америка / Нью-Йорк</option><option value="UTC">UTC</option></select></div></div><div className="form-two-col"><div><label className="field-label">Ширина окна</label><input className="text-input" type="number" min={800} max={3840} value={draft.browser.width} onChange={(e) => patchBrowser({ width: Number(e.target.value) })}/></div><div><label className="field-label">Высота окна</label><input className="text-input" type="number" min={600} max={2160} value={draft.browser.height} onChange={(e) => patchBrowser({ height: Number(e.target.value) })}/></div></div><div className="form-divider" /><div className="field-label">Отпечаток устройства <span>Базовые параметры</span></div><div className="form-two-col"><div><label className="field-label">Потоки процессора</label><select className="text-input" value={draft.browser.hardwareConcurrency} onChange={(e) => patchBrowser({ hardwareConcurrency: Number(e.target.value) })}>{[2,4,6,8,12,16].map((n) => <option key={n} value={n}>{n}</option>)}</select></div><div><label className="field-label">Объём памяти (ГБ)</label><select className="text-input" value={draft.browser.deviceMemory} onChange={(e) => patchBrowser({ deviceMemory: Number(e.target.value) })}>{[2,4,8,16,32].map((n) => <option key={n} value={n}>{n}</option>)}</select></div></div><label className="field-label">User-Agent <span>Необязательно</span></label><input className="text-input" value={draft.browser.userAgent} onChange={(e) => patchBrowser({ userAgent: e.target.value })} placeholder="Оставьте пустым для стандартного значения"/><div className="capability-note"><CircleHelp size={14}/><span>Язык, часовой пояс, число потоков и память переопределяются в рамках профиля. Полная согласованная подмена Canvas/WebGL и других сигналов пока не реализована.</span></div></div>}
          <div className="form-divider" /><div className="proxy-section-header"><div><div className="accordion-heading no-toggle"><span className="accordion-icon"><Globe2 size={15} /></span><span><strong>Прокси-подключение</strong><small>Подключать профиль через прокси</small></span></div></div><button className={`toggle-switch ${proxyEnabled ? 'on' : ''}`} aria-pressed={proxyEnabled} onClick={() => { setProxyEnabled(!proxyEnabled); setProxyResult(null); }}><span /></button></div>
          {proxyEnabled && <div className="proxy-fields"><div className="field-label">Тип прокси</div><div className="proxy-type-select">{(['http', 'https', 'socks5'] as ProxyType[]).map((type) => <button key={type} className={draft.proxy?.type === type ? 'chosen' : ''} onClick={() => patchProxy({ type })}>{type.toUpperCase()}</button>)}</div><div className="form-two-col"><div><label className="field-label">Хост / IP-адрес</label><input className="text-input" placeholder="proxy.example.com" value={draft.proxy?.host ?? ''} onChange={(e) => patchProxy({ host: e.target.value })}/></div><div><label className="field-label">Порт</label><input className="text-input" type="number" placeholder="8080" value={draft.proxy?.port ?? 8080} onChange={(e) => patchProxy({ port: Number(e.target.value) })}/></div></div><div className="form-two-col"><div><label className="field-label">Имя пользователя <span>Необязательно</span></label><input className="text-input" autoComplete="off" value={draft.proxy?.username ?? ''} onChange={(e) => patchProxy({ username: e.target.value })} placeholder="Имя пользователя прокси"/></div><div><label className="field-label">Пароль <span>Необязательно</span></label><input className="text-input" type="password" autoComplete="new-password" value={draft.proxy?.password ?? ''} onChange={(e) => patchProxy({ password: e.target.value })} placeholder={modal === 'edit' && profiles.find((p) => p.id === editingId)?.proxy?.hasPassword ? 'Сохранён — введите новый для замены' : 'Пароль прокси'}/></div></div><button className="test-proxy-button" onClick={() => void testProxy()}><Activity size={14}/> Проверить подключение</button>{proxyResult && <div className={`proxy-result ${proxyResult.ok ? 'ok' : 'bad'}`}><span className="status-dot"/>{proxyResult.message}</div>}<div className="capability-note"><LockKeyhole size={14}/><span>Proxy credentials are not sent back to the UI when loading a saved profile. OS-backed encryption is used where available.</span></div></div>}
          {!proxyEnabled && <div className="direct-connection-note"><span className="direct-note-icon"><Check size={13}/></span><span><strong>Прямое подключение</strong><small>Этот профиль использует обычное сетевое подключение.</small></span></div>}
          <div className="isolation-banner"><div className="isolation-banner-icon"><ShieldCheck size={17}/></div><div><strong>Изолированное хранилище браузера</strong><p>Cookie, данные сайтов и авторизации отделены от других профилей. Полная подмена отпечатка устройства пока не реализована.</p></div></div>
        </div><div className="modal-footer"><span className="escape-hint"><kbd>ESC</kbd> чтобы закрыть</span><div><button className="secondary-button" onClick={() => setModal(null)}>Отмена</button><button className="primary-button" onClick={() => void saveProfile()}><Check size={15}/>{modal === 'edit' ? 'Сохранить изменения' : 'Создать профиль'}</button></div></div>
      </section></div>}
    {toast && <div className={`toast ${toast.kind}`} role="status"><span className="toast-mark">{toast.kind === 'success' ? <Check size={14}/> : <X size={14}/>}</span>{toast.text}<button onClick={() => setToast(null)} aria-label="Dismiss notification"><X size={14}/></button></div>}
  </div>;
}
