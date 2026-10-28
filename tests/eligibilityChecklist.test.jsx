import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { evaluateApplicationGate } from '../src/lib/eligibility';
import { getEligibilityChecklist } from '../src/lib/eligibilityChecklist';
import ScholarshipExplorer from '../src/pages/ScholarshipExplorer';

const gia = { id: 'gia', title: 'Grant-in-Aid (GIA)', ruleFamily: 'general-pool', category: 'Internal Endowment', isActive: true, deadline: '2099-04-30', minimumQpi: 2.5, maximumIncome: 250000, coverage: 'Tuition', tags: [], eligibleDegrees: ['ALL'] };
const jubilee = { id: 'jsf', title: 'Jubilee Scholarship Fund (Valedictorian & Salutatorian)', ruleFamily: 'honors', category: 'Internal Endowment', isActive: true, deadline: '2099-04-30', coverage: 'Tuition', tags: [], eligibleDegrees: ['ALL'] };

const qualified = {
  role: 'student',
  yearStanding: '2nd',
  isTransferee: 'No',
  qpi: 3.2,
  householdIncome: 180000,
  citizenship: 'Filipino',
  academicStanding: 'good',
  degreeProgram: 'BS Computer Science',
};

const rowsByKey = (checklist) => Object.fromEntries(checklist.rows.map((row) => [row.key, row]));

describe('getEligibilityChecklist', () => {
  it('agrees with the application gate when every check passes', () => {
    const checklist = getEligibilityChecklist(qualified, gia);
    expect(evaluateApplicationGate(qualified, gia).allowed).toBe(true);
    expect(checklist.verdict).toBe('eligible');
    expect(checklist.rows.every((row) => row.status === 'pass')).toBe(true);
  });

  it('marks the failing criterion with the gate reason and its Application Form section', () => {
    const checklist = getEligibilityChecklist({ ...qualified, householdIncome: 400000 }, gia);
    const { householdIncome } = rowsByKey(checklist);
    expect(checklist.verdict).toBe('ineligible');
    expect(householdIncome.status).toBe('fail');
    expect(householdIncome.messages[0]).toMatch(/at or below/);
    expect(householdIncome.section).not.toBeNull();
    // The answer the Update link highlights in that section.
    expect(householdIncome.field).toBe('householdIncome');
  });

  it('shows every rule check even when an answer is still missing', () => {
    const checklist = getEligibilityChecklist({ ...qualified, citizenship: '', degreeProgram: 'BS Nursing' }, gia);
    const rows = rowsByKey(checklist);
    expect(rows.citizenship.status).toBe('unanswered');
    expect(rows.degreeProgram.status).toBe('fail');
    expect(checklist.verdict).toBe('ineligible');
  });

  it('reads incomplete when only answers are missing', () => {
    const checklist = getEligibilityChecklist({ ...qualified, citizenship: '' }, gia);
    expect(checklist.verdict).toBe('incomplete');
  });

  it('adds the honors criteria for the Jubilee Scholarship', () => {
    const rows = rowsByKey(getEligibilityChecklist({ ...qualified, honorsRank: 'Valedictorian', isHonorsGraduate: true, graduatingClassSize: 60 }, jubilee));
    expect(rows.honorsRank.status).toBe('pass');
    expect(rows.graduatingClassSize.status).toBe('fail');
  });

  it('puts an unclaimed reason such as a closed deadline on the application window row', () => {
    const rows = rowsByKey(getEligibilityChecklist(qualified, { ...gia, deadline: '2000-01-01' }));
    expect(rows.program.status).toBe('fail');
    expect(rows.program.messages).toContain('Inactive or past deadline.');
  });
});

describe('Scholarship Explorer', () => {
  const render = (profile) => renderToStaticMarkup(
    <ScholarshipExplorer
      profile={profile}
      scholarships={[gia, jubilee]}
      searchQuery=""
      filters={{ category: 'all', coverage: 'all', deadline: 'all', activeOnly: false }}
      onSearchChange={() => {}}
      onFilterChange={() => {}}
      onApply={() => {}}
      onOpenProfileSection={() => {}}
    />,
  );

  it('shows the checklist and the qualified tally without opening anything', () => {
    const html = render(qualified);
    expect(html).toContain('You qualify for 1 of 2');
    expect(html).toContain('Smart Eligibility Checker results');
    expect(html).toContain('Not eligible yet');
  });
});
