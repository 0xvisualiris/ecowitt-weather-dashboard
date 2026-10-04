import { useState } from 'react';
import { type AdminSession, postJson } from '../lib';
import { go } from '../App';
import { t, translateApiError } from '../i18n';

export function AdminPasswordScreen({ forced, onSession }: { forced: boolean; onSession: (s: AdminSession) => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) { setError(t('adminPassword.mismatch')); return; }
    if (newPassword.length < 8) { setError(t('adminPassword.tooShort')); return; }
    setBusy(true);
    try {
      await postJson('/api/admin/password', { currentPassword, newPassword });
      // The change already told us mustChangePassword is now false – update
      // the gate's state directly instead of re-fetching it a moment later.
      onSession({ loggedIn: true, mustChangePassword: false });
      go({ screen: 'admin' });
    } catch (e) {
      setError(translateApiError((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card lg auth-card stack" onSubmit={submit}>
        <div className="eyebrow"><span>{t('adminPassword.title')}</span></div>
        {forced && <div className="note">{t('adminPassword.forcedNote')}</div>}
        <div className="field">
          <label className="label" htmlFor="cur-pass">{t('adminPassword.current')}</label>
          <input id="cur-pass" className="input" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
            autoComplete="current-password" autoFocus />
        </div>
        <div className="field">
          <label className="label" htmlFor="new-pass">{t('adminPassword.new')} <span className="faint">{t('adminPassword.newHint')}</span></label>
          <input id="new-pass" className="input" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <div className="field">
          <label className="label" htmlFor="new-pass2">{t('adminPassword.confirm')}</label>
          <input id="new-pass2" className="input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
        </div>
        {error && <div className="form-error">{error}</div>}
        <button className="btn-primary" type="submit" disabled={busy}>{t('adminPassword.title')}</button>
      </form>
    </div>
  );
}
