import { useEffect, useState } from 'react';
import { LuMenu, LuX, LuUsers, LuActivity, LuStethoscope, LuGitMerge, LuRefreshCw, LuLogOut, LuWifi, LuWifiOff } from 'react-icons/lu';
import { Button, IconButton, Toasts } from './ui';
import { Store, useStore } from './store';
import { Login } from './LoginPage';
import { Dashboard, Vitals, Doctor, Conflicts, Sync, go } from './pages';
import { logoutUser, touchActivity } from './lib/auth';

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

const items = [
  ['/dashboard', 'Field dashboard', LuUsers],
  ['/vitals', 'Vitals', LuActivity],
  ['/doctor/triage', 'Doctor triage', LuStethoscope],
  ['/doctor/conflicts', 'Conflicts', LuGitMerge],
  ['/sync', 'Sync manager', LuRefreshCw]
] as const;

function Shell() {
  const { s, setOnline, reloadLocalData } = useStore();
  const [path, q] = useRoute();
  const [open, setOpen] = useState(false);
  const known = items.some(i => i[0] === path) || path === '/login';

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

        {items.map(([p, l, I]) => (
          <button key={p} className="nav" aria-current={path === p ? 'page' : undefined} onClick={() => go(p)}>
            <I size={18} />{l}
          </button>
        ))}

        <div style={{ flex: 1 }} />
        <Button variant="outlined" size="sm" icon={s.online ? <LuWifi /> : <LuWifiOff />} onClick={toggle}>
          {s.online ? 'Online' : 'Offline'}
        </Button>
        <Button variant="text" size="sm" icon={<LuLogOut />} onClick={handleSignOut}>
          Sign out ({s.user?.name?.split(' ')[0]})
        </Button>
      </aside>

      <div className="main">
        <div className="top">
          <IconButton label="Open menu" onClick={() => setOpen(true)}><LuMenu /></IconButton>
          <b style={{ color: 'var(--maroon)', letterSpacing: '.12em' }}>SETU</b>
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
