import { StatusBadge } from './ui';
import { REQUIREMENT_STATE_LABELS, describeRequirementTypes } from '../lib/applicationRequirements';
import { getAttributeVerificationLabel, getAttributeVerificationTone } from '../lib/verification';
import { fmtCurrency, fmtDate } from '../lib/formatters';

// Shared read-only pieces of an application: the required-document checklist and
// the self-reported profile snapshot. The application workspace, the student's
// submitted-application view, and the staff review modal all render them, so
// the three never describe the same application differently.

export function RequirementStateBadge({ state }) {
  const entry = REQUIREMENT_STATE_LABELS[state] || REQUIREMENT_STATE_LABELS.missing;
  return <StatusBadge tone={entry.tone} className="shrink-0">{entry.label}</StatusBadge>;
}

export function RequirementChecklist({ requirements, onPreview }) {
  if (!requirements.length) return <p className="m-0 text-sm text-app-muted">This program does not list required documents.</p>;
  return (
    <ul className="m-0 grid gap-2 p-0">
      {requirements.map((requirement) => (
        <li key={requirement.id} className="grid gap-1 border-b border-app-border/60 pb-2 last:border-b-0 last:pb-0">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <span className="min-w-0 flex-1 text-sm text-app-text">{requirement.label}</span>
            <RequirementStateBadge state={requirement.state} />
          </div>
          {requirement.attached.length ? (
            <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-app-muted">
              {requirement.attached.map((doc) => (
                onPreview
                  ? <button key={doc.id} type="button" className="underline decoration-dotted underline-offset-2 hover:text-app-text" onClick={() => onPreview(doc)}>{doc.title} · {doc.verificationStatus}</button>
                  : <span key={doc.id}>{doc.title} · {doc.verificationStatus}</span>
              ))}
            </span>
          ) : <span className="text-xs text-app-muted">Accepts {describeRequirementTypes(requirement)}</span>}
        </li>
      ))}
    </ul>
  );
}

const formatAcademic = (academic) => {
  if (academic?.value == null) return 'Not encoded';
  return academic.credential === 'qpi' ? Number(academic.value).toFixed(2) : String(academic.value);
};

const SnapshotRow = ({ label, value, verification }) => (
  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-app-border/60 py-2 last:border-b-0">
    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">{label}</span>
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <strong className="text-sm text-app-text">{value || 'Not encoded'}</strong>
      {verification ? <StatusBadge tone={getAttributeVerificationTone(verification)}>{getAttributeVerificationLabel(verification)}</StatusBadge> : null}
    </span>
  </div>
);

// Values are self-reported; a badge only reflects Document Vault proof reviewed
// by the Admissions Office, never a Registrar record.
export function ProfileSnapshotList({ snapshot }) {
  if (!snapshot) return <p className="m-0 text-sm text-app-muted">No profile snapshot was recorded.</p>;
  return (
    <div className="grid">
      <SnapshotRow label="Name" value={snapshot.fullName} />
      {snapshot.studentNumber ? <SnapshotRow label="Student number" value={snapshot.studentNumber} /> : null}
      <SnapshotRow label="Program" value={snapshot.degreeProgram} />
      <SnapshotRow label="Year standing" value={snapshot.yearStandingLabel} />
      <SnapshotRow label={snapshot.academic?.label || 'Academic record'} value={formatAcademic(snapshot.academic)} verification={snapshot.academic?.verification} />
      <SnapshotRow label="Household income" value={snapshot.householdIncome?.value == null ? '' : fmtCurrency(snapshot.householdIncome.value)} verification={snapshot.householdIncome?.verification} />
      <SnapshotRow label="Citizenship" value={snapshot.citizenship?.value} verification={snapshot.citizenship?.verification} />
      {snapshot.capturedAt ? <p className="m-0 pt-2 text-xs text-app-muted">Self-reported values as of {fmtDate(snapshot.capturedAt)}.</p> : null}
    </div>
  );
}
