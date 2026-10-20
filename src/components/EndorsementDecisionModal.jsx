import { useState } from 'react';
import { Button, ModalShell } from './ui';
import { ENDORSEMENT_NOTE_PRESETS } from '../lib/endorsement';

// One short decision dialog. The document gate lives in the Documents tab and
// the endorsement panel's action, so this only captures the hand-off or
// endorsement note.
export default function EndorsementDecisionModal({
  application,
  mode = 'endorse',
  onConfirm,
  onClose,
  busy = false,
  error = '',
}) {
  const [note, setNote] = useState('');
  const isHandoff = mode === 'handoff';
  const title = isHandoff ? 'Send to endorsement' : 'Record endorsement';
  const confirmLabel = isHandoff ? 'Send to endorsement' : 'Endorse';

  return (
    <ModalShell title={title} onClose={busy ? undefined : onClose}>
      <div className="grid gap-4">
        <div>
          <h3 className="m-0 text-base font-semibold text-app-text">{application.studentName}</h3>
          <p className="m-0 mt-1 text-sm text-app-muted">
            {application.scholarshipTitle} · {application.studentProgram || 'Program on file'}
          </p>
        </div>

        <p className="m-0 rounded-[14px] border border-app-border bg-app-surface px-3 py-2 text-sm text-app-muted">
          {isHandoff
            ? 'The application moves to the Department Chair’s endorsement queue. The note is added to the status history.'
            : 'The endorsement is recorded with this note in the application status history.'}
        </p>

        <div className="grid gap-2">
          <span className="text-sm font-semibold text-app-text">Suggested notes</span>
          <div className="flex flex-wrap gap-2">
            {ENDORSEMENT_NOTE_PRESETS.map((preset) => (
              <Button key={preset} type="button" variant="secondary" onClick={() => setNote(preset)}>
                {preset}
              </Button>
            ))}
          </div>
        </div>

        <label className="grid gap-1 text-sm text-app-text">
          <span className="font-semibold">{isHandoff ? 'Note (optional)' : 'Recommendation note'}</span>
          <textarea
            rows="4"
            value={note}
            maxLength={2000}
            onChange={(event) => setNote(event.target.value)}
            placeholder={isHandoff
              ? 'Tell the Department Chair what was verified.'
              : 'Record the department’s recommendation.'}
          />
        </label>

        {error ? (
          <p className="m-0 rounded-[14px] border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border pt-3">
          <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            onClick={() => onConfirm?.({ note: note.trim() })}
          >
            {busy ? 'Saving…' : confirmLabel}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
