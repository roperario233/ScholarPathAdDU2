import { fmtCurrency } from './formatters';

// FORM 230-SCH financial details. These are sensitive (parents' income, assets,
// expenses), so they never go in `profiles.profile_details`, which a Department
// Chair can read. They live in two office-only tables:
//   student_financial_profiles       reusable facts, edited in My Profile
//   application_financial_details    the per-application answers, plus the
//                                    financial profile frozen at submission
// Both are readable by the owning student and the Admissions Office only.

export const economicStatusOptions = [
  { value: '', label: 'Select' },
  { value: 'lower', label: 'Lower class' },
  { value: 'middle', label: 'Middle class' },
  { value: 'upper', label: 'Upper class' },
];

export const parentEmploymentOptions = [
  { value: '', label: 'Select' },
  { value: 'employed', label: 'Employed' },
  { value: 'self-employed', label: 'Self-employed' },
  { value: 'unemployed', label: 'Unemployed' },
];

export const yesNoAnswerOptions = [
  { value: '', label: 'Select' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

export const ASSET_OPTIONS = [
  { key: 'house', label: 'House' },
  { key: 'lot', label: 'Lot' },
  { key: 'car', label: 'Car' },
  { key: 'puv', label: 'Public utility vehicle (PUV)' },
  { key: 'motorcycle', label: 'Motorcycle' },
  { key: 'realEstate', label: 'Other real estate' },
  { key: 'heavyEquipment', label: 'Heavy equipment' },
];

export const APPLIANCE_OPTIONS = [
  { key: 'smartphones', label: 'Smartphone(s)' },
  { key: 'aircon', label: 'Air conditioner' },
  { key: 'laptop', label: 'Laptop or computer' },
  { key: 'postpaidInternet', label: 'Postpaid internet' },
];

const TEXT_MAX = 100;
const LONG_TEXT_MAX = 300;
const AMOUNT_MAX = 1_000_000_000;

const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';
const cleanText = (raw, max) => String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const tooLong = (raw, max) => String(raw ?? '').trim().replace(/\s+/g, ' ').length > max;

// A non-negative amount of pesos, or '' when blank. `invalid` flags a value that
// is present but not a usable amount.
const toAmount = (raw) => {
  if (!hasValue(raw)) return { value: '', invalid: false };
  const value = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(value) && value >= 0 && value <= AMOUNT_MAX
    ? { value, invalid: false }
    : { value: raw, invalid: true };
};

const isAmount = (value) => hasValue(value) && Number.isFinite(Number(value)) && Number(value) >= 0;

const pickFlags = (source, options) => Object.fromEntries(
  [...options.map((option) => [option.key, Boolean(source?.[option.key])]), ['others', cleanText(source?.others, TEXT_MAX)]],
);

const oneOfValues = (value, options) => (options.some((option) => option.value && option.value === value) ? value : '');

export const createEmptyFinancialProfile = () => ({
  economicStatus: '',
  father: {},
  mother: {},
  assets: pickFlags({}, ASSET_OPTIONS),
  appliances: pickFlags({}, APPLIANCE_OPTIONS),
});

const validateParent = (raw = {}, prefix, errors) => {
  const income = toAmount(raw.annualIncome);
  if (income.invalid) errors[`${prefix}AnnualIncome`] = 'Enter the annual income as an amount of 0 or more.';
  [['employer', TEXT_MAX], ['lastEmployed', TEXT_MAX], ['unemploymentReason', LONG_TEXT_MAX]].forEach(([key, max]) => {
    if (tooLong(raw[key], max)) errors[`${prefix}${key[0].toUpperCase()}${key.slice(1)}`] = `Keep this within ${max} characters.`;
  });
  return {
    employmentStatus: oneOfValues(raw.employmentStatus, parentEmploymentOptions),
    employer: cleanText(raw.employer, TEXT_MAX),
    annualIncome: income.value,
    lastEmployed: cleanText(raw.lastEmployed, TEXT_MAX),
    unemploymentReason: cleanText(raw.unemploymentReason, LONG_TEXT_MAX),
  };
};

// My Profile "Household finances" section. A blank answer is allowed at save
// time (completeness and the server gate decide what an application needs);
// only malformed values are errors.
export const validateFinancialProfileSection = (form = {}) => {
  const errors = {};
  const economicStatus = oneOfValues(form.economicStatus || '', economicStatusOptions);
  if (form.economicStatus && !economicStatus) errors.economicStatus = 'Choose an option.';
  const values = {
    economicStatus,
    father: validateParent(form.father, 'father', errors),
    mother: validateParent(form.mother, 'mother', errors),
    assets: pickFlags(form.assets, ASSET_OPTIONS),
    appliances: pickFlags(form.appliances, APPLIANCE_OPTIONS),
  };
  return { values: { financialProfile: values }, errors };
};

// ---------------------------------------------------------------------------
// The per-application "Financial situation" answers. Flat keys so the database
// gate (financial_answers_complete) can read them without nesting.
// ---------------------------------------------------------------------------
export const FINANCIAL_ANSWER_FIELDS = {
  otherIncomeAnswer: 'Other sources of income',
  otherIncomeSources: 'Other income sources',
  otherIncomeMonthly: 'Average monthly amount of other income',
  difficultyAnswer: 'Financial difficulty in the last 3 months',
  difficultyReasons: 'Reasons for the financial difficulty',
  difficultyCoping: 'How the family copes',
  allowanceDaily: 'Daily allowance',
  allowanceEnough: 'Whether the allowance is enough',
  foodIntake: 'Daily food intake',
  transportMode: 'Mode of transport',
  expenseFood: 'Daily food expense',
  expenseTransport: 'Daily transport expense',
  expenseOther: 'Other daily expenses',
};

export const createEmptyFinancialAnswers = () => Object.fromEntries(Object.keys(FINANCIAL_ANSWER_FIELDS).map((key) => [key, '']));

const yesNo = (raw) => (raw === 'yes' || raw === 'no' ? raw : '');

// Canonical shape of the answers: trimmed text, lowercase yes/no, numeric
// amounts. It never reports errors so a partial draft can always be saved.
export const normalizeFinancialAnswers = (raw = {}) => {
  const amount = (key) => {
    const parsed = toAmount(raw[key]);
    return parsed.invalid ? '' : parsed.value;
  };
  const answers = {
    otherIncomeAnswer: yesNo(raw.otherIncomeAnswer),
    otherIncomeSources: cleanText(raw.otherIncomeSources, LONG_TEXT_MAX),
    otherIncomeMonthly: amount('otherIncomeMonthly'),
    difficultyAnswer: yesNo(raw.difficultyAnswer),
    difficultyReasons: cleanText(raw.difficultyReasons, LONG_TEXT_MAX),
    difficultyCoping: cleanText(raw.difficultyCoping, LONG_TEXT_MAX),
    allowanceDaily: amount('allowanceDaily'),
    allowanceEnough: yesNo(raw.allowanceEnough),
    foodIntake: cleanText(raw.foodIntake, LONG_TEXT_MAX),
    transportMode: cleanText(raw.transportMode, TEXT_MAX),
    expenseFood: amount('expenseFood'),
    expenseTransport: amount('expenseTransport'),
    expenseOther: amount('expenseOther'),
  };
  // An answer that no longer applies is cleared so a stale detail never ships.
  if (answers.otherIncomeAnswer !== 'yes') {
    answers.otherIncomeSources = '';
    answers.otherIncomeMonthly = '';
  }
  if (answers.difficultyAnswer !== 'yes') {
    answers.difficultyReasons = '';
    answers.difficultyCoping = '';
  }
  return answers;
};

// What is still missing for a submission. Mirrors financial_answers_complete()
// in the database (the client also asks for the income source details).
export const getFinancialAnswersMissing = (rawAnswers) => {
  const answers = normalizeFinancialAnswers(rawAnswers || {});
  const missing = [];
  const need = (key) => missing.push(FINANCIAL_ANSWER_FIELDS[key]);
  if (!answers.otherIncomeAnswer) need('otherIncomeAnswer');
  if (answers.otherIncomeAnswer === 'yes') {
    if (!answers.otherIncomeSources) need('otherIncomeSources');
    if (!isAmount(answers.otherIncomeMonthly)) need('otherIncomeMonthly');
  }
  if (!answers.difficultyAnswer) need('difficultyAnswer');
  if (answers.difficultyAnswer === 'yes') {
    if (!answers.difficultyReasons) need('difficultyReasons');
    if (!answers.difficultyCoping) need('difficultyCoping');
  }
  if (!isAmount(answers.allowanceDaily)) need('allowanceDaily');
  if (!answers.allowanceEnough) need('allowanceEnough');
  if (!answers.foodIntake) need('foodIntake');
  if (!answers.transportMode) need('transportMode');
  if (!isAmount(answers.expenseFood)) need('expenseFood');
  if (!isAmount(answers.expenseTransport)) need('expenseTransport');
  if (!isAmount(answers.expenseOther)) need('expenseOther');
  return missing;
};

export const isFinancialAnswersComplete = (answers) => getFinancialAnswersMissing(answers).length === 0;

// ---------------------------------------------------------------------------
// Display rows (same `{ label, value }` shape as getProfileSnapshotSections), for
// the workspace preview, the student's own view, the Admissions Office review
// and the print sheet.
// ---------------------------------------------------------------------------
const optionLabel = (options, value) => options.find((option) => option.value === value)?.label || '';
const money = (value) => (isAmount(value) ? fmtCurrency(Number(value)) : '');
const flagList = (flags, options) => [
  ...options.filter((option) => flags?.[option.key]).map((option) => option.label),
  ...(flags?.others ? [flags.others] : []),
].join(', ');

const describeParent = (parent = {}, deceased) => {
  if (deceased) return 'Deceased';
  return [
    optionLabel(parentEmploymentOptions, parent.employmentStatus),
    parent.employer,
    isAmount(parent.annualIncome) ? `${money(parent.annualIncome)} a year` : '',
    parent.employmentStatus === 'unemployed' && parent.lastEmployed ? `last employed ${parent.lastEmployed}` : '',
    parent.employmentStatus === 'unemployed' && parent.unemploymentReason ? parent.unemploymentReason : '',
  ].filter(Boolean).join(' · ');
};

export const getFinancialDetailSections = ({ financialProfile, answers, family = {} } = {}) => {
  const sections = [];
  if (financialProfile) {
    sections.push({
      key: 'finances',
      title: 'Household finances',
      rows: [
        { label: 'Perceived economic status', value: optionLabel(economicStatusOptions, financialProfile.economicStatus) },
        { label: 'Father', value: describeParent(financialProfile.father, family.fatherDeceased) },
        { label: 'Mother', value: describeParent(financialProfile.mother, family.motherDeceased) },
        { label: 'Assets', value: flagList(financialProfile.assets, ASSET_OPTIONS) || 'None listed' },
        { label: 'Appliances and services', value: flagList(financialProfile.appliances, APPLIANCE_OPTIONS) || 'None listed' },
      ],
    });
  }
  if (answers && Object.keys(answers).length) {
    const normalized = normalizeFinancialAnswers(answers);
    const answerText = (value) => (value === 'yes' ? 'Yes' : value === 'no' ? 'No' : '');
    sections.push({
      key: 'situation',
      title: 'Financial situation',
      rows: [
        { label: 'Other sources of income', value: normalized.otherIncomeAnswer === 'yes'
          ? [normalized.otherIncomeSources, money(normalized.otherIncomeMonthly) && `${money(normalized.otherIncomeMonthly)} a month`].filter(Boolean).join(' · ')
          : answerText(normalized.otherIncomeAnswer) },
        { label: 'Financial difficulty in the last 3 months', value: normalized.difficultyAnswer === 'yes'
          ? ['Yes', normalized.difficultyReasons, normalized.difficultyCoping && `Coping: ${normalized.difficultyCoping}`].filter(Boolean).join(' · ')
          : answerText(normalized.difficultyAnswer) },
        { label: 'Daily allowance', value: [money(normalized.allowanceDaily), normalized.allowanceEnough ? (normalized.allowanceEnough === 'yes' ? 'enough' : 'not enough') : ''].filter(Boolean).join(' · ') },
        { label: 'Daily food intake', value: normalized.foodIntake },
        { label: 'Mode of transport', value: normalized.transportMode },
        { label: 'Daily expenses', value: [
          money(normalized.expenseFood) && `food ${money(normalized.expenseFood)}`,
          money(normalized.expenseTransport) && `transport ${money(normalized.expenseTransport)}`,
          money(normalized.expenseOther) && `other ${money(normalized.expenseOther)}`,
        ].filter(Boolean).join(' · ') },
      ],
    });
  }
  return sections;
};
