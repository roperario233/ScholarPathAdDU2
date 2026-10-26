import { useState } from 'react';
import { Button, FormField, ModalShell, WarningIcon } from './ui';
import { describeInterviewWaiver } from '../lib/interview';

/**
 * The warning that precedes a sub-committee recommendation recorded without an
 * interview outcome (SOP step 5 → 6). The waiver is recorded on the deliberation
 * with the reviewer's reason, and App.jsx cancels the live schedule before the
 * stage moves, so this dialog states the consequence, captures the required
 * reason, and asks for confirmation.
 */
export default function ProceedWithoutInterviewModal({
  application,
  interview,
  onConfirm,
  onClose,
  busy = false,
  error = '',
}) {
  const waiver = describeInterviewWaiver(interview);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');

  // A waiver is a recorded decision, not a quiet toggle: the reason is kept in the
  // schedule history, the deliberation, and the cancellation the applicant and
  // panel receive.
  const handleConfirm = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setReasonError('Record why the recommendation proceeds without an interview.');
      return;
    }
    onConfirm?.({ reason: trimmed });
  };

  return (
    <ModalShell
      title={waiver.headline}
      onClose={busy ? undefined : onClose}
      className="max-h-[calc(100vh-2.5rem)] w-[min(560px,100%)] overflow-y-auto"
      // A confirmation alert reads best centred: the icon and the question are the
      // only things in the header, and Cancel in the footer (or the backdrop)
      // dismisses the dialog.
      header={(
        <div className="mb-5 grid justify-items-center gap-2.5 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full border border-amber-400/50 bg-amber-400/15 text-amber-600 dark:border-amber-300/40 dark:bg-amber-400/20 dark:text-amber-200">
            <WarningIcon className="h-6 w-6" />
          </span>
          <h2 className="m-0 max-w-[34ch] text-lg font-semibold leading-snug text-app-text">{waiver.headline}</h2>
        </div>
      )}
    >
      <div className="grid gap-4">
        <div>
          <h3 className="m-0 text-base font-semibold text-app-text">{application.studentName}</h3>
          <p className="m-0 mt-1 text-sm text-app-muted">
            {application.scholarshipTitle} · {application.studentProgram || 'Program on file'}
          </p>
        </div>

        <p className="m-0 rounded-[14px] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-100">
          {waiver.detail}
        </p>

        {waiver.cancels ? (
          <div className="grid gap-1 rounded-[14px] border border-app-border bg-app-surface p-3 text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">Interview to cancel</span>
            <strong className="text-app-text">{waiver.when}</strong>
            <span className="text-app-muted">{waiver.where}</span>
          </div>
        ) : null}

        <ul className="m-0 grid gap-1 pl-5 text-sm text-app-muted">
          <li>The recommendation is recorded without an interview outcome.</li>
          {waiver.cancels ? <li>The interview is cancelled and its calendar invitation is removed.</li> : null}
          {waiver.cancels ? <li>The applicant and the interview panel are notified of the cancellation.</li> : null}
          <li>The waiver and this reason are recorded in the application history.</li>
        </ul>

        <FormField
          label="Reason for proceeding without an interview (required)"
          hint="Kept in the schedule history and the deliberation."
          error={reasonError}
        >
          <textarea
            rows="3"
            value={reason}
            autoFocus
            maxLength={2000}
            disabled={busy}
            placeholder="Explain why this application is recommended without an interview."
            onChange={(event) => {
              setReason(event.target.value);
              if (reasonError) setReasonError('');
            }}
          />
        </FormField>

        {error ? (
          <p className="m-0 rounded-[14px] border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border pt-3">
          <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" variant="primary" disabled={busy} onClick={handleConfirm}>
            {busy ? 'Recording…' : 'Proceed without interview'}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
