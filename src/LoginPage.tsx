import { useState, FormEvent, useEffect } from 'react';
import {
  LuShieldPlus,
  LuCircleCheck,
  LuHeartPulse,
  LuStethoscope,
  LuIdCard,
  LuInfo,
  LuLock,
  LuEye,
  LuEyeOff,
  LuWifiOff,
  LuArrowRight,
  LuShieldCheck,
  LuMapPin,
  LuSettings,
  LuZap
} from 'react-icons/lu';
import { Button, useToast, Dialog } from './ui';
import { useStore } from './store';
import { go } from './pages';
import { loginWithCredentials, getApiBaseUrl, setApiBaseUrl, HealthWorkerCadre, CADRE_INFO, SEEDED_OFFLINE_USERS } from './lib/auth';
import { useI18n, LANGUAGES, LangCode } from './lib/i18n';
import './login.css';

type RoleHint = 'chw' | 'doctor';
const roles = [
  { id: 'chw' as RoleHint, title: 'Community Health Worker', text: 'Field surveys, rapid vitals and triage sync', Icon: LuHeartPulse },
  { id: 'doctor' as RoleHint, title: 'Doctor / Clinician', text: 'Record triage, approvals and conflict review', Icon: LuStethoscope }
];

export function Login() {
  const { s, setOnline, reloadLocalData } = useStore();
  const { lang, setLang, theme, setTheme } = useI18n();
  const toast = useToast();
  const [roleHint, setRoleHint] = useState<RoleHint>('chw');
  const [selectedCadre, setSelectedCadre] = useState<HealthWorkerCadre>('CHW');
  const [id, setId] = useState('chw1');
  const [pin, setPin] = useState('Test-Password-1');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [e, setE] = useState<{ id?: string; pin?: string }>({});

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiUrl, setApiUrl] = useState('');

  useEffect(() => {
    getApiBaseUrl().then(url => setApiUrl(url || (typeof window !== 'undefined' ? `${window.location.origin} (Vite /api Proxy)` : '')));
  }, []);

  const saveSettings = async () => {
    await setApiBaseUrl(apiUrl);
    setSettingsOpen(false);
    toast(`Server URL set to ${apiUrl}`);
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const x: { id?: string; pin?: string } = {};
    if (id.trim().length < 3) x.id = 'Enter a staff ID or username (3 or more characters).';
    if (pin.length < 4) x.pin = 'Password/PIN must be 4 or more characters.';
    setE(x);
    if (x.id || x.pin) return toast('Sign in failed. Check the highlighted fields.', true);

    setLoading(true);
    try {
      const user = await loginWithCredentials(id.trim(), pin, 'SETU Web/Mobile Device', !s.online);
      await reloadLocalData();

      // Check if server role mismatches user's role hint card
      const assignedRole = user.role.toUpperCase();
      const hintRoleUpper = roleHint === 'chw' ? 'CHW' : 'DOCTOR';
      if (assignedRole !== hintRoleUpper) {
        toast(`Signed in as ${user.name}. Server-assigned role: ${user.role} (${user.district} district).`);
      } else {
        toast(`Welcome, ${user.name} (${user.district})`);
      }

      if (assignedRole === 'DOCTOR' || assignedRole === 'ADMIN') {
        go('/doctor/triage');
      } else {
        go('/dashboard');
      }
    } catch (err: any) {
      toast(err.message || 'Authentication failed. Please verify credentials.', true);
    } finally {
      setLoading(false);
    }
  };

  const quickFieldLogin = async (staffId: string) => {
    setId(staffId);
    setPin('Test-Password-1');
    setLoading(true);
    try {
      const user = await loginWithCredentials(staffId, 'Test-Password-1', 'SETU Mobile Device', true);
      await reloadLocalData();
      toast(`Offline field access active: ${user.name} (${user.district})`);
      const assignedRole = user.role.toUpperCase();
      if (assignedRole === 'DOCTOR' || assignedRole === 'ADMIN') {
        go('/doctor/triage');
      } else {
        go('/dashboard');
      }
    } catch (err: any) {
      toast(err.message || 'Quick login failed', true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="lgn">
      <header className="lg-head">
        <div className="lg-logo">
          <span className="lg-badge"><LuShieldPlus size={22} /></span>
          <span className="lg-name">SETU</span>
        </div>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <select
            value={lang}
            onChange={e => setLang(e.target.value as LangCode)}
            style={{ height: 28, fontSize: '0.75rem', padding: '0 4px', width: 'auto', background: '#fff' }}
            aria-label="Language Selector"
          >
            {LANGUAGES.map(l => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="lg-chip"
            style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, fontSize: '0.75rem', padding: '0 8px' }}
            onClick={() => setTheme(theme === 'sunlight' ? 'default' : 'sunlight')}
            title="Toggle Outdoor High-Contrast Sunlight Mode"
          >
            {theme === 'sunlight' ? ' Sunlight: ON' : ' Bright Mode'}
          </button>
          <button
            type="button"
            className="lg-chip"
            style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, fontSize: '0.75rem', padding: '0 8px' }}
            onClick={() => setSettingsOpen(true)}
            title="Configure Server URL"
          >
            <LuSettings size={14} /> Server
          </button>
        </div>
      </header>

      <main className="lg-main">
        <h1 className="lg-title">SETU</h1>
        <p className="lg-sub">Work Anywhere. Sync Everywhere. Lose Nothing.</p>
        <span className="lg-pill">
          <LuShieldCheck size={14} />
          {s.online ? 'Online: connecting to backend' : 'Offline mode: local encrypted unlock'}
        </span>

        <form className="lg-card" onSubmit={submit} noValidate>
          <div className="lg-row">
            <span className="lg-cap">Health Worker Cadre / Category</span>
            <span className="lg-role" style={{ color: CADRE_INFO[selectedCadre]?.color }}>
              {CADRE_INFO[selectedCadre]?.label} · {CADRE_INFO[selectedCadre]?.title.split('(')[0]}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {(Object.keys(CADRE_INFO) as HealthWorkerCadre[]).map(cadreKey => {
              const info = CADRE_INFO[cadreKey];
              const isSelected = selectedCadre === cadreKey;
              return (
                <button
                  type="button"
                  key={cadreKey}
                  style={{
                    padding: '5px 11px',
                    borderRadius: 16,
                    border: `1.5px solid ${isSelected ? info.color : '#D1D5DB'}`,
                    background: isSelected ? info.bg : '#FFFFFF',
                    color: isSelected ? info.color : '#374151',
                    fontWeight: isSelected ? 700 : 500,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    transition: 'all 0.15s ease'
                  }}
                  onClick={() => {
                    setSelectedCadre(cadreKey);
                    if (cadreKey === 'ASHA') { setId('asha1'); setRoleHint('chw'); }
                    else if (cadreKey === 'ANM') { setId('anm1'); setRoleHint('chw'); }
                    else if (cadreKey === 'AWW') { setId('aww1'); setRoleHint('chw'); }
                    else if (cadreKey === 'CHW') { setId('chw1'); setRoleHint('chw'); }
                    else if (cadreKey === 'DOCTOR') { setId('doctor1'); setRoleHint('doctor'); }
                    else if (cadreKey === 'ADMIN') { setId('admin1'); setRoleHint('doctor'); }
                  }}
                >
                  <span>{info.label}</span>
                </button>
              );
            })}
          </div>

          <div className="lg-row">
            <span className="lg-cap" id="rl">Select operating role hint</span>
            <span className="lg-role">{roleHint === 'chw' ? 'Front-line CHW' : 'Clinician'}</span>
          </div>

          <div className="lg-roles" role="radiogroup" aria-labelledby="rl">
            {roles.map(({ id: r, title, text, Icon }) => (
              <button
                type="button"
                key={r}
                role="radio"
                aria-checked={roleHint === r}
                className={`lg-rc ${roleHint === r ? 'on' : ''}`}
                onClick={() => {
                  setRoleHint(r);
                  if (r === 'chw' && id === 'doctor1') {
                    setId('chw1');
                  } else if (r === 'doctor' && id === 'chw1') {
                    setId('doctor1');
                  }
                }}
              >
                <span className="lg-rc-top">
                  <Icon size={24} />
                  {roleHint === r && <LuCircleCheck size={22} className="lg-tick" aria-hidden />}
                </span>
                <b>{title}</b>
                <span>{text}</span>
              </button>
            ))}
          </div>

          <label htmlFor="sid" className="lg-label">Staff ID</label>
          <div className={`lg-input ${e.id ? 'bad' : ''}`}>
            <LuIdCard size={20} />
            <input
              id="sid"
              placeholder="chw1 or doctor1"
              value={id}
              onChange={x => setId(x.target.value)}
              aria-invalid={!!e.id}
              autoComplete="username"
            />
          </div>
          {e.id ? <div className="err">{e.id}</div> : (
            <p className="lg-help">
              <LuInfo size={14} />Seeded cadres: <code>asha1</code>, <code>anm1</code>, <code>aww1</code>, <code>chw1</code>, <code>doctor1</code>, <code>admin1</code>
            </p>
          )}

          <div className="lg-row" style={{ marginTop: 18 }}>
            <label htmlFor="pin" className="lg-label" style={{ margin: 0 }}>Password / PIN</label>
            <span className="muted" style={{ fontSize: '0.8rem' }}>Default: Test-Password-1</span>
          </div>
          <div className={`lg-input ${e.pin ? 'bad' : ''}`}>
            <LuLock size={20} />
            <input
              id="pin"
              type={show ? 'text' : 'password'}
              value={pin}
              onChange={x => setPin(x.target.value)}
              aria-invalid={!!e.pin}
              autoComplete="current-password"
            />
            <button
              type="button"
              className="lg-eye"
              aria-label={show ? 'Hide password' : 'Show password'}
              onClick={() => setShow(!show)}
            >
              {show ? <LuEyeOff size={20} /> : <LuEye size={20} />}
            </button>
          </div>
          {e.pin && <div className="err">{e.pin}</div>}

          <div className="lg-off">
            <span className="lg-off-i"><LuWifiOff size={18} /></span>
            <div>
              <b>Offline Mode Simulator</b>
              <span>{s.online ? 'Online: Network active' : 'Simulating offline airplane mode'}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!s.online}
              aria-label="Offline simulation mode"
              className={`lg-sw ${!s.online ? 'on' : ''}`}
              onClick={() => setOnline(!s.online)}
            >
              <i />
            </button>
          </div>

          <Button size="lg" type="submit" className="lg-go" disabled={loading}>
            {loading ? 'Authenticating...' : 'Enter Portal'}
            <LuArrowRight />
          </Button>

          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Button
              type="button"
              variant="outlined"
              size="sm"
              icon={<LuZap />}
              onClick={() => quickFieldLogin(id in SEEDED_OFFLINE_USERS ? id : (roleHint === 'chw' ? 'chw1' : 'doctor1'))}
              disabled={loading}
            >
              Instant Offline Access ({SEEDED_OFFLINE_USERS[id]?.user.name || (roleHint === 'chw' ? 'CHW Harpreet' : 'Dr. Gurpreet')})
            </Button>
          </div>

          <div className="lg-foot">
            <span><LuMapPin size={14} />District Offline Node</span>
            <span className="lg-ver">AES-GCM & PBKDF2 Encrypted</span>
          </div>
        </form>

        <p className="lg-note">Synthetic demo records only. Zero silent data loss offline architecture.</p>
      </main>

      {settingsOpen && (
        <Dialog title="Server Connection Settings" onClose={() => setSettingsOpen(false)}>
          <div className="field">
            <label htmlFor="cfg-url">Backend Server URL</label>
            <input
              id="cfg-url"
              value={apiUrl}
              onChange={ev => setApiUrl(ev.target.value)}
              placeholder="http://localhost:8080 or http://10.0.2.2:8080"
            />
            <p className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
              Use <code>http://localhost:8080</code> on web, or <code>http://10.0.2.2:8080</code> inside Android Emulator.
            </p>
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <Button onClick={saveSettings}>Save URL</Button>
            <Button variant="outlined" onClick={() => setSettingsOpen(false)}>Cancel</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
