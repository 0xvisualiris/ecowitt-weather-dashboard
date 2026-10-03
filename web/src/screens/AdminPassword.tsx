import { useState } from 'react';
import { postJson } from '../lib';
import { go } from '../App';

export function AdminPasswordScreen({ forced }: { forced: boolean }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) { setError('Die Passwörter stimmen nicht überein.'); return; }
    if (newPassword.length < 8) { setError('Das neue Passwort muss mindestens 8 Zeichen lang sein.'); return; }
    setBusy(true);
    try {
      await postJson('/api/admin/password', { currentPassword, newPassword });
      go({ screen: 'admin' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card lg auth-card stack" onSubmit={submit}>
        <div className="eyebrow"><span>Passwort ändern</span></div>
        {forced && <div className="note">Das Standardpasswort muss vor der weiteren Nutzung geändert werden.</div>}
        <div className="field">
          <label className="label" htmlFor="cur-pass">Aktuelles Passwort</label>
          <input id="cur-pass" className="input" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
            autoComplete="current-password" autoFocus />
        </div>
        <div className="field">
          <label className="label" htmlFor="new-pass">Neues Passwort <span className="faint">(mind. 8 Zeichen)</span></label>
          <input id="new-pass" className="input" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <div className="field">
          <label className="label" htmlFor="new-pass2">Neues Passwort bestätigen</label>
          <input id="new-pass2" className="input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
        </div>
        {error && <div className="form-error">{error}</div>}
        <button className="btn-primary" type="submit" disabled={busy}>Passwort ändern</button>
      </form>
    </div>
  );
}
