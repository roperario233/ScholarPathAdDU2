import { useEffect, useState } from 'react';
import { Circle, CircleCheck } from 'lucide-react';
import { Button, Card, FormField, SettingToggle, StatusBadge } from './ui';
import { SelectPicker } from '../pages/LoginScreen';
import { getAttributeVerificationTone } from '../lib/verification';
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
  honorsRankOptions,
  hsStrandOptions,
  ipCommunityOptions,
  pwdOptions,
  religionOptions,
  validateAcademicSection,
  validateAddressSection,
  validateBackgroundSection,
  validateFamilySection,
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

export function ProfileOverview({ completeness, onEditSection, attributeVerifications = {}, onAttachProof }) {
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
        <p className="-mt-1 mb-4 text-sm text-app-muted">Complete your profile and upload proof documents in the Document Vault for each attribute in order for it to be verified by the Admissions Office.</p>
        <ul className="m-0 grid list-none gap-2 p-0 md:grid-cols-2">
          {completeness.items.map((item) => {
            const status = attributeVerifications[item.key];
            const showAttachProof = status !== undefined && status !== 'Verified';
            const showAdd = !item.done && !showAttachProof;
            return (
              <li key={item.key} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl bg-app-surface px-3 py-2">
                <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-app-text">
                  {item.done
                    ? <CircleCheck size={18} className="shrink-0 text-emerald-500" aria-hidden="true" />
                    : <Circle size={18} className="shrink-0 text-app-muted" aria-hidden="true" />}
                  <span className="min-w-0">{item.label}<span className="sr-only">{item.done ? ' (complete)' : ' (missing)'}</span></span>
                  {status !== undefined && (
                    <StatusBadge tone={getAttributeVerificationTone(status)}>{status}</StatusBadge>
                  )}
                </span>
                <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {showAttachProof && (
                    <button type="button" className="link-btn shrink-0" onClick={() => onAttachProof(item.key)}>Attach proof</button>
                  )}
                  {showAdd && (
                    <button type="button" className="link-btn shrink-0" onClick={() => onEditSection(item.section)}>Add</button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

export function PersonalSection({ profile, role, roleLabel, onSave, onDirtyChange }) {
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
    <SectionForm title="Personal information" description="How your name and contact details appear across ScholarPath." form={form}>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Full name" error={errors.fullName}>
          <input className={controlClass} value={values.fullName} onChange={(event) => update({ fullName: event.target.value })} autoComplete="name" maxLength={100} aria-invalid={Boolean(errors.fullName)} required />
        </FormField>
        <FormField label="Mobile number" hint="Optional. SMS deadline reminders use this Philippine mobile number when SMS notifications are on in Settings." error={errors.phone}>
          <input className={controlClass} value={values.phone} onChange={(event) => update({ phone: event.target.value.replace(/[^\d+\-\s]/g, '').slice(0, 20) })} inputMode="tel" autoComplete="tel" placeholder="e.g. 0917 123 4567" aria-invalid={Boolean(errors.phone)} />
        </FormField>
        {isStudent && (
          <>
            <SelectField label="Religion" value={values.religion} onChange={(value) => update({ religion: value })} options={religionOptions} error={errors.religion} />
            <SelectField label="Civil status" value={values.civilStatus} onChange={(value) => update({ civilStatus: value })} options={civilStatusOptions} error={errors.civilStatus} />
          </>
        )}
      </div>
      <FormField label="Short bio" hint={`${values.bio.length}/${BIO_MAX_LENGTH} characters`} error={errors.bio}>
        <textarea className="min-h-28" value={values.bio} onChange={(event) => update({ bio: event.target.value.slice(0, BIO_MAX_LENGTH) })} rows={4} placeholder="A sentence about your studies or scholarship goals." aria-invalid={Boolean(errors.bio)} />
      </FormField>
      {isStudent && (
        <FormField label="Scholarship essay" hint={`${values.essay.length}/${ESSAY_MAX_LENGTH} characters. Paragraph breaks are kept.`} error={errors.essay}>
          <textarea className="min-h-40" value={values.essay} onChange={(event) => update({ essay: event.target.value.slice(0, ESSAY_MAX_LENGTH) })} rows={8} placeholder="Share your motivation, goals, or circumstances for your scholarship applications." aria-invalid={Boolean(errors.essay)} />
        </FormField>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <ReadOnlyField label="Sign-in email" value={profile.email} note="Managed by your AdDU sign-in account." className="md:col-span-2" />
        <ReadOnlyField label="Role" value={roleLabel} />
        <ReadOnlyField label={role === 'admissions_office' ? 'Office' : 'School / Department'} value={profile.department} note={assignmentNote[role]} />
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
    <SectionForm title="Address" description="Where ScholarPath can reach you for scholarship correspondence. The residing address can mirror your complete address." form={form}>
      <FormField label="Complete address" hint={`House number, street, barangay, city or municipality, and province. Up to ${ADDRESS_MAX_LENGTH} characters.`} error={errors.completeAddress}>
        <textarea className="min-h-24" value={values.completeAddress} onChange={(event) => update({ completeAddress: event.target.value.slice(0, ADDRESS_MAX_LENGTH) })} rows={3} placeholder="e.g. 123 Rizal Street, Barangay 5-A, Davao City, Davao del Sur" aria-invalid={Boolean(errors.completeAddress)} />
      </FormField>
      <FormField label="Country" hint={`Up to ${COUNTRY_MAX_LENGTH} characters.`} error={errors.country}>
        <input className={controlClass} value={values.country} onChange={(event) => update({ country: event.target.value.slice(0, COUNTRY_MAX_LENGTH) })} autoComplete="country-name" placeholder="e.g. Philippines" aria-invalid={Boolean(errors.country)} />
      </FormField>
      <SettingToggle checked={values.sameAsCompleteAddress} onChange={(checked) => update({ sameAsCompleteAddress: checked })} title="Residing address is the same as my complete address" description="Turn this off to enter a different address where you currently reside." />
      {!values.sameAsCompleteAddress && (
        <FormField label="Residing address" hint={`Where you currently reside. Up to ${ADDRESS_MAX_LENGTH} characters.`} error={errors.residingAddress}>
          <textarea className="min-h-24" value={values.residingAddress} onChange={(event) => update({ residingAddress: event.target.value.slice(0, ADDRESS_MAX_LENGTH) })} rows={3} placeholder="e.g. Boarding house, Barangay 10, Davao City" aria-invalid={Boolean(errors.residingAddress)} />
        </FormField>
      )}
    </SectionForm>
  );
}

export function FamilySection({ profile, onSave, onDirtyChange }) {
  const stored = profile.familyDetails && typeof profile.familyDetails === 'object' ? profile.familyDetails : {};
  const form = useSectionForm({
    initialValues: {
      familyDetails: {
        fatherName: asText(stored.fatherName),
        fatherOccupation: asText(stored.fatherOccupation),
        fatherDeceased: Boolean(stored.fatherDeceased),
        motherName: asText(stored.motherName),
        motherOccupation: asText(stored.motherOccupation),
        motherDeceased: Boolean(stored.motherDeceased),
        familyPosition: asText(stored.familyPosition),
        numberOfSiblings: asText(stored.numberOfSiblings),
      },
    },
    validate: validateFamilySection,
    onSave,
    onDirtyChange,
  });
  const { values, errors, update } = form;
  const family = values.familyDetails;
  const updateFamily = (patch) => update({ familyDetails: { ...family, ...patch } });

  return (
    <SectionForm title="Family details" description="Your family composition supports household-income and dependent-based financial aid review." form={form}>
      <fieldset className="m-0 grid gap-4 border-0 p-0">
        <legend className="text-sm font-semibold text-app-text">Father</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Father's name" error={errors.fatherName}>
            <input className={controlClass} value={family.fatherName} onChange={(event) => updateFamily({ fatherName: event.target.value })} autoComplete="off" placeholder="Full name" aria-invalid={Boolean(errors.fatherName)} />
          </FormField>
          <FormField label="Father's occupation" error={errors.fatherOccupation}>
            <input className={controlClass} value={family.fatherOccupation} onChange={(event) => updateFamily({ fatherOccupation: event.target.value })} autoComplete="off" placeholder="e.g. Fisherman" aria-invalid={Boolean(errors.fatherOccupation)} />
          </FormField>
        </div>
        <SettingToggle checked={family.fatherDeceased} onChange={(checked) => updateFamily({ fatherDeceased: checked })} title="Father is deceased" description="Mark this if your father has passed away." />
      </fieldset>
      <fieldset className="m-0 grid gap-4 border-0 p-0">
        <legend className="text-sm font-semibold text-app-text">Mother</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Mother's name" error={errors.motherName}>
            <input className={controlClass} value={family.motherName} onChange={(event) => updateFamily({ motherName: event.target.value })} autoComplete="off" placeholder="Full name" aria-invalid={Boolean(errors.motherName)} />
          </FormField>
          <FormField label="Mother's occupation" error={errors.motherOccupation}>
            <input className={controlClass} value={family.motherOccupation} onChange={(event) => updateFamily({ motherOccupation: event.target.value })} autoComplete="off" placeholder="e.g. Sari-sari store owner" aria-invalid={Boolean(errors.motherOccupation)} />
          </FormField>
        </div>
        <SettingToggle checked={family.motherDeceased} onChange={(checked) => updateFamily({ motherDeceased: checked })} title="Mother is deceased" description="Mark this if your mother has passed away." />
      </fieldset>
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField label="Family position" value={family.familyPosition} onChange={(value) => updateFamily({ familyPosition: value })} options={familyPositionOptions} error={errors.familyPosition} />
        <FormField label="Number of siblings" hint="Whole number, not counting yourself." error={errors.numberOfSiblings}>
          <input className={controlClass} value={family.numberOfSiblings} onChange={(event) => updateFamily({ numberOfSiblings: event.target.value.replace(/\D/g, '').slice(0, 2) })} inputMode="numeric" autoComplete="off" placeholder="e.g. 2" aria-invalid={Boolean(errors.numberOfSiblings)} />
        </FormField>
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
      programChoice2: asText(profile.programChoice2),
      programChoice3: asText(profile.programChoice3),
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
      {standing.requiresProgramChoices && (
        <div className="grid gap-3 rounded-2xl border border-app-border bg-app-surface/60 p-4">
          <div>
            <p className="m-0 text-sm font-semibold text-app-text">Program choices</p>
            <small className="field-hint mt-1 block">Your 1st choice is the program above. Add a 2nd and 3rd choice when you are applying to more than one program.</small>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <SelectPicker label="2nd choice program" value={values.programChoice2} onChange={(value) => update({ programChoice2: value })} options={programOptions} idPrefix="profile-program-choice-2" />
            <SelectPicker label="3rd choice program" value={values.programChoice3} onChange={(value) => update({ programChoice3: value })} options={programOptions} idPrefix="profile-program-choice-3" />
          </div>
          {(errors.programChoice2 || errors.programChoice3) && <span className="text-sm text-rose-600 dark:text-rose-300" role="alert">{errors.programChoice2 || errors.programChoice3}</span>}
        </div>
      )}
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
      ipCommunity: asText(profile.ipCommunity),
      pwd: asText(profile.pwd),
      employed: asText(profile.employed),
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
    <SectionForm title="Eligibility background" description="Citizenship, IP community, disability, employment status, graduating honors standing, and sponsor ties used by honors-track and government-linked financial aid pipelines." form={form}>
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField label="Citizenship" value={values.citizenship} onChange={(value) => update({ citizenship: value })} options={citizenshipOptions} placeholder="Choose citizenship" error={errors.citizenship} labelAdornment={<AttributeVerification attributeKey="citizenship" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        <SelectField label="Indigenous People (IP) community" hint="Whether you belong to a recognized IP community." value={values.ipCommunity} onChange={(value) => update({ ipCommunity: value })} options={ipCommunityOptions} error={errors.ipCommunity} labelAdornment={<AttributeVerification attributeKey="ipCommunity" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        <SelectField label="Person with Disability (PWD)" value={values.pwd} onChange={(value) => update({ pwd: value })} options={pwdOptions} error={errors.pwd} labelAdornment={<AttributeVerification attributeKey="pwd" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        <SelectField label="Employment status" hint="Whether you are currently employed while studying." value={values.employed} onChange={(value) => update({ employed: value })} options={employmentOptions} error={errors.employed} labelAdornment={<AttributeVerification attributeKey="employed" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        <SelectField label="Graduating honors standing" hint="Jubilee Scholarship requires official Valedictorian or Salutatorian standing." value={values.honorsRank} onChange={(value) => update(value ? { honorsRank: value } : { honorsRank: value, graduatingClassSize: '' })} options={honorsRankOptions} error={errors.honorsRank} labelAdornment={<AttributeVerification attributeKey="honorsRank" attributeVerifications={attributeVerifications} onAttachProof={onAttachProof} />} />
        {values.honorsRank && (
          <FormField label="Graduating class size" hint="Required to support your honors standing." error={errors.graduatingClassSize}>
            <input className={controlClass} value={values.graduatingClassSize} onChange={(event) => update({ graduatingClassSize: event.target.value.replace(/\D/g, '').slice(0, 5) })} inputMode="numeric" autoComplete="off" placeholder="e.g. 120" aria-invalid={Boolean(errors.graduatingClassSize)} />
          </FormField>
        )}
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
