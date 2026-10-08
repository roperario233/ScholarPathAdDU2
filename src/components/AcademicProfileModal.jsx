import { useEffect, useState } from 'react';
import logoImage from '../../pictures/logo.png';
import { Button, FormField, ModalShell, StatusBadge } from './ui';
import { SelectPicker } from '../pages/LoginScreen';
import {
  academicStandingOptions,
  citizenshipOptions,
  getStandingRequirements,
  hsStrandOptions,
  validateOnboardingEssentials,
  yearStandingOptions,
} from '../lib/profile';
import { getAttributeVerificationTone } from '../lib/verification';

// Text boxes and selects share one fixed height (matching the SelectPicker
// trigger) so side-by-side controls line up.
const controlClass = 'h-12 py-0';

// A profile attribute the Admissions Office can verify against a Document Vault
// proof document. The state is derived from the student's linked documents
// (src/lib/verification.js) and is informational: it never blocks eligibility
// matching or applying. An answer with no proof uploaded yet reads as
// "Unverified", which renders as a neutral badge rather than an error.
function AttributeVerificationBadge({ attributeKey, attributeVerifications = {} }) {
  const status = attributeVerifications[attributeKey] || 'Unverified';
  return <StatusBadge tone={getAttributeVerificationTone(status)}>{status}</StatusBadge>;
}

function NativeSelect({ label, hint, error, labelAdornment, value, onChange, options, placeholder }) {
  return (
    <FormField label={label} hint={hint} error={error} labelAdornment={labelAdornment}>
      <select className={controlClass} value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)}>
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
  const standing = getStandingRequirements(yearStanding);
  const selectedProgram = academicPrograms.find((entry) => entry.value === program) || academicPrograms[0];
  const programOptions = academicProgramCategories.flatMap((category) => [
    { value: `group-${category}`, label: category, isGroup: true },
    ...academicPrograms.filter((option) => option.category === category),
  ]);

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

  const clearError = () => setValidationError('');
  // An incoming first-year is matched on senior high school standing instead of
  // a college QPI, so the required inputs swap accordingly.
  const isComplete = Boolean(program && yearStanding && academicStanding && citizenship)
    && householdIncome !== ''
    && (standing.requiresHsStanding
      ? Boolean(hsStrand) && hsAverage !== ''
      : Boolean(studentNumber) && qpi !== '');

  const handleSubmit = (event) => {
    event.preventDefault();
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
    if (firstError) {
      setValidationError(firstError.error);
      return;
    }

    setValidationError('');
    onSave({ ...result.values, hasActiveGovernmentGrant });
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
          Welcome{fullName ? `, ${fullName.split(' ')[0]}` : ''}! Add your academic and eligibility details so the Smart Eligibility Checker can match you with the right scholarships.
        </p>
        <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <NativeSelect label="Year standing" value={yearStanding} onChange={(value) => { setYearStanding(value); clearError(); }} options={yearStandingOptions} placeholder="Choose year standing" />
            {standing.requiresStudentNumber && (
              <FormField label="AdDU student number" hint="The 4–12 digits on your AdDU ID or registration record.">
                <input className={controlClass} value={studentNumber} onChange={(event) => { setStudentNumber(event.target.value.replace(/\D/g, '').slice(0, 12)); clearError(); }} inputMode="numeric" autoComplete="off" placeholder="e.g. 1234567" required />
              </FormField>
            )}
          </div>
          <SelectPicker label={standing.programLabel} value={program} onChange={(value) => { setProgram(value); clearError(); }} options={programOptions} idPrefix="academic-profile-program" />
          {standing.requiresProgramChoices && (
            <div className="grid gap-3 rounded-2xl border border-app-border bg-app-surface/60 p-4">
              <div>
                <p className="m-0 text-sm font-semibold text-app-text">Program choices</p>
                <small className="field-hint mt-1 block">Your 1st choice is the program above. Add a 2nd and 3rd choice when you are applying to more than one program.</small>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectPicker label="2nd choice program" value={programChoice2} onChange={(value) => { setProgramChoice2(value); clearError(); }} options={programOptions} idPrefix="academic-profile-program-choice-2" />
                <SelectPicker label="3rd choice program" value={programChoice3} onChange={(value) => { setProgramChoice3(value); clearError(); }} options={programOptions} idPrefix="academic-profile-program-choice-3" />
              </div>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <NativeSelect label="Academic standing" value={academicStanding} onChange={(value) => { setAcademicStanding(value); clearError(); }} options={academicStandingOptions} placeholder="Choose standing" labelAdornment={<AttributeVerificationBadge attributeKey="academicStanding" attributeVerifications={attributeVerifications} />} />
            <NativeSelect label="Citizenship" value={citizenship} onChange={(value) => { setCitizenship(value); clearError(); }} options={citizenshipOptions} placeholder="Choose citizenship" labelAdornment={<AttributeVerificationBadge attributeKey="citizenship" attributeVerifications={attributeVerifications} />} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Mobile number" hint="Optional. Deadline reminder texts use this Philippine mobile number.">
              <input className={controlClass} value={phone} onChange={(event) => { setPhone(event.target.value.replace(/[^\d+\-\s]/g, '').slice(0, 20)); clearError(); }} inputMode="tel" autoComplete="tel" placeholder="e.g. 0917 123 4567" />
            </FormField>
            <FormField label="Annual household income" hint="Combined household income for one year, in Philippine pesos." labelAdornment={<AttributeVerificationBadge attributeKey="householdIncome" attributeVerifications={attributeVerifications} />}>
              <input className={controlClass} value={householdIncome} onChange={(event) => { setHouseholdIncome(event.target.value.replace(/[^\d]/g, '')); clearError(); }} inputMode="numeric" autoComplete="off" placeholder="e.g. 240000" required />
            </FormField>
          </div>
          {standing.requiresHsStanding && (
            <div className="grid gap-4 sm:grid-cols-2">
              <NativeSelect label="Senior high school strand" value={hsStrand} onChange={(value) => { setHsStrand(value); clearError(); }} options={hsStrandOptions.filter((option) => option.value)} placeholder="Choose strand" />
              <FormField label="Senior high school general average" hint="Whole number from 60 to 100." labelAdornment={<AttributeVerificationBadge attributeKey="hsAverage" attributeVerifications={attributeVerifications} />}>
                <input className={controlClass} value={hsAverage} onChange={(event) => { setHsAverage(event.target.value.replace(/\D/g, '').slice(0, 3)); clearError(); }} inputMode="numeric" autoComplete="off" placeholder="e.g. 94" required />
              </FormField>
            </div>
          )}
          {standing.requiresQpi && (
            <FormField label="Annual QPI" hint="Self-reported on the AdDU 0.00–4.00 scale. The prototype does not verify QPI with the Registrar." labelAdornment={<AttributeVerificationBadge attributeKey="qpi" attributeVerifications={attributeVerifications} />}>
              <input className={controlClass} value={qpi} onChange={(event) => { setQpi(event.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')); clearError(); }} inputMode="decimal" autoComplete="off" placeholder="e.g. 3.25" required />
            </FormField>
          )}
          <label className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-app-border bg-app-surface p-3 text-sm text-app-text">
            <input className="h-4 w-4 shrink-0 accent-[var(--primary)]" type="checkbox" checked={hasActiveGovernmentGrant} onChange={(event) => setHasActiveGovernmentGrant(event.target.checked)} />
            <span className="min-w-0 flex-1 leading-relaxed">I currently have an active government grant</span>
          </label>
          <small className="-mt-2 block text-xs leading-relaxed text-app-muted">This helps exclude scholarships that cannot be combined with another government grant. You can add the rest of your eligibility details later in My Profile.</small>
          {program && selectedProgram && (
            <div className="rounded-control border border-blue-500/20 bg-blue-500/5 px-4 py-3">
              <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-app-muted">School / Department</span>
              <strong className="text-app-primary">{selectedProgram.department}</strong>
            </div>
          )}
          <div className="rounded-control border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-sm leading-relaxed text-app-muted">
            These answers are self-reported. They are verified once you submit an application after uploading the necessary proof in the Document Vault.
          </div>
          {(validationError || errorMessage) && <div className="w-full rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-3 text-sm text-rose-200" role="alert">{validationError || errorMessage}</div>}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="primary" className="flex-1" type="submit" disabled={!isComplete || isSaving}>
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
        </form>
    </ModalShell>
  );
}