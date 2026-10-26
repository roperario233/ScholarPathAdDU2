import { useEffect, useState } from 'react';
import { Button, ModalShell } from './ui';
import { formatSessionDuration } from '../lib/sessionTimeout';

export default function SessionTimeoutModal({ reason, expiresAt, warningMs = 60_000, warningStartedAt, onStaySignedIn, onSignOut }) {
  const [now, setNow] = useState(warningStartedAt || expiresAt - warningMs);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const remaining = Math.max(0, expiresAt - now);
  const reasonText = reason === 'absolute'
    ? 'Your session is approaching its maximum sign-in duration.'
    : 'Your session is approaching its inactivity limit.';

  return (
    <ModalShell title="Your session is about to end" className="w-full max-w-lg">
      <p className="mt-0 text-sm text-app-muted">{reasonText}</p>
      <p className="text-app-text">
        You will be signed out in <strong>{formatSessionDuration(remaining)}</strong> unless you sign out now.
      </p>
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onSignOut}>Sign out now</Button>
        <Button type="button" variant="primary" onClick={onStaySignedIn}>
          {reason === 'absolute' ? 'Continue until session expiry' : 'Stay signed in'}
        </Button>
      </div>
      {reason === 'absolute' && (
        <p className="mb-0 mt-3 text-xs text-app-muted">Continuing does not extend the maximum session duration.</p>
      )}
    </ModalShell>
  );
}