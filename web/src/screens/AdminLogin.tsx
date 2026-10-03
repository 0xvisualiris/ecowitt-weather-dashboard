import { useState } from 'react';
import { postJson } from '../lib';
import { go } from '../App';

export function AdminLoginScreen() {
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
      go(r.mustChangePassword ? { screen: 'adminPassword' } : { screen: 'admin' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card lg auth-card stack" onSubmit={submit}>
        <div className="eyebrow"><span>Admin-Anmeldung</span></div>
        <div className="field">
          <label className="label" htmlFor="admin-user">Benutzername</label>
          <input id="admin-user" className="input" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" />
        </div>
        <div className="field">
          <label className="label" htmlFor="admin-pass">Passwort</label>
          <input id="admin-pass" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)}
            autoComplete="current-password" autoFocus />
        </div>
        {error && <div className="form-error">{error}</div>}
        <button className="btn-primary" type="submit" disabled={busy}>Anmelden</button>
        <div className="note">Standard: admin / admin. Das Passwort muss danach geändert werden.</div>
      </form>
    </div>
  );
}
