import { useEffect, useState } from 'react';
import { Camera, Circle, CircleCheck, TriangleAlert } from 'lucide-react';
import { Button, Card, FormField, SettingToggle, StatusBadge } from './ui';
import ProfileAvatar from './ProfileAvatar';
import PhotoCaptureModal from './PhotoCaptureModal';
import { AVATAR_ACCEPT } from '../lib/avatarStorage';
import { SelectPicker } from '../pages/LoginScreen';
import { getAttributeVerificationTone } from '../lib/verification';
import { VAULT_REQUIREMENT_STATE_LABELS, getRequirementUploadPreset } from '../lib/applicationRequirements';
import {
  ADDRESS_MAX_LENGTH,
  BIO_MAX_LENGTH,
  COUNTRY_MAX_LENGTH,
  ESSAY_MAX_LENGTH,
  academicStandingOptions,
  citizenshipOptions,
  civilStatusOptions,
  deriveYearStanding,
  employmentOptions,
  familyPositionOptions,
  getStandingRequirements,
  getVerifiableAttributeOption,
  honorsRankOptions,
  hsStrandOptions,
  ipCommunityOptions,
  pwdOptions,
  validateAcademicSection,
  validateAddressSection,
  validateBackgroundSection,
  validateFamilySection,
  validateFinancialSection,
  validatePasswordChange,
  validatePersonalSection,
  religionOptions,
  yearStandingOptions,
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

  const update = (patch) => {
    setValues((previous) => ({ ...previous, ...patch }));
    setErrors((previous) => {
      const next = { ...previous };
      Object.keys(patch).forEach((key) => delete next[key]);
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
// attached before it is submitted. An answer that claims nothing reads
// `Not needed` and asks for no document.
function AttributeVerification({ attributeKey, attributeVerifications = {}, onAttachProof }) {
  const status = attributeVerifications[attributeKey] || 'Unverified';
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <StatusBadge tone={getAttributeVerificationTone(status)}>{status}</StatusBadge>
      {status !== 'Verified' && status !== 'Not needed' && onAttachProof && (
        <button type="button" className="link-btn" onClick={() => onAttachProof(attributeKey)}>{status === 'Outdated' ? 'Upload new proof' : 'Attach proof'}</button>
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
  student: 'Set automatically from your degree program in Academic profile.',
  department_chair: 'Your assigned department scopes the Department Review queue and is managed by the Admissions Office.',
  admissions_office: 'Admissions Office Staff lane: application preparation and document verification.',
  admissions_head: 'Full Admissions Office authority: preparation, verification, approval, release, catalog, and announcements.',
};

// Both Admissions Office lanes belong to the central office, so the read-only
// field reads "Office" for either of them.
const isAdmissionsRole = (role) => role === 'admissions_office' || role === 'admissions_head';

// The year standing decides which answers an application reads, so the
// overview says which credential the student is matched on.
const standingNote = (standing) => {
  if (standing.isIncomingFirstYear) return 'As an incoming first-year, you are matched on your senior high school general average. An AdDU student number and QPI are not asked until you enroll.';
  if (standing.isContinuing) return 'As an enrolled student, you are matched on your annual QPI and identified by your AdDU student number.';
  return 'Choose your year standing in Academic profile to see the items that apply to you.';
};

const completenessGroupNotes = {
  application: 'Complete these before you can start an AdDU application. The Smart Eligibility Checker reads them, each submission saves them in your profile snapshot, and each application needs a current proof of them from your Document Vault.',
  details: 'Not required to apply, but every answer except your mobile number is included in the profile snapshot of each application you submit, which the Admissions Office and your Department Chair review. A mobile number enables SMS reminders.',
};

function CompletenessItem({ item, status, onEditSection, onAttachProof }) {
  // A verification badge only means something once the answer is filled in.
  const showStatus = item.done && status !== undefined;
  const showAttachProof = showStatus && status !== 'Verified' && status !== 'Not needed' && onAttachProof;
  return (
    <li className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl bg-app-surface px-3 py-2">
      <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-app-text">
        {item.done
          ? <CircleCheck size={18} className="shrink-0 text-emerald-500" aria-hidden="true" />
          : <Circle size={18} className="shrink-0 text-app-muted" aria-hidden="true" />}
        <span className="min-w-0">{item.label}<span className="sr-only">{item.done ? ' (complete)' : ' (missing)'}</span></span>
        {showStatus && <StatusBadge tone={getAttributeVerificationTone(status)}>{status}</StatusBadge>}
      </span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {showAttachProof && (
          <button type="button" className="link-btn shrink-0" onClick={() => onAttachProof(item.key)}>{status === 'Pending' ? 'View' : status === 'Outdated' ? 'Upload new proof' : 'Attach proof'}</button>
        )}
        {!item.done && (
          <button type="button" className="link-btn shrink-0" onClick={() => onEditSection(item.section)}>Add</button>
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
      ? 'The open scholarships list no required documents.'
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
                    <button type="button" className="link-btn shrink-0" onClick={() => onUploadDocument(getRequirementUploadPreset(item, standing))}>
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
          <button type="button" className="link-btn shrink-0" onClick={() => onEditSection('personal')}>{hasDefaultStatement ? 'Edit' : 'Write'}</button>
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
              This photo appears in your header and on My Profile. It is not sent with your applications: each application has its own 2x2 ID photo requirement, which the Admissions Office verifies.
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

export function PersonalSection({ profile, role, roleLabel, onSave, onDirtyChange, avatar = {}, onChangeAvatar, onRemoveAvatar }) {
  const isStudent = role === 'student';
  const form = useSectionForm({
    initialValues: {
      fullName: asText(profile.fullName),
      phone: asText(profile.phone),
      bio: asText(profile.bio),
      religion: asText(profile.religion),
      civilStatus: asText(profile.civilStatus),
      essay: asText(profile.essay),
    },
    validate: validatePersonalSection,
    onSave,
    onDirtyChange,
  });
  const { values, errors, update } = form;

  return (
    <SectionForm title="Personal information" description={isStudent ? 'How your name and contact details appear across ScholarPath. Your name, religion, and civil status are included in each application you submit.' : 'How your name and contact details appear across ScholarPath.'} form={form}>
      <ProfilePhotoCard
        fullName={values.fullName || profile.fullName}
        avatar={avatar}
        isSaving={avatar.isSaving}
        onChangeAvatar={onChangeAvatar}
        onRemoveAvatar={onRemoveAvatar}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Full name" error={errors.fullName}>
          <input className={controlClass} value={values.fullName} onChange={(event) => update({ fullName: event.target.value })} autoComplete="name" maxLength={100} aria-invalid={Boolean(errors.fullName)} required />
        </FormField>
        <FormField label="Mobile number" hint="Optional. SMS deadline reminders use this Philippine mobile number when SMS notifications are on in Settings." error={errors.phone}>
          <input className={controlClass} value={values.phone} onChange={(event) => update({ phone: event.target.value.replace(/[^\d+\-\s]/g, '').slice(0, 20) })} inputMode="tel" autoComplete="tel" placeholder="e.g. 0917 123 4567" aria-invalid={Boolean(errors.phone)} />
        </FormField>
        {isStudent && <SelectField label="Religion" hint="Optional. Included in each application you submit; choose “Prefer not to say” to leave it out." value={values.religion} onChange={(value) => update({ religion: value })} options={religionOptions} error={errors.religion} />}
        {isStudent && <SelectField label="Civil status" value={values.civilStatus} onChange={(value) => update({ civilStatus: value })} options={civilStatusOptions} error={errors.civilStatus} />}
      </div>
      <FormField label="Short bio" hint={`${values.bio.length}/${BIO_MAX_LENGTH} characters`} error={errors.bio}>
        <textarea className="min-h-28" value={values.bio} onChange={(event) => update({ bio: event.target.value.slice(0, BIO_MAX_LENGTH) })} rows={4} placeholder="A sentence about your studies or scholarship goals." aria-invalid={Boolean(errors.bio)} />
      </FormField>
      {isStudent && (
        <FormField label="Default scholarship statement" hint={`Optional. Prefills the statement of each new application, where you can tailor it per scholarship. ${values.essay.length}/${ESSAY_MAX_LENGTH} characters.`} error={errors.essay}>
          <textarea className="min-h-40" value={values.essay} onChange={(event) => update({ essay: event.target.value.slice(0, ESSAY_MAX_LENGTH) })} rows={8} placeholder="Share your motivation, goals, or circumstances. This becomes the starting statement for your applications." aria-invalid={Boolean(errors.essay)} />
        </FormField>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <ReadOnlyField label="Sign-in email" value={profile.email} note="Managed by your sign-in account." className="md:col-span-2" />
        <ReadOnlyField label="Role" value={roleLabel} />
        <ReadOnlyField label={isAdmissionsRole(role) ? 'Office' : 'School / Department'} value={profile.department} note={assignmentNote[role]} />
      </div>
    </SectionForm>
  );
}

export function AddressSection({ profile, onSave, onDirtyChange }) {
  const form = useSectionForm({
    initialValues: {
      completeAddress: asText(profile.completeAddress),
      country: asText(profile.country),
      sameAsCompleteAddress: profile.sameAsCompleteAddress !== false,
      residingAddress: asText(profile.residingAddress),
    },
    validate: validateAddressSection,
    onSave,
    onDirtyChange,
  });
  const { values, errors, update } = form;
  return (
    <SectionForm title="Address" description="Where ScholarPath can reach you for scholarship correspondence. Your addresses are included in each application you submit." form={form}>
      <FormField label="Complete address" hint={`House number, street, barangay, city or municipality, and province. Up to ${ADDRESS_MAX_LENGTH} characters.`} error={errors.completeAddress}>
        <textarea className="min-h-24" value={values.completeAddress} onChange={(event) => update({ completeAddress: event.target.value.slice(0, ADDRESS_MAX_LENGTH) })} rows={3} aria-invalid={Boolean(errors.completeAddress)} />
      </FormField>
      <FormField label="Country" hint={`Up to ${COUNTRY_MAX_LENGTH} characters.`} error={errors.country}>
        <input className={controlClass} value={values.country} onChange={(event) => update({ country: event.target.value.slice(0, COUNTRY_MAX_LENGTH) })} autoComplete="country-name" aria-invalid={Boolean(errors.country)} />
      </FormField>
      <SettingToggle checked={values.sameAsCompleteAddress} onChange={(checked) => update({ sameAsCompleteAddress: checked })} title="Residing address is the same as my complete address" description="Turn this off to enter a different address where you currently reside." />
      {!values.sameAsCompleteAddress && (
        <FormField label="Residing address" error={errors.residingAddress}>
          <textarea className="min-h-24" value={values.residingAddress} onChange={(event) => update({ residingAddress: event.target.value.slice(0, ADDRESS_MAX_LENGTH) })} rows={3} aria-invalid={Boolean(errors.residingAddress)} />
        </FormField>
      )}
    </SectionForm>
  );
}

export function FamilySection({ profile, onSave, onDirtyChange }) {
  const stored = profile.familyDetails && typeof profile.familyDetails === 'object' ? profile.familyDetails : {};
  const form = useSectionForm({
    initialValues: { familyDetails: {
      fatherName: asText(stored.fatherName), fatherOccupation: asText(stored.fatherOccupation), fatherDeceased: Boolean(stored.fatherDeceased),
      motherName: asText(stored.motherName), motherOccupation: asText(stored.motherOccupation), motherDeceased: Boolean(stored.motherDeceased),
      familyPosition: asText(stored.familyPosition), numberOfSiblings: asText(stored.numberOfSiblings),
    } },
    validate: validateFamilySection,
    onSave,
    onDirtyChange,
  });
  const { values, errors, update } = form;
  const family = values.familyDetails;
  const updateFamily = (patch) => update({ familyDetails: { ...family, ...patch } });
  return (
    <SectionForm title="Family details" description="Family composition supports household-income and dependent-based financial aid review, and is included in each application you submit." form={form}>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Father's name" error={errors.fatherName}><input className={controlClass} value={family.fatherName} onChange={(event) => updateFamily({ fatherName: event.target.value })} /></FormField>
        <FormField label="Father's occupation" error={errors.fatherOccupation}><input className={controlClass} value={family.fatherOccupation} onChange={(event) => updateFamily({ fatherOccupation: event.target.value })} /></FormField>
        <SettingToggle checked={family.fatherDeceased} onChange={(checked) => updateFamily({ fatherDeceased: checked })} title="Father is deceased" description="Mark this if your father has passed away." />
        <FormField label="Mother's name" error={errors.motherName}><input className={controlClass} value={family.motherName} onChange={(event) => updateFamily({ motherName: event.target.value })} /></FormField>
        <FormField label="Mother's occupation" error={errors.motherOccupation}><input className={controlClass} value={family.motherOccupation} onChange={(event) => updateFamily({ motherOccupation: event.target.value })} /></FormField>
        <SettingToggle checked={family.motherDeceased} onChange={(checked) => updateFamily({ motherDeceased: checked })} title="Mother is deceased" description="Mark this if your mother has passed away." />
        <SelectField label="Family position" value={family.familyPosition} onChange={(value) => updateFamily({ familyPosition: value })} options={familyPositionOptions} error={errors.familyPosition} />
        <FormField label="Number of siblings" error={errors.numberOfSiblings}><input className={controlClass} value={family.numberOfSiblings} onChange={(event) => updateFamily({ numberOfSiblings: event.target.value.replace(/\D/g, '').slice(0, 2) })} inputMode="numeric" aria-invalid={Boolean(errors.numberOfSiblings)} /></FormField>
      </div>
    </SectionForm>
  );
}

export function AcademicSection({ profile, academicPrograms, academicProgramCategories, onSave, onDirtyChange, attributeVerifications = {}, onAttachProof, previewProofImpact }) {
  const form = useSectionForm({
    initialValues: {
      studentNumber: asText(profile.studentNumber),
      degreeProgram: asText(profile.degreeProgram),
      yearStanding: deriveYearStanding(profile),
      academicStanding: asText(profile.academicStanding),
      qpi: asText(profile.qpi),
      hsStrand: asText(profile.hsStrand),
      hsAverage: asText(profile.hsAverage),
      programChoice2: asText(profile.programChoice2),
      programChoice3: asText(profile.programChoice3),
    },
    validate: (values) => validateAcademicSection(values, academicPrograms),
    onSave,
    onDirtyChange,
    previewProofImpact,
  });
  const { values, errors, update } = form;
  const standing = getStandingRequirements(values.yearStanding);
  const selectedProgram = academicPrograms.find((program) => program.value === values.degreeProgram);
  const programOptions = academicProgramCategories.flatMap((category) => [
    { value: `group-${category}`, label: category, isGroup: true },
    ...academicPrograms.filter((program) => program.category === category),
  ]);

  return (
    <SectionForm title="Academic profile" description="Your enrollment details drive degree-specific matching in the Smart Eligibility Checker." form={form}>
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField label="Year standing" value={values.yearStanding} onChange={(value) => update({ yearStanding: value })} options={yearStandingOptions} placeholder="Choose year standing" error={errors.yearStanding} />
        {standing.requiresStudentNumber && <FormField label="AdDU student number" hint="The 4–12 digits on your AdDU ID or registration record." error={errors.studentNumber}><input className={controlClass} value={values.studentNumber} onChange={(event) => update({ studentNumber: event.target.value.replace(/\D/g, '').slice(0, 12) })} inputMode="numeric" autoComplete="off" placeholder="e.g. 1234567" aria-invalid={Boolean(errors.studentNumber)} /></FormField>}
      </div>
      <div className="grid gap-2">
        <SelectPicker label={standing.programLabel} value={values.degreeProgram} onChange={(value) => update({ degreeProgram: value })} options={programOptions} idPrefix="profile-degree-program" />
        {errors.degreeProgram && <span className="text-sm text-rose-600 dark:text-rose-300" role="alert">{errors.degreeProgram}</span>}
      </div>
      <ReadOnlyField label="School / Department" value={selectedProgram?.department} note="Updates automatically when you change your degree program." />
      {standing.requiresProgramChoices && <div className="grid gap-3 rounded-2xl border border-app-border bg-app-surface/60 p-4"><p className="m-0 text-sm font-semibold text-app-text">Ranked program choices</p><div className="grid gap-3 md:grid-cols-2"><SelectPicker label="2nd choice program" value={values.programChoice2} onChange={(value) => update({ programChoice2: value })} options={programOptions} idPrefix="profile-program-choice-2" /><SelectPicker label="3rd choice program" value={values.programChoice3} onChange={(value) => update({ programChoice3: value })} options={programOptions} idPrefix="profile-program-choice-3" /></div>{(errors.programChoice2 || errors.programChoice3) && <span className="text-sm text-rose-600 dark:text-rose-300" role="alert">{errors.programChoice2 || errors.programChoice3}</span>}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField label="Academic standing" value={values.academicStanding} onChange={(value) => update({ academicStanding: value })} options={academicStandingOptions} placeholder="Choose standing" error={errors.academicStanding} labelAdornment={<AttributeVerification attributeKey="academicStanding" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        {standing.requiresQpi && <FormField label="Annual QPI" hint="Self-reported. The prototype does not verify QPI with the Registrar." error={errors.qpi} labelAdornment={<AttributeVerification attributeKey="qpi" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />}><input className={controlClass} value={values.qpi} onChange={(event) => update({ qpi: event.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').slice(0, 4) })} inputMode="decimal" autoComplete="off" placeholder="e.g. 3.25" aria-invalid={Boolean(errors.qpi)} /></FormField>}
      </div>
      {standing.requiresHsStanding && <div className="grid gap-4 md:grid-cols-2"><SelectField label="Senior high school strand" value={values.hsStrand} onChange={(value) => update({ hsStrand: value })} options={hsStrandOptions.filter((option) => option.value)} placeholder="Choose strand" error={errors.hsStrand} /><FormField label="Senior high school general average" hint="Whole number from 60 to 100." error={errors.hsAverage} labelAdornment={<AttributeVerification attributeKey="hsAverage" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />}><input className={controlClass} value={values.hsAverage} onChange={(event) => update({ hsAverage: event.target.value.replace(/\D/g, '').slice(0, 3) })} inputMode="numeric" placeholder="e.g. 94" aria-invalid={Boolean(errors.hsAverage)} /></FormField></div>}
    </SectionForm>
  );
}

export function FinancialSection({ profile, onSave, onDirtyChange, attributeVerifications = {}, onAttachProof, previewProofImpact }) {
  const form = useSectionForm({
    initialValues: {
      householdIncome: asText(profile.householdIncome),
      hasActiveGovernmentGrant: Boolean(profile.hasActiveGovernmentGrant),
      hasOtherActiveScholarship: Boolean(profile.hasOtherActiveScholarship),
      hasSiblingOnAid: Boolean(profile.hasSiblingOnAid),
      isOnPrepaidPlan: Boolean(profile.isOnPrepaidPlan),
    },
    validate: validateFinancialSection,
    onSave,
    onDirtyChange,
    previewProofImpact,
  });
  const { values, errors, update } = form;

  return (
    <SectionForm title="Household and financial aid" description="Income ceilings and the Exclusion Flag Hierarchy use these answers. Specific exclusions override broad inclusions." form={form}>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Annual household income" hint="Combined household income for one year, in Philippine pesos." error={errors.householdIncome} labelAdornment={<AttributeVerification attributeKey="householdIncome" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />}>
          <input className={controlClass} value={values.householdIncome} onChange={(event) => update({ householdIncome: event.target.value.replace(/\D/g, '').slice(0, 10) })} inputMode="numeric" autoComplete="off" placeholder="e.g. 240000" aria-invalid={Boolean(errors.householdIncome)} />
        </FormField>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <SettingToggle checked={values.hasActiveGovernmentGrant} onChange={(checked) => update({ hasActiveGovernmentGrant: checked })} title="Active government grant" description="Excludes scholarships that cannot be combined with another government grant." />
        <SettingToggle checked={values.hasOtherActiveScholarship} onChange={(checked) => update({ hasOtherActiveScholarship: checked })} title="Another active scholarship" description="Held without College Scholarship Committee approval." />
        <SettingToggle checked={values.hasSiblingOnAid} onChange={(checked) => update({ hasSiblingOnAid: checked })} title="Sibling on AdDU financial aid" description="A sibling currently receives AdDU-administered financial aid." />
        <SettingToggle checked={values.isOnPrepaidPlan} onChange={(checked) => update({ isOnPrepaidPlan: checked })} title="Prepaid tuition plan" description="Tuition and fees are covered by a prepaid educational plan." />
      </div>
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
    },
    validate: validateBackgroundSection,
    onSave,
    onDirtyChange,
    previewProofImpact,
  });
  const { values, errors, update } = form;
  const updateSponsorTie = (key, checked) => update({ sponsorTies: { ...values.sponsorTies, [key]: checked } });

  return (
    <SectionForm title="Eligibility background" description="Citizenship, disability, employment status, honors, and sponsor ties used by financial aid pipelines." form={form}>
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField label="Citizenship" value={values.citizenship} onChange={(value) => update({ citizenship: value })} options={citizenshipOptions} placeholder="Choose citizenship" error={errors.citizenship} labelAdornment={<AttributeVerification attributeKey="citizenship" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        <SelectField label="Indigenous People (IP) community" value={values.ipCommunity} onChange={(value) => update({ ipCommunity: value })} options={ipCommunityOptions} error={errors.ipCommunity} labelAdornment={<AttributeVerification attributeKey="ipCommunity" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        <SelectField label="Person with Disability (PWD)" value={values.pwd} onChange={(value) => update({ pwd: value })} options={pwdOptions} error={errors.pwd} labelAdornment={<AttributeVerification attributeKey="pwd" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        <SelectField label="Employment status" value={values.employed} onChange={(value) => update({ employed: value })} options={employmentOptions} error={errors.employed} labelAdornment={<AttributeVerification attributeKey="employed" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        <SelectField label="Graduating honors standing" hint="Jubilee Scholarship requires official Valedictorian or Salutatorian standing." value={values.honorsRank} onChange={(value) => update(value ? { honorsRank: value } : { honorsRank: value, graduatingClassSize: '' })} options={honorsRankOptions} error={errors.honorsRank} labelAdornment={<AttributeVerification attributeKey="honorsRank" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        {values.honorsRank && <FormField label="Graduating class size" hint="Required to support your honors standing." error={errors.graduatingClassSize}>
          <input className={controlClass} value={values.graduatingClassSize} onChange={(event) => update({ graduatingClassSize: event.target.value.replace(/\D/g, '').slice(0, 5) })} inputMode="numeric" autoComplete="off" placeholder="e.g. 120" aria-invalid={Boolean(errors.graduatingClassSize)} />
        </FormField>}
      </div>
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
