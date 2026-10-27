import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApplicationPrintSheet } from '../src/components/ApplicationPrintSheet';
import ApplicationFinancialStep from '../src/components/ApplicationFinancialStep';
import { FinancialDetailsNotice } from '../src/components/ApplicationFinancialDetails';
import { ProfileSnapshotList } from '../src/components/ApplicationParts';
import { buildProfileSnapshot } from '../src/lib/applicationRequirements';
import { getFinancialDetailSections, normalizeFinancialAnswers } from '../src/lib/financialDetails';
import { AFFIDAVIT_CLAUSES } from '../src/lib/applicationForm';

const profile = {
  fullName: 'Ana Reyes',
  studentNumber: '202300001',
  degreeProgram: 'BS Information Technology',
  department: 'School of Engineering and Architecture',
  yearStanding: '2nd',
  qpi: 3.2,
  householdIncome: 180000,
  citizenship: 'Filipino',
  academicStanding: 'good',
  birthdate: '2005-04-12',
  sexAtBirth: 'Female',
  communityService: 'Yes',
  completeAddress: 'Roxas Ave, Davao City',
  sameAsCompleteAddress: true,
};

const financialSections = getFinancialDetailSections({
  financialProfile: { economicStatus: 'lower', father: { employmentStatus: 'employed', annualIncome: 120000 }, mother: { employmentStatus: 'unemployed', annualIncome: 0 }, assets: {}, appliances: {} },
  answers: normalizeFinancialAnswers({ otherIncomeAnswer: 'no', difficultyAnswer: 'no', allowanceDaily: 150, allowanceEnough: 'yes', foodIntake: 'Rice', transportMode: 'Jeepney', expenseFood: 100, expenseTransport: 40, expenseOther: 0 }),
});

const sheet = (props = {}) => renderToStaticMarkup(
  <ApplicationPrintSheet
    application={{ id: 'app-1', scholarshipTitle: 'Grant-in-Aid (GIA)', status: 'Submitted', submittedAt: '2026-10-12' }}
    snapshot={buildProfileSnapshot(profile)}
    financialSections={financialSections}
    statement="My story."
    requirements={[{ id: 'a', label: 'Latest grade report or transcript', state: 'attached', attached: [{ title: 'Grades.pdf' }] }]}
    {...props}
  />,
);

describe('ApplicationPrintSheet', () => {
  it('prints the application in FORM 230-SCH order with the financial groups', () => {
    const html = sheet();
    const order = ['Needed to apply', 'Personal and address', 'Family', 'Household finances', 'Financial situation', 'Financial aid and service', 'Scholarship essay'];
    const positions = order.map((title) => html.indexOf(title));
    expect(positions.every((index) => index >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).toContain('Grant-in-Aid (GIA)');
    expect(html).toContain('My story.');
    expect(html).toContain('Grades.pdf');
  });

  it('carries the Barangay certification and the signed affidavit pages', () => {
    const html = sheet();
    expect(html).toContain('Certification of residence');
    expect(html).toContain('Punong Barangay');
    expect(html).toContain('Affidavit of agreement');
    ['Applicant (signature', 'Father (signature', 'Mother (signature'].forEach((label) => expect(html).toContain(label));
    AFFIDAVIT_CLAUSES.forEach((clause) => expect(html).toContain(clause.replace(/'/g, '&#x27;')));
    expect(html).toContain('Roxas Ave, Davao City');
  });

  it('leaves the financial groups out for the Department Chair', () => {
    const html = sheet({ financialSections: [], audience: 'chair' });
    expect(html).not.toContain('Household finances</h2>');
    expect(html).not.toContain('Perceived economic status');
    expect(html).toContain('shared with the Admissions Office only');
  });
});

describe('financial detail surfaces', () => {
  it('shows the office-only groups beside the snapshot when they are passed in', () => {
    const snapshot = buildProfileSnapshot(profile);
    const withFinance = renderToStaticMarkup(<ProfileSnapshotList snapshot={snapshot} expanded extraSections={financialSections} />);
    expect(withFinance).toContain('Household finances');
    expect(withFinance).toContain('Financial situation');
    const without = renderToStaticMarkup(<ProfileSnapshotList snapshot={snapshot} expanded />);
    expect(without).not.toContain('Household finances');
  });

  it('explains why the financial groups are missing', () => {
    expect(renderToStaticMarkup(<FinancialDetailsNotice status="hidden" />)).toContain('Admissions Office only');
    expect(renderToStaticMarkup(<FinancialDetailsNotice status="missing" />)).toContain('20261036000000');
    expect(renderToStaticMarkup(<FinancialDetailsNotice status="ready" />)).toBe('');
  });

  it('renders the financial situation step with the detail fields only after a Yes answer', () => {
    const base = normalizeFinancialAnswers({});
    const closed = renderToStaticMarkup(<ApplicationFinancialStep answers={base} onChange={() => {}} missing={['Daily allowance']} />);
    expect(closed).toContain('Daily allowance');
    expect(closed).toContain('not your Department Chair');
    expect(closed).not.toContain('What were the reasons?');
    const open = renderToStaticMarkup(<ApplicationFinancialStep answers={{ ...base, difficultyAnswer: 'yes' }} onChange={() => {}} />);
    expect(open).toContain('What were the reasons?');
  });
});
