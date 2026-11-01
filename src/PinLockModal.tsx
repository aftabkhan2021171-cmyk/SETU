import React, { useState, useEffect } from 'react';
import { LuLock, LuEye, LuEyeOff, LuLogOut, LuShieldAlert } from 'react-icons/lu';
import {
  getActiveSession,
  unlockSessionWithPin,
  logoutUser,
  getLockCooldownRemainingSeconds
} from './lib/auth';
import { Button } from './ui';
import { useStore } from './store';
import { go } from './pages';

export function PinLockModal() {
  const { reloadLocalData } = useStore();
  const session = getActiveSession();
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(getLockCooldownRemainingSeconds());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      const remaining = getLockCooldownRemainingSeconds();
      setCooldown(remaining);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin || cooldown > 0) return;
    setError(null);
    setLoading(true);
    try {
      await unlockSessionWithPin(pin);
      await reloadLocalData();
    } catch (err: any) {
      setError(err.message || 'Invalid PIN');
      setCooldown(getLockCooldownRemainingSeconds());
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await logoutUser();
    await reloadLocalData();
    go('/login');
  };

  const user = session?.user;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Screen locked"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16
      }}
    >
      <div
        style={{
          background: 'var(--card-bg, #ffffff)',
          color: 'var(--text-color, #1a1a1a)',
          borderRadius: 16,
          padding: '28px 24px',
          width: '100%',
          maxWidth: 380,
          boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
          border: '1px solid var(--border-color, #e0e0e0)',
          textAlign: 'center'
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            background: 'var(--primary-bg, #f3ede2)',
            color: 'var(--primary, #8B6E32)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 26,
            marginBottom: 16
          }}
        >
          <LuLock />
        </div>

        <h2 style={{ margin: '0 0 6px', fontSize: '1.25rem', fontWeight: 700 }}>
          Screen Locked
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: '0.88rem', color: 'var(--grey, #666)' }}>
          {user ? `Logged in as ${user.name}` : 'Session locked for security'}
        </p>

        {user && (
          <div
            style={{
              display: 'inline-block',
              background: 'var(--chip-bg, #f0f0f0)',
              padding: '3px 10px',
              borderRadius: 12,
              fontSize: '0.75rem',
              fontWeight: 600,
              marginBottom: 18,
              letterSpacing: '0.04em'
            }}
          >
            {user.role} • {user.district}
          </div>
        )}

        <form onSubmit={handleUnlock}>
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <input
              type={showPin ? 'text' : 'password'}
              placeholder="Enter Staff PIN to unlock"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              disabled={loading || cooldown > 0}
              autoFocus
              style={{
                width: '100%',
                padding: '12px 42px 12px 14px',
                fontSize: '1rem',
                borderRadius: 8,
                border: '1px solid var(--border, #ccc)',
                background: 'var(--input-bg, #fafafa)',
                boxSizing: 'border-box'
              }}
            />
            <button
              type="button"
              onClick={() => setShowPin(!showPin)}
              tabIndex={-1}
              style={{
                position: 'absolute',
                right: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'var(--grey, #888)',
                cursor: 'pointer',
                fontSize: 18,
                display: 'flex',
                alignItems: 'center'
              }}
            >
              {showPin ? <LuEyeOff /> : <LuEye />}
            </button>
          </div>

          {error && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: '#d32f2f',
                fontSize: '0.82rem',
                marginBottom: 12,
                justifyContent: 'center'
              }}
            >
              <LuShieldAlert /> {error}
            </div>
          )}

          {cooldown > 0 && (
            <div
              style={{
                background: '#fff3cd',
                color: '#856404',
                padding: '6px 10px',
                borderRadius: 6,
                fontSize: '0.8rem',
                marginBottom: 12
              }}
            >
              ⏱️ Cooldown active: wait <strong>{cooldown}s</strong> before retry
            </div>
          )}

          <Button
            type="submit"
            size="lg"
            variant="primary"
            disabled={!pin || loading || cooldown > 0}
            style={{ width: '100%', marginBottom: 10 }}
          >
            {loading ? 'Unlocking...' : cooldown > 0 ? `Wait (${cooldown}s)` : 'Unlock Session'}
          </Button>

          <Button
            type="button"
            size="md"
            variant="text"
            onClick={handleSignOut}
            style={{ width: '100%', color: 'var(--grey, #666)' }}
          >
            <LuLogOut style={{ marginRight: 6 }} /> Sign Out / Switch Account
          </Button>
        </form>
      </div>
    </div>
  );
}
