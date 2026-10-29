import { useMemo, useState } from 'react';
import { Button, Card, FormField, StatusBadge } from './ui';
import { DEFAULT_APPROVER_ROLE, LADDER_ROLES, REVIEW_ROLE_LABELS } from '../lib/reviewScope';

// SOP step 7 routing (Consultation 2, 32:08-36:01): who approves depends on the
// school. Education's Dean approves directly, Engineering's Chairpersons approve
// without the Dean, and Computer Studies uses its Assistant Deans. The Head sets
// one row per school, or per cluster inside a school; anything unset is approved
// by the Chairperson. The database resolves the same rows in
// public.approver_role_for_student().
export default function ApprovalLevelsCard({ approvalLevels = [], academicPrograms = [], onSave, onDelete }) {
  const [draft, setDraft] = useState({ id: null, school: '', cluster: '', approverRole: 'dean' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const schools = useMemo(() => [...new Set(academicPrograms.map((entry) => entry.school).filter(Boolean))].sort(), [academicPrograms]);
  const clusters = useMemo(() => [...new Set(academicPrograms
    .filter((entry) => entry.school === draft.school && entry.cluster)
    .map((entry) => entry.cluster))].sort(), [academicPrograms, draft.school]);

  const update = (patch) => {
    setError('');
    setDraft((previous) => ({ ...previous, ...patch }));
  };
  const reset = () => setDraft({ id: null, school: '', cluster: '', approverRole: 'dean' });

  const save = async () => {
    setBusy(true);
    const result = await onSave?.(draft);
    setBusy(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    reset();
  };

  const remove = async (levelId) => {
    setBusy(true);
    const result = await onDelete?.(levelId);
    setBusy(false);
    if (result?.error) setError(result.error);
  };

  return (
    <Card
      title="Who approves for each school"
      action={<StatusBadge tone="info">Unset: {REVIEW_ROLE_LABELS[DEFAULT_APPROVER_ROLE]}</StatusBadge>}
    >
      <div className="grid gap-4">
        <p className="m-0 text-sm text-app-muted">
          After the interview, the recommendation goes to this level of the applicant&apos;s school for approval. A cluster row wins over its school row.
        </p>
        {approvalLevels.length ? (
          <ul className="m-0 grid gap-2 p-0">
            {approvalLevels.map((level) => (
              <li key={level.id} className="flex flex-col items-start gap-2 rounded-[14px] border border-app-border bg-app-surface px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0 text-sm text-app-text">
                  {[level.school, level.cluster].filter(Boolean).join(' · ')}
                  <span className="text-app-muted"> — {REVIEW_ROLE_LABELS[level.approverRole] || level.approverRole}</span>
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => update({ id: level.id, school: level.school, cluster: level.cluster || '', approverRole: level.approverRole })}>Edit</Button>
                  <Button type="button" variant="danger" disabled={busy} onClick={() => remove(level.id)}>Remove</Button>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="m-0 text-sm text-app-muted">No school-specific level yet. Every recommendation goes to the Chairperson.</p>}

        <div className="grid gap-3 md:grid-cols-3">
          <FormField label="School">
            <select value={draft.school} onChange={(event) => update({ school: event.target.value, cluster: '' })}>
              <option value="">Choose a school</option>
              {schools.map((school) => <option key={school} value={school}>{school}</option>)}
            </select>
          </FormField>
          <FormField label="Cluster" hint={clusters.length ? 'Optional. Leave blank for the whole school.' : 'This school has no clusters.'}>
            <select value={draft.cluster} disabled={!clusters.length} onChange={(event) => update({ cluster: event.target.value })}>
              <option value="">Whole school</option>
              {clusters.map((cluster) => <option key={cluster} value={cluster}>{cluster}</option>)}
            </select>
          </FormField>
          <FormField label="Approved by">
            <select value={draft.approverRole} onChange={(event) => update({ approverRole: event.target.value })}>
              {LADDER_ROLES.map((role) => <option key={role} value={role}>{REVIEW_ROLE_LABELS[role]}</option>)}
            </select>
          </FormField>
        </div>
        {error ? <p className="m-0 text-sm text-rose-700 dark:text-rose-200" role="alert">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          {draft.id ? <Button type="button" disabled={busy} onClick={reset}>Cancel edit</Button> : null}
          <Button type="button" variant="primary" disabled={busy || !draft.school} onClick={save}>{draft.id ? 'Save change' : 'Add approving level'}</Button>
        </div>
      </div>
    </Card>
  );
}
