import { useEffect, useState } from 'react';
import logoImage from '../../pictures/logo.png';
import { Button, FormField, ModalShell } from './ui';
import { SelectPicker } from '../pages/LoginScreen';
import { validateHouseholdIncome, validateMobileNumber, validateQpi, validateStudentNumber } from '../lib/profile';

export default function AcademicProfileModal({ fullName, initialProgram, initialStudentNumber, initialPhone, initialHouseholdIncome, initialQpi, initialHasActiveGovernmentGrant, academicPrograms = [], academicProgramCategories = [], onSave, isSaving, errorMessage }) {
  const [program, setProgram] = useState(initialProgram || '');
  const [studentNumber, setStudentNumber] = useState(initialStudentNumber || '');
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
    setPhone(initialPhone || '');
    setHouseholdIncome(initialHouseholdIncome ?? '');
    setQpi(initialQpi ?? '');
    setHasActiveGovernmentGrant(Boolean(initialHasActiveGovernmentGrant));
  }, [initialProgram, initialStudentNumber, initialPhone, initialHouseholdIncome, initialQpi, initialHasActiveGovernmentGrant]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!program) return;
    const checks = [validateStudentNumber(studentNumber), validateHouseholdIncome(householdIncome), validateQpi(qpi), validateMobileNumber(phone)];
    const firstError = checks.find((check) => check.error);
    if (firstError) {
      setValidationError(firstError.error);
      return;
    }

    const [normalizedStudentNumber, normalizedIncome, normalizedQpi, normalizedPhone] = checks.map((check) => check.value);
    setValidationError('');
    onSave(selectedProgram, normalizedStudentNumber, normalizedIncome, normalizedQpi, hasActiveGovernmentGrant, normalizedPhone);
  };

  return (
    <ModalShell title="" onClose={undefined} aria-labelledby="academic-profile-title" overlayClassName="academic-profile-overlay" className="w-full max-w-[540px]">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-control border border-blue-500/20 bg-app-surface p-1 shadow-card">
            <img className="h-full w-full object-contain" src={logoImage} alt="Ateneo de Davao University logo" />
          </div>
          <span className="inline-flex w-fit items-center rounded-full bg-blue-500/10 px-3 py-1 text-xs font-semibold text-app-primary">AdDU student verification</span>
        </div>
        <h2 id="academic-profile-title" className="m-0 text-[clamp(1.55rem,4vw,2rem)] font-bold tracking-tight text-app-text">Which program are you taking?</h2>
        <p className="mt-2 text-sm leading-relaxed text-app-muted">
          Welcome{fullName ? `, ${fullName.split(' ')[0]}` : ''}! Add your academic details so ScholarPath can verify your AdDU enrollment and show relevant scholarships.
        </p>
        <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
          <FormField label="AdDU student number" hint="Enter the digits shown on your AdDU ID or registration record (4–12 digits).">
            <input className="min-h-12 rounded-control" value={studentNumber} onChange={(event) => { setStudentNumber(event.target.value.replace(/\D/g, '').slice(0, 12)); setValidationError(''); }} inputMode="numeric" autoComplete="off" placeholder="e.g. 1234567" required />
          </FormField>
            <SelectPicker
              label="Program / Course"
              value={program}
              onChange={(value) => { setProgram(value); setValidationError(''); }}
              options={programOptions}
              idPrefix="academic-profile-program"
            />
          <FormField label="Annual household income" hint="Combined household income for one year, in Philippine pesos.">
            <input className="min-h-12 rounded-control" value={householdIncome} onChange={(event) => { setHouseholdIncome(event.target.value.replace(/[^\d]/g, '')); setValidationError(''); }} inputMode="numeric" autoComplete="off" placeholder="e.g. 240000" required />
          </FormField>
          <FormField label="Annual QPI" hint="Use your latest annual QPI on the AdDU 0.00–4.00 scale.">
            <input className="min-h-12 rounded-control" value={qpi} onChange={(event) => { setQpi(event.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')); setValidationError(''); }} inputMode="decimal" autoComplete="off" placeholder="e.g. 3.25" min="0" max="4" step="0.01" required />
          </FormField>
          <FormField label="Mobile number" hint="Optional. Deadline reminder texts use this Philippine mobile number (e.g. 0917 123 4567).">
            <input className="min-h-12 rounded-control" value={phone} onChange={(event) => { setPhone(event.target.value.replace(/[^\d+\-\s]/g, '').slice(0, 20)); setValidationError(''); }} inputMode="tel" autoComplete="tel" placeholder="e.g. 0917 123 4567" />
          </FormField>
          <label className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-app-border bg-app-surface p-3 text-sm text-app-text">
            <input className="h-4 w-4 shrink-0 accent-[var(--primary)]" type="checkbox" checked={hasActiveGovernmentGrant} onChange={(event) => setHasActiveGovernmentGrant(event.target.checked)} />
            <span className="min-w-0 flex-1 leading-relaxed">I currently have an active government grant</span>
          </label>
          <small className="-mt-2 block text-xs leading-relaxed text-app-muted">This helps exclude scholarships that cannot be combined with another government grant.</small>
          {program && (
            <div className="rounded-control border border-blue-500/20 bg-blue-500/5 px-4 py-3">
              <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-app-muted">School / Department</span>
              <strong className="text-app-primary">{selectedProgram.department}</strong>
            </div>
          )}
          {(validationError || errorMessage) && <div className="w-full rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-3 text-sm text-rose-200" role="alert">{validationError || errorMessage}</div>}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="primary" className="flex-1" type="submit" disabled={!program || !studentNumber || householdIncome === '' || qpi === '' || isSaving}>
              {isSaving ? 'Saving profile…' : 'Continue to ScholarPath'}
            </Button>
            <button
              type="button"
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 py-2 text-sm font-semibold text-app-muted transition hover:-translate-y-px hover:text-app-text focus:outline-none focus:ring-4 focus:ring-blue-500/20"
              onClick={() => onSave(null, null, null, null, null, null)}
            >
              Skip for now
            </button>
          </div>
        </form>
    </ModalShell>
  );
}
