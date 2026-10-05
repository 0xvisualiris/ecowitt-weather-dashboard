import { useEffect, useRef, useState } from 'react';
import { type AdminSession } from '../lib';
import { go } from '../App';
import { t, translateApiError } from '../i18n';

interface LoginResponse { ok: boolean; mustChangePassword?: boolean; needsTotp?: boolean; error?: string }

export function AdminLoginScreen({ onSession }: { onSession: (s: AdminSession) => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (needsTotp) codeRef.current?.focus(); }, [needsTotp]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Plain fetch, not postJson: a wrong/missing 2FA code is still a
      // non-2xx response, but the body's `needsTotp` flag (not just the
      // error text) decides whether to keep showing the code field – that
      // needs the parsed body even on failure, which postJson's throw-only
      // error path discards.
      const r = await fetch('/api/admin/login', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, code: needsTotp ? code : undefined }),
      });
      const j: LoginResponse = await r.json();
      if (j.ok) {
        // Already know the resulting session from this response – no need to
        // ask the server again, which would just risk re-asking faster than
        // this same change can be observed.
        onSession({ loggedIn: true, mustChangePassword: !!j.mustChangePassword });
        go(j.mustChangePassword ? { screen: 'adminPassword' } : { screen: 'admin' });
        return;
      }
      if (j.needsTotp) {
        setNeedsTotp(true);
        setCode('');
        if (j.error) setError(translateApiError(j.error));
        return;
      }
      setError(translateApiError(j.error || r.statusText));
    } catch (e) {
      setError(translateApiError((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card lg auth-card stack" onSubmit={submit}>
        <div className="eyebrow"><span>{t('adminLogin.title')}</span></div>
        <div className="field">
          <label className="label" htmlFor="admin-user">{t('adminLogin.username')}</label>
          <input id="admin-user" className="input" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" disabled={needsTotp} />
        </div>
        <div className="field">
          <label className="label" htmlFor="admin-pass">{t('adminLogin.password')}</label>
          <input id="admin-pass" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)}
            autoComplete="current-password" autoFocus disabled={needsTotp} />
        </div>
        {needsTotp && (
          <div className="field">
            <label className="label" htmlFor="admin-totp">{t('adminLogin.totpCode')}</label>
            <input ref={codeRef} id="admin-totp" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
            <div className="note">{t('adminLogin.totpHint')}</div>
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
        <button className="btn-primary" type="submit" disabled={busy}>{t('adminLogin.submit')}</button>
        {!needsTotp && <div className="note">{t('adminLogin.note')}</div>}
      </form>
    </div>
  );
}
