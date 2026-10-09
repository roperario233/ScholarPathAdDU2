import { useState } from 'react';
import { Button, ModalShell } from './ui';

// Reusable reason dialog built on the shared ModalShell. It replaces
// window.prompt for status actions that require a recorded human reason so the
// justification is captured consistently. Today it backs application rejection;
// Stop, Conditional Revert, and Lapsed overrides reuse it as those stages land.
export default function ReasonModal({
  title,
  label = 'Reason',
  hint = '',
  confirmLabel = 'Confirm',
  confirmVariant = 'danger',
  onConfirm,
  onClose,
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const handleConfirm = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('A reason is required before this action can be recorded.');
      return;
    }
    onConfirm(trimmed);
  };

  return (
    <ModalShell title={title} onClose={onClose} className="w-[min(520px,100%)]">
      <div className="grid gap-3">
        <label className="grid gap-2 text-sm text-app-text">
          <span className="font-semibold">{label}</span>
          <textarea
            rows="3"
            value={reason}
            autoFocus
            placeholder={hint}
            onChange={(event) => {
              setReason(event.target.value);
              if (error) setError('');
            }}
          />
        </label>
        {error && <span className="text-sm text-rose-300" role="alert">{error}</span>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="button" variant={confirmVariant} onClick={handleConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </ModalShell>
  );
}
