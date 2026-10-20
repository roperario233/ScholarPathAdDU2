import { useState } from 'react';
import { Button, ModalShell } from './ui';

// Reusable reason dialog built on the shared ModalShell. It replaces
// window.prompt for status actions that require a recorded human reason so the
// justification is captured consistently. Today it backs application and
// Document Vault rejection; Stop, Conditional Revert, and Lapsed overrides reuse
// it as those stages land.
//
// Without `options` the reason is free text. With `options` ({ value, label,
// requiresNotes }) the reviewer picks a preset reason and may add notes; the
// recorded reason is "<label> — <notes>", or only the notes for an option that
// requires them (such as "Other").
export default function ReasonModal({
  title,
  label = 'Reason',
  hint = '',
  options = null,
  notesLabel = 'Notes',
  notesHint = '',
  confirmLabel = 'Confirm',
  confirmVariant = 'danger',
  onConfirm,
  onClose,
}) {
  const [choice, setChoice] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const selected = options ? options.find((option) => option.value === choice) || null : null;
  const notesRequired = Boolean(selected?.requiresNotes);

  const handleConfirm = () => {
    const trimmed = reason.trim();
    if (options) {
      if (!selected) {
        setError('Select a reason before this action can be recorded.');
        return;
      }
      if (notesRequired && !trimmed) {
        setError('Add a note that explains the reason.');
        return;
      }
      onConfirm(notesRequired ? trimmed : [selected.label, trimmed].filter(Boolean).join(' — '));
      return;
    }
    if (!trimmed) {
      setError('A reason is required before this action can be recorded.');
      return;
    }
    onConfirm(trimmed);
  };

  return (
    <ModalShell title={title} onClose={onClose} className="w-[min(520px,100%)]">
      <div className="grid gap-3">
        {options ? (
          <>
            <label className="grid gap-2 text-sm text-app-text">
              <span className="font-semibold">{label}</span>
              <select
                value={choice}
                autoFocus
                onChange={(event) => {
                  setChoice(event.target.value);
                  if (error) setError('');
                }}
              >
                <option value="">Select a reason…</option>
                {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            {hint ? <p className="m-0 text-xs text-app-muted">{hint}</p> : null}
            <label className="grid gap-2 text-sm text-app-text">
              <span className="font-semibold">{notesLabel} {notesRequired ? '(required)' : '(optional)'}</span>
              <textarea
                rows="3"
                value={reason}
                placeholder={notesHint}
                onChange={(event) => {
                  setReason(event.target.value);
                  if (error) setError('');
                }}
              />
            </label>
          </>
        ) : (
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
        )}
        {error && <span className="text-sm text-rose-300" role="alert">{error}</span>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="button" variant={confirmVariant} onClick={handleConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </ModalShell>
  );
}
