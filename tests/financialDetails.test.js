import { describe, expect, it } from 'vitest';
import {
  createEmptyFinancialAnswers,
  createEmptyFinancialProfile,
  getFinancialAnswersMissing,
  getFinancialDetailSections,
  isFinancialAnswersComplete,
  normalizeFinancialAnswers,
  validateFinancialProfileSection,
} from '../src/lib/financialDetails';
import { AFFIDAVIT_CLAUSES, ESSAY_TOPIC, countWords } from '../src/lib/applicationForm';

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

describe('validateFinancialProfileSection', () => {
  it('cleans the parents, assets and appliances into one financial profile', () => {
    const { values, errors } = validateFinancialProfileSection({
      economicStatus: 'lower',
      father: { employmentStatus: 'employed', employer: '  Davao   Fruits ', annualIncome: '120,000' },
      mother: { employmentStatus: 'unemployed', annualIncome: '0', lastEmployed: 'March 2024', unemploymentReason: 'Retrenched' },
      assets: { house: true, car: false, others: ' Sari-sari store ' },
      appliances: { smartphones: true },
    });
    expect(errors).toEqual({});
    expect(values.financialProfile.economicStatus).toBe('lower');
    expect(values.financialProfile.father).toMatchObject({ employmentStatus: 'employed', employer: 'Davao Fruits', annualIncome: 120000 });
    expect(values.financialProfile.mother).toMatchObject({ employmentStatus: 'unemployed', annualIncome: 0, lastEmployed: 'March 2024' });
    expect(values.financialProfile.assets).toMatchObject({ house: true, car: false, lot: false, others: 'Sari-sari store' });
    expect(values.financialProfile.appliances).toMatchObject({ smartphones: true, aircon: false });
  });

  it('allows blank answers at save time and rejects a malformed amount or option', () => {
    expect(validateFinancialProfileSection({}).errors).toEqual({});
    expect(validateFinancialProfileSection({ father: { annualIncome: '-5' } }).errors.fatherAnnualIncome).toBeTruthy();
    expect(validateFinancialProfileSection({ mother: { annualIncome: 'lots' } }).errors.motherAnnualIncome).toBeTruthy();
    expect(validateFinancialProfileSection({ economicStatus: 'royal' }).errors.economicStatus).toBeTruthy();
    expect(validateFinancialProfileSection({ father: { employmentStatus: 'retired' } }).values.financialProfile.father.employmentStatus).toBe('');
  });

  it('starts from an empty profile with every flag off', () => {
    const empty = createEmptyFinancialProfile();
    expect(empty.economicStatus).toBe('');
    expect(Object.values(empty.assets).filter((value) => value === true)).toEqual([]);
  });
});

describe('financial situation answers', () => {
  it('lists every missing answer for an empty step and none for a complete one', () => {
    expect(getFinancialAnswersMissing(undefined)).toHaveLength(9);
    expect(getFinancialAnswersMissing(createEmptyFinancialAnswers())).toContain('Daily allowance');
    expect(isFinancialAnswersComplete(complete)).toBe(true);
  });

  it('accepts 0 as an amount but not a blank', () => {
    expect(isFinancialAnswersComplete({ ...complete, expenseOther: 0 })).toBe(true);
    expect(getFinancialAnswersMissing({ ...complete, expenseOther: '' })).toEqual(['Other daily expenses']);
  });

  it('asks for the details behind a Yes answer', () => {
    expect(getFinancialAnswersMissing({ ...complete, difficultyAnswer: 'yes' })).toEqual(['Reasons for the financial difficulty', 'How the family copes']);
    expect(getFinancialAnswersMissing({ ...complete, otherIncomeAnswer: 'yes' })).toEqual(['Other income sources', 'Average monthly amount of other income']);
    expect(isFinancialAnswersComplete({ ...complete, otherIncomeAnswer: 'yes', otherIncomeSources: 'Tutoring', otherIncomeMonthly: 2000 })).toBe(true);
  });

  it('clears the details of an answer that no longer applies', () => {
    const normalized = normalizeFinancialAnswers({ ...complete, difficultyAnswer: 'no', difficultyReasons: ['other'], difficultyOther: 'stale', otherIncomeAnswer: 'no', otherIncomeSources: 'stale', otherIncomeMonthly: '500' });
    expect(normalized).toMatchObject({ difficultyReasons: [], difficultyOther: '', difficultyCoping: [], copingOther: '', otherIncomeSources: '', otherIncomeMonthly: '' });
  });

  it('keeps a legacy free-text answer under Other instead of dropping it', () => {
    const normalized = normalizeFinancialAnswers({ ...complete, difficultyAnswer: 'yes', difficultyReasons: 'Typhoon damage', difficultyCoping: 'Loans', transportMode: 'Jeepney' });
    expect(normalized.difficultyReasons).toEqual(['other']);
    expect(normalized.difficultyOther).toBe('Typhoon damage');
    expect(normalized.difficultyCoping).toEqual(['other']);
    expect(normalized.copingOther).toBe('Loans');
    expect(normalized.transportMode).toBe('other');
    expect(normalized.transportOther).toBe('Jeepney');
  });

  it('ignores an option key that is not in the FORM 230-SCH list', () => {
    const normalized = normalizeFinancialAnswers({ ...complete, difficultyAnswer: 'yes', difficultyReasons: ['unstable-income', 'made-up'], difficultyCoping: ['pawn-sell'] });
    expect(normalized.difficultyReasons).toEqual(['unstable-income']);
    expect(normalized.difficultyCoping).toEqual(['pawn-sell']);
  });

  it('coerces amounts to numbers and drops unusable ones', () => {
    const normalized = normalizeFinancialAnswers({ ...complete, allowanceDaily: '1,500.50', expenseFood: 'x', otherIncomeAnswer: 'maybe' });
    expect(normalized.allowanceDaily).toBe(1500.5);
    expect(normalized.expenseFood).toBe('');
    expect(normalized.otherIncomeAnswer).toBe('');
  });
});

describe('financial detail sections', () => {
  const financialProfile = {
    economicStatus: 'lower',
    father: { employmentStatus: 'employed', employer: 'Davao Fruits', annualIncome: 120000 },
    mother: { employmentStatus: 'unemployed', annualIncome: 0, lastEmployed: 'March 2024', unemploymentReason: 'Retrenched' },
    assets: { house: true, car: true, others: 'Sari-sari store' },
    appliances: { smartphones: true },
  };

  it('describes the household finances and the situation as labelled rows', () => {
    const sections = getFinancialDetailSections({ financialProfile, answers: normalizeFinancialAnswers({ ...complete, difficultyAnswer: 'yes', difficultyReasons: ['unstable-income'], difficultyCoping: ['loan'] }) });
    expect(sections.map((section) => section.key)).toEqual(['finances', 'situation']);
    const rows = Object.fromEntries(sections.flatMap((section) => section.rows).map((row) => [row.label, row.value]));
    expect(rows['Perceived economic status']).toBe('Lower class');
    expect(rows.Father).toBe('Employed · Davao Fruits · ₱120,000 a year');
    expect(rows.Mother).toContain('Unemployed');
    expect(rows.Mother).toContain('last employed March 2024');
    expect(rows.Assets).toBe('House, Car, Sari-sari store');
    expect(rows['Financial difficulty in the last 3 months']).toBe('Yes · Insufficient and unstable income of parents · Coping: Apply for a loan from banks or cooperatives');
    expect(rows['Daily allowance']).toBe('₱150 · enough');
    expect(rows['Daily food intake']).toBe('Adequate');
    expect(rows['Mode of transport']).toBe('Public transport (jeep, bus, etc.)');
  });

  it('shows a deceased parent without income', () => {
    const [section] = getFinancialDetailSections({ financialProfile, family: { fatherDeceased: true } });
    expect(section.rows.find((row) => row.label === 'Father').value).toBe('Deceased');
  });

  it('omits a group with nothing to show', () => {
    expect(getFinancialDetailSections({})).toEqual([]);
    expect(getFinancialDetailSections({ answers: normalizeFinancialAnswers(complete) }).map((section) => section.key)).toEqual(['situation']);
  });
});

describe('application form text', () => {
  it('counts words by whitespace', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('  one   two\nthree ')).toBe(3);
  });

  it('carries the fixed essay topic and the seven affidavit clauses', () => {
    expect(ESSAY_TOPIC).toMatch(/unrelated to academics/);
    expect(AFFIDAVIT_CLAUSES).toHaveLength(7);
  });
});
