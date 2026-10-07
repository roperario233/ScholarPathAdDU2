import { useEffect, useState } from 'react';
import { Circle, CircleCheck } from 'lucide-react';
import { Button, Card, FormField, SettingToggle, StatusBadge } from './ui';
import { SelectPicker } from '../pages/LoginScreen';
import { checkAdduInternalGate, checkUniversalGate } from '../lib/eligibility';
import { fmtCurrency } from '../lib/formatters';
import { getAttributeVerificationTone } from '../lib/verification';
import {
  BIO_MAX_LENGTH,
  VERIFIABLE_ATTRIBUTE_OPTIONS,
  academicStandingOptions,
  citizenshipOptions,
  deriveYearStanding,
  getStandingRequirements,
  honorsRankOptions,
  hsStrandOptions,
  validateAcademicSection,
  validateBackgroundSection,
  validateFinancialSection,
  validatePasswordChange,
  validatePersonalSection,
  yearStandingOptions,
} from '../lib/profile';

// One fixed height for text boxes and native selects (matching the SelectPicker
// trigger) so side-by-side controls line up; the global padding would otherwise
// size inputs and selects a few pixels apart.
const controlClass = 'h-12 py-0';
const asText = (value) => (value === undefined || value === null ? '' : String(value));
const optionLabel = (options, value) => options.find((option) => String(option.value) === String(value))?.label || '';

// Shared draft/validate/save lifecycle for one My Profile section. The draft
// re-syncs whenever the saved profile changes, so a successful save (or a
// change made elsewhere, such as the Smart Eligibility Checker) never leaves a
// stale form behind.
function useSectionForm({ initialValues, validate, onSave, onDirtyChange }) {
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

  return { values, errors, status, isSaving, isDirty, update, reset, submit };
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
// derived from the student's linked proof documents (src/lib/verification.js) and
// is informational: it never blocks eligibility matching or applying.
function AttributeVerification({ attributeKey, attributeVerifications = {}, onAttachProof }) {
  const status = attributeVerifications[attributeKey] || 'Unverified';
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <StatusBadge tone={getAttributeVerificationTone(status)}>{status}</StatusBadge>
      {status !== 'Verified' && onAttachProof && (
        <button type="button" className="link-btn" onClick={() => onAttachProof(attributeKey)}>Attach proof</button>
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
  admissions_office: 'Central Admissions Office operations role.',
};

export function ProfileOverview({ profile, role, roleLabel, completeness, onEditSection, onOpenEligibility, attributeVerifications = {}, onAttachProof }) {
  const isStudent = role === 'student';
  const exclusionFlags = isStudent
    ? [...checkUniversalGate(profile).reasons, ...checkAdduInternalGate(profile).reasons]
    : [];
  const initials = (profile.fullName || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || 'SP';

  return (
    <div className="grid gap-4">
      <Card title="Account identity">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[20px] bg-gradient-to-br from-ateneo to-sky-400 text-xl font-extrabold text-white" aria-hidden="true">{initials}</span>
          <div className="min-w-0 flex-1">
            <strong className="block break-words text-lg text-app-text">{profile.fullName}</strong>
            <span className="mt-1 block text-sm text-app-muted">{roleLabel}{profile.department ? ` · ${profile.department}` : ''}</span>
            <span className="mt-1 block break-all text-sm text-app-muted">{profile.email}</span>
          </div>
          <Button type="button" onClick={() => onEditSection('personal')}>Edit personal information</Button>
        </div>
        {profile.bio && <p className="mb-0 mt-4 border-t border-app-border pt-4 text-sm text-app-muted">{profile.bio}</p>}
      </Card>

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
        <ul className="m-0 mt-4 grid list-none gap-2 p-0 md:grid-cols-2">
          {completeness.items.map((item) => (
            <li key={item.key} className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-app-surface px-3 py-2">
              <span className="flex min-w-0 items-center gap-2 text-sm text-app-text">
                {item.done
                  ? <CircleCheck size={18} className="shrink-0 text-emerald-500" aria-hidden="true" />
                  : <Circle size={18} className="shrink-0 text-app-muted" aria-hidden="true" />}
                <span className="min-w-0">{item.label}<span className="sr-only">{item.done ? ' (complete)' : ' (missing)'}</span></span>
              </span>
              {!item.done && (
                <button type="button" className="link-btn shrink-0" onClick={() => onEditSection(item.section)}>Add</button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {isStudent && (
        <>
        <Card title="Eligibility snapshot">
          <p className="-mt-1 mb-4 text-sm text-app-muted">The Smart Eligibility Checker matches scholarships using these saved values.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <ReadOnlyField label="Degree program" value={profile.degreeProgram} />
            <ReadOnlyField label="Annual QPI" value={asText(profile.qpi) === '' ? '' : Number(profile.qpi).toFixed(2)} />
            <ReadOnlyField label="Household income" value={asText(profile.householdIncome) === '' ? '' : fmtCurrency(profile.householdIncome)} />
            <ReadOnlyField label="Year standing" value={optionLabel(yearStandingOptions, deriveYearStanding(profile))} />
          </div>
          <div className={`mt-4 rounded-xl border p-4 text-sm ${exclusionFlags.length ? 'border-amber-400/40 bg-amber-500/10' : 'border-emerald-500/30 bg-emerald-500/10'}`}>
            <strong className="block text-app-text">
              {exclusionFlags.length ? `Exclusion Flag Hierarchy: ${exclusionFlags.length} flag${exclusionFlags.length === 1 ? '' : 's'} recorded` : 'Exclusion Flag Hierarchy: no flags recorded'}
            </strong>
            {exclusionFlags.length > 0 && (
              <ul className="m-0 mt-2 grid gap-1 pl-5 text-app-muted">
                {exclusionFlags.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="primary" type="button" onClick={onOpenEligibility}>Check scholarships and eligibility</Button>
            <Button type="button" onClick={() => onEditSection('financial')}>Review exclusion answers</Button>
          </div>
        </Card>
        <Card title="Profile verification">
          <p className="-mt-1 mb-4 text-sm text-app-muted">Upload a proof document in the Document Vault for each attribute you want verified; the Admissions Office verifies the file and the attribute together. Verification is informational and never blocks applying, and QPI and income stay self-reported rather than Registrar-verified.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {VERIFIABLE_ATTRIBUTE_OPTIONS.map((option) => (
              <div key={option.key} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-app-border bg-app-surface px-4 py-3">
                <span className="min-w-0 text-sm text-app-text">{option.label}</span>
                <AttributeVerification attributeKey={option.key} attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />
              </div>
            ))}
          </div>
        </Card>
        </>
      )}
    </div>
  );
}

export function PersonalSection({ profile, role, roleLabel, onSave, onDirtyChange }) {
  const form = useSectionForm({
    initialValues: { fullName: asText(profile.fullName), phone: asText(profile.phone), bio: asText(profile.bio) },
    validate: validatePersonalSection,
    onSave,
    onDirtyChange,
  });
  const { values, errors, update } = form;

  return (
    <SectionForm title="Personal information" description="How your name and contact details appear across ScholarPath." form={form}>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Full name" error={errors.fullName}>
          <input className={controlClass} value={values.fullName} onChange={(event) => update({ fullName: event.target.value })} autoComplete="name" maxLength={100} aria-invalid={Boolean(errors.fullName)} required />
        </FormField>
        <FormField label="Mobile number" hint="Optional. SMS deadline reminders use this Philippine mobile number when SMS notifications are on in Settings." error={errors.phone}>
          <input className={controlClass} value={values.phone} onChange={(event) => update({ phone: event.target.value.replace(/[^\d+\-\s]/g, '').slice(0, 20) })} inputMode="tel" autoComplete="tel" placeholder="e.g. 0917 123 4567" aria-invalid={Boolean(errors.phone)} />
        </FormField>
      </div>
      <FormField label="Short bio" hint={`${values.bio.length}/${BIO_MAX_LENGTH} characters`} error={errors.bio}>
        <textarea className="min-h-28" value={values.bio} onChange={(event) => update({ bio: event.target.value.slice(0, BIO_MAX_LENGTH) })} rows={4} placeholder="A sentence about your studies or scholarship goals." aria-invalid={Boolean(errors.bio)} />
      </FormField>
      <div className="grid gap-3 md:grid-cols-2">
        <ReadOnlyField label="Sign-in email" value={profile.email} note="Managed by your AdDU sign-in account." className="md:col-span-2" />
        <ReadOnlyField label="Role" value={roleLabel} />
        <ReadOnlyField label={role === 'admissions_office' ? 'Office' : 'School / Department'} value={profile.department} note={assignmentNote[role]} />
      </div>
    </SectionForm>
  );
}

export function AcademicSection({ profile, academicPrograms, academicProgramCategories, onSave, onDirtyChange, attributeVerifications = {}, onAttachProof }) {
  const form = useSectionForm({
    initialValues: {
      studentNumber: asText(profile.studentNumber),
      degreeProgram: asText(profile.degreeProgram),
      yearStanding: deriveYearStanding(profile),
      academicStanding: asText(profile.academicStanding),
      qpi: asText(profile.qpi),
      hsStrand: asText(profile.hsStrand),
      hsAverage: asText(profile.hsAverage),
    },
    validate: (values) => validateAcademicSection(values, academicPrograms),
    onSave,
    onDirtyChange,
  });
  const { values, errors, update } = form;
  // The standing decides which fields apply: an incoming first-year reports
  // senior high school standing and has no AdDU student number or QPI yet.
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
        {standing.requiresStudentNumber && (
          <FormField label="AdDU student number" hint="The 4–12 digits on your AdDU ID or registration record." error={errors.studentNumber}>
            <input className={controlClass} value={values.studentNumber} onChange={(event) => update({ studentNumber: event.target.value.replace(/\D/g, '').slice(0, 12) })} inputMode="numeric" autoComplete="off" placeholder="e.g. 1234567" aria-invalid={Boolean(errors.studentNumber)} />
          </FormField>
        )}
      </div>
      <div className="grid gap-2">
        <SelectPicker label={standing.programLabel} value={values.degreeProgram} onChange={(value) => update({ degreeProgram: value })} options={programOptions} idPrefix="profile-degree-program" />
        {errors.degreeProgram && <span className="text-sm text-rose-600 dark:text-rose-300" role="alert">{errors.degreeProgram}</span>}
      </div>
      <ReadOnlyField label="School / Department" value={selectedProgram?.department} note="Updates automatically when you change your degree program." />
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField label="Academic standing" value={values.academicStanding} onChange={(value) => update({ academicStanding: value })} options={academicStandingOptions} placeholder="Choose standing" error={errors.academicStanding} labelAdornment={<AttributeVerification attributeKey="academicStanding" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        {standing.requiresQpi && (
          <FormField label="Annual QPI" hint="Self-reported on the 0.00–4.00 scale. The prototype does not verify QPI with the Registrar." error={errors.qpi} labelAdornment={<AttributeVerification attributeKey="qpi" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />}>
            <input className={controlClass} value={values.qpi} onChange={(event) => update({ qpi: event.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').slice(0, 4) })} inputMode="decimal" autoComplete="off" placeholder="e.g. 3.25" aria-invalid={Boolean(errors.qpi)} />
          </FormField>
        )}
      </div>
      {standing.requiresHsStanding && (
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="Senior high school strand" hint="Incoming first-year students are matched on their senior high school standing." value={values.hsStrand} onChange={(value) => update({ hsStrand: value })} options={hsStrandOptions} error={errors.hsStrand} />
          <FormField label="Senior high school general average" hint="Whole number from 60 to 100." error={errors.hsAverage} labelAdornment={<AttributeVerification attributeKey="hsAverage" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />}>
            <input className={controlClass} value={values.hsAverage} onChange={(event) => update({ hsAverage: event.target.value.replace(/\D/g, '').slice(0, 3) })} inputMode="numeric" autoComplete="off" placeholder="e.g. 94" aria-invalid={Boolean(errors.hsAverage)} />
          </FormField>
        </div>
      )}
    </SectionForm>
  );
}

export function FinancialSection({ profile, onSave, onDirtyChange, attributeVerifications = {}, onAttachProof }) {
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

export function BackgroundSection({ profile, onSave, onDirtyChange, attributeVerifications = {}, onAttachProof }) {
  const form = useSectionForm({
    initialValues: {
      citizenship: asText(profile.citizenship),
      honorsRank: asText(profile.honorsRank),
      graduatingClassSize: asText(profile.graduatingClassSize),
      sponsorTies: {
        gsisMemberDependent: Boolean(profile.sponsorTies?.gsisMemberDependent),
        afpDependent: Boolean(profile.sponsorTies?.afpDependent),
        usVeteranDependent: Boolean(profile.sponsorTies?.usVeteranDependent),
      },
    },
    validate: validateBackgroundSection,
    onSave,
    onDirtyChange,
  });
  const { values, errors, update } = form;
  const updateSponsorTie = (key, checked) => update({ sponsorTies: { ...values.sponsorTies, [key]: checked } });

  return (
    <SectionForm title="Eligibility background" description="Citizenship, graduating honors standing, and sponsor ties used by honors-track and government-linked financial aid pipelines." form={form}>
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField label="Citizenship" value={values.citizenship} onChange={(value) => update({ citizenship: value })} options={citizenshipOptions} placeholder="Choose citizenship" error={errors.citizenship} />
        <SelectField label="Graduating honors standing" hint="Jubilee Scholarship requires official Valedictorian or Salutatorian standing." value={values.honorsRank} onChange={(value) => update({ honorsRank: value })} options={honorsRankOptions} error={errors.honorsRank} labelAdornment={<AttributeVerification attributeKey="honorsRank" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        <FormField label="Graduating class size" hint="Optional unless you hold an honors standing." error={errors.graduatingClassSize}>
          <input className={controlClass} value={values.graduatingClassSize} onChange={(event) => update({ graduatingClassSize: event.target.value.replace(/\D/g, '').slice(0, 5) })} inputMode="numeric" autoComplete="off" placeholder="e.g. 120" aria-invalid={Boolean(errors.graduatingClassSize)} />
        </FormField>
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

export function SecuritySection({ email, isAccountManaged, onChangePassword, onRequestPasswordReset, onDirtyChange }) {
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

  if (!isAccountManaged) {
    return (
      <Card title="Account security">
        <ReadOnlyField label="Sign-in email" value={email} />
        <p className="mb-0 mt-4 rounded-xl border border-app-border bg-app-surface p-4 text-sm text-app-muted">
          This session uses a prototype demo account. Password changes and reset links become available once the Supabase workspace is configured.
        </p>
      </Card>
    );
  }

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
