import { useEffect, useMemo, useState } from 'react';
import logoImage from '../../pictures/logo.png';
import { Button, FormField, ModalShell, StatusBadge } from './ui';
import { SelectPicker } from '../pages/LoginScreen';
import {
  academicStandingOptions,
  citizenshipOptions,
  getProgramChoiceOptions,
  getStandingRequirements,
  hsStrandOptions,
  validateOnboardingEssentials,
  yearStandingOptions,
} from '../lib/profile';
import { describeAttributeVerification, deriveAttributeVerifications, getAttributeVerificationTone } from '../lib/verification';

// Text boxes and selects share one fixed height (matching the SelectPicker
// trigger) so side-by-side controls line up.
const controlClass = 'h-12 py-0';

// A profile attribute the Admissions Office can verify against a Document Vault
// proof document. The state is derived from the student's linked documents
// (src/lib/verification.js). It never blocks eligibility matching; an
// application needs a current proof attached before it is submitted. An answer
// with no proof uploaded yet reads as
// "Unverified", which renders as a neutral badge rather than an error, and an
// answer that needs no proof names its reason (`Not applicable`, `No proof
// needed`, or `Not answered`).
function AttributeVerificationBadge({ attributeKey, attributeVerifications = {} }) {
  const status = attributeVerifications[attributeKey] || 'Unverified';
  return <StatusBadge tone={getAttributeVerificationTone(status)} title={describeAttributeVerification(status)}>{status}</StatusBadge>;
}

function NativeSelect({ label, hint, error, labelAdornment, value, onChange, options, placeholder }) {
  return (
    <FormField label={label} hint={hint} error={error} labelAdornment={labelAdornment}>
      <select className={controlClass} value={value} onChange={(event) => onChange(event.target.value)} autoComplete="off" aria-invalid={Boolean(error)}>
        <option value="" disabled>{placeholder}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </FormField>
  );
}

export default function AcademicProfileModal({
  fullName,
  initialProgram,
  initialProgramChoice2,
  initialProgramChoice3,
  initialStudentNumber,
  initialYearStanding,
  initialAcademicStanding,
  initialCitizenship,
  initialPhone,
  initialHouseholdIncome,
  initialQpi,
  initialHsStrand,
  initialHsAverage,
  initialHasActiveGovernmentGrant,
  academicPrograms = [],
  academicProgramCategories = [],
  documents = [],
  attributeVerifications = {},
  onSave,
  isSaving,
  errorMessage,
}) {
  const [program, setProgram] = useState(initialProgram || '');
  const [programChoice2, setProgramChoice2] = useState(initialProgramChoice2 || '');
  const [programChoice3, setProgramChoice3] = useState(initialProgramChoice3 || '');
  const [studentNumber, setStudentNumber] = useState(initialStudentNumber || '');
  const [yearStanding, setYearStanding] = useState(initialYearStanding || '');
  const [academicStanding, setAcademicStanding] = useState(initialAcademicStanding || '');
  const [citizenship, setCitizenship] = useState(initialCitizenship || '');
  const [phone, setPhone] = useState(initialPhone || '');
  const [householdIncome, setHouseholdIncome] = useState(initialHouseholdIncome ?? '');
  const [qpi, setQpi] = useState(initialQpi ?? '');
  const [hsStrand, setHsStrand] = useState(initialHsStrand || '');
  const [hsAverage, setHsAverage] = useState(initialHsAverage ?? '');
  const [hasActiveGovernmentGrant, setHasActiveGovernmentGrant] = useState(Boolean(initialHasActiveGovernmentGrant));
  const [validationError, setValidationError] = useState('');
  // Per-field errors from the shared rules, so a duplicate program choice shows
  // beside the choice it belongs to instead of only in the summary banner.
  const [errors, setErrors] = useState({});
  const standing = getStandingRequirements(yearStanding);
  // The QPI and the senior high school general average are each read for one
  // standing, so their badges follow the standing chosen in this modal rather
  // than the saved one: a first-login account has no saved standing yet, and the
  // senior high school average it just asked for would otherwise read `Not
  // applicable` (the old "Not needed") while it is mandatory. Only the standing
  // is overridden, so the saved values still drive the Outdated check.
  const standingVerifications = useMemo(
    () => deriveAttributeVerifications(documents, ['qpi', 'hsAverage'], {
      profile: { yearStanding, qpi: initialQpi ?? '', hsAverage: initialHsAverage ?? '' },
    }),
    [documents, yearStanding, initialQpi, initialHsAverage],
  );
  const verifications = { ...attributeVerifications, ...standingVerifications };
  const selectedProgram = academicPrograms.find((entry) => entry.value === program) || academicPrograms[0];
  const programOptions = academicProgramCategories.flatMap((category) => [
    { value: `group-${category}`, label: category, isGroup: true },
    ...academicPrograms.filter((option) => option.category === category),
  ]);
  const choiceOptions = {
    degreeProgram: getProgramChoiceOptions(programOptions, { slot: 'degreeProgram', degreeProgram: program, programChoice2, programChoice3 }),
    programChoice2: getProgramChoiceOptions(programOptions, { slot: 'programChoice2', degreeProgram: program, programChoice2, programChoice3 }),
    programChoice3: getProgramChoiceOptions(programOptions, { slot: 'programChoice3', degreeProgram: program, programChoice2, programChoice3 }),
  };

  useEffect(() => {
    setProgram(initialProgram || '');
    setProgramChoice2(initialProgramChoice2 || '');
    setProgramChoice3(initialProgramChoice3 || '');
    setStudentNumber(initialStudentNumber || '');
    setYearStanding(initialYearStanding || '');
    setAcademicStanding(initialAcademicStanding || '');
    setCitizenship(initialCitizenship || '');
    setPhone(initialPhone || '');
    setHouseholdIncome(initialHouseholdIncome ?? '');
    setQpi(initialQpi ?? '');
    setHsStrand(initialHsStrand || '');
    setHsAverage(initialHsAverage ?? '');
    setHasActiveGovernmentGrant(Boolean(initialHasActiveGovernmentGrant));
  }, [initialProgram, initialProgramChoice2, initialProgramChoice3, initialStudentNumber, initialYearStanding, initialAcademicStanding, initialCitizenship, initialPhone, initialHouseholdIncome, initialQpi, initialHsStrand, initialHsAverage, initialHasActiveGovernmentGrant]);

  // Clears the summary banner plus the field errors a change can resolve. A new
  // 1st choice can fix or break both later choices, so that field clears all three.
  const clearError = (...keys) => {
    setValidationError('');
    if (!keys.length) return;
    setErrors((previous) => {
      const next = { ...previous };
      keys.forEach((key) => delete next[key]);
      return next;
    });
  };
  // An incoming first-year is matched on senior high school standing instead of
  // a college QPI, so the required inputs swap accordingly.
  const isComplete = Boolean(program && yearStanding && academicStanding && citizenship)
    && householdIncome !== ''
    && (standing.requiresHsStanding
      ? Boolean(hsStrand) && hsAverage !== ''
      : Boolean(studentNumber) && qpi !== '');

  const handleContinue = () => {
    if (isSaving) return;

    const result = validateOnboardingEssentials({
      studentNumber,
      degreeProgram: program,
      programChoice2,
      programChoice3,
      yearStanding,
      academicStanding,
      qpi,
      hsStrand,
      hsAverage,
      householdIncome,
      hasActiveGovernmentGrant,
      phone,
      citizenship,
    }, academicPrograms);
    const firstError = Object.values(result.errors)[0];
    setErrors(result.errors);
    if (firstError) {
      // Every rendered field shows its own message, so the banner stays a summary.
      setValidationError('Review the highlighted fields before continuing.');
      return;
    }

    setValidationError('');
    setErrors({});
    onSave({ ...result.values, hasActiveGovernmentGrant });
  };

  const handleKeyDown = (event) => {
    if (event.key !== 'Enter'
      || event.target.tagName !== 'INPUT'
      || event.target.type === 'checkbox'
      || event.target.closest('.select-picker-modal')) return;
    event.preventDefault();
    handleContinue();
  };

  return (
    <ModalShell title="" onClose={undefined} aria-labelledby="academic-profile-title" overlayClassName="academic-profile-overlay" className="w-full max-w-[640px]">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-control border border-blue-500/20 bg-app-surface p-1 shadow-card">
            <img className="h-full w-full object-contain" src={logoImage} alt="Ateneo de Davao University logo" />
          </div>
          <span className="inline-flex w-fit items-center rounded-full bg-blue-500/10 px-3 py-1 text-xs font-semibold text-app-primary">AdDU student verification</span>
        </div>
        <h2 id="academic-profile-title" className="m-0 text-[clamp(1.55rem,4vw,2rem)] font-bold tracking-tight text-app-text">Tell us about your studies</h2>
        <p className="mt-2 text-sm leading-relaxed text-app-muted">
          Welcome{fullName ? `, ${fullName.split(' ')[0]}` : ''}! Add your academic details so the Smart Eligibility Checker can match you.
        </p>
        {/* Avoid native form submission: Chromium treats canceled submit events as autofill-save signals. */}
        <div className="mt-5 grid gap-4" onKeyDown={handleKeyDown}>
          <div className="grid gap-4 sm:grid-cols-2">
            <NativeSelect label="Year standing" value={yearStanding} onChange={(value) => { setYearStanding(value); clearError('yearStanding', 'studentNumber', 'qpi', 'programChoice2', 'programChoice3'); }} options={yearStandingOptions} placeholder="Choose year standing" error={errors.yearStanding} />
            {standing.requiresStudentNumber && (
              <FormField label="AdDU student number" hint="4–12 digits from your AdDU record." error={errors.studentNumber}>
                <input className={controlClass} value={studentNumber} onChange={(event) => { setStudentNumber(event.target.value.replace(/\D/g, '').slice(0, 12)); clearError('studentNumber'); }} inputMode="numeric" autoComplete="off" placeholder="e.g. 1234567" required aria-invalid={Boolean(errors.studentNumber)} />
              </FormField>
            )}
          </div>
          <SelectPicker label={standing.programLabel} value={program} onChange={(value) => { setProgram(value); clearError('degreeProgram', 'programChoice2', 'programChoice3'); }} options={choiceOptions.degreeProgram} error={errors.degreeProgram} idPrefix="academic-profile-program" />
          {standing.requiresProgramChoices && (
            <div className="grid gap-3 rounded-2xl border border-app-border bg-app-surface/60 p-4">
              <div>
                <p className="m-0 text-sm font-semibold text-app-text">Program choices</p>
                <small className="field-hint mt-1 block">Add a 2nd and 3rd choice if you are applying to another program. Each program can be chosen once.</small>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectPicker label="2nd choice program" value={programChoice2} onChange={(value) => { setProgramChoice2(value); clearError('programChoice2', 'programChoice3'); }} options={choiceOptions.programChoice2} error={errors.programChoice2} idPrefix="academic-profile-program-choice-2" />
                <SelectPicker label="3rd choice program" value={programChoice3} onChange={(value) => { setProgramChoice3(value); clearError('programChoice3'); }} options={choiceOptions.programChoice3} error={errors.programChoice3} idPrefix="academic-profile-program-choice-3" />
              </div>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <NativeSelect label="Academic standing" value={academicStanding} onChange={(value) => { setAcademicStanding(value); clearError('academicStanding'); }} options={academicStandingOptions} placeholder="Choose standing" error={errors.academicStanding} labelAdornment={<AttributeVerificationBadge attributeKey="academicStanding" attributeVerifications={verifications} />} />
            <NativeSelect label="Citizenship" value={citizenship} onChange={(value) => { setCitizenship(value); clearError('citizenship'); }} options={citizenshipOptions} placeholder="Choose citizenship" error={errors.citizenship} labelAdornment={<AttributeVerificationBadge attributeKey="citizenship" attributeVerifications={verifications} />} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Mobile number" hint="Optional. Deadline reminder texts use this Philippine mobile number." error={errors.phone}>
              <input className={controlClass} value={phone} onChange={(event) => { setPhone(event.target.value.replace(/[^\d+\-\s]/g, '').slice(0, 20)); clearError('phone'); }} inputMode="tel" autoComplete="tel" placeholder="e.g. 0917 123 4567" aria-invalid={Boolean(errors.phone)} />
            </FormField>
            <FormField label="Annual household income" hint="Combined household income for one year, in Philippine pesos." error={errors.householdIncome} labelAdornment={<AttributeVerificationBadge attributeKey="householdIncome" attributeVerifications={verifications} />}>
              <input className={controlClass} value={householdIncome} onChange={(event) => { setHouseholdIncome(event.target.value.replace(/[^\d]/g, '')); clearError('householdIncome'); }} inputMode="numeric" autoComplete="off" placeholder="e.g. 240000" required aria-invalid={Boolean(errors.householdIncome)} />
            </FormField>
          </div>
          {standing.requiresHsStanding && (
            <div className="grid gap-4 sm:grid-cols-2">
              <NativeSelect label="Senior high school strand" value={hsStrand} onChange={(value) => { setHsStrand(value); clearError('hsStrand'); }} options={hsStrandOptions.filter((option) => option.value)} placeholder="Choose strand" error={errors.hsStrand} />
              <FormField label="Senior high school general average" hint="Whole number from 60 to 100." error={errors.hsAverage} labelAdornment={<AttributeVerificationBadge attributeKey="hsAverage" attributeVerifications={verifications} />}>
                <input className={controlClass} value={hsAverage} onChange={(event) => { setHsAverage(event.target.value.replace(/\D/g, '').slice(0, 3)); clearError('hsAverage'); }} inputMode="numeric" autoComplete="off" placeholder="e.g. 94" required aria-invalid={Boolean(errors.hsAverage)} />
              </FormField>
            </div>
          )}
          {standing.requiresQpi && (
            <FormField label="Annual QPI" hint="Self-reported; not Registrar-verified." error={errors.qpi} labelAdornment={<AttributeVerificationBadge attributeKey="qpi" attributeVerifications={verifications} />}>
              <input className={controlClass} value={qpi} onChange={(event) => { setQpi(event.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')); clearError('qpi'); }} inputMode="decimal" autoComplete="off" placeholder="e.g. 3.25" required aria-invalid={Boolean(errors.qpi)} />
            </FormField>
          )}
          <label className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-app-border bg-app-surface p-3 text-sm text-app-text">
            <input className="h-4 w-4 shrink-0 accent-[var(--primary)]" type="checkbox" checked={hasActiveGovernmentGrant} onChange={(event) => setHasActiveGovernmentGrant(event.target.checked)} />
            <span className="min-w-0 flex-1 leading-relaxed">I currently have an active government grant</span>
          </label>
          <small className="-mt-2 block text-xs leading-relaxed text-app-muted">Excludes scholarships that cannot be combined with another grant. You can add the rest later.</small>
          {program && selectedProgram && (
            <div className="rounded-control border border-blue-500/20 bg-blue-500/5 px-4 py-3">
              <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-app-muted">School / Department</span>
              <strong className="text-app-primary">{selectedProgram.department}</strong>
            </div>
          )}
          <div className="rounded-control border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-sm leading-relaxed text-app-muted">
            Self-reported; verified once you submit an application with proof from the Document Vault.
          </div>
          {(validationError || errorMessage) && <div className="w-full rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-3 text-sm text-rose-200" role="alert">{validationError || errorMessage}</div>}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="primary" className="flex-1" type="button" onClick={handleContinue} disabled={!isComplete || isSaving}>
              {isSaving ? 'Saving profile…' : 'Continue to ScholarPath'}
            </Button>
            <button
              type="button"
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 py-2 text-sm font-semibold text-app-muted transition hover:-translate-y-px hover:text-app-text focus:outline-none focus:ring-4 focus:ring-blue-500/20"
              onClick={() => onSave(null)}
            >
              Skip for now
            </button>
          </div>
        </div>
    </ModalShell>
  );
}