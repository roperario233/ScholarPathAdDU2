import { useEffect, useMemo, useState } from 'react';
import { Camera, Circle, CircleCheck, Paperclip, TriangleAlert } from 'lucide-react';
import { Button, Card, FormField, SettingToggle, StatusBadge } from './ui';
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
  BIO_MAX_LENGTH,
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
  getProgramChoiceOptions,
  getStandingRequirements,
  getVerifiableAttributeOption,
  getYearStandingOptions,
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
  religionOptions,
  requiresStudentNumber,
} from '../lib/profile';

const controlClass = 'h-12 py-0';
const asText = (value) => (value === undefined || value === null ? '' : String(value));

// Shared draft/validate/save lifecycle for one My Profile section. The draft
// re-syncs whenever the saved profile changes, so a successful save (or a
// change made elsewhere, such as the Smart Eligibility Checker) never leaves a
// stale form behind.
function useSectionForm({ initialValues, validate, onSave, onDirtyChange, previewProofImpact }) {
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

  const submit = async (event) => {
    event.preventDefault();
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
  };

  return { values, errors, status, isSaving, isDirty, proofWarnings, update, reset, submit };
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

function SectionForm({ title, description, form, submitLabel = 'Save changes', children }) {
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

function ReadOnlyField({ label, value, note, className = '' }) {
  return (
    <div className={`grid min-w-0 content-start gap-1 rounded-xl border border-app-border bg-app-surface px-4 py-3 ${className}`}>
      <span className="text-xs uppercase tracking-[0.08em] text-app-muted">{label}</span>
      <strong className="text-sm text-app-text [overflow-wrap:anywhere]">{value || 'Not set'}</strong>
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
function AttributeVerification({ attributeKey, attributeVerifications = {}, onAttachProof }) {
  const status = attributeVerifications[attributeKey] || 'Unverified';
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
      <StatusBadge tone={getAttributeVerificationTone(status)} title={describeAttributeVerification(status)}>{status}</StatusBadge>
      {!isAttributeProofSettled(status) && onAttachProof && (
        <button type="button" className="proof-action" onClick={() => onAttachProof(attributeKey)}>
          <Paperclip size={13} aria-hidden="true" />
          {status === 'Outdated' ? 'Upload new proof' : status === 'Pending' ? 'View proof' : 'Attach proof'}
        </button>
      )}
    </span>
  );
}

function SelectField({ label, hint, error, value, onChange, options, placeholder, labelAdornment }) {
  return (
    <FormField label={label} hint={hint} error={error} labelAdornment={labelAdornment}>
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
  application: 'Required to start an application. Each answer needs a current proof in your Document Vault.',
  details: 'Included in every application you submit. A mobile number enables SMS reminders.',
};

function CompletenessItem({ item, status, onEditSection, onAttachProof }) {
  // A verification badge only means something once the answer is filled in.
  const showStatus = item.done && status !== undefined;
  const showAttachProof = showStatus && !isAttributeProofSettled(status) && onAttachProof;
  return (
    <li className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl bg-app-surface px-3 py-2">
      <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-app-text">
        {item.done
          ? <CircleCheck size={18} className="shrink-0 text-emerald-500" aria-hidden="true" />
          : <Circle size={18} className="shrink-0 text-app-muted" aria-hidden="true" />}
        <span className="min-w-0">{item.label}<span className="sr-only">{item.done ? ' (complete)' : ' (missing)'}</span></span>
        {showStatus && <StatusBadge tone={getAttributeVerificationTone(status)} title={describeAttributeVerification(status)}>{status}</StatusBadge>}
      </span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {showAttachProof && (
          <button type="button" className="proof-action shrink-0" onClick={() => onAttachProof(item.key)}>
            <Paperclip size={13} className="shrink-0" aria-hidden="true" />
            {status === 'Pending' ? 'View proof' : status === 'Outdated' ? 'Upload new proof' : 'Attach proof'}
          </button>
        )}
        {!item.done && (
          <button type="button" className="proof-action shrink-0" onClick={() => onEditSection(item.section)}>Add</button>
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
              <li key={item.key} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl bg-app-surface px-3 py-2">
                <span className="grid min-w-0 flex-1 basis-56 gap-0.5">
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
      <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 ${total > 0 ? 'mt-4 border-t border-app-border pt-4' : ''}`}>
        <span className="grid min-w-0 flex-1 basis-56 gap-0.5">
          <span className="text-sm font-semibold text-app-text">Default statement</span>
          <span className="text-xs text-app-muted">Optional. Prefills each application statement.</span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <StatusBadge tone={hasDefaultStatement ? 'success' : 'neutral'}>{hasDefaultStatement ? 'Saved' : 'Not set'}</StatusBadge>
          <button type="button" className="proof-action shrink-0" onClick={() => onEditSection('personal')}>{hasDefaultStatement ? 'Edit' : 'Write'}</button>
        </span>
      </div>
    </Card>
  );
}

export function ProfileOverview({ profile = {}, completeness, documentChecklist = null, onEditSection, attributeVerifications = {}, onAttachProof, onUploadDocument }) {
  // Staff have a single group of personal details, so headings would only add noise.
  const showGroups = completeness.groups.length > 1;
  return (
    <div className="grid gap-4">
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
              This photo appears in your header and on My Profile. It is not sent with applications.
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
function RepeatableRows({ legend, rows, columns, max, addLabel, error, onChange }) {
  const setCell = (index, key, value) => onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)));
  const blankRow = () => Object.fromEntries(columns.map((column) => [column.key, '']));
  return (
    <fieldset className="m-0 grid gap-3 border-0 p-0">
      <legend className="mb-1 text-sm font-semibold text-app-text">{legend}</legend>
      {rows.map((row, index) => (
        <div key={index} className="grid gap-2 rounded-xl border border-app-border bg-app-surface/60 p-3 md:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))_auto] md:items-end">
          {columns.map((column) => (
            column.type === 'select' ? (
              <select key={column.key} className={controlClass} aria-label={`${legend} ${index + 1} ${column.label}`} value={row[column.key] ?? ''} onChange={(event) => setCell(index, column.key, event.target.value)}>
                {column.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            ) : (
              <input
                key={column.key}
                className={controlClass}
                aria-label={`${legend} ${index + 1} ${column.label}`}
                placeholder={column.label}
                value={row[column.key] ?? ''}
                inputMode={column.type === 'age' ? 'numeric' : undefined}
                onChange={(event) => setCell(index, column.key, column.type === 'age' ? event.target.value.replace(/\D/g, '').slice(0, 3) : event.target.value)}
              />
            )
          ))}
          <Button type="button" variant="ghost" className="!min-h-12" onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))} aria-label={`Remove ${legend.toLowerCase()} ${index + 1}`}>Remove</Button>
        </div>
      ))}
      {error ? <span className="text-sm text-rose-300" role="alert">{error}</span> : null}
      <div><Button type="button" onClick={() => onChange([...rows, blankRow()])} disabled={rows.length >= max}>{addLabel}</Button></div>
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
      bio: asText(profile.bio),
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

  return (
    <SectionForm title="Personal information" description={isStudent ? 'Your name, birthdate, religion, and civil status are included in each application.' : 'Your name and contact details across ScholarPath.'} form={form}>
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
            <FormField label="Last name" hint="Printed as the surname on your application." error={errors.lastName}>
              <input className={controlClass} value={values.lastName} onChange={(event) => update({ lastName: event.target.value.slice(0, NAME_PART_MAX_LENGTH) })} autoComplete="family-name" maxLength={NAME_PART_MAX_LENGTH} aria-invalid={Boolean(errors.lastName)} />
            </FormField>
            <FormField label="First name" error={errors.firstName}>
              <input className={controlClass} value={values.firstName} onChange={(event) => update({ firstName: event.target.value.slice(0, NAME_PART_MAX_LENGTH) })} autoComplete="given-name" maxLength={NAME_PART_MAX_LENGTH} aria-invalid={Boolean(errors.firstName)} />
            </FormField>
            <FormField label="Middle name" hint="Optional." error={errors.middleName}>
              <input className={controlClass} value={values.middleName} onChange={(event) => update({ middleName: event.target.value.slice(0, NAME_PART_MAX_LENGTH) })} autoComplete="additional-name" maxLength={NAME_PART_MAX_LENGTH} aria-invalid={Boolean(errors.middleName)} />
            </FormField>
            {values.lastName || values.firstName ? (
              <ReadOnlyField
                label="Full name"
                value={composeFullName(values)}
                note="Composed from your name parts and printed on the application as Last, First, Middle."
              />
            ) : (
              <FormField label="Full name" hint="Needed to apply until you add your last and first name." error={errors.fullName}>
                <input className={controlClass} value={values.fullName} onChange={(event) => update({ fullName: event.target.value })} autoComplete="name" maxLength={100} aria-invalid={Boolean(errors.fullName)} required />
              </FormField>
            )}
          </>
        ) : (
          <FormField label="Full name" error={errors.fullName}>
            <input className={controlClass} value={values.fullName} onChange={(event) => update({ fullName: event.target.value })} autoComplete="name" maxLength={100} aria-invalid={Boolean(errors.fullName)} required />
          </FormField>
        )}
        <FormField label="Mobile number" hint={isStudent ? 'Needed to apply. Also used for SMS reminders.' : 'Optional. Used for SMS reminders.'} error={errors.phone}>
          <input className={controlClass} value={values.phone} onChange={(event) => update({ phone: event.target.value.replace(/[^\d+\-\s]/g, '').slice(0, 20) })} inputMode="tel" autoComplete="tel" placeholder="e.g. 0917 123 4567" aria-invalid={Boolean(errors.phone)} />
        </FormField>
        {isStudent && <SelectField label="Religion" hint="Optional. Included in each application." value={values.religion} onChange={(value) => update({ religion: value })} options={religionOptions} error={errors.religion} />}
        {isStudent && <SelectField label="Civil status" value={values.civilStatus} onChange={(value) => update({ civilStatus: value })} options={civilStatusOptions} error={errors.civilStatus} />}
        {isStudent && <FormField label="Birthdate" hint="Needed to apply." error={errors.birthdate}><input className={controlClass} type="date" max={todayInputValue()} value={values.birthdate} onChange={(event) => update({ birthdate: event.target.value })} autoComplete="bday" aria-invalid={Boolean(errors.birthdate)} /></FormField>}
        {isStudent && <SelectField label="Sex assigned at birth" hint="Needed to apply." value={values.sexAtBirth} onChange={(value) => update({ sexAtBirth: value })} options={sexAtBirthOptions} error={errors.sexAtBirth} />}
        {isStudent && <FormField label="Preferred pronouns" hint="Optional." error={errors.pronouns}><input className={controlClass} value={values.pronouns} onChange={(event) => update({ pronouns: event.target.value.slice(0, PRONOUNS_MAX_LENGTH) })} placeholder="e.g. she/her" aria-invalid={Boolean(errors.pronouns)} /></FormField>}
      </div>
      <FormField label="Short bio" hint={`${values.bio.length}/${BIO_MAX_LENGTH} characters`} error={errors.bio}>
        <textarea className="min-h-28" value={values.bio} onChange={(event) => update({ bio: event.target.value.slice(0, BIO_MAX_LENGTH) })} rows={4} placeholder="A sentence about your studies or scholarship goals." aria-invalid={Boolean(errors.bio)} />
      </FormField>
      {isStudent && (
        <FormField label="Default scholarship statement" hint={`Optional. Prefills each new application. ${values.essay.length}/${ESSAY_MAX_LENGTH} characters.`} error={errors.essay}>
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

export function AddressSection({ profile, onSave, onDirtyChange, attributeVerifications = {}, onAttachProof, previewProofImpact }) {
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
  });
  const { values, errors, update } = form;
  return (
    <SectionForm title="Address" description="Included in each application you submit. Every application asks for a proof of address." form={form}>
      <FormField label="Complete address" hint={`House number, street, barangay, city or municipality, and province. Up to ${ADDRESS_MAX_LENGTH} characters.`} error={errors.completeAddress}
        labelAdornment={<AttributeVerification attributeKey="completeAddress" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />}>
        <textarea className="min-h-24" value={values.completeAddress} onChange={(event) => update({ completeAddress: event.target.value.slice(0, ADDRESS_MAX_LENGTH) })} rows={3} aria-invalid={Boolean(errors.completeAddress)} />
      </FormField>
      <FormField label="Country" hint={`Up to ${COUNTRY_MAX_LENGTH} characters.`} error={errors.country}>
        <input className={controlClass} value={values.country} onChange={(event) => update({ country: event.target.value.slice(0, COUNTRY_MAX_LENGTH) })} autoComplete="country-name" aria-invalid={Boolean(errors.country)} />
      </FormField>
      <SettingToggle checked={values.sameAsCompleteAddress} onChange={(checked) => update({ sameAsCompleteAddress: checked })} title="Residing address is the same as my complete address" description="Turn off to enter a different address." />
      {!values.sameAsCompleteAddress && (
        <FormField label="Residing address" error={errors.residingAddress}
          labelAdornment={<AttributeVerification attributeKey="residingAddress" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />}>
          <textarea className="min-h-24" value={values.residingAddress} onChange={(event) => update({ residingAddress: event.target.value.slice(0, ADDRESS_MAX_LENGTH) })} rows={3} aria-invalid={Boolean(errors.residingAddress)} />
        </FormField>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField label="Where do you stay while studying?" hint="Choose this if you are not from Davao City." value={values.housingType} onChange={(value) => update({ housingType: value }, ['housingOther'])} options={housingTypeOptions} error={errors.housingType} />
        {values.housingType === 'Other' && <FormField label="Describe where you stay" error={errors.housingOther}><input className={controlClass} value={values.housingOther} onChange={(event) => update({ housingOther: event.target.value.slice(0, SCHOOL_FIELD_MAX_LENGTH) })} aria-invalid={Boolean(errors.housingOther)} /></FormField>}
      </div>
    </SectionForm>
  );
}

// The two family proofs in one block: a PSA birth certificate proves the parents'
// names and a barangay certificate of residency the household. Each badge links to
// the Document Vault with that attribute preselected (onAttachProof).
function FamilyProofRow({ attributeVerifications = {}, onAttachProof }) {
  const rows = [
    { key: 'parents', label: "Parents' names" },
    { key: 'householdMembers', label: 'Siblings and household members' },
  ];
  return (
    <div className="grid gap-2 rounded-xl border border-app-border bg-app-surface px-4 py-3">
      <p className="m-0 text-xs uppercase tracking-[0.08em] text-app-muted">Proof of family details</p>
      {rows.map(({ key, label }) => (
        <div key={key} className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm text-app-text">
          <span className="min-w-0">{label}</span>
          <AttributeVerification attributeKey={key} attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />
        </div>
      ))}
    </div>
  );
}

export function FamilySection({ profile, onSave, onDirtyChange, attributeVerifications = {}, onAttachProof, previewProofImpact }) {
  const stored = profile.familyDetails && typeof profile.familyDetails === 'object' ? profile.familyDetails : {};
  const form = useSectionForm({
    initialValues: { familyDetails: {
      fatherName: asText(stored.fatherName), fatherOccupation: asText(stored.fatherOccupation), fatherDeceased: Boolean(stored.fatherDeceased),
      motherName: asText(stored.motherName), motherOccupation: asText(stored.motherOccupation), motherDeceased: Boolean(stored.motherDeceased),
      familyPosition: asText(stored.familyPosition), numberOfSiblings: asText(stored.numberOfSiblings),
      fatherAge: asText(stored.fatherAge), fatherDateOfDeath: asText(stored.fatherDateOfDeath),
      motherAge: asText(stored.motherAge), motherDateOfDeath: asText(stored.motherDateOfDeath),
      siblings: Array.isArray(stored.siblings) ? stored.siblings.map((row) => ({ name: asText(row?.name), age: asText(row?.age), relationship: asText(row?.relationship), status: asText(row?.status) })) : [],
      householdAdults: Array.isArray(stored.householdAdults) ? stored.householdAdults.map((row) => ({ name: asText(row?.name), age: asText(row?.age), relationship: asText(row?.relationship) })) : [],
    } },
    validate: validateFamilySection,
    onSave,
    onDirtyChange,
    previewProofImpact,
  });
  const { values, errors, update } = form;
  const family = values.familyDetails;
  const updateFamily = (patch) => update({ familyDetails: { ...family, ...patch } }, ['siblings', 'householdAdults']);
  return (
    <SectionForm title="Family details" description="Supports household-income and dependent-based review. Included in each application, with a proof of family details." form={form}>
      <FamilyProofRow attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Father's name" error={errors.fatherName}><input className={controlClass} value={family.fatherName} onChange={(event) => updateFamily({ fatherName: event.target.value })} /></FormField>
        <FormField label="Father's occupation" error={errors.fatherOccupation}><input className={controlClass} value={family.fatherOccupation} onChange={(event) => updateFamily({ fatherOccupation: event.target.value })} /></FormField>
        <SettingToggle checked={family.fatherDeceased} onChange={(checked) => updateFamily({ fatherDeceased: checked })} title="Father is deceased" description="Mark this if your father has passed away." />
        {family.fatherDeceased
          ? <FormField label="Father's date of death" error={errors.fatherDateOfDeath}><input className={controlClass} type="date" max={todayInputValue()} value={family.fatherDateOfDeath} onChange={(event) => updateFamily({ fatherDateOfDeath: event.target.value })} /></FormField>
          : <FormField label="Father's current age" error={errors.fatherAge}><input className={controlClass} value={family.fatherAge} onChange={(event) => updateFamily({ fatherAge: event.target.value.replace(/\D/g, '').slice(0, 3) })} inputMode="numeric" /></FormField>}
        <FormField label="Mother's name" error={errors.motherName}><input className={controlClass} value={family.motherName} onChange={(event) => updateFamily({ motherName: event.target.value })} /></FormField>
        <FormField label="Mother's occupation" error={errors.motherOccupation}><input className={controlClass} value={family.motherOccupation} onChange={(event) => updateFamily({ motherOccupation: event.target.value })} /></FormField>
        <SettingToggle checked={family.motherDeceased} onChange={(checked) => updateFamily({ motherDeceased: checked })} title="Mother is deceased" description="Mark this if your mother has passed away." />
        {family.motherDeceased
          ? <FormField label="Mother's date of death" error={errors.motherDateOfDeath}><input className={controlClass} type="date" max={todayInputValue()} value={family.motherDateOfDeath} onChange={(event) => updateFamily({ motherDateOfDeath: event.target.value })} /></FormField>
          : <FormField label="Mother's current age" error={errors.motherAge}><input className={controlClass} value={family.motherAge} onChange={(event) => updateFamily({ motherAge: event.target.value.replace(/\D/g, '').slice(0, 3) })} inputMode="numeric" /></FormField>}
        <SelectField label="Family position" value={family.familyPosition} onChange={(value) => updateFamily({ familyPosition: value })} options={familyPositionOptions} error={errors.familyPosition} />
        <FormField label="Number of siblings" error={errors.numberOfSiblings}><input className={controlClass} value={family.numberOfSiblings} onChange={(event) => updateFamily({ numberOfSiblings: event.target.value.replace(/\D/g, '').slice(0, 2) })} inputMode="numeric" aria-invalid={Boolean(errors.numberOfSiblings)} /></FormField>
      </div>
      <RepeatableRows
        legend="Sibling"
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
      />
      <RepeatableRows
        legend="Household member"
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
      />
    </SectionForm>
  );
}

export function AcademicSection({ profile, academicPrograms, academicProgramGroups, documents = [], onSave, onDirtyChange, attributeVerifications = {}, onAttachProof, previewProofImpact }) {
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
    },
    validate: (values) => validateAcademicSection(values, academicPrograms),
    onSave,
    onDirtyChange,
    previewProofImpact,
  });
  const { values, errors, update } = form;
  const standing = getStandingRequirements(values.yearStanding);
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
  const verifications = { ...attributeVerifications, ...standingVerifications };
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
    <SectionForm title="Academic profile" description="Drives degree-specific matching in the Smart Eligibility Checker." form={form}>
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField label="Applicant status" value={applicantStatus} onChange={setApplicantStatus} options={applicantStatusOptions} placeholder="Choose applicant status" error={errors.isTransferee} />
        {standingOptions.length ? (
          <SelectField label="Year standing" hint={!values.yearStanding || standingOffered ? 'Choose the year you are going into.' : 'Your saved 1st year standing is no longer offered — choose the year you are going into.'} value={values.yearStanding} onChange={setYearStanding} options={standingOptions} placeholder="Choose year standing" error={errors.yearStanding} />
        ) : null}
        {needsStudentNumber && <FormField label="AdDU student number" hint="4–12 digits from your AdDU record." error={errors.studentNumber}><input className={controlClass} value={values.studentNumber} onChange={(event) => update({ studentNumber: event.target.value.replace(/\D/g, '').slice(0, 12) })} inputMode="numeric" autoComplete="off" placeholder="e.g. 1234567" aria-invalid={Boolean(errors.studentNumber)} /></FormField>}
      </div>
      <div className="grid gap-2">
        <SelectPicker label={standing.programLabel} value={values.degreeProgram} onChange={(value) => update({ degreeProgram: value }, ['programChoice2', 'programChoice3'])} options={choiceOptions.degreeProgram} error={errors.degreeProgram} idPrefix="profile-degree-program" />
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
        <SelectField label="Academic standing" value={values.academicStanding} onChange={(value) => update({ academicStanding: value })} options={academicStandingOptions} placeholder="Choose standing" error={errors.academicStanding} labelAdornment={<AttributeVerification attributeKey="academicStanding" attributeVerifications={verifications} onAttachProof={onAttachProof} />} />
        {standing.requiresQpi && <FormField label="Annual QPI" hint="Self-reported; not Registrar-verified." error={errors.qpi} labelAdornment={<AttributeVerification attributeKey="qpi" attributeVerifications={verifications} onAttachProof={onAttachProof} />}><input className={controlClass} value={values.qpi} onChange={(event) => update({ qpi: event.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').slice(0, 4) })} inputMode="decimal" autoComplete="off" placeholder="e.g. 3.25" aria-invalid={Boolean(errors.qpi)} /></FormField>}
      </div>
      {standing.requiresHsStanding && (
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="Senior high school strand" value={values.hsStrand} onChange={(value) => update({ hsStrand: value })} options={hsStrandOptions.filter((option) => option.value)} placeholder="Choose strand" error={errors.hsStrand} />
          <FormField label="Senior high school general average" hint="Whole number from 60 to 100." error={errors.hsAverage} labelAdornment={<AttributeVerification attributeKey="hsAverage" attributeVerifications={verifications} onAttachProof={onAttachProof} />}><input className={controlClass} value={values.hsAverage} onChange={(event) => update({ hsAverage: event.target.value.replace(/\D/g, '').slice(0, 3) })} inputMode="numeric" placeholder="e.g. 94" aria-invalid={Boolean(errors.hsAverage)} /></FormField>
        </div>
      )}
      {(standing.requiresHsStanding || isTransferee) && (
        <div className="grid gap-3 rounded-2xl border border-app-border bg-app-surface/60 p-4">
          <div>
            <p className="m-0 text-sm font-semibold text-app-text">{isTransferee ? 'College last attended' : 'Senior high school last attended'}</p>
            <small className="field-hint mt-1 block">The school name is needed to apply.</small>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <FormField label="School name"><input className={controlClass} value={values.schoolLastAttended.name} onChange={(event) => update({ schoolLastAttended: { ...values.schoolLastAttended, name: event.target.value.slice(0, SCHOOL_FIELD_MAX_LENGTH) } })} /></FormField>
            <FormField label="City"><input className={controlClass} value={values.schoolLastAttended.city} onChange={(event) => update({ schoolLastAttended: { ...values.schoolLastAttended, city: event.target.value.slice(0, SCHOOL_FIELD_MAX_LENGTH) } })} /></FormField>
            <FormField label="Province"><input className={controlClass} value={values.schoolLastAttended.province} onChange={(event) => update({ schoolLastAttended: { ...values.schoolLastAttended, province: event.target.value.slice(0, SCHOOL_FIELD_MAX_LENGTH) } })} /></FormField>
          </div>
        </div>
      )}
      <FormField label="Awards received" hint={`Optional. ${values.awards.length}/${AWARDS_MAX_LENGTH} characters.`} error={errors.awards}>
        <textarea className="min-h-24" value={values.awards} onChange={(event) => update({ awards: event.target.value.slice(0, AWARDS_MAX_LENGTH) })} rows={3} aria-invalid={Boolean(errors.awards)} />
      </FormField>
    </SectionForm>
  );
}

export function BackgroundSection({ profile, onSave, onDirtyChange, attributeVerifications = {}, onAttachProof, previewProofImpact }) {
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
  });
  const { values, errors, update } = form;
  const updateSponsorTie = (key, checked) => update({ sponsorTies: { ...values.sponsorTies, [key]: checked } });
  // The grant list is only active while the student says they already receive aid.
  // `isGrantListActive` is the single rule behind both the rendering and the
  // validator, so a hidden row can never block the save.
  const grantListActive = isGrantListActive(values);
  // With every aid answer off, the list can only be open because grants were
  // recorded earlier; the note then asks the student to keep or remove them
  // instead of demanding a new row.
  const receivesAid = Boolean(values.hasActiveGovernmentGrant || values.hasOtherActiveScholarship || values.isOnPrepaidPlan);

  return (
    <SectionForm title="Eligibility background" description="Citizenship, disability, employment, household income, existing aid, honors, and sponsor ties." form={form}>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Annual household income" hint="Combined yearly income in Philippine pesos." error={errors.householdIncome} labelAdornment={<AttributeVerification attributeKey="householdIncome" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />}>
          <input className={controlClass} value={values.householdIncome} onChange={(event) => update({ householdIncome: event.target.value.replace(/\D/g, '').slice(0, 10) })} inputMode="numeric" autoComplete="off" placeholder="e.g. 240000" aria-invalid={Boolean(errors.householdIncome)} />
        </FormField>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField label="Citizenship" value={values.citizenship} onChange={(value) => update({ citizenship: value })} options={citizenshipOptions} placeholder="Choose citizenship" error={errors.citizenship} labelAdornment={<AttributeVerification attributeKey="citizenship" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        <SelectField label="Indigenous People (IP) community" value={values.ipCommunity} onChange={(value) => update({ ipCommunity: value })} options={ipCommunityOptions} error={errors.ipCommunity} labelAdornment={<AttributeVerification attributeKey="ipCommunity" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        {values.ipCommunity === 'Yes' && <FormField label="Indigenous group" hint="Name of your community." error={errors.ipGroupName}><input className={controlClass} value={values.ipGroupName} onChange={(event) => update({ ipGroupName: event.target.value.slice(0, SCHOOL_FIELD_MAX_LENGTH) })} aria-invalid={Boolean(errors.ipGroupName)} /></FormField>}
        <SelectField label="Person with Disability (PWD)" value={values.pwd} onChange={(value) => update({ pwd: value })} options={pwdOptions} error={errors.pwd} labelAdornment={<AttributeVerification attributeKey="pwd" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        <SelectField label="Employment status" value={values.employed} onChange={(value) => update({ employed: value })} options={employmentOptions} error={errors.employed} labelAdornment={<AttributeVerification attributeKey="employed" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        <SelectField label="Graduating honors standing" hint="Jubilee Scholarship requires official Valedictorian or Salutatorian standing." value={values.honorsRank} onChange={(value) => update(value ? { honorsRank: value } : { honorsRank: value, graduatingClassSize: '' })} options={honorsRankOptions} error={errors.honorsRank} labelAdornment={<AttributeVerification attributeKey="honorsRank" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        <FormField label="Number of graduates of your senior high school" hint={values.honorsRank ? 'Required to support your honors standing.' : undefined} error={errors.graduatingClassSize}>
          <input className={controlClass} value={values.graduatingClassSize} onChange={(event) => update({ graduatingClassSize: event.target.value.replace(/\D/g, '').slice(0, 5) })} inputMode="numeric" autoComplete="off" placeholder="e.g. 120" aria-invalid={Boolean(errors.graduatingClassSize)} />
        </FormField>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField label="Willing to render community service in return for the grant?" hint="Needed to apply." value={values.communityService} onChange={(value) => update({ communityService: value })} options={communityServiceOptions} error={errors.communityService} />
      </div>
      <fieldset className="m-0 grid gap-3 border-0 p-0">
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

function ParentFinanceFields({ legend, deceased, value, errors, prefix, onChange }) {
  if (deceased) {
    return (
      <fieldset className="m-0 grid gap-2 rounded-2xl border border-app-border bg-app-surface/60 p-4">
        <legend className="px-1 text-sm font-semibold text-app-text">{legend}</legend>
        <p className="m-0 text-sm text-app-muted">Marked as deceased in Family details, so no employment or income is needed.</p>
      </fieldset>
    );
  }
  return (
    <fieldset className="m-0 grid gap-3 rounded-2xl border border-app-border bg-app-surface/60 p-4">
      <legend className="px-1 text-sm font-semibold text-app-text">{legend}</legend>
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField label="Employment status" hint="Needed to apply." value={value.employmentStatus} onChange={(next) => onChange({ employmentStatus: next })} options={parentEmploymentOptions} />
        <FormField label="Annual income (PHP)" hint="As it appears on the income document. Enter 0 if none. Needed to apply." error={errors[`${prefix}AnnualIncome`]}>
          <input className={controlClass} value={value.annualIncome} onChange={(event) => onChange({ annualIncome: event.target.value.replace(/[^\d.]/g, '').slice(0, 12) })} inputMode="decimal" placeholder="e.g. 180000" />
        </FormField>
        {value.employmentStatus === 'employed' || value.employmentStatus === 'self-employed'
          ? <FormField label={value.employmentStatus === 'employed' ? 'Company or employer' : 'Business or trade'} error={errors[`${prefix}Employer`]}><input className={controlClass} value={value.employer} onChange={(event) => onChange({ employer: event.target.value })} /></FormField>
          : null}
        {value.employmentStatus === 'unemployed' && (
          <>
            <FormField label="When last employed" error={errors[`${prefix}LastEmployed`]}><input className={controlClass} value={value.lastEmployed} onChange={(event) => onChange({ lastEmployed: event.target.value })} placeholder="e.g. March 2024" /></FormField>
            <FormField label="Reason for being unemployed" error={errors[`${prefix}UnemploymentReason`]}><input className={controlClass} value={value.unemploymentReason} onChange={(event) => onChange({ unemploymentReason: event.target.value })} /></FormField>
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
    <SectionForm title="Household finances" description="Part of the financial aid application. Shared with the Admissions Office only; your Department Chair cannot see these answers." form={form}>
      {migrationMissing ? <p className="m-0 rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-app-text" role="status">Household finances need the latest database migration before they can be saved.</p> : null}
      <SelectField label="How would you describe your family's economic status?" hint="Needed to apply." value={values.economicStatus} onChange={(value) => update({ economicStatus: value })} options={economicStatusOptions} error={errors.economicStatus} />
      <ParentFinanceFields legend="Father" prefix="father" deceased={Boolean(family.fatherDeceased)} value={values.father} errors={errors} onChange={(patch) => update({ father: { ...values.father, ...patch } })} />
      <ParentFinanceFields legend="Mother" prefix="mother" deceased={Boolean(family.motherDeceased)} value={values.mother} errors={errors} onChange={(patch) => update({ mother: { ...values.mother, ...patch } })} />
      {[['assets', 'Assets owned by the family', ASSET_OPTIONS], ['appliances', 'Appliances and services', APPLIANCE_OPTIONS]].map(([group, legend, options]) => (
        <fieldset key={group} className="m-0 grid gap-3 border-0 p-0">
          <legend className="mb-3 text-sm font-semibold text-app-text">{legend}</legend>
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
