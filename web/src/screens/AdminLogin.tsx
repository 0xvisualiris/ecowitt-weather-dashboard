import { useState } from 'react';
import { type AdminSession, postJson } from '../lib';
import { go } from '../App';
import { t, translateApiError } from '../i18n';

export function AdminLoginScreen({ onSession }: { onSession: (s: AdminSession) => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<{ ok: true; mustChangePassword: boolean }>('/api/admin/login', { username, password });
      // Already know the resulting session from this response – no need to
      // ask the server again, which would just risk re-asking faster than
      // this same change can be observed.
      onSession({ loggedIn: true, mustChangePassword: r.mustChangePassword });
      go(r.mustChangePassword ? { screen: 'adminPassword' } : { screen: 'admin' });
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
          <input id="admin-user" className="input" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" />
        </div>
        <div className="field">
          <label className="label" htmlFor="admin-pass">{t('adminLogin.password')}</label>
          <input id="admin-pass" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)}
            autoComplete="current-password" autoFocus />
        </div>
        {error && <div className="form-error">{error}</div>}
        <button className="btn-primary" type="submit" disabled={busy}>{t('adminLogin.submit')}</button>
        <div className="note">{t('adminLogin.note')}</div>
      </form>
    </div>
  );
}
