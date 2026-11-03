import { useMemo, useState } from 'react';
import ReasonModal from './ReasonModal';
import { SelectPicker } from '../pages/LoginScreen';
import { ELIGIBILITY_EXCEPTION_REASONS } from '../lib/constants';
import { getAdduInternalPrograms, getDeadlineStatus } from '../lib/eligibility';
import { fmtCurrency, fmtDate } from '../lib/formatters';

const describeValue = (value, format = (entry) => entry) => (value == null || value === '' ? 'Not declared' : format(value));

// The Admissions Office Admin opens a Draft for a student the qualification rules
// would block (an eligibility exception). The student still completes, certifies,
// and submits it; the reason is filed in the staff-only internal notes and never
// shown to the student. Only an open AdDU internal track can be chosen, because
// the database refuses any other.
export default function OpenApplicationForStudentModal({
  students = {},
  scholarships = [],
  applications = [],
  onConfirm,
  onClose,
}) {
  const [studentId, setStudentId] = useState('');
  const [scholarshipId, setScholarshipId] = useState('');
  const [fieldError, setFieldError] = useState({});

  const studentOptions = useMemo(() => Object.entries(students)
    .filter(([, entry]) => entry.role === 'student')
    .map(([id, entry]) => ({
      value: id,
      label: entry.fullName,
      description: [entry.degreeProgram, entry.qpi != null ? `QPI ${entry.qpi}` : ''].filter(Boolean).join(' · '),
    }))
    .sort((a, b) => a.label.localeCompare(b.label)), [students]);

  const openScholarships = useMemo(() => getAdduInternalPrograms(scholarships)
    .filter((entry) => entry.isActive !== false && getDeadlineStatus(entry.deadline).label !== 'Closed'), [scholarships]);
  const scholarshipOptions = openScholarships.map((entry) => ({
    value: entry.id,
    label: entry.title,
    description: entry.deadline ? `Deadline ${fmtDate(entry.deadline)}` : 'No deadline set',
  }));

  const student = studentId ? students[studentId] : null;
  const scholarship = openScholarships.find((entry) => entry.id === scholarshipId) || null;
  const duplicate = Boolean(studentId && scholarshipId) && applications.some(
    (entry) => entry.studentId === studentId && entry.scholarshipId === scholarshipId,
  );

  const handleConfirm = (reason) => {
    const errors = {
      student: studentId ? '' : 'Choose the student.',
      scholarship: scholarshipId ? '' : 'Choose the scholarship.',
    };
    setFieldError(errors);
    if (errors.student || errors.scholarship) return Promise.resolve({ error: 'Choose the student and the scholarship first.' });
    if (duplicate) return Promise.resolve({ error: 'This student already has an application for this scholarship.' });
    return Promise.resolve(onConfirm(studentId, scholarshipId, reason)).then((result) => {
      if (!result?.error) onClose();
      return result;
    });
  };

  return (
    <ReasonModal
      title="Open an application for a student"
      label="Reason for the eligibility exception"
      hint="Recorded in the staff-only internal notes. The student is told only that the Admissions Office opened the application."
      options={ELIGIBILITY_EXCEPTION_REASONS}
      notesHint="Who recommended the applicant, or why the office is letting the application through."
      confirmLabel="Open application"
      confirmVariant="primary"
      onConfirm={handleConfirm}
      onClose={onClose}
    >
      <p className="m-0 text-sm text-app-muted">
        Waives the qualification rules for one applicant. The student still completes and submits the application.
      </p>
      <SelectPicker
        label="Student"
        idPrefix="office-open-student"
        value={studentId}
        options={studentOptions}
        placeholder="Choose a student"
        required
        error={fieldError.student || ''}
        onChange={(value) => {
          setStudentId(value);
          setFieldError((previous) => ({ ...previous, student: '' }));
        }}
      />
      <SelectPicker
        label="Scholarship"
        idPrefix="office-open-scholarship"
        value={scholarshipId}
        options={scholarshipOptions}
        placeholder={scholarshipOptions.length ? 'Choose a scholarship' : 'No AdDU scholarship is open'}
        required
        error={fieldError.scholarship || ''}
        onChange={(value) => {
          setScholarshipId(value);
          setFieldError((previous) => ({ ...previous, scholarship: '' }));
        }}
      />
      {student && scholarship ? (
        <dl className="m-0 grid gap-x-4 gap-y-1 rounded-xl border border-app-border bg-app-surface p-3 text-sm sm:grid-cols-2">
          <div className="grid gap-0.5">
            <dt className="text-xs font-semibold text-app-muted">Declared QPI</dt>
            <dd className="m-0 text-app-text">
              {describeValue(student.qpi)}
              {scholarship.minimumQpi != null ? <span className="text-app-muted"> · minimum {scholarship.minimumQpi}</span> : null}
            </dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-xs font-semibold text-app-muted">Declared household income</dt>
            <dd className="m-0 text-app-text">
              {describeValue(student.householdIncome, fmtCurrency)}
              {scholarship.maximumIncome != null ? <span className="text-app-muted"> · maximum {fmtCurrency(scholarship.maximumIncome)}</span> : null}
            </dd>
          </div>
          <p className="m-0 text-xs text-app-muted sm:col-span-2">
            Self-reported in the student&apos;s Application Form. An incoming first-year is read on the senior high
            school general average instead of the QPI.
          </p>
        </dl>
      ) : null}
      {duplicate ? (
        <p className="m-0 text-sm text-rose-600 dark:text-rose-300" role="alert">
          This student already has an application for this scholarship.
        </p>
      ) : null}
    </ReasonModal>
  );
}
