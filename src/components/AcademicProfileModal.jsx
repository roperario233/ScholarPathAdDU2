import { useEffect, useState } from 'react';
import logoImage from '../../pictures/logo.png';
import { Button, FormField, ModalShell } from './ui';
import { SelectPicker } from '../pages/LoginScreen';
import {
  academicStandingOptions,
  applicantTypeOptions,
  citizenshipOptions,
  validateOnboardingEssentials,
  yearLevelOptions,
} from '../lib/profile';

// Text boxes and selects share one fixed height (matching the SelectPicker
// trigger) so side-by-side controls line up.
const controlClass = 'h-12 py-0';

function NativeSelect({ label, hint, error, value, onChange, options, placeholder }) {
  return (
    <FormField label={label} hint={hint} error={error}>
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
  initialStudentNumber,
  initialYearLevel,
  initialApplicantType,
  initialAcademicStanding,
  initialCitizenship,
  initialPhone,
  initialHouseholdIncome,
  initialQpi,
  initialHasActiveGovernmentGrant,
  academicPrograms = [],
  academicProgramCategories = [],
  onSave,
  isSaving,
  errorMessage,
}) {
  const [program, setProgram] = useState(initialProgram || '');
  const [studentNumber, setStudentNumber] = useState(initialStudentNumber || '');
  const [yearLevel, setYearLevel] = useState(initialYearLevel ?? '');
  const [applicantType, setApplicantType] = useState(initialApplicantType || '');
  const [academicStanding, setAcademicStanding] = useState(initialAcademicStanding || '');
  const [citizenship, setCitizenship] = useState(initialCitizenship || '');
  const [phone, setPhone] = useState(initialPhone || '');
  const [householdIncome, setHouseholdIncome] = useState(initialHouseholdIncome ?? '');
  const [qpi, setQpi] = useState(initialQpi ?? '');
  const [hasActiveGovernmentGrant, setHasActiveGovernmentGrant] = useState(Boolean(initialHasActiveGovernmentGrant));
  const [validationError, setValidationError] = useState('');
  const selectedProgram = academicPrograms.find((entry) => entry.value === program) || academicPrograms[0];
  const programOptions = academicProgramCategories.flatMap((category) => [
    { value: `group-${category}`, label: category, isGroup: true },
    ...academicPrograms.filter((option) => option.category === category),
  ]);

  useEffect(() => {
    setProgram(initialProgram || '');
    setStudentNumber(initialStudentNumber || '');
    setYearLevel(initialYearLevel ?? '');
    setApplicantType(initialApplicantType || '');
    setAcademicStanding(initialAcademicStanding || '');
    setCitizenship(initialCitizenship || '');
    setPhone(initialPhone || '');
    setHouseholdIncome(initialHouseholdIncome ?? '');
    setQpi(initialQpi ?? '');
    setHasActiveGovernmentGrant(Boolean(initialHasActiveGovernmentGrant));
  }, [initialProgram, initialStudentNumber, initialYearLevel, initialApplicantType, initialAcademicStanding, initialCitizenship, initialPhone, initialHouseholdIncome, initialQpi, initialHasActiveGovernmentGrant]);

  const clearError = () => setValidationError('');
  const isComplete = Boolean(program && studentNumber && yearLevel && applicantType && academicStanding && citizenship)
    && householdIncome !== '' && qpi !== '';

  const handleSubmit = (event) => {
    event.preventDefault();
    const result = validateOnboardingEssentials({
      studentNumber,
      degreeProgram: program,
      yearLevel,
      applicantType,
      academicStanding,
      qpi,
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
            <FormField label="AdDU student number" hint="The 4–12 digits on your AdDU ID or registration record.">
              <input className={controlClass} value={studentNumber} onChange={(event) => { setStudentNumber(event.target.value.replace(/\D/g, '').slice(0, 12)); clearError(); }} inputMode="numeric" autoComplete="off" placeholder="e.g. 1234567" required />
            </FormField>
            <NativeSelect label="Year level" value={yearLevel} onChange={(value) => { setYearLevel(value); clearError(); }} options={yearLevelOptions} placeholder="Choose year level" />
          </div>
          <SelectPicker label="Program / Course" value={program} onChange={(value) => { setProgram(value); clearError(); }} options={programOptions} idPrefix="academic-profile-program" />
          <div className="grid gap-4 sm:grid-cols-2">
            <NativeSelect label="Applicant type" value={applicantType} onChange={(value) => { setApplicantType(value); clearError(); }} options={applicantTypeOptions} placeholder="Choose applicant type" />
            <NativeSelect label="Academic standing" value={academicStanding} onChange={(value) => { setAcademicStanding(value); clearError(); }} options={academicStandingOptions} placeholder="Choose standing" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <NativeSelect label="Citizenship" value={citizenship} onChange={(value) => { setCitizenship(value); clearError(); }} options={citizenshipOptions} placeholder="Choose citizenship" />
            <FormField label="Mobile number" hint="Optional. Deadline reminder texts use this Philippine mobile number.">
              <input className={controlClass} value={phone} onChange={(event) => { setPhone(event.target.value.replace(/[^\d+\-\s]/g, '').slice(0, 20)); clearError(); }} inputMode="tel" autoComplete="tel" placeholder="e.g. 0917 123 4567" />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Annual household income" hint="Combined household income for one year, in Philippine pesos.">
              <input className={controlClass} value={householdIncome} onChange={(event) => { setHouseholdIncome(event.target.value.replace(/[^\d]/g, '')); clearError(); }} inputMode="numeric" autoComplete="off" placeholder="e.g. 240000" required />
            </FormField>
            <FormField label="Annual QPI" hint="Self-reported on the AdDU 0.00–4.00 scale. The prototype does not verify QPI with the Registrar.">
              <input className={controlClass} value={qpi} onChange={(event) => { setQpi(event.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')); clearError(); }} inputMode="decimal" autoComplete="off" placeholder="e.g. 3.25" required />
            </FormField>
          </div>
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