import { useEffect, useState } from 'react';
import logoImage from '../../pictures/logo.png';
import { Button, FormField, ModalShell } from './ui';
import { SelectPicker } from '../pages/LoginScreen';
import {
  academicStandingOptions,
  applicantStatusOptions,
  applyApplicantStatus,
  applyYearStanding,
  citizenshipOptions,
  getApplicantStatus,
  getProgramChoiceOptions,
  getStandingRequirements,
  getYearStandingOptions,
  hsStrandOptions,
  requiresStudentNumber,
  validateOnboardingEssentials,
} from '../lib/profile';
import { getAcademicProgramGroups } from '../lib/academicPrograms';

// Text boxes and selects share one fixed height (matching the SelectPicker
// trigger) so side-by-side controls line up.
const controlClass = 'h-12 py-0';

function NativeSelect({ label, hint, error, value, onChange, options, placeholder, required = false }) {
  return (
    <FormField label={label} hint={hint} error={error} required={required}>
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
  initialIsTransferee,
  initialAcademicStanding,
  initialCitizenship,
  initialHouseholdIncome,
  initialQpi,
  initialHsStrand,
  initialHsAverage,
  initialHasActiveGovernmentGrant,
  academicPrograms = [],
  academicProgramGroups = [],
  onSave,
  isSaving,
  errorMessage,
}) {
  const [program, setProgram] = useState(initialProgram || '');
  const [programChoice2, setProgramChoice2] = useState(initialProgramChoice2 || '');
  const [programChoice3, setProgramChoice3] = useState(initialProgramChoice3 || '');
  const [studentNumber, setStudentNumber] = useState(initialStudentNumber || '');
  const [yearStanding, setYearStanding] = useState(initialYearStanding || '');
  // FORM 230-SCH Applicant Status, the same control My Profile shows. It is kept
  // in the draft as its own answer so picking Current or Transferee before a year
  // is chosen does not snap the control back to its placeholder, and the year
  // standing and the transferee answer move with it (see applyApplicantStatus).
  const [applicantStatus, setApplicantStatus] = useState(getApplicantStatus({
    yearStanding: initialYearStanding,
    isTransferee: initialIsTransferee,
  }));
  // The AdDU student number is issued to an enrolled Ateneo student, so it is asked
  // only of a current student: an incoming first-year has not been issued one yet
  // and a transferee's record belongs to the institution they left.
  const isTransferee = applicantStatus === 'transferee' ? 'Yes' : applicantStatus ? 'No' : '';
  const needsStudentNumber = requiresStudentNumber({ yearStanding, isTransferee });
  const [academicStanding, setAcademicStanding] = useState(initialAcademicStanding || '');
  const [citizenship, setCitizenship] = useState(initialCitizenship || '');
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
  // An incoming first-year has no year to pick (the status already answers it) and
  // an enrolled applicant is never offered "Incoming 1st year".
  const standingOptions = getYearStandingOptions(applicantStatus);
  // A standing saved as the retired `1st year` is no longer offered, so the picker
  // asks for the year again instead of silently showing an empty control.
  const standingOffered = standingOptions.some((option) => option.value === yearStanding);
  const selectedProgram = academicPrograms.find((entry) => entry.value === program) || academicPrograms[0];
  // Grouped by "School — Cluster" so the picker walks all four levels, with the
  // academic department as each program's description.
  const programOptions = academicProgramGroups?.length ? academicProgramGroups : getAcademicProgramGroups(academicPrograms);
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
    setApplicantStatus(getApplicantStatus({ yearStanding: initialYearStanding, isTransferee: initialIsTransferee }));
    setAcademicStanding(initialAcademicStanding || '');
    setCitizenship(initialCitizenship || '');
    setHouseholdIncome(initialHouseholdIncome ?? '');
    setQpi(initialQpi ?? '');
    setHsStrand(initialHsStrand || '');
    setHsAverage(initialHsAverage ?? '');
    setHasActiveGovernmentGrant(Boolean(initialHasActiveGovernmentGrant));
  }, [initialProgram, initialProgramChoice2, initialProgramChoice3, initialStudentNumber, initialYearStanding, initialIsTransferee, initialAcademicStanding, initialCitizenship, initialHouseholdIncome, initialQpi, initialHsStrand, initialHsAverage, initialHasActiveGovernmentGrant]);

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
  // Switching the applicant status rearranges the academic fields (the year
  // standing, the student number, the QPI or the senior high school answers), so
  // the two controls move together and a stale inline error is cleared with them.
  const changeApplicantStatus = (status) => {
    const next = applyApplicantStatus({ applicantStatus, yearStanding }, status);
    setApplicantStatus(next.applicantStatus);
    setYearStanding(next.yearStanding);
    // Only an incoming first-year ranks a 2nd and 3rd choice, so those are dropped
    // on the way out (applyApplicantStatus decides which).
    if (next.programChoice2 === '') setProgramChoice2('');
    if (next.programChoice3 === '') setProgramChoice3('');
    clearError('isTransferee', 'yearStanding', 'studentNumber', 'qpi', 'hsStrand', 'hsAverage', 'programChoice2', 'programChoice3');
  };
  const changeYearStanding = (value) => {
    const next = applyYearStanding(value);
    setYearStanding(next.yearStanding);
    // The incoming standing is the Incoming First Year status, so the two controls
    // stay in step whichever one the student answers first.
    if (next.applicantStatus) setApplicantStatus(next.applicantStatus);
    clearError('isTransferee', 'yearStanding', 'studentNumber', 'qpi', 'hsStrand', 'hsAverage', 'programChoice2', 'programChoice3');
  };
  // An incoming first-year is matched on senior high school standing instead of
  // a college QPI, so the required inputs swap accordingly. The strand is asked of
  // every applicant here, the way My Profile asks it (FORM 230-SCH).
  const isComplete = Boolean(applicantStatus && program && yearStanding && hsStrand && academicStanding && citizenship)
    && householdIncome !== ''
    && (standing.requiresHsStanding
      ? hsAverage !== ''
      : (!needsStudentNumber || Boolean(studentNumber)) && qpi !== '');

  const handleContinue = () => {
    if (isSaving) return;

    const result = validateOnboardingEssentials({
      studentNumber,
      degreeProgram: program,
      programChoice2,
      programChoice3,
      yearStanding,
      // The status control above decides whether the AdDU student number is asked,
      // so the live answer is what the shared rules read.
      isTransferee,
      academicStanding,
      qpi,
      hsStrand,
      hsAverage,
      householdIncome,
      hasActiveGovernmentGrant,
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
          <span className="inline-flex w-fit items-center rounded-full bg-blue-500/10 px-3 py-1 text-xs font-semibold text-app-primary">Smart Eligibility Checker</span>
        </div>
        <h2 id="academic-profile-title" className="m-0 text-[clamp(1.55rem,4vw,2rem)] font-bold tracking-tight text-app-text">Tell us about your studies</h2>
        <p className="mt-2 text-sm leading-relaxed text-app-muted">
          Welcome{fullName ? `, ${fullName.split(' ')[0]}` : ''}! Add your academic details so the Smart Eligibility Checker can match you.
        </p>
        {/* Avoid native form submission: Chromium treats canceled submit events as autofill-save signals. */}
        <div className="mt-5 grid gap-4" onKeyDown={handleKeyDown}>
          <div className="grid gap-4 sm:grid-cols-2">
            <NativeSelect label="Applicant status" value={applicantStatus} onChange={changeApplicantStatus} options={applicantStatusOptions} placeholder="Choose applicant status" error={errors.isTransferee} required={!applicantStatus} />
            {/* An incoming first-year has no year to pick: the status already answers it. */}
            {standingOptions.length > 0 && (
              <NativeSelect
                label="Year standing"
                hint={!yearStanding || standingOffered ? 'Choose the year you are going into.' : 'Your saved 1st year standing is no longer offered — choose the year you are going into.'}
                value={yearStanding}
                onChange={changeYearStanding}
                options={standingOptions}
                placeholder="Choose year standing"
                error={errors.yearStanding}
                required={!yearStanding}
              />
            )}
            {needsStudentNumber && (
              <FormField label="AdDU student number" hint="4–12 digits from your AdDU record." error={errors.studentNumber} required={!studentNumber}>
                <input className={controlClass} value={studentNumber} onChange={(event) => { setStudentNumber(event.target.value.replace(/\D/g, '').slice(0, 12)); clearError('studentNumber'); }} inputMode="numeric" autoComplete="off" placeholder="e.g. 1234567" required aria-invalid={Boolean(errors.studentNumber)} />
              </FormField>
            )}
          </div>
          <SelectPicker label={standing.programLabel} value={program} onChange={(value) => { setProgram(value); clearError('degreeProgram', 'programChoice2', 'programChoice3'); }} options={choiceOptions.degreeProgram} error={errors.degreeProgram} idPrefix="academic-profile-program" required={!program} />
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
            <NativeSelect label="Academic standing" value={academicStanding} onChange={(value) => { setAcademicStanding(value); clearError('academicStanding'); }} options={academicStandingOptions} placeholder="Choose standing" error={errors.academicStanding} required={!academicStanding} />
            <NativeSelect label="Citizenship" value={citizenship} onChange={(value) => { setCitizenship(value); clearError('citizenship'); }} options={citizenshipOptions} placeholder="Choose citizenship" error={errors.citizenship} required={!citizenship} />
          </div>
          <FormField label="Annual household income" hint="Combined household income for one year, in Philippine pesos." error={errors.householdIncome} required={householdIncome === ''}>
            <input className={controlClass} value={householdIncome} onChange={(event) => { setHouseholdIncome(event.target.value.replace(/[^\d]/g, '')); clearError('householdIncome'); }} inputMode="numeric" autoComplete="off" placeholder="e.g. 240000" required aria-invalid={Boolean(errors.householdIncome)} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* FORM 230-SCH asks every applicant for the strand in senior high school,
                so it is asked (and required) for a continuing student too. */}
            <NativeSelect label="Senior high school strand" hint="Needed to apply." value={hsStrand} onChange={(value) => { setHsStrand(value); clearError('hsStrand'); }} options={hsStrandOptions.filter((option) => option.value)} placeholder="Choose strand" error={errors.hsStrand} required={!hsStrand} />
            {standing.requiresHsStanding && (
              <FormField label="Senior high school general average" hint="Whole number from 60 to 100." error={errors.hsAverage} required={hsAverage === ''}>
                <input className={controlClass} value={hsAverage} onChange={(event) => { setHsAverage(event.target.value.replace(/\D/g, '').slice(0, 3)); clearError('hsAverage'); }} inputMode="numeric" autoComplete="off" placeholder="e.g. 94" required aria-invalid={Boolean(errors.hsAverage)} />
              </FormField>
            )}
          </div>
          {standing.requiresQpi && (
            <FormField label="Annual QPI" hint="Self-reported; not Registrar-verified." error={errors.qpi} required={qpi === ''}>
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
              <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-app-muted">School</span>
              <strong className="text-app-primary">{selectedProgram.school}</strong>
              {selectedProgram.cluster && (
                <>
                  <span className="mb-1 mt-2 block text-xs uppercase tracking-[0.08em] text-app-muted">Cluster</span>
                  <strong className="text-app-primary">{selectedProgram.cluster}</strong>
                </>
              )}
              <span className="mb-1 mt-2 block text-xs uppercase tracking-[0.08em] text-app-muted">Academic department</span>
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