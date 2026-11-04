import { useState } from 'react';
import { Button, FormField, Panel } from './ui';
import { getActorRoleLabel } from '../lib/applicationRequirements';
import { fmtDate } from '../lib/formatters';
import { GRANT_NOTE_MAX_LENGTH, describeGrantAmount, validateGrantAmount } from '../lib/grantAmount';

const sectionHeading = 'm-0 text-sm font-bold uppercase tracking-[0.1em] text-app-muted';

const toDraft = (record) => ({
  coveragePercent: record?.coveragePercent ?? '',
  amount: record?.amountPerSemester ?? '',
  note: record?.note || '',
});

// The Grant amount tab of the review modal. The school's approving level records
// the figure while the case is Recommended or Approved; everyone else who reads
// the tab (the Admissions Office) sees it read-only. It is a recorded award figure,
// never a disbursement.
export default function GrantAmountPanel({ applicationId, record, canEdit, status, onSave }) {
  const [draft, setDraft] = useState(() => toDraft(record));
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const { errors } = validateGrantAmount(draft);
  const update = (key) => (event) => {
    setDraft((previous) => ({ ...previous, [key]: event.target.value }));
    setSaved(false);
    if (error) setError('');
  };

  const submit = async (event) => {
    event.preventDefault();
    setShowErrors(true);
    if (Object.keys(errors).length) return;
    setBusy(true);
    setError('');
    try {
      const result = await onSave?.(applicationId, draft);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setSaved(true);
    } catch (failure) {
      setError(failure?.message || 'The grant amount could not be saved. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="grid gap-3">
      <div className="grid gap-1">
        <h4 className={sectionHeading}>Grant amount</h4>
        <p className="m-0 text-xs text-app-muted">
          Recorded by the school's approving level or the Admissions Office Admin for the release. This is a recorded figure, not a disbursement. The student sees it only after the results are released.
        </p>
      </div>

      {record ? (
        <div className="grid gap-1 rounded-[14px] border border-app-border bg-app-card p-3">
          <span className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">Recorded grant</span>
          <strong className="text-base text-app-text">{describeGrantAmount(record)}</strong>
          {record.note ? <p className="m-0 whitespace-pre-line text-sm text-app-text">{record.note}</p> : null}
          <span className="text-xs text-app-muted">
            {getActorRoleLabel(record.setByRole) || 'Recorded'}
            {record.updatedAt ? ` · ${fmtDate(record.updatedAt)}` : ''}
          </span>
        </div>
      ) : (
        <p className="m-0 rounded-[14px] border border-dashed border-app-border p-3 text-sm text-app-muted">
          {canEdit ? 'No grant amount recorded yet.' : 'Not yet set by the approving level.'}
        </p>
      )}

      {canEdit ? (
        <form className="grid gap-3" onSubmit={submit} noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Coverage (% of tuition)" error={showErrors ? errors.coveragePercent : ''}>
              <input type="number" inputMode="decimal" min="0" max="100" step="0.01" value={draft.coveragePercent} onChange={update('coveragePercent')} placeholder="e.g. 100" />
            </FormField>
            <FormField label="Amount per semester (₱)" error={showErrors ? errors.amount : ''}>
              <input type="number" inputMode="decimal" min="0" step="0.01" value={draft.amount} onChange={update('amount')} placeholder="e.g. 10000" />
            </FormField>
          </div>
          <FormField label="Note (optional)" error={showErrors ? errors.note : ''} hint={`${String(draft.note || '').length}/${GRANT_NOTE_MAX_LENGTH}`}>
            <textarea rows="3" value={draft.note} maxLength={GRANT_NOTE_MAX_LENGTH} onChange={update('note')} placeholder="Basis for the amount, if useful to the Admissions Office." />
          </FormField>
          {showErrors && errors.form ? <p className="m-0 text-sm text-rose-300" role="alert">{errors.form}</p> : null}
          {error ? <p className="m-0 text-sm text-rose-300" role="alert">{error}</p> : null}
          {saved ? <p className="m-0 text-sm text-emerald-600 dark:text-emerald-300" role="status">Grant amount saved.</p> : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs text-app-muted">Editable while the application is {status === 'Approved' ? 'Approved' : 'Recommended or Approved'}.</span>
            <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : record ? 'Update grant amount' : 'Save grant amount'}</Button>
          </div>
        </form>
      ) : null}
    </Panel>
  );
}
