import { Fragment, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Camera, Circle, CircleAlert, CircleCheck, OctagonAlert, Paperclip, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { Button, Card, FormField, RequiredMark, SettingToggle, StatusBadge } from './ui';
import ProfileAvatar from './ProfileAvatar';
import PhotoCaptureModal from './PhotoCaptureModal';
import { AVATAR_ACCEPT } from '../lib/avatarStorage';
import { COURSE_SHIFT_REMINDER } from '../lib/applicationForm';
import { getAcademicProgramGroups } from '../lib/academicPrograms';
import { REVIEW_ROLE_LABELS, getReviewScopeLabel, isReviewerRole } from '../lib/reviewScope';
import { SelectPicker } from '../pages/LoginScreen';
import { describeAttributeVerification, deriveAttributeVerifications, getAttributeVerificationTone, isAttributeProofSettled } from '../lib/verification';
import { VAULT_REQUIREMENT_STATE_LABELS, getRequirementUploadPreset } from '../lib/applicationRequirements';
import {
  APPLIANCE_OPTIONS,
  ASSET_OPTIONS,
  economicStatusOptions,
  parentEmploymentOptions,
  validateFinancialProfileSection,
} from '../lib/financialDetails';
import {
  ADDRESS_MAX_LENGTH,
  AWARDS_MAX_LENGTH,
  COUNTRY_MAX_LENGTH,
  ESSAY_MAX_LENGTH,
  MAX_GRANT_ROWS,
  MAX_HOUSEHOLD_ADULT_ROWS,
  MAX_SIBLING_ROWS,
  NAME_PART_MAX_LENGTH,
  PRONOUNS_MAX_LENGTH,
  SCHOOL_FIELD_MAX_LENGTH,
  applicantStatusOptions,
  applyApplicantStatus,
  applyYearStanding,
  communityServiceOptions,
  composeFullName,
  grantLevelOptions,
  grantStatusOptions,
  grantTypeOptions,
  housingTypeOptions,
  sexAtBirthOptions,
  siblingStatusOptions,
  splitLegacyFullName,
  academicStandingOptions,
  citizenshipOptions,
  civilStatusOptions,
  deriveYearStanding,
  employmentOptions,
  familyPositionOptions,
  getApplicantStatus,
  getMissingRequiredAnswers,
  getProgramChoiceOptions,
  getStandingRequirements,
  getVerifiableAttributeOption,
  getYearStandingOptions,
  grantHistoryOptions,
  honorsRankOptions,
  hsStrandOptions,
  ipCommunityOptions,
  isGrantListActive,
  pwdOptions,
  validateAcademicSection,
  validateAddressSection,
  validateBackgroundSection,
  validateFamilySection,
  validatePasswordChange,
  validatePersonalSection,
  APPLICATION_FORM_SECTIONS,
  religionOptions,
  requiresStudentNumber,
} from '../lib/profile';

const controlClass = 'h-12 py-0';
// "Part 3 of your application form." — the section's place in the numbered menu.
const formPart = (key) => `Part ${APPLICATION_FORM_SECTIONS.findIndex((section) => section.key === key) + 1} of your Application Form.`;
const asText = (value) => (value === undefined || value === null ? '' : String(value));

// Shared draft/validate/save lifecycle for one My Profile section. The draft
// re-syncs whenever the saved profile changes, so a successful save (or a
// change made elsewhere, such as the Smart Eligibility Checker) never leaves a
// stale form behind.
function useSectionForm({ initialValues, validate, onSave, onDirtyChange, previewProofImpact, attributeVerifications, previewVerifications }) {
  const initialKey = JSON.stringify(initialValues);
  // The saved values the draft was last synced to; null forces a re-sync.
  const [syncedKey, setSyncedKey] = useState(initialKey);
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState({ tone: '', message: '' });
  const [isSaving, setIsSaving] = useState(false);

  if (syncedKey !== initialKey) {
    setSyncedKey(initialKey);
    setValues(JSON.parse(initialKey));
    setErrors({});
  }

  const isDirty = JSON.stringify(values) !== initialKey;
  // Attributes whose Document Vault proof this draft would make Outdated, so the
  // form can warn before the student saves.
  const proofWarnings = isDirty && previewProofImpact ? previewProofImpact(values) : [];
  // The badges follow the draft, not only the saved profile: picking "Yes" on a
  // claim reads Unverified right away instead of "No proof needed" until Save, so
  // the student sees the proof the answer asks for while they are still on it.
  const verifications = isDirty && previewVerifications
    ? { ...attributeVerifications, ...previewVerifications(values) }
    : attributeVerifications;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // `relatedKeys` lets a field clear errors it can resolve in a neighbour, such as
  // the 1st program choice clearing a duplicate message on the 2nd and 3rd.
  const update = (patch, relatedKeys = []) => {
    setValues((previous) => ({ ...previous, ...patch }));
    setErrors((previous) => {
      const next = { ...previous };
      [...Object.keys(patch), ...relatedKeys].forEach((key) => delete next[key]);
      return next;
    });
    setStatus({ tone: '', message: '' });
  };

  const reset = () => {
    setSyncedKey(null);
    setStatus({ tone: '', message: '' });
  };

  // `onSuccess` runs after a successful save; "Save and continue" uses it to open
  // the next application-form section.
  const submit = async (event, { onSuccess } = {}) => {
    event?.preventDefault();
    const result = validate(values);
    if (Object.keys(result.errors).length) {
      setErrors(result.errors);
      setStatus({ tone: 'error', message: 'Review the highlighted fields before saving.' });
      return;
    }

    setIsSaving(true);
    setStatus({ tone: '', message: '' });
    const saved = await onSave(result.values);
    setIsSaving(false);
    if (!saved?.success) {
      setStatus({ tone: 'error', message: saved?.message || 'Unable to save your changes.' });
      return;
    }
    // Normalized values (formatted mobile number, rounded QPI) come back
    // through the saved profile, so re-sync to it rather than keep the draft.
    setSyncedKey(null);
    setStatus({ tone: 'success', message: saved.message || 'Changes saved.' });
    onSuccess?.();
  };

  return { values, errors, status, isSaving, isDirty, proofWarnings, verifications, update, reset, submit };
}

function FormStatus({ status }) {
  const toneClass = status.tone === 'success'
    ? 'text-emerald-600 dark:text-emerald-300'
    : 'text-rose-600 dark:text-rose-300';
  return (
    <p className={`m-0 min-w-0 flex-1 basis-56 text-sm ${toneClass}`} role="status" aria-live="polite">
      {status.message}
    </p>
  );
}

// Set by My Profile around a student's application-form section: the next
// unfinished section and how to open it. Absent for staff and Account security,
// so their forms keep the single save button.
export const SectionContinueContext = createContext(null);

function SectionForm({ title, description, form, submitLabel = 'Save changes', children }) {
  const proceed = useContext(SectionContinueContext);
  return (
    <Card title={title}>
      {description && <p className="-mt-1 mb-5 text-sm text-app-muted">{description}</p>}
      <form className="grid gap-5" onSubmit={form.submit} noValidate>
        {children}
        <ProofImpactWarning warnings={form.proofWarnings} />
        <div className="flex flex-wrap items-center gap-3 border-t border-app-border pt-4">
          <Button variant="primary" type="submit" disabled={!form.isDirty || form.isSaving}>
            {form.isSaving ? 'Saving…' : submitLabel}
          </Button>
          {/* Unsaved input is saved first; a clean form simply steps to the next part. */}
          {proceed && (form.isDirty || proceed.next) && (
            <Button
              type="button"
              className="gap-2"
              disabled={form.isSaving}
              onClick={() => (form.isDirty ? form.submit(null, { onSuccess: proceed.onContinue }) : proceed.onContinue())}
            >
              {form.isDirty ? 'Save and continue' : `Next: ${proceed.next.label}`}
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
          )}
          {form.isDirty && (
            <Button type="button" onClick={form.reset} disabled={form.isSaving}>Discard changes</Button>
          )}
          <FormStatus status={form.status} />
        </div>
      </form>
    </Card>
  );
}

// Shown while a draft would change a value that a Document Vault proof attests.
// Saving still works; this tells the student which proof will need replacing
// before their next application can be submitted.
function ProofImpactWarning({ warnings = [] }) {
  if (!warnings.length) return null;
  const labels = warnings.map(({ key, previousStatus }) => `${getVerifiableAttributeOption(key)?.label || key} (${previousStatus.toLowerCase()})`);
  return (
    <div role="status" className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-app-text">
      <TriangleAlert size={18} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
      <p className="m-0">
        Your proof for <strong>{labels.join(', ')}</strong> was uploaded for the current value. If you save this change, that proof will be marked Outdated and you will need to upload a new one in the Document Vault before you submit another application. Applications you already submitted keep the values you declared.
      </p>
    </div>
  );
}

// A stored value shown where an input would be. It repeats FormField's label and
// hint layout around a .readonly-control box (the same border, radius, surface,
// and height as the profile inputs), so a read-only row lines up with the
// editable fields beside it instead of reading as a separate card.
function ReadOnlyField({ label, value, note, className = '' }) {
  return (
    <div className={`grid min-w-0 content-start gap-2 ${className}`}>
      <span className="min-w-0 text-sm font-semibold text-app-text">{label}</span>
      <div className="readonly-control">{value || 'Not set'}</div>
      {note && <small className="field-hint">{note}</small>}
    </div>
  );
}

// A verification badge for one profile attribute, with a link to attach its
// proof document in the Document Vault when it is not verified yet. The state is
// derived from the student's linked proof documents (src/lib/verification.js).
// It never blocks eligibility matching; an application needs a current proof
// attached before it is submitted. An answer that needs no proof reads its own
// reason instead of a request for a document: `Not applicable` when it is not
// read for the student's year standing, `No proof needed` when the answer claims
// nothing, or `Not answered` while the optional answer is still "Not specified".
// The action is a quiet chip beside the badge, deliberately not `link-btn`: inside
// the authenticated shell that class is a page action (40px tall, painted border and
// background), which dwarfed the status pill and wrapped the field's label line.
function AttributeVerification({ attributeKey, attributeVerifications = {}, savedVerifications = null, onAttachProof }) {
  const status = attributeVerifications[attributeKey] || 'Unverified';
  // `attributeVerifications` follows the unsaved draft; `savedVerifications` is
  // what the profile holds. While they disagree the proof cannot be attached yet:
  // a file uploaded now would attest the saved answer, not the one on screen, and
  // would read Outdated the moment the student saves.
  const awaitsSave = Boolean(savedVerifications) && (savedVerifications[attributeKey] || 'Unverified') !== status;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
      <StatusBadge tone={getAttributeVerificationTone(status)} title={describeAttributeVerification(status)}>{status}</StatusBadge>
      {!isAttributeProofSettled(status) && onAttachProof && awaitsSave && (
        <span className="text-xs font-semibold text-amber-600 dark:text-amber-300">Save, then attach proof</span>
      )}
      {!isAttributeProofSettled(status) && onAttachProof && !awaitsSave && (
        <button type="button" className="proof-action" onClick={() => onAttachProof(attributeKey)}>
          <Paperclip size={13} aria-hidden="true" />
          {status === 'Outdated' ? 'Upload new proof' : status === 'Pending' ? 'View proof' : 'Attach proof'}
        </button>
      )}
    </span>
  );
}

function SelectField({ label, hint, error, value, onChange, options, placeholder, labelAdornment, fieldKey, required = false }) {
  return (
    <FormField label={label} hint={hint} error={error} labelAdornment={labelAdornment} fieldKey={fieldKey} required={required}>
      <select className={controlClass} value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)}>
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </FormField>
  );
}

const assignmentNote = {
  student: 'Set from your degree program.',
  // The academic reviewer ladder. A Dean owns a school, an Assistant Dean a cluster,
  // and a Chairperson a department; each scope is assigned by an operator, never
  // self-editable, because it decides which cases the account can read.
  dean: 'Every department in your school. Managed by the Admissions Office.',
  assistant_dean: 'Every department in your cluster. Managed by the Admissions Office.',
  department_chair: 'Your department and its degree programs. Managed by the Admissions Office.',
  admissions_office: 'Application preparation, document verification, and the endorsement hand-off.',
  admissions_head: 'All office authority, plus endorsement, approval, release, catalog, and announcements.',
};

// Both Admissions Office lanes belong to the central office, so the read-only
// field reads "Office" for either of them.
const isAdmissionsRole = (role) => role === 'admissions_office' || role === 'admissions_head';

// The year standing decides which answers an application reads, so the
// overview says which credential the student is matched on.
const standingNote = (standing) => {
  if (standing.isIncomingFirstYear) return 'Matched on your senior high school general average.';
  if (standing.isContinuing) return 'Matched on your annual QPI.';
  return 'Choose your year standing in Academic profile.';
};

const completenessGroupNotes = {
  details: 'Included in every application you submit. A mobile number enables SMS reminders.',
};

// The application-form section states from getApplicationFormProgress(): a check
// when complete, an amber mark while answers or claim proofs are missing, and a
// red mark when a proof was reverted for resubmission or is outdated.
const FORM_SECTION_STATUS = {
  complete: { Icon: CircleCheck, className: 'text-emerald-500', text: 'Complete' },
  incomplete: { Icon: CircleAlert, className: 'text-amber-500', text: 'Not finished' },
  alert: { Icon: OctagonAlert, className: 'text-rose-500', text: 'Needs attention' },
};

export function FormSectionStatusIcon({ state, size = 16, className = '' }) {
  const { Icon, className: tone } = FORM_SECTION_STATUS[state] || FORM_SECTION_STATUS.incomplete;
  return <Icon size={size} className={`shrink-0 ${tone} ${className}`} aria-hidden="true" />;
}

export const getFormSectionStatusText = (state) => (FORM_SECTION_STATUS[state] || FORM_SECTION_STATUS.incomplete).text;

// The proof rows a section needs beyond its answers: a reverted or outdated proof
// of an answer the checklist does not list on its own row (the parents' names,
// the residing address, honors), and a claim with no proof yet.
const getSectionProofRows = (section) => {
  const answered = new Set(section.items.map((item) => item.key));
  return [
    ...section.alerts.map((alert) => ({ key: alert.key, label: `${alert.label} (proof)` })),
    ...section.unprovenClaims.map((claim) => ({ key: claim.key, label: claim.label })),
  ]
    .filter((row, index, rows) => !answered.has(row.key) && rows.findIndex((entry) => entry.key === row.key) === index)
    .map((row) => ({ ...row, section: section.key, done: true, proof: true }));
};

function ApplicationFormChecklist({ formProgress, standing, onEditSection, attributeVerifications, onAttachProof }) {
  return (
    <Card
      title="Your application form"
      action={<span className="text-sm text-app-muted"><strong className="text-app-text">{formProgress.answered}</strong> of {formProgress.total} answered</span>}
    >
      <p className="-mt-1 mb-4 text-sm text-app-muted">
        Every AdDU scholarship application copies these answers when you submit it, so complete each part once. {standingNote(standing)}
      </p>
      {formProgress.proofsPending > 0 && (
        <p className="-mt-2 mb-3 text-sm text-amber-600 dark:text-amber-300">
          {formProgress.proofsPending === 1 ? '1 proof' : `${formProgress.proofsPending} proofs`} still {formProgress.proofsPending === 1 ? 'needs' : 'need'} attaching or replacing in your Document Vault before you can submit.
        </p>
      )}
      <div
        className="h-3 overflow-hidden rounded-full bg-app-surface"
        role="progressbar"
        aria-label="Application form answered"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={formProgress.percent}
      >
        <div className="h-full rounded-full bg-gradient-to-r from-ateneo to-sky-400 transition-[width]" style={{ width: `${formProgress.percent}%` }} />
      </div>
      <div className="mt-5 grid gap-5">
        {formProgress.sections.map((section) => {
          const proofRows = getSectionProofRows(section);
          return (
            <section key={section.key} className="grid gap-2" aria-labelledby={`form-section-${section.key}`}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <h4 id={`form-section-${section.key}`} className="m-0 flex min-w-0 items-center gap-2 text-sm font-bold text-app-text">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-app-surface text-xs text-app-muted" aria-hidden="true">{section.number}</span>
                  <span className="min-w-0">{section.label}</span>
                </h4>
                <span className="flex items-center gap-2 text-xs font-semibold text-app-muted">
                  <FormSectionStatusIcon state={section.state} />
                  {section.state === 'complete' ? `${section.completed} of ${section.total} answered` : section.description}
                  <button type="button" className="proof-action" onClick={() => onEditSection(section.key)}>Open</button>
                </span>
              </div>
              <ul className="m-0 grid list-none gap-2 p-0 md:grid-cols-2">
                {[...section.items, ...proofRows].map((item) => (
                  <CompletenessItem key={item.key} item={item} status={attributeVerifications[item.key]} onEditSection={onEditSection} onAttachProof={onAttachProof} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Card>
  );
}

function CompletenessItem({ item, status, onEditSection, onAttachProof }) {
  // A verification badge only means something once the answer is filled in.
  const showStatus = item.done && status !== undefined;
  const showAttachProof = showStatus && !isAttributeProofSettled(status) && onAttachProof;
  return (
    <li className="grid min-h-11 grid-cols-1 items-center gap-x-3 gap-y-2 rounded-xl bg-app-surface px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto]">
      {/* A fixed two-column row: the answer keeps the free space and wraps its own
          text, while the verification state sits with the action that resolves it,
          right-aligned. As flex items the badge and the chip could split, and a wrapped
          chip landed alone at the row's left edge. */}
      <span className="flex min-w-0 items-center gap-2 text-sm text-app-text">
        {item.proof
          ? <Paperclip size={18} className="shrink-0 text-app-muted" aria-hidden="true" />
          : item.done
            ? <CircleCheck size={18} className="shrink-0 text-emerald-500" aria-hidden="true" />
            : <Circle size={18} className="shrink-0 text-app-muted" aria-hidden="true" />}
        <span className="min-w-0">{item.label}{!item.proof && <span className="sr-only">{item.done ? ' (complete)' : ' (missing)'}</span>}</span>
      </span>
      <span className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {showStatus && <StatusBadge tone={getAttributeVerificationTone(status)} title={describeAttributeVerification(status)}>{status}</StatusBadge>}
        {showAttachProof && (
          <button type="button" className="proof-action shrink-0" onClick={() => onAttachProof(item.key)}>
            <Paperclip size={13} className="shrink-0" aria-hidden="true" />
            {status === 'Pending' ? 'View proof' : status === 'Outdated' ? 'Upload new proof' : 'Attach proof'}
          </button>
        )}
        {!item.done && (
          <button type="button" className="proof-action" onClick={() => onEditSection(item.section)}>Add</button>
        )}
      </span>
    </li>
  );
}

// Which scholarships a document applies to, kept to one short line however large
// the catalog is: it names at most two, from whichever list is shorter (those
// that ask for it or those that do not), and otherwise gives a count.
const describeDocumentScope = (item, openCount) => {
  if (item.askedByAll) return '';
  const titles = (list) => list.map((scholarship) => scholarship.title);
  if (item.notAskedBy.length <= 2 && item.notAskedBy.length < item.scholarships.length) {
    return `Not needed for ${titles(item.notAskedBy).join(' or ')}`;
  }
  if (item.scholarships.length <= 2) return `Only for ${titles(item.scholarships).join(' and ')}`;
  return `For ${item.scholarships.length} of ${openCount} open scholarships`;
};

// The documents the open AdDU internal scholarships ask for at the student's
// standing, read against the whole Document Vault, plus the application
// statement that every submission needs.
function DocumentChecklistCard({ checklist, standing, hasDefaultStatement, onUploadDocument, onEditSection }) {
  const { items, scholarships, ready, total } = checklist;
  const audience = standing.isIncomingFirstYear ? ' for incoming first-years' : standing.isContinuing ? ' for enrolled students' : '';
  const intro = total
    ? `Required by open AdDU scholarships${audience}. Upload each once and reuse it.`
    : scholarships.length
      ? 'No required documents listed.'
      : 'No AdDU internal scholarship is open right now.';
  return (
    <Card
      title="Documents for applications"
      action={total ? <span className="text-sm text-app-muted"><strong className="text-app-text">{ready}</strong> of {total} ready</span> : null}
    >
      <p className="-mt-1 mb-4 text-sm text-app-muted">{intro}</p>
      {total > 0 && (
        <ul className="m-0 grid list-none gap-2 p-0">
          {items.map((item) => {
            const state = VAULT_REQUIREMENT_STATE_LABELS[item.state] || VAULT_REQUIREMENT_STATE_LABELS.missing;
            const scope = describeDocumentScope(item, scholarships.length);
            return (
              <li key={item.key} className="grid min-h-11 grid-cols-1 items-center gap-x-3 gap-y-2 rounded-xl bg-app-surface px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-semibold text-app-text">{item.label}</span>
                  {scope && <span className="text-xs text-app-muted">{scope}</span>}
                </span>
                <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                  {onUploadDocument && (
                    <button type="button" className="proof-action shrink-0" onClick={() => onUploadDocument(getRequirementUploadPreset(item, standing))}>
                      {item.state !== 'attached' && item.state !== 'verified' && <Paperclip size={13} className="shrink-0" aria-hidden="true" />}
                      {item.state === 'missing' ? 'Upload' : item.state === 'rejected' ? 'Upload again' : item.state === 'outdated' ? 'Upload new proof' : 'View'}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className={`grid grid-cols-1 items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto] ${total > 0 ? 'mt-4 border-t border-app-border pt-4' : ''}`}>
        <span className="grid min-w-0 gap-0.5">
          <span className="text-sm font-semibold text-app-text">Default statement/essay</span>
          <span className="text-xs text-app-muted">Optional. Prefills each application's statement/essay.</span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <StatusBadge tone={hasDefaultStatement ? 'success' : 'neutral'}>{hasDefaultStatement ? 'Saved' : 'Not set'}</StatusBadge>
          <button type="button" className="proof-action shrink-0" onClick={() => onEditSection('personal')}>{hasDefaultStatement ? 'Edit' : 'Write'}</button>
        </span>
      </div>
    </Card>
  );
}

export function ProfileOverview({ profile = {}, completeness, formProgress = null, documentChecklist = null, onEditSection, attributeVerifications = {}, onAttachProof, onUploadDocument }) {
  // Staff have a single group of personal details, so headings would only add noise.
  const showGroups = completeness.groups.length > 1;
  return (
    <div className="grid gap-4">
      {formProgress ? (
        <ApplicationFormChecklist
          formProgress={formProgress}
          standing={completeness.standing}
          onEditSection={onEditSection}
          attributeVerifications={attributeVerifications}
          onAttachProof={onAttachProof}
        />
      ) : (
      <Card title="Profile completeness">
        <div className="flex items-center gap-3">
          <div
            className="h-3 flex-1 overflow-hidden rounded-full bg-app-surface"
            role="progressbar"
            aria-label="Profile completeness"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={completeness.percent}
          >
            <div className="h-full rounded-full bg-gradient-to-r from-ateneo to-sky-400 transition-[width]" style={{ width: `${completeness.percent}%` }} />
          </div>
          <strong className="w-12 text-right text-app-text">{completeness.percent}%</strong>
        </div>
        {showGroups && <p className="mb-0 mt-3 text-sm text-app-muted">{standingNote(completeness.standing)}</p>}
        <div className="mt-4 grid gap-5">
          {completeness.groups.map((group) => (
            <section key={group.key} className="grid gap-2" aria-label={showGroups ? group.label : undefined}>
              {showGroups && (
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h4 className="m-0 text-sm font-bold text-app-text">{group.label}</h4>
                    <span className="text-xs font-semibold text-app-muted">{group.completed} of {group.total} complete</span>
                  </div>
                  <p className="m-0 text-xs text-app-muted">{completenessGroupNotes[group.key]}</p>
                </div>
              )}
              <ul className="m-0 grid list-none gap-2 p-0 md:grid-cols-2">
                {group.items.map((item) => (
                  <CompletenessItem key={item.key} item={item} status={attributeVerifications[item.key]} onEditSection={onEditSection} onAttachProof={onAttachProof} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Card>
      )}
      {documentChecklist && (
        <DocumentChecklistCard
          checklist={documentChecklist}
          standing={completeness.standing}
          hasDefaultStatement={Boolean(String(profile.essay || '').trim())}
          onUploadDocument={onUploadDocument}
          onEditSection={onEditSection}
        />
      )}
    </div>
  );
}

// The profile photo applies immediately instead of joining the Personal
// information draft: it is a stored object (avatars bucket + profiles.avatar_path),
// not one of the text fields the section saves together. The note keeps it
// distinct from the verified application photo requirements.
function ProfilePhotoCard({ fullName = '', avatar = {}, isSaving = false, onChangeAvatar, onRemoveAvatar }) {
  const [status, setStatus] = useState({ tone: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const applyPhoto = async (file) => {
    setBusy(true);
    setStatus({ tone: '', message: '' });
    const result = await onChangeAvatar?.(file);
    setBusy(false);
    const success = Boolean(result?.success);
    setStatus({ tone: success ? 'success' : 'error', message: result?.message || (success ? 'Profile photo updated.' : 'Your photo could not be saved.') });
    return success ? { ok: true } : { error: result?.message || 'Your photo could not be saved.' };
  };

  const handleFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) applyPhoto(file);
  };

  const removePhoto = async () => {
    setBusy(true);
    setStatus({ tone: '', message: '' });
    const result = await onRemoveAvatar?.();
    setBusy(false);
    setStatus({ tone: result?.success ? 'success' : 'error', message: result?.message || 'Your profile photo could not be removed.' });
  };

  const working = busy || isSaving;

  return (
    <section className="grid gap-3 rounded-xl border border-app-border bg-app-surface/70 p-4" aria-label="Profile photo">
      <div className="flex min-w-0 flex-wrap items-start gap-4">
        <ProfileAvatar src={avatar.url} name={fullName} size="xl" />
        <div className="grid min-w-0 flex-1 gap-2">
          <div className="grid gap-1">
            <strong className="text-sm font-bold text-app-text">Profile photo</strong>
            <p className="m-0 text-sm text-app-muted">
              This photo appears in the header and sidebar. It is not sent with applications.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => setCameraOpen(true)} disabled={working}>
              <Camera size={16} aria-hidden="true" /> Take photo
            </Button>
            <label className={`inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl border border-app-border bg-app-card px-4 py-2 text-sm font-semibold text-app-text transition hover:-translate-y-px focus-within:ring-4 focus-within:ring-blue-500/20 ${working ? 'pointer-events-none opacity-60' : ''}`}>
              Upload photo
              <input type="file" accept={AVATAR_ACCEPT} className="sr-only" onChange={handleFile} disabled={working} />
            </label>
            {avatar.path ? (
              <Button type="button" variant="ghost" onClick={removePhoto} disabled={working}>Remove</Button>
            ) : null}
          </div>
          {status.message ? (
            <p className={`m-0 text-sm ${status.tone === 'success' ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`} role="status" aria-live="polite">
              {status.message}
            </p>
          ) : null}
        </div>
      </div>
      {cameraOpen ? (
        <PhotoCaptureModal
          title="Take your profile photo"
          mode="portrait"
          fileNamePrefix="profile-photo"
          showGuide={false}
          onUsePhoto={applyPhoto}
          onClose={() => setCameraOpen(false)}
        />
      ) : null}
    </section>
  );
}

// A short repeatable list (siblings, household members, grants). Each row is a
// small grid of inputs with a remove button; blank rows are dropped on save by the
// section validator. `columns` is `[{ key, label, type, options, placeholder }]`.
// `required` marks the whole list with the red asterisk while it needs a row.
function RepeatableRows({ legend, rows, columns, max, addLabel, error, onChange, required = false }) {
  const setCell = (index, key, value) => onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)));
  const blankRow = () => Object.fromEntries(columns.map((column) => [column.key, '']));
  const atMax = rows.length >= max;
  return (
    <fieldset className="m-0 grid gap-3 border-0 p-0">
      <legend className="mb-1 text-sm font-semibold text-app-text">
        {legend}
        {required && <RequiredMark />}
      </legend>
      {rows.map((row, index) => (
        <div key={index} className="grid gap-3 rounded-xl border border-app-border bg-app-surface/60 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <strong className="text-sm font-bold text-app-text">{legend} {index + 1}</strong>
            <button
              type="button"
              className="proof-action !text-rose-600 dark:!text-rose-300"
              onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
              aria-label={`Remove ${legend.toLowerCase()} ${index + 1}`}
            >
              <Trash2 size={14} aria-hidden="true" /> Remove
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {columns.map((column, columnIndex) => {
              // A lone last field takes the full row so a two-column grid never leaves a gap.
              const spanClass = columns.length % 2 === 1 && columnIndex === columns.length - 1 ? 'sm:col-span-2' : '';
              return (
                <label key={column.key} className={`grid min-w-0 content-start gap-1 ${spanClass}`}>
                  <span className="text-xs font-semibold text-app-muted">{column.label}</span>
                  {column.type === 'select' ? (
                    <select className={controlClass} value={row[column.key] ?? ''} onChange={(event) => setCell(index, column.key, event.target.value)}>
                      {column.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  ) : (
                    <input
                      className={controlClass}
                      value={row[column.key] ?? ''}
                      inputMode={column.type === 'age' ? 'numeric' : undefined}
                      onChange={(event) => setCell(index, column.key, column.type === 'age' ? event.target.value.replace(/\D/g, '').slice(0, 3) : event.target.value)}
                    />
                  )}
                </label>
              );
            })}
          </div>
        </div>
      ))}
      {error ? <span className="text-sm text-rose-300" role="alert">{error}</span> : null}
      <div className="grid gap-1">
        <Button type="button" className="w-full justify-center border-dashed sm:w-auto sm:justify-self-start" onClick={() => onChange([...rows, blankRow()])} disabled={atMax}>
          <Plus size={16} aria-hidden="true" /> {addLabel}
        </Button>
        {atMax ? <small className="field-hint">You can list up to {max}.</small> : null}
      </div>
    </fieldset>
  );
}

const todayInputValue = () => new Date().toISOString().slice(0, 10);

const flagsOf = (source, options) => ({
  ...Object.fromEntries(options.map((option) => [option.key, Boolean(source?.[option.key])])),
  others: asText(source?.others),
});

export function PersonalSection({ profile, role, roleLabel, onSave, onDirtyChange, avatar = {}, onChangeAvatar, onRemoveAvatar }) {
  const isStudent = role === 'student';
  // "Last, First Middle" is unambiguous, so only that form prefills the parts.
  const legacyParts = asText(profile.fullName).includes(',')
    ? splitLegacyFullName(profile.fullName)
    : { firstName: '', middleName: '', lastName: '' };
  const form = useSectionForm({
    initialValues: {
      firstName: asText(profile.firstName) || legacyParts.firstName,
      middleName: asText(profile.middleName) || legacyParts.middleName,
      lastName: asText(profile.lastName) || legacyParts.lastName,
      fullName: asText(profile.fullName),
      phone: asText(profile.phone),
      religion: asText(profile.religion),
      civilStatus: asText(profile.civilStatus),
      birthdate: asText(profile.birthdate),
      sexAtBirth: asText(profile.sexAtBirth),
      pronouns: asText(profile.pronouns),
      essay: asText(profile.essay),
    },
    validate: validatePersonalSection,
    onSave,
    onDirtyChange,
  });
  const { values, errors, update } = form;
  // The red marks follow this draft, not the saved profile, so a required answer
  // stops being starred the moment it is filled in. The composed name stands in
  // for the parts exactly as saving composes it, so the forms never disagree.
  const need = isStudent
    ? getMissingRequiredAnswers({
      ...profile,
      fullName: composeFullName(values) || values.fullName,
      phone: values.phone,
      civilStatus: values.civilStatus,
      birthdate: values.birthdate,
      sexAtBirth: values.sexAtBirth,
      religion: values.religion,
      pronouns: values.pronouns,
    })
    : new Set();
  // The fallback Full name input replaces the parts only while both are blank, so
  // the mark sits on it, then moves to whichever part is still missing.
  const nameFallbackShown = !(values.lastName || values.firstName);
  const nameNeedsAnswer = need.has('fullName');

  return (
    <SectionForm title="Personal information" description={isStudent ? `${formPart('personal')} Your name, birthdate, religion, civil status, and mobile number are copied into each application.` : 'Your name and contact details across ScholarPath.'} form={form}>
      <ProfilePhotoCard
        fullName={values.fullName || profile.fullName}
        avatar={avatar}
        isSaving={avatar.isSaving}
        onChangeAvatar={onChangeAvatar}
        onRemoveAvatar={onRemoveAvatar}
      />
      <div className="grid gap-4 md:grid-cols-2">
        {isStudent ? (
          <>
            <FormField fieldKey="fullName lastName" label="Last name" hint="Printed as the surname on your application." error={errors.lastName} required={nameNeedsAnswer && !nameFallbackShown && !values.lastName}>
              <input className={controlClass} value={values.lastName} onChange={(event) => update({ lastName: event.target.value.slice(0, NAME_PART_MAX_LENGTH) })} autoComplete="family-name" maxLength={NAME_PART_MAX_LENGTH} aria-invalid={Boolean(errors.lastName)} />
            </FormField>
            <FormField label="First name" error={errors.firstName} required={nameNeedsAnswer && !nameFallbackShown && !values.firstName}>
              <input className={controlClass} value={values.firstName} onChange={(event) => update({ firstName: event.target.value.slice(0, NAME_PART_MAX_LENGTH) })} autoComplete="given-name" maxLength={NAME_PART_MAX_LENGTH} aria-invalid={Boolean(errors.firstName)} />
            </FormField>
            <FormField label="Middle name" hint="Optional." error={errors.middleName}>
              <input className={controlClass} value={values.middleName} onChange={(event) => update({ middleName: event.target.value.slice(0, NAME_PART_MAX_LENGTH) })} autoComplete="additional-name" maxLength={NAME_PART_MAX_LENGTH} aria-invalid={Boolean(errors.middleName)} />
            </FormField>
            {values.lastName || values.firstName ? (
              <ReadOnlyField
                label="Full name"
                value={composeFullName(values)}
              />
            ) : (
              <FormField fieldKey="fullName" label="Full name" hint="Needed to apply until you add your last and first name." error={errors.fullName} required={nameNeedsAnswer}>
                <input className={controlClass} value={values.fullName} onChange={(event) => update({ fullName: event.target.value })} autoComplete="name" maxLength={100} aria-invalid={Boolean(errors.fullName)} required />
              </FormField>
            )}
          </>
        ) : (
          <FormField label="Full name" error={errors.fullName}>
            <input className={controlClass} value={values.fullName} onChange={(event) => update({ fullName: event.target.value })} autoComplete="name" maxLength={100} aria-invalid={Boolean(errors.fullName)} required />
          </FormField>
        )}
        <FormField fieldKey="phone" label="Mobile number" hint={isStudent ? 'Needed to apply. Also used for SMS reminders.' : 'Optional. Used for SMS reminders.'} error={errors.phone} required={need.has('phone')}>
          <input className={controlClass} value={values.phone} onChange={(event) => update({ phone: event.target.value.replace(/[^\d+\-\s]/g, '').slice(0, 20) })} inputMode="tel" autoComplete="tel" placeholder="e.g. 0917 123 4567" aria-invalid={Boolean(errors.phone)} />
        </FormField>
        {isStudent && <SelectField fieldKey="religion" label="Religion" hint="Needed to apply." value={values.religion} onChange={(value) => update({ religion: value })} options={religionOptions} error={errors.religion} required={need.has('religion')} />}
        {isStudent && <SelectField fieldKey="civilStatus" label="Civil status" value={values.civilStatus} onChange={(value) => update({ civilStatus: value })} options={civilStatusOptions} error={errors.civilStatus} required={need.has('civilStatus')} />}
        {isStudent && <FormField fieldKey="birthdate" label="Birthdate" hint="Needed to apply." error={errors.birthdate} required={need.has('birthdate')}><input className={controlClass} type="date" max={todayInputValue()} value={values.birthdate} onChange={(event) => update({ birthdate: event.target.value })} autoComplete="bday" aria-invalid={Boolean(errors.birthdate)} /></FormField>}
        {isStudent && <SelectField fieldKey="sexAtBirth" label="Sex assigned at birth" hint="Needed to apply." value={values.sexAtBirth} onChange={(value) => update({ sexAtBirth: value })} options={sexAtBirthOptions} error={errors.sexAtBirth} required={need.has('sexAtBirth')} />}
        {isStudent && <FormField label="Preferred pronouns" hint="Needed to apply. Write NA if not applicable." error={errors.pronouns} required={need.has('pronouns')}><input className={controlClass} value={values.pronouns} onChange={(event) => update({ pronouns: event.target.value.slice(0, PRONOUNS_MAX_LENGTH) })} placeholder="e.g. she/her" aria-invalid={Boolean(errors.pronouns)} /></FormField>}
      </div>
      {isStudent && (
        <FormField label="Default statement/essay" hint={`Optional. Prefills each new application. ${values.essay.length}/${ESSAY_MAX_LENGTH} characters.`} error={errors.essay}>
          <textarea className="min-h-40" value={values.essay} onChange={(event) => update({ essay: event.target.value.slice(0, ESSAY_MAX_LENGTH) })} rows={8} placeholder="Share your motivation, goals, or circumstances." aria-invalid={Boolean(errors.essay)} />
        </FormField>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <ReadOnlyField label="Sign-in email" value={profile.email} note="Managed by your sign-in account." className="md:col-span-2" />
        <ReadOnlyField label="Role" value={roleLabel} />
        <ReadOnlyField label={isAdmissionsRole(role) ? 'Office' : 'School'} value={profile.department} note={assignmentNote[role]} />
        {isReviewerRole(role) && (
          <ReadOnlyField
            label="Review scope"
            value={getReviewScopeLabel({ ...profile, role }) || 'Not assigned yet'}
            note={REVIEW_ROLE_LABELS[role]
              ? `${REVIEW_ROLE_LABELS[role]} — the cases this account can read.`
              : ''}
            className="md:col-span-2"
          />
        )}
      </div>
    </SectionForm>
  );
}

export function AddressSection({ profile, onSave, onDirtyChange, attributeVerifications = {}, onAttachProof, previewProofImpact, previewVerifications }) {
  const form = useSectionForm({
    initialValues: {
      completeAddress: asText(profile.completeAddress),
      country: asText(profile.country),
      sameAsCompleteAddress: profile.sameAsCompleteAddress !== false,
      residingAddress: asText(profile.residingAddress),
      housingType: asText(profile.housingType),
      housingOther: asText(profile.housingOther),
    },
    validate: validateAddressSection,
    onSave,
    onDirtyChange,
    previewProofImpact,
    attributeVerifications,
    previewVerifications,
  });
  const { values, errors, update } = form;
  // A required answer is starred until this draft answers it.
  const need = getMissingRequiredAnswers({ ...profile, completeAddress: values.completeAddress, housingType: values.housingType });
  return (
    <SectionForm title="Address" description={`${formPart('address')} Copied into each application you submit. Every application asks for a proof of address.`} form={form}>
      <FormField fieldKey="completeAddress" label="Complete address" hint={`House number, street, barangay, city or municipality, and province. Up to ${ADDRESS_MAX_LENGTH} characters.`} error={errors.completeAddress} required={need.has('completeAddress')}
        labelAdornment={<AttributeVerification attributeKey="completeAddress" attributeVerifications={form.verifications} savedVerifications={attributeVerifications} onAttachProof={onAttachProof} />}>
        <textarea className="min-h-24" value={values.completeAddress} onChange={(event) => update({ completeAddress: event.target.value.slice(0, ADDRESS_MAX_LENGTH) })} rows={3} aria-invalid={Boolean(errors.completeAddress)} />
      </FormField>
      <FormField label="Country" hint={`Up to ${COUNTRY_MAX_LENGTH} characters.`} error={errors.country}>
        <input className={controlClass} value={values.country} onChange={(event) => update({ country: event.target.value.slice(0, COUNTRY_MAX_LENGTH) })} autoComplete="country-name" aria-invalid={Boolean(errors.country)} />
      </FormField>
      <SettingToggle checked={values.sameAsCompleteAddress} onChange={(checked) => update({ sameAsCompleteAddress: checked })} title="Residing address is the same as my complete address" description="Turn off to enter a different address." />
      {!values.sameAsCompleteAddress && (
        <FormField label="Residing address" error={errors.residingAddress}
          labelAdornment={<AttributeVerification attributeKey="residingAddress" attributeVerifications={form.verifications} savedVerifications={attributeVerifications} onAttachProof={onAttachProof} />}>
          <textarea className="min-h-24" value={values.residingAddress} onChange={(event) => update({ residingAddress: event.target.value.slice(0, ADDRESS_MAX_LENGTH) })} rows={3} aria-invalid={Boolean(errors.residingAddress)} />
        </FormField>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField fieldKey="housingType" label="Where do you stay while studying?" hint="Needed to apply. Choose “I live at home” when it does not apply." value={values.housingType} onChange={(value) => update({ housingType: value }, ['housingOther'])} options={housingTypeOptions} error={errors.housingType} required={need.has('housingType')} />
        {values.housingType === 'Other' && <FormField label="Describe where you stay" error={errors.housingOther}><input className={controlClass} value={values.housingOther} onChange={(event) => update({ housingOther: event.target.value.slice(0, SCHOOL_FIELD_MAX_LENGTH) })} aria-invalid={Boolean(errors.housingOther)} /></FormField>}
      </div>
    </SectionForm>
  );
}

// The two family proofs in one block: a PSA birth certificate proves the parents'
// names and a barangay certificate of residency the household. Each badge links to
// the Document Vault with that attribute preselected (onAttachProof).
function FamilyProofRow({ attributeVerifications = {}, savedVerifications = null, onAttachProof }) {
  const rows = [
    { key: 'parents', label: "Parents' names" },
    { key: 'householdMembers', label: 'Siblings and household members' },
  ];
  return (
    <div className="grid gap-2 rounded-xl border border-app-border bg-app-surface px-4 py-3">
      <p className="m-0 text-xs uppercase tracking-[0.08em] text-app-muted">Proof of family details</p>
      {rows.map(({ key, label }) => (
        <div key={key} className="grid grid-cols-1 items-center gap-x-3 gap-y-2 text-sm text-app-text sm:grid-cols-[minmax(0,1fr)_auto]">
          <span className="min-w-0">{label}</span>
          <AttributeVerification attributeKey={key} attributeVerifications={attributeVerifications} savedVerifications={savedVerifications} onAttachProof={onAttachProof} />
        </div>
      ))}
    </div>
  );
}

export function FamilySection({ profile, onSave, onDirtyChange, attributeVerifications = {}, onAttachProof, previewProofImpact, previewVerifications }) {
  const stored = profile.familyDetails && typeof profile.familyDetails === 'object' ? profile.familyDetails : {};
  const form = useSectionForm({
    initialValues: { familyDetails: {
      fatherUnknown: Boolean(stored.fatherUnknown), fatherName: asText(stored.fatherName), fatherOccupation: asText(stored.fatherOccupation), fatherDeceased: Boolean(stored.fatherDeceased),
      motherUnknown: Boolean(stored.motherUnknown), motherName: asText(stored.motherName), motherOccupation: asText(stored.motherOccupation), motherDeceased: Boolean(stored.motherDeceased),
      familyPosition: asText(stored.familyPosition), numberOfSiblings: asText(stored.numberOfSiblings),
      fatherAge: asText(stored.fatherAge), fatherDateOfDeath: asText(stored.fatherDateOfDeath),
      motherAge: asText(stored.motherAge), motherDateOfDeath: asText(stored.motherDateOfDeath),
      siblings: Array.isArray(stored.siblings) ? stored.siblings.map((row) => ({ name: asText(row?.name), age: asText(row?.age), relationship: asText(row?.relationship), status: asText(row?.status) })) : [],
      householdAdults: Array.isArray(stored.householdAdults) ? stored.householdAdults.map((row) => ({ name: asText(row?.name), age: asText(row?.age), relationship: asText(row?.relationship) })) : [],
      // "None" is a saved answer (validateFamilySection returns both flags), so it
      // has to ride the draft: without them the post-save re-sync dropped the
      // answers, the toggles read "no", and the next save erased them.
      siblingsNone: Boolean(stored.siblingsNone),
      householdAdultsNone: Boolean(stored.householdAdultsNone),
    } },
    validate: validateFamilySection,
    onSave,
    onDirtyChange,
    previewProofImpact,
    attributeVerifications,
    previewVerifications,
  });
  const { values, errors, update } = form;
  const family = values.familyDetails;
  // Each parent's name is needed to apply unless the parent is marked unknown, and
  // the mark follows the draft so it clears as soon as the name is typed.
  const need = getMissingRequiredAnswers({ ...profile, familyDetails: values.familyDetails });
  const updateFamily = (patch) => update({ familyDetails: { ...family, ...patch } }, ['siblings', 'householdAdults']);
  return (
    <SectionForm title="Family details" description={`${formPart('family')} Each parent's name, age or date of death, and occupation are needed to apply, with the household details below and a proof of family details.`} form={form}>
      <FamilyProofRow attributeVerifications={form.verifications} savedVerifications={attributeVerifications} onAttachProof={onAttachProof} />
      <div className="grid gap-4 md:grid-cols-2">
        {['father', 'mother'].map((parent) => {
          const noun = parent === 'father' ? 'Father' : 'Mother';
          const lower = parent === 'father' ? 'father' : 'mother';
          const unknown = family[`${parent}Unknown`];
          const deceased = family[`${parent}Deceased`];
          return (
            <Fragment key={parent}>
              {/* Unknown and deceased cannot both describe the same parent. */}
              <div className="md:col-span-2">
                <SettingToggle
                  checked={unknown}
                  onChange={(checked) => updateFamily({ [`${parent}Unknown`]: checked, ...(checked ? { [`${parent}Deceased`]: false } : {}) })}
                  title={`${noun} is unknown or not listed`}
                  description={`Mark this if your ${lower}'s name is unknown or not on your birth certificate. No employment or income is then asked for.`}
                />
              </div>
              {!unknown && (
                <>
                  <FormField fieldKey={`${parent}Name`} label={`${noun}'s name`} hint="Needed to apply." error={errors[`${parent}Name`]} required={need.has(`${parent}Name`)}><input className={controlClass} value={family[`${parent}Name`]} onChange={(event) => updateFamily({ [`${parent}Name`]: event.target.value })} aria-invalid={Boolean(errors[`${parent}Name`])} /></FormField>
                  <FormField fieldKey={`${parent}Occupation`} label={`${noun}'s occupation`} hint="Needed to apply. Write NA if not applicable." error={errors[`${parent}Occupation`]} required={need.has(`${parent}Occupation`)}><input className={controlClass} value={family[`${parent}Occupation`]} onChange={(event) => updateFamily({ [`${parent}Occupation`]: event.target.value })} aria-invalid={Boolean(errors[`${parent}Occupation`])} /></FormField>
                  <SettingToggle checked={deceased} onChange={(checked) => updateFamily({ [`${parent}Deceased`]: checked })} title={`${noun} is deceased`} description={`Mark this if your ${lower} has passed away.`} />
                  {deceased
                    ? <FormField fieldKey={`${parent}DateOfDeath`} label={`${noun}'s date of death`} hint="Needed to apply." error={errors[`${parent}DateOfDeath`]} required={need.has(`${parent}DateOfDeath`)}><input className={controlClass} type="date" max={todayInputValue()} value={family[`${parent}DateOfDeath`]} onChange={(event) => updateFamily({ [`${parent}DateOfDeath`]: event.target.value })} /></FormField>
                    : <FormField fieldKey={`${parent}Age`} label={`${noun}'s current age`} hint="Needed to apply." error={errors[`${parent}Age`]} required={need.has(`${parent}Age`)}><input className={controlClass} value={family[`${parent}Age`]} onChange={(event) => updateFamily({ [`${parent}Age`]: event.target.value.replace(/\D/g, '').slice(0, 3) })} inputMode="numeric" /></FormField>}
                </>
              )}
            </Fragment>
          );
        })}
        <SelectField label="Family position" value={family.familyPosition} onChange={(value) => updateFamily({ familyPosition: value })} options={familyPositionOptions} error={errors.familyPosition} />
        <FormField fieldKey="numberOfSiblings" label="Number of siblings" hint="Needed to apply. Enter 0 if you have none." error={errors.numberOfSiblings} required={need.has('numberOfSiblings')}><input className={controlClass} value={family.numberOfSiblings} onChange={(event) => updateFamily({ numberOfSiblings: event.target.value.replace(/\D/g, '').slice(0, 2) })} inputMode="numeric" aria-invalid={Boolean(errors.numberOfSiblings)} /></FormField>
      </div>
      <SettingToggle
        checked={Boolean(family.siblingsNone)}
        onChange={(checked) => updateFamily({ siblingsNone: checked, ...(checked ? { siblings: [] } : {}) })}
        title="No siblings to list"
        description="Mark this if you have no sibling who is studying, below 18, employed, or married."
      />
      {!family.siblingsNone && (<RepeatableRows
        legend="Sibling"
        required={need.has('siblings')}
        rows={family.siblings}
        max={MAX_SIBLING_ROWS}
        addLabel="Add a sibling"
        error={errors.siblings}
        onChange={(rows) => updateFamily({ siblings: rows })}
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'age', label: 'Age', type: 'age' },
          { key: 'relationship', label: 'Relationship' },
          { key: 'status', label: 'Status', type: 'select', options: siblingStatusOptions },
        ]}
      />)}
      <SettingToggle
        checked={Boolean(family.householdAdultsNone)}
        onChange={(checked) => updateFamily({ householdAdultsNone: checked, ...(checked ? { householdAdults: [] } : {}) })}
        title="No other adults in the household"
        description="Mark this if no grandparent, aunt, cousin, or other adult lives with you."
      />
      {!family.householdAdultsNone && (<RepeatableRows
        legend="Household member"
        required={need.has('householdAdults')}
        rows={family.householdAdults}
        max={MAX_HOUSEHOLD_ADULT_ROWS}
        addLabel="Add another adult in the household"
        error={errors.householdAdults}
        onChange={(rows) => updateFamily({ householdAdults: rows })}
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'age', label: 'Age', type: 'age' },
          { key: 'relationship', label: 'Relationship' },
        ]}
      />)}
    </SectionForm>
  );
}

export function AcademicSection({ profile, academicPrograms, academicProgramGroups, documents = [], onSave, onDirtyChange, attributeVerifications = {}, onAttachProof, previewProofImpact, previewVerifications }) {
  const form = useSectionForm({
    initialValues: {
      studentNumber: asText(profile.studentNumber),
      degreeProgram: asText(profile.degreeProgram),
      yearStanding: deriveYearStanding(profile),
      academicStanding: asText(profile.academicStanding),
      isTransferee: asText(profile.isTransferee),
      // Held in the draft so the status control keeps the answer the student just
      // picked while the year standing is still unanswered.
      applicantStatus: getApplicantStatus(profile),
      qpi: asText(profile.qpi),
      hsStrand: asText(profile.hsStrand),
      hsAverage: asText(profile.hsAverage),
      programChoice2: asText(profile.programChoice2),
      programChoice3: asText(profile.programChoice3),
      schoolLastAttended: {
        name: asText(profile.schoolLastAttended?.name),
        city: asText(profile.schoolLastAttended?.city),
        province: asText(profile.schoolLastAttended?.province),
      },
      awards: asText(profile.awards),
      awardsNone: Boolean(profile.awardsNone),
    },
    validate: (values) => validateAcademicSection(values, academicPrograms),
    onSave,
    onDirtyChange,
    previewProofImpact,
    attributeVerifications,
    previewVerifications,
  });
  const { values, errors, update } = form;
  const standing = getStandingRequirements(values.yearStanding);
  // The academic answers a standing needs (QPI or senior high school standing, the
  // student number of a current student) are starred while this draft leaves them
  // blank, so changing the applicant status moves the marks with the fields.
  const need = getMissingRequiredAnswers({
    ...profile,
    yearStanding: values.yearStanding,
    isTransferee: values.isTransferee,
    studentNumber: values.studentNumber,
    degreeProgram: values.degreeProgram,
    academicStanding: values.academicStanding,
    qpi: values.qpi,
    hsStrand: values.hsStrand,
    hsAverage: values.hsAverage,
    schoolLastAttended: values.schoolLastAttended,
    awards: values.awards,
    awardsNone: values.awardsNone,
  });
  const isTransferee = values.isTransferee === 'Yes';
  // FORM 230-SCH Applicant Status. The status is its own answer in the draft (it
  // would otherwise be re-derived from an unanswered year standing and snap back to
  // the placeholder), and picking it moves the year standing and the transferee
  // answer with it so the two controls can never disagree.
  const applicantStatus = values.applicantStatus;
  // An incoming first-year has no year to pick, and an enrolled applicant is never
  // offered "Incoming 1st year".
  const standingOptions = getYearStandingOptions(applicantStatus);
  // The AdDU student number belongs to a current Ateneo student, so a transferee
  // and an incoming first-year never see the field.
  const needsStudentNumber = requiresStudentNumber(values);
  // A standing saved as the retired `1st year` is no longer offered, so the picker
  // asks for the year again instead of silently showing an empty control.
  const standingOffered = standingOptions.some((option) => option.value === values.yearStanding);
  const setApplicantStatus = (status) => {
    // Switching the status rearranges these fields, so a stale inline error from
    // the arrangement the student just left is cleared with it.
    update(applyApplicantStatus(values, status), ['yearStanding', 'studentNumber', 'qpi', 'hsStrand', 'hsAverage', 'programChoice2', 'programChoice3']);
  };
  const setYearStanding = (value) => {
    update(applyYearStanding(value), ['yearStanding', 'studentNumber', 'qpi', 'hsStrand', 'hsAverage', 'programChoice2', 'programChoice3']);
  };
  // The QPI and the senior high school general average are each read for one
  // standing, so their badges follow the standing this form is showing instead
  // of the saved one: changing the year standing would otherwise label the field
  // that just appeared with the other standing's derived state (the mandatory
  // senior high school average reading `Not applicable` for a student who has
  // not saved the incoming standing yet). Only the standing is overridden — the
  // saved values still drive the Outdated check, so the unsaved-edit warning
  // from previewProofImpact is not duplicated here.
  const standingVerifications = useMemo(
    () => deriveAttributeVerifications(documents, ['qpi', 'hsAverage'], { profile: { ...profile, yearStanding: values.yearStanding } }),
    [documents, profile, values.yearStanding],
  );
  const verifications = { ...form.verifications, ...standingVerifications };
  const selectedProgram = academicPrograms.find((program) => program.value === values.degreeProgram);
  // One group header per "School — Cluster" pair, in taxonomy order, with the
  // academic department as each program's description, so a single picker walks
  // all four levels: School, Cluster, Department, degree program.
  const programOptions = academicProgramGroups?.length ? academicProgramGroups : getAcademicProgramGroups(academicPrograms);
  // Each ranked choice hides the programs already chosen in the other two slots,
  // so the same program cannot be ranked twice (issue #20).
  const choiceOptions = {
    degreeProgram: getProgramChoiceOptions(programOptions, { slot: 'degreeProgram', ...values }),
    programChoice2: getProgramChoiceOptions(programOptions, { slot: 'programChoice2', ...values }),
    programChoice3: getProgramChoiceOptions(programOptions, { slot: 'programChoice3', ...values }),
  };

  return (
    <SectionForm title="Academic profile" description={`${formPart('academic')} Also drives degree-specific matching in the Smart Eligibility Checker.`} form={form}>
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField fieldKey="applicantStatus isTransferee" label="Applicant status" value={applicantStatus} onChange={setApplicantStatus} options={applicantStatusOptions} placeholder="Choose applicant status" error={errors.isTransferee} required={need.has('applicantStatus')} />
        {standingOptions.length ? (
          <SelectField fieldKey="yearStanding" label="Year standing" hint={!values.yearStanding || standingOffered ? 'Choose the year you are going into.' : 'Your saved 1st year standing is no longer offered — choose the year you are going into.'} value={values.yearStanding} onChange={setYearStanding} options={standingOptions} placeholder="Choose year standing" error={errors.yearStanding} required={need.has('yearStanding')} />
        ) : null}
        {needsStudentNumber && <FormField fieldKey="studentNumber" label="AdDU student number" hint="4–12 digits from your AdDU record." error={errors.studentNumber} required={need.has('studentNumber')}><input className={controlClass} value={values.studentNumber} onChange={(event) => update({ studentNumber: event.target.value.replace(/\D/g, '').slice(0, 12) })} inputMode="numeric" autoComplete="off" placeholder="e.g. 1234567" aria-invalid={Boolean(errors.studentNumber)} /></FormField>}
      </div>
      <div className="grid gap-2" data-field="degreeProgram">
        <SelectPicker label={standing.programLabel} value={values.degreeProgram} onChange={(value) => update({ degreeProgram: value }, ['programChoice2', 'programChoice3'])} options={choiceOptions.degreeProgram} error={errors.degreeProgram} idPrefix="profile-degree-program" required={need.has('degreeProgram')} />
      </div>
      {selectedProgram && (
        <div className="grid gap-4 md:grid-cols-2">
          <ReadOnlyField
            label="School"
            value={selectedProgram.school}
            note="Updates with your degree program."
            className={selectedProgram.cluster ? '' : 'md:col-span-2'}
          />
          {selectedProgram.cluster && <ReadOnlyField label="Cluster" value={selectedProgram.cluster} />}
          <ReadOnlyField label="Academic department" value={selectedProgram.department} className="md:col-span-2" />
        </div>
      )}
      <p className="m-0 rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-app-text" role="note">{COURSE_SHIFT_REMINDER}</p>
      {standing.requiresProgramChoices && (
        <div className="grid gap-3 rounded-2xl border border-app-border bg-app-surface/60 p-4"><div><p className="m-0 text-sm font-semibold text-app-text">Ranked program choices</p><small className="field-hint mt-1 block">Each program can be chosen once.</small></div><div className="grid gap-3 md:grid-cols-2"><SelectPicker label="2nd choice program" value={values.programChoice2} onChange={(value) => update({ programChoice2: value }, ['programChoice3'])} options={choiceOptions.programChoice2} error={errors.programChoice2} idPrefix="profile-program-choice-2" /><SelectPicker label="3rd choice program" value={values.programChoice3} onChange={(value) => update({ programChoice3: value })} options={choiceOptions.programChoice3} error={errors.programChoice3} idPrefix="profile-program-choice-3" /></div></div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField fieldKey="academicStanding" label="Academic standing" value={values.academicStanding} onChange={(value) => update({ academicStanding: value })} options={academicStandingOptions} placeholder="Choose standing" error={errors.academicStanding} required={need.has('academicStanding')} labelAdornment={<AttributeVerification attributeKey="academicStanding" attributeVerifications={verifications} savedVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        {standing.requiresQpi && <FormField fieldKey="qpi" label="Annual QPI" hint="Self-reported; not Registrar-verified." error={errors.qpi} required={need.has('qpi')} labelAdornment={<AttributeVerification attributeKey="qpi" attributeVerifications={verifications} savedVerifications={attributeVerifications} onAttachProof={onAttachProof} />}><input className={controlClass} value={values.qpi} onChange={(event) => update({ qpi: event.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').slice(0, 4) })} inputMode="decimal" autoComplete="off" placeholder="e.g. 3.25" aria-invalid={Boolean(errors.qpi)} /></FormField>}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {/* FORM 230-SCH asks every applicant for the strand in senior high school,
            so it is shown (and required) for a continuing student too. */}
        <SelectField fieldKey="hsStrand" label="Senior high school strand" hint="Needed to apply." value={values.hsStrand} onChange={(value) => update({ hsStrand: value })} options={hsStrandOptions.filter((option) => option.value)} placeholder="Choose strand" error={errors.hsStrand} required={need.has('hsStrand')} />
        {standing.requiresHsStanding && <FormField fieldKey="hsAverage" label="Senior high school general average" hint="Whole number from 60 to 100." error={errors.hsAverage} required={need.has('hsAverage')} labelAdornment={<AttributeVerification attributeKey="hsAverage" attributeVerifications={verifications} savedVerifications={attributeVerifications} onAttachProof={onAttachProof} />}><input className={controlClass} value={values.hsAverage} onChange={(event) => update({ hsAverage: event.target.value.replace(/\D/g, '').slice(0, 3) })} inputMode="numeric" placeholder="e.g. 94" aria-invalid={Boolean(errors.hsAverage)} /></FormField>}
      </div>
      <div data-field="schoolLastAttended" className="grid gap-3 rounded-2xl border border-app-border bg-app-surface/60 p-4">
        <div>
          <p className="m-0 text-sm font-semibold text-app-text">{isTransferee ? 'College last attended' : 'Senior high school last attended'}</p>
          <small className="field-hint mt-1 block">The school name, city, and province are needed to apply.</small>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <FormField fieldKey="schoolLastAttended" label="School name" error={errors.schoolLastAttended} required={need.has('schoolLastAttended')}><input className={controlClass} value={values.schoolLastAttended.name} onChange={(event) => update({ schoolLastAttended: { ...values.schoolLastAttended, name: event.target.value.slice(0, SCHOOL_FIELD_MAX_LENGTH) } })} aria-invalid={Boolean(errors.schoolLastAttended)} /></FormField>
          <FormField fieldKey="schoolLastAttendedCity" label="City" error={errors.schoolLastAttendedCity} required={need.has('schoolLastAttended')}><input className={controlClass} value={values.schoolLastAttended.city} onChange={(event) => update({ schoolLastAttended: { ...values.schoolLastAttended, city: event.target.value.slice(0, SCHOOL_FIELD_MAX_LENGTH) } })} aria-invalid={Boolean(errors.schoolLastAttendedCity)} /></FormField>
          <FormField fieldKey="schoolLastAttendedProvince" label="Province" error={errors.schoolLastAttendedProvince} required={need.has('schoolLastAttended')}><input className={controlClass} value={values.schoolLastAttended.province} onChange={(event) => update({ schoolLastAttended: { ...values.schoolLastAttended, province: event.target.value.slice(0, SCHOOL_FIELD_MAX_LENGTH) } })} aria-invalid={Boolean(errors.schoolLastAttendedProvince)} /></FormField>
        </div>
      </div>
      <SettingToggle
        checked={values.awardsNone}
        onChange={(checked) => update({ awardsNone: checked, ...(checked ? { awards: '' } : {}) })}
        title="No awards received"
        description="Mark this when you have no award to list."
      />
      {!values.awardsNone && (
        <FormField fieldKey="awards" label="Awards received" hint={`Needed to apply. ${values.awards.length}/${AWARDS_MAX_LENGTH} characters.`} error={errors.awards} required={need.has('awards')}>
          <textarea className="min-h-24" value={values.awards} onChange={(event) => update({ awards: event.target.value.slice(0, AWARDS_MAX_LENGTH) })} rows={3} aria-invalid={Boolean(errors.awards)} />
        </FormField>
      )}
    </SectionForm>
  );
}

export function BackgroundSection({ profile, onSave, onDirtyChange, attributeVerifications = {}, onAttachProof, previewProofImpact, previewVerifications }) {
  const form = useSectionForm({
    initialValues: {
      citizenship: asText(profile.citizenship),
      ipCommunity: asText(profile.ipCommunity),
      pwd: asText(profile.pwd),
      employed: asText(profile.employed),
      honorsRank: asText(profile.honorsRank),
      graduatingClassSize: asText(profile.graduatingClassSize),
      hsStrand: asText(profile.hsStrand),
      hsAverage: asText(profile.hsAverage),
      sponsorTies: {
        gsisMemberDependent: Boolean(profile.sponsorTies?.gsisMemberDependent),
        afpDependent: Boolean(profile.sponsorTies?.afpDependent),
        usVeteranDependent: Boolean(profile.sponsorTies?.usVeteranDependent),
      },
      ipGroupName: asText(profile.ipGroupName),
      communityService: asText(profile.communityService),
      // FORM 230-SCH "Did you enjoy financial aid in senior high school / apply
      // for or receive a grant?" — one answer opens the list below.
      previousGrantsAnswered: asText(profile.previousGrantsAnswered),
      // Household income and the Exclusion Flag Hierarchy answers moved here from
      // the retired "Household and financial aid" section.
      householdIncome: asText(profile.householdIncome),
      hasActiveGovernmentGrant: Boolean(profile.hasActiveGovernmentGrant),
      hasOtherActiveScholarship: Boolean(profile.hasOtherActiveScholarship),
      hasSiblingOnAid: Boolean(profile.hasSiblingOnAid),
      isOnPrepaidPlan: Boolean(profile.isOnPrepaidPlan),
      previousGrants: Array.isArray(profile.previousGrants)
        ? profile.previousGrants.map((row) => ({ type: asText(row?.type), name: asText(row?.name), level: asText(row?.level), status: asText(row?.status), institution: asText(row?.institution), amount: asText(row?.amount) }))
        : [],
    },
    validate: validateBackgroundSection,
    onSave,
    onDirtyChange,
    previewProofImpact,
    attributeVerifications,
    previewVerifications,
  });
  const { values, errors, update } = form;
  const updateSponsorTie = (key, checked) => update({ sponsorTies: { ...values.sponsorTies, [key]: checked } });
  // The background answers the application gate reads, starred while blank.
  const need = getMissingRequiredAnswers({
    ...profile,
    householdIncome: values.householdIncome,
    citizenship: values.citizenship,
    ipCommunity: values.ipCommunity,
    ipGroupName: values.ipGroupName,
    pwd: values.pwd,
    employed: values.employed,
    communityService: values.communityService,
    honorsRank: values.honorsRank,
    graduatingClassSize: values.graduatingClassSize,
    previousGrantsAnswered: values.previousGrantsAnswered,
  });
  // The grant list is only active while the student says they already receive aid.
  // `isGrantListActive` is the single rule behind both the rendering and the
  // validator, so a hidden row can never block the save.
  const grantListActive = isGrantListActive(values);
  // With every aid answer off, the list can only be open because grants were
  // recorded earlier; the note then asks the student to keep or remove them
  // instead of demanding a new row.
  const receivesAid = Boolean(values.hasActiveGovernmentGrant || values.hasOtherActiveScholarship || values.isOnPrepaidPlan);

  return (
    <SectionForm title="Eligibility background" description={`${formPart('background')} Citizenship, disability, employment, household income, existing aid, honors, and sponsor ties.`} form={form}>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField fieldKey="householdIncome" label="Annual household income" hint="Combined yearly income in Philippine pesos." error={errors.householdIncome} required={need.has('householdIncome')} labelAdornment={<AttributeVerification attributeKey="householdIncome" attributeVerifications={form.verifications} savedVerifications={attributeVerifications} onAttachProof={onAttachProof} />}>
          <input className={controlClass} value={values.householdIncome} onChange={(event) => update({ householdIncome: event.target.value.replace(/\D/g, '').slice(0, 10) })} inputMode="numeric" autoComplete="off" placeholder="e.g. 240000" aria-invalid={Boolean(errors.householdIncome)} />
        </FormField>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField fieldKey="citizenship" label="Citizenship" value={values.citizenship} onChange={(value) => update({ citizenship: value })} options={citizenshipOptions} placeholder="Choose citizenship" error={errors.citizenship} required={need.has('citizenship')} labelAdornment={<AttributeVerification attributeKey="citizenship" attributeVerifications={form.verifications} savedVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        <SelectField fieldKey="ipCommunity" label="Indigenous People (IP) community" value={values.ipCommunity} onChange={(value) => update({ ipCommunity: value })} options={ipCommunityOptions} error={errors.ipCommunity} required={need.has('ipCommunity')} labelAdornment={<AttributeVerification attributeKey="ipCommunity" attributeVerifications={form.verifications} savedVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        {values.ipCommunity === 'Yes' && <FormField fieldKey="ipGroupName" label="Indigenous group" hint="Needed to apply. Name of your community." error={errors.ipGroupName} required={need.has('ipGroupName')}><input className={controlClass} value={values.ipGroupName} onChange={(event) => update({ ipGroupName: event.target.value.slice(0, SCHOOL_FIELD_MAX_LENGTH) })} aria-invalid={Boolean(errors.ipGroupName)} /></FormField>}
        <SelectField fieldKey="pwd" label="Person with Disability (PWD)" value={values.pwd} onChange={(value) => update({ pwd: value })} options={pwdOptions} error={errors.pwd} required={need.has('pwd')} labelAdornment={<AttributeVerification attributeKey="pwd" attributeVerifications={form.verifications} savedVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        <SelectField fieldKey="employed" label="Employment status" value={values.employed} onChange={(value) => update({ employed: value })} options={employmentOptions} error={errors.employed} required={need.has('employed')} labelAdornment={<AttributeVerification attributeKey="employed" attributeVerifications={form.verifications} savedVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        <SelectField fieldKey="honorsRank" label="Graduating honors standing" hint="Jubilee Scholarship requires official Valedictorian or Salutatorian standing." value={values.honorsRank} onChange={(value) => update({ honorsRank: value })} options={honorsRankOptions} error={errors.honorsRank} labelAdornment={<AttributeVerification attributeKey="honorsRank" attributeVerifications={form.verifications} savedVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        {values.honorsRank && (
          <FormField fieldKey="graduatingClassSize" label="Number of graduates of your senior high school" hint="Needed to apply, and needed to support your honors standing." error={errors.graduatingClassSize} required={need.has('graduatingClassSize')}>
            <input className={controlClass} value={values.graduatingClassSize} onChange={(event) => update({ graduatingClassSize: event.target.value.replace(/\D/g, '').slice(0, 5) })} inputMode="numeric" autoComplete="off" placeholder="e.g. 120" aria-invalid={Boolean(errors.graduatingClassSize)} />
          </FormField>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField fieldKey="communityService" label="Willing to render community service in return for the grant?" hint="Needed to apply." value={values.communityService} onChange={(value) => update({ communityService: value })} options={communityServiceOptions} error={errors.communityService} required={need.has('communityService')} />
        <SelectField
          fieldKey="previousGrantsAnswered"
          label="Did you enjoy financial aid in senior high school, or apply for or receive a grant?"
          hint="Needed to apply. Answer Yes to list each grant below."
          value={values.previousGrantsAnswered}
          onChange={(value) => update(value === 'No' ? { previousGrantsAnswered: value, previousGrants: [] } : { previousGrantsAnswered: value })}
          options={grantHistoryOptions}
          error={errors.previousGrantsAnswered}
          required={need.has('previousGrantsAnswered')}
        />
      </div>
      <fieldset data-field="hasActiveGovernmentGrant hasOtherActiveScholarship isOnPrepaidPlan hasSiblingOnAid" className="m-0 grid gap-3 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold text-app-text">Financial aid already received</legend>
        <small className="field-hint block">The first three answers are exclusion rules the Smart Eligibility Checker reads, and any of them opens the grant list below. A sibling on AdDU financial aid is about your sibling, not about you.</small>
        <div className="grid gap-3 md:grid-cols-2">
          <SettingToggle checked={values.hasActiveGovernmentGrant} onChange={(checked) => update({ hasActiveGovernmentGrant: checked })} title="Active government grant" description="Excludes scholarships that cannot be combined with another government grant." />
          <SettingToggle checked={values.hasOtherActiveScholarship} onChange={(checked) => update({ hasOtherActiveScholarship: checked })} title="Another active scholarship" description="Held without College Scholarship Committee approval." />
          <SettingToggle checked={values.isOnPrepaidPlan} onChange={(checked) => update({ isOnPrepaidPlan: checked })} title="Prepaid tuition plan" description="Covered by a prepaid educational plan." />
          <SettingToggle checked={values.hasSiblingOnAid} onChange={(checked) => update({ hasSiblingOnAid: checked })} title="Sibling on AdDU financial aid" description="A sibling receives AdDU financial aid." />
        </div>
      </fieldset>
      {grantListActive && (
        <>
          <p className="m-0 rounded-xl border border-app-border bg-app-surface/60 px-3 py-2 text-sm text-app-muted" role="note">
            {receivesAid
              ? 'List every grant you applied for or received, in senior high school or in college. At least one grant is required while you already receive aid.'
              : 'You recorded these grants earlier. Keep them, or remove the ones that no longer apply.'}
            {' '}These answers are taken as declared; no document is verified for them.
          </p>
          <RepeatableRows
            legend="Grant"
            required={grantListActive && !values.previousGrants.length}
            rows={values.previousGrants}
            max={MAX_GRANT_ROWS}
            addLabel="Add a grant applied for or received"
            error={errors.previousGrants}
            onChange={(rows) => update({ previousGrants: rows })}
            columns={[
              { key: 'type', label: 'Type', type: 'select', options: [{ value: '', label: 'Type' }, ...grantTypeOptions] },
              { key: 'name', label: 'Grant (CHED, DOST, STEP, GSIS, ...)' },
              { key: 'level', label: 'Level', type: 'select', options: [{ value: '', label: 'Level' }, ...grantLevelOptions] },
              { key: 'status', label: 'Status', type: 'select', options: [{ value: '', label: 'Status' }, ...grantStatusOptions] },
              { key: 'institution', label: 'Institution' },
              { key: 'amount', label: 'Amount a year (PHP)' },
            ]}
          />
        </>
      )}
      <fieldset className="m-0 grid gap-3 border-0 p-0">
        <legend className="mb-3 text-sm font-semibold text-app-text">Sponsor ties</legend>
        <div className="grid gap-3 md:grid-cols-3">
          <SettingToggle checked={values.sponsorTies.gsisMemberDependent} onChange={(checked) => updateSponsorTie('gsisMemberDependent', checked)} title="GSIS member dependent" description="A parent or guardian is an active GSIS member." />
          <SettingToggle checked={values.sponsorTies.afpDependent} onChange={(checked) => updateSponsorTie('afpDependent', checked)} title="AFP / CAA dependent" description="Dependent of AFP or CAA personnel." />
          <SettingToggle checked={values.sponsorTies.usVeteranDependent} onChange={(checked) => updateSponsorTie('usVeteranDependent', checked)} title="US veteran dependent" description="Qualifying US veteran dependent status." />
        </div>
      </fieldset>
    </SectionForm>
  );
}

const parentFinanceInitial = (parent = {}) => ({
  employmentStatus: asText(parent.employmentStatus),
  employer: asText(parent.employer),
  annualIncome: asText(parent.annualIncome),
  lastEmployed: asText(parent.lastEmployed),
  unemploymentReason: asText(parent.unemploymentReason),
});

function ParentFinanceFields({ legend, deceased, unknown = false, value, errors, prefix, onChange, need }) {
  if (deceased || unknown) {
    return (
      <fieldset className="m-0 grid gap-2 rounded-2xl border border-app-border bg-app-surface/60 p-4">
        <legend className="px-1 text-sm font-semibold text-app-text">{legend}</legend>
        <p className="m-0 text-sm text-app-muted">Marked as {unknown ? 'unknown or not listed' : 'deceased'} in Family details, so no employment or income is needed.</p>
      </fieldset>
    );
  }
  // Each parent's employment answers are their own "Needed to apply" items: the
  // employment status and income, the employer of a working parent, and the last
  // employment and reason of an unemployed one.
  const employmentNeeded = need?.has(`${prefix}Finances`);
  const employerNeeded = need?.has(`${prefix}Employer`);
  const unemploymentNeeded = need?.has(`${prefix}Unemployment`);
  return (
    <fieldset data-field={`${prefix}Finances`} className="m-0 grid gap-3 rounded-2xl border border-app-border bg-app-surface/60 p-4">
      <legend className="px-1 text-sm font-semibold text-app-text">{legend}</legend>
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField label="Employment status" hint="Needed to apply." value={value.employmentStatus} onChange={(next) => onChange({ employmentStatus: next })} options={parentEmploymentOptions} required={Boolean(employmentNeeded && !value.employmentStatus)} />
        <FormField label="Annual income (PHP)" hint="As it appears on the income document. Enter 0 if none. Needed to apply." error={errors[`${prefix}AnnualIncome`]} required={Boolean(employmentNeeded && !String(value.annualIncome).trim())}>
          <input className={controlClass} value={value.annualIncome} onChange={(event) => onChange({ annualIncome: event.target.value.replace(/[^\d.]/g, '').slice(0, 12) })} inputMode="decimal" placeholder="e.g. 180000" />
        </FormField>
        {value.employmentStatus === 'employed' || value.employmentStatus === 'self-employed'
          ? <FormField label={value.employmentStatus === 'employed' ? 'Company or employer' : 'Business or trade'} hint="Needed to apply." error={errors[`${prefix}Employer`]} required={Boolean(employerNeeded && !String(value.employer).trim())}><input className={controlClass} value={value.employer} onChange={(event) => onChange({ employer: event.target.value })} /></FormField>
          : null}
        {value.employmentStatus === 'unemployed' && (
          <>
            <FormField label="When last employed" hint="Needed to apply." error={errors[`${prefix}LastEmployed`]} required={Boolean(unemploymentNeeded && !String(value.lastEmployed).trim())}><input className={controlClass} value={value.lastEmployed} onChange={(event) => onChange({ lastEmployed: event.target.value })} placeholder="e.g. March 2024" /></FormField>
            <FormField label="Reason for being unemployed" hint="Needed to apply." error={errors[`${prefix}UnemploymentReason`]} required={Boolean(unemploymentNeeded && !String(value.unemploymentReason).trim())}><input className={controlClass} value={value.unemploymentReason} onChange={(event) => onChange({ unemploymentReason: event.target.value })} /></FormField>
          </>
        )}
      </div>
    </fieldset>
  );
}

// FORM 230-SCH household finances. Office-only: stored in student_financial_profiles
// (readable by the student and the Admissions Office, never the Department Chair),
// so it saves through its own handler instead of profile_details.
export function FinancesSection({ profile, onSave, onDirtyChange, migrationMissing = false }) {
  const stored = profile.financialProfile && typeof profile.financialProfile === 'object' ? profile.financialProfile : {};
  const family = profile.familyDetails && typeof profile.familyDetails === 'object' ? profile.familyDetails : {};
  const form = useSectionForm({
    initialValues: {
      economicStatus: asText(stored.economicStatus),
      father: parentFinanceInitial(stored.father),
      mother: parentFinanceInitial(stored.mother),
      assets: flagsOf(stored.assets, ASSET_OPTIONS),
      appliances: flagsOf(stored.appliances, APPLIANCE_OPTIONS),
    },
    validate: validateFinancialProfileSection,
    onSave,
    onDirtyChange,
  });
  const { values, errors, update } = form;
  // The perceived economic status and each parent's employment and income are
  // needed to apply, read here from the draft so the marks clear while typing.
  const need = getMissingRequiredAnswers({
    ...profile,
    financialProfile: {
      ...(profile.financialProfile || {}),
      economicStatus: values.economicStatus,
      father: values.father,
      mother: values.mother,
      assets: values.assets,
      appliances: values.appliances,
    },
  });
  const setFlag = (group, key, checked) => {
    const options = group === 'assets' ? ASSET_OPTIONS : APPLIANCE_OPTIONS;
    const next = { ...values[group], [key]: checked };
    // "None of the above" is exclusive: it clears every item and the free-text
    // entry, and picking any item clears it.
    if (key === 'none' && checked) {
      options.forEach((option) => {
        if (option.key !== 'none') next[option.key] = false;
      });
      next.others = '';
    } else if (key !== 'none' && checked) {
      next.none = false;
    }
    update({ [group]: next });
  };

  return (
    <SectionForm title="Household finances" description={`${formPart('finances')} Shared with the Admissions Office only; your Department Chair cannot see these answers.`} form={form}>
      {migrationMissing ? <p className="m-0 rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-app-text" role="status">Household finances need the latest database migration before they can be saved.</p> : null}
      <SelectField fieldKey="economicStatus" label="How would you describe your family's economic status?" hint="Needed to apply." value={values.economicStatus} onChange={(value) => update({ economicStatus: value })} options={economicStatusOptions} error={errors.economicStatus} required={need.has('economicStatus')} />
      <ParentFinanceFields legend="Father" prefix="father" deceased={Boolean(family.fatherDeceased)} unknown={Boolean(family.fatherUnknown)} value={values.father} errors={errors} onChange={(patch) => update({ father: { ...values.father, ...patch } })} need={need} />
      <ParentFinanceFields legend="Mother" prefix="mother" deceased={Boolean(family.motherDeceased)} unknown={Boolean(family.motherUnknown)} value={values.mother} errors={errors} onChange={(patch) => update({ mother: { ...values.mother, ...patch } })} need={need} />
      {[['assets', 'Assets owned by the family', ASSET_OPTIONS], ['appliances', 'Appliances and services', APPLIANCE_OPTIONS]].map(([group, legend, options]) => (
        <fieldset key={group} className="m-0 grid gap-3 border-0 p-0">
          <legend className="mb-3 text-sm font-semibold text-app-text">{legend}{need.has(group) && <RequiredMark />}</legend>
          <div className="grid gap-3 md:grid-cols-3">
            {options.map((option) => <SettingToggle key={option.key} checked={values[group][option.key]} onChange={(checked) => setFlag(group, option.key, checked)} title={option.label} description="" />)}
          </div>
          <FormField label="Others"><input className={controlClass} value={values[group].others} onChange={(event) => update({ [group]: { ...values[group], others: event.target.value.slice(0, 100) } })} placeholder="Anything not listed" /></FormField>
        </fieldset>
      ))}
    </SectionForm>
  );
}

export function SecuritySection({ email, onChangePassword, onRequestPasswordReset, onDirtyChange }) {
  const [resetStatus, setResetStatus] = useState({ tone: '', message: '' });
  const [isSendingReset, setIsSendingReset] = useState(false);
  const form = useSectionForm({
    initialValues: { password: '', confirmPassword: '' },
    validate: validatePasswordChange,
    onSave: (values) => onChangePassword(values.password),
    onDirtyChange,
  });
  const { values, errors, update } = form;

  const handleSendReset = async () => {
    setIsSendingReset(true);
    setResetStatus({ tone: '', message: '' });
    const result = await onRequestPasswordReset();
    setIsSendingReset(false);
    setResetStatus({ tone: result?.success ? 'success' : 'error', message: result?.message || 'Unable to send a reset link.' });
  };

  return (
    <div className="grid gap-4">
      <SectionForm title="Change password" description={`Update the password for ${email || 'your account'}.`} form={form} submitLabel="Update password">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="New password" hint="At least 8 characters with letters and numbers." error={errors.password}>
            <input className={controlClass} type="password" value={values.password} onChange={(event) => update({ password: event.target.value })} autoComplete="new-password" aria-invalid={Boolean(errors.password)} />
          </FormField>
          <FormField label="Confirm new password" error={errors.confirmPassword}>
            <input className={controlClass} type="password" value={values.confirmPassword} onChange={(event) => update({ confirmPassword: event.target.value })} autoComplete="new-password" aria-invalid={Boolean(errors.confirmPassword)} />
          </FormField>
        </div>
      </SectionForm>
      <Card title="Password reset link">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <p className="m-0 min-w-0 flex-1 basis-64 text-sm text-app-muted">Prefer to reset by email? We will send a reset link to your sign-in address.</p>
          <Button type="button" onClick={handleSendReset} disabled={isSendingReset}>{isSendingReset ? 'Sending…' : 'Email me a reset link'}</Button>
        </div>
        {resetStatus.message && <div className="mt-3 flex"><FormStatus status={resetStatus} /></div>}
      </Card>
    </div>
  );
}
