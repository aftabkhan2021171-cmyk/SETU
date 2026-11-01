import { useEffect, useState } from 'react';
import { LuMenu, LuX, LuUsers, LuActivity, LuStethoscope, LuGitMerge, LuRefreshCw, LuLogOut, LuWifi, LuWifiOff, LuSun, LuMoon, LuLock } from 'react-icons/lu';
import { Button, IconButton, Toasts, useToast } from './ui';
import { Store, useStore } from './store';
import { Login } from './LoginPage';
import { Dashboard, Vitals, Doctor, Conflicts, Sync, go } from './pages';
import { logoutUser, touchActivity, isSessionLocked, subscribeLockState, lockSession, getCadreInfo } from './lib/auth';
import { useI18n, LANGUAGES, LangCode, AppTheme } from './lib/i18n';
import { PinLockModal } from './PinLockModal';

const useRoute = () => {
  const r = () => location.hash.slice(1) || '/login';
  const [h, setH] = useState(r);
  useEffect(() => {
    const f = () => setH(r());
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return [h.split('?')[0], new URLSearchParams(h.split('?')[1] || '')] as const;
};

function Shell() {
  const { s, setOnline, reloadLocalData } = useStore();
  const { lang, setLang, theme, setTheme, t } = useI18n();
  const [path, q] = useRoute();
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState(isSessionLocked());
  const toast = useToast();
  const [wasOffline, setWasOffline] = useState(!s.online);
  const [prevPending, setPrevPending] = useState(s.syncStats.pendingCount);

  useEffect(() => {
    return subscribeLockState(setLocked);
  }, []);

  // Monitor network transitions for transparent auto-sync feedback
  useEffect(() => {
    if (wasOffline && s.online) {
      setWasOffline(false);
      if (s.syncStats.pendingCount > 0) {
        toast(`🟢 Network connected: automatically syncing ${s.syncStats.pendingCount} offline record(s)...`);
      } else {
        toast(`🟢 Network connected: auto-sync active.`);
      }
    } else if (!wasOffline && !s.online) {
      setWasOffline(true);
      toast(`📡 Offline mode active: new entries will be saved locally and auto-synced when online.`);
    }
  }, [s.online, wasOffline, s.syncStats.pendingCount, toast]);

  // Notify when pending entries finish auto-syncing
  useEffect(() => {
    if (prevPending > 0 && s.syncStats.pendingCount === 0 && s.syncStats.syncedCount > 0) {
      toast(`☁️ Auto-sync complete: offline records successfully synced to cloud!`);
    }
    setPrevPending(s.syncStats.pendingCount);
  }, [s.syncStats.pendingCount, s.syncStats.syncedCount, prevPending, toast]);

  const navItems = [
    ['/dashboard', t.dashboard, LuUsers],
    ['/vitals', t.vitals, LuActivity],
    ['/doctor/triage', t.doctorTriage, LuStethoscope],
    ['/doctor/conflicts', t.conflicts, LuGitMerge],
    ['/sync', t.syncManager, LuRefreshCw]
  ] as const;

  const known = navItems.some(i => i[0] === path) || path === '/login';

  useEffect(() => { setOpen(false); }, [path]);

  // Track user activity for auto-lock
  useEffect(() => {
    const handleInteract = () => touchActivity();
    window.addEventListener('click', handleInteract);
    window.addEventListener('keydown', handleInteract);
    return () => {
      window.removeEventListener('click', handleInteract);
      window.removeEventListener('keydown', handleInteract);
    };
  }, []);

  // When user is authenticated, redirect away from /login directly to the workspace
  useEffect(() => {
    if (s.user && (path === '/login' || !path || path === '/')) {
      const isDoctorOrAdmin = s.user.role === 'DOCTOR' || s.user.role === 'ADMIN';
      go(isDoctorOrAdmin ? '/doctor/triage' : '/dashboard');
    }
  }, [s.user, path]);

  if (path !== '/login' && !s.user) {
    go('/login');
    return null;
  }
  if (path === '/login') return <Login />;

  const toggle = () => {
    setOnline(!s.online);
  };

  const handleSignOut = async () => {
    await logoutUser();
    await reloadLocalData();
    go('/login');
  };

  const isDoctorOrAdmin = s.user?.role === 'DOCTOR' || s.user?.role === 'ADMIN';

  return (
    <div className="shell">
      <aside className={`side ${open ? 'open' : ''}`} aria-label="Main navigation">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="brand" onClick={() => go(isDoctorOrAdmin ? '/doctor/triage' : '/dashboard')}>
            SETU
          </button>
          <span className="top" style={{ display: open ? 'flex' : 'none', border: 0, padding: 0, background: 'none' }}>
            <IconButton label="Close menu" size="sm" onClick={() => setOpen(false)}><LuX /></IconButton>
          </span>
        </div>

        {s.user && (
          <div style={{ margin: '6px 0 10px', padding: '6px 8px', background: 'rgba(0,0,0,0.03)', borderRadius: 6, border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--ink)' }}>{s.user.name}</span>
              <span style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: 10,
                background: getCadreInfo(s.user.cadre).bg,
                color: getCadreInfo(s.user.cadre).color
              }}>
                {s.user.cadre || s.user.role}
              </span>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--grey)', marginTop: 2 }}>
              {s.user.district} District
            </div>
          </div>
        )}

        {/* Multi-Language Dropdown */}
        <div style={{ margin: '4px 0 10px' }}>
          <label style={{ fontSize: '0.72rem', color: 'var(--grey)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 3 }}>
            🌐 Language / ਭਾਸ਼ਾ
          </label>
          <select
            value={lang}
            onChange={e => setLang(e.target.value as LangCode)}
            style={{ height: 32, fontSize: '0.8rem', padding: '0 6px' }}
            aria-label="Select Language"
          >
            {LANGUAGES.map(l => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        {/* Display Mode Switcher (Outdoor Sunlight / Dark / Default) */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: '0.72rem', color: 'var(--grey)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 3 }}>
            🎨 Display Mode
          </label>
          <div className="row" style={{ gap: 4 }}>
            <button
              type="button"
              className="btn sm"
              style={{
                flex: 1,
                padding: '0 4px',
                fontSize: '0.72rem',
                background: theme === 'default' ? 'var(--maroon)' : '#fff',
                color: theme === 'default' ? '#fff' : 'var(--ink)',
                border: '1px solid var(--line)'
              }}
              onClick={() => setTheme('default')}
            >
              Default
            </button>
            <button
              type="button"
              className="btn sm"
              style={{
                flex: 1.1,
                padding: '0 4px',
                fontSize: '0.72rem',
                background: theme === 'sunlight' ? '#000' : '#fff',
                color: theme === 'sunlight' ? '#fff' : '#000',
                border: '1px solid #000',
                fontWeight: 700
              }}
              onClick={() => setTheme('sunlight')}
              title="High-Contrast Mode for Direct Outdoor Sunlight"
            >
              ☀️ Sun
            </button>
            <button
              type="button"
              className="btn sm"
              style={{
                flex: 1,
                padding: '0 4px',
                fontSize: '0.72rem',
                background: theme === 'dark' ? '#333' : '#fff',
                color: theme === 'dark' ? '#fff' : 'var(--ink)',
                border: '1px solid var(--line)'
              }}
              onClick={() => setTheme('dark')}
            >
              🌙 Dark
            </button>
          </div>
        </div>

        {navItems.map(([p, l, I]) => (
          <button key={p} className="nav" aria-current={path === p ? 'page' : undefined} onClick={() => go(p)}>
            <I size={18} />{l}
          </button>
        ))}

        <div style={{ flex: 1 }} />
        <Button variant="outlined" size="sm" icon={s.online ? <LuWifi /> : <LuWifiOff />} onClick={toggle}>
          {s.online ? t.online : t.offline}
        </Button>
        <div className="row" style={{ gap: 4, width: '100%', marginTop: 4 }}>
          <Button variant="outlined" size="sm" icon={<LuLock />} onClick={() => lockSession()} style={{ flex: 1 }}>
            Lock
          </Button>
          <Button variant="text" size="sm" icon={<LuLogOut />} onClick={handleSignOut} style={{ flex: 1 }}>
            {t.signOut}
          </Button>
        </div>
      </aside>

      <div className="main">
        <div className="top" style={{ justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <IconButton label="Open menu" onClick={() => setOpen(true)}><LuMenu /></IconButton>
            <b style={{ color: 'var(--maroon)', letterSpacing: '.12em' }}>SETU</b>
            {s.user && (
              <span style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                padding: '2px 7px',
                borderRadius: 8,
                background: getCadreInfo(s.user.cadre).bg,
                color: getCadreInfo(s.user.cadre).color
              }}>
                {s.user.cadre || s.user.role}
              </span>
            )}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <select
              value={lang}
              onChange={e => setLang(e.target.value as LangCode)}
              style={{ height: 30, fontSize: '0.75rem', padding: '0 4px', width: 'auto' }}
              aria-label="Language Selector Mobile"
            >
              {LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn sm"
              style={{ height: 30, padding: '0 8px', fontSize: '0.75rem' }}
              onClick={() => setTheme(theme === 'sunlight' ? 'default' : theme === 'default' ? 'dark' : 'sunlight')}
              title="Toggle Display Theme"
            >
              {theme === 'sunlight' ? '☀️ Sun' : theme === 'dark' ? '🌙 Dark' : '🎨 Mode'}
            </button>
          </div>
        </div>
        {path === '/dashboard' && <Dashboard />}
        {path === '/vitals' && <Vitals pid={q.get('p') || ''} />}
        {path === '/doctor/triage' && <Doctor />}
        {path === '/doctor/conflicts' && <Conflicts />}
        {path === '/sync' && <Sync />}
        {!known && (
          <div className="page">
            <h1>Page not found</h1>
            <p>No screen exists at {path}.</p>
            <Button onClick={() => go(isDoctorOrAdmin ? '/doctor/triage' : '/dashboard')}>
              Go to dashboard
            </Button>
          </div>
        )}
      </div>

      {locked && s.user && <PinLockModal />}
    </div>
  );
}

export default function App() {
  return (
    <Toasts>
      <Store>
        <Shell />
      </Store>
    </Toasts>
  );
}
