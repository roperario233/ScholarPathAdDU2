import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AcademicProfileModal from '../src/components/AcademicProfileModal';
import ApplicationFinancialStep from '../src/components/ApplicationFinancialStep';
import { createEmptyFinancialAnswers } from '../src/lib/financialDetails';

// My Profile is the application form, so the other two surfaces that collect the
// same answers mark a blank required answer the same way: a red asterisk after the
// label, announced to assistive tech as "(required)".

const countMarks = (html) => (html.match(/\(required\)/g) || []).length;

const noop = () => {};

const programs = [
  { value: 'BS Information Technology', label: 'BS Information Technology', school: 'School of Arts and Sciences (SAS)', cluster: 'Computer Studies', department: 'Information Technology and Information Systems Department' },
];

const renderModal = (props = {}) => renderToStaticMarkup(
  <AcademicProfileModal fullName="Ana Reyes" academicPrograms={programs} onSave={noop} {...props} />,
);

describe('first-login academic profile marks', () => {
  it('marks the answers the Continue gate still needs', () => {
    // Nothing answered: applicant status, year standing, the senior high school
    // strand, program, academic standing, citizenship, and household income. The
    // QPI and student number only appear once a standing is picked.
    const html = renderModal();
    expect(countMarks(html)).toBe(7);
    expect(html).toContain('Applicant status');
    expect(html).not.toContain('Mobile number');
    expect(html).not.toContain('Annual QPI');
  });

  it('adds the current student’s student number and QPI to the marks', () => {
    // Choosing a standing clears the Year standing mark and reveals the two answers
    // a current student still owes: the student number and the annual QPI.
    const html = renderModal({ initialYearStanding: '2nd', initialIsTransferee: 'No' });
    expect(countMarks(html)).toBe(7);
    expect(html).toContain('AdDU student number');
    expect(html).toContain('Annual QPI');
  });

  it('follows the applicant status the way My Profile does', () => {
    // An incoming first-year answers the year standing with the status, so the year
    // control is left out entirely.
    const incoming = renderModal({ initialYearStanding: 'incoming-1st' });
    expect(incoming).toContain('Applicant status');
    expect(incoming).not.toContain('Year standing');
    // A transferee's record belongs to the institution they left, so the student
    // number is not asked for.
    const transferee = renderModal({ initialYearStanding: '2nd', initialIsTransferee: 'Yes' });
    expect(transferee).not.toContain('AdDU student number');
  });

  it('drops the mark once the answer is given', () => {
    const html = renderModal({
      initialYearStanding: '2nd',
      initialIsTransferee: 'No',
      initialStudentNumber: '2023001',
      initialProgram: 'BS Information Technology',
      initialAcademicStanding: 'good',
      initialCitizenship: 'Filipino',
      initialHouseholdIncome: '240000',
      initialQpi: '3.2',
      initialHsStrand: 'STEM',
    });
    expect(countMarks(html)).toBe(0);
  });
});

describe('financial situation marks', () => {
  it('marks every unanswered answer of an empty step', () => {
    const html = renderToStaticMarkup(
      <ApplicationFinancialStep answers={createEmptyFinancialAnswers()} onChange={noop} missing={[]} />,
    );
    expect(countMarks(html)).toBe(9);
  });

  it('marks nothing once the step is complete', () => {
    const complete = {
      otherIncomeAnswer: 'no',
      difficultyAnswer: 'no',
      allowanceDaily: '150',
      allowanceEnough: 'yes',
      foodIntakeAdequacy: 'adequate',
      transportMode: 'public-transport',
      expenseFood: '100',
      expenseTransport: '40',
      expenseOther: '0',
    };
    const html = renderToStaticMarkup(<ApplicationFinancialStep answers={complete} onChange={noop} missing={[]} />);
    expect(countMarks(html)).toBe(0);
  });

  it('asks for the details behind a Yes answer', () => {
    const html = renderToStaticMarkup(
      <ApplicationFinancialStep
        answers={{ ...createEmptyFinancialAnswers(), otherIncomeAnswer: 'yes', difficultyAnswer: 'yes' }}
        onChange={noop}
        missing={[]}
      />,
    );
    // The two follow-up answers, plus the reason and coping lists they open.
    expect(html).toContain('Other income sources');
    expect(countMarks(html)).toBe(11);
  });
});
