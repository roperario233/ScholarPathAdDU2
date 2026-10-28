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
  { key: 'none', label: 'None of the above' },
];

export const APPLIANCE_OPTIONS = [
  { key: 'smartphones', label: 'Smartphone(s)' },
  { key: 'aircon', label: 'Air conditioner' },
  { key: 'laptop', label: 'Laptop or computer' },
  { key: 'postpaidInternet', label: 'Postpaid internet' },
  { key: 'none', label: 'None of the above' },
];

// FORM 230-SCH asks the student to check as many as apply, so the reasons and the
// coping strategies are stored as option keys plus one free-text "Other". Both
// lists mirror the printed form.
export const DIFFICULTY_REASON_OPTIONS = [
  { key: 'job-loss', label: 'Loss of job during the pandemic' },
  { key: 'unstable-income', label: 'Insufficient and unstable income of parents' },
  { key: 'school-expenses', label: 'School expenses (aside from tuition and fees)' },
  { key: 'extended-family', label: 'Supporting extended family members' },
  { key: 'other-expenses', label: 'Other expenses, e.g. rent, medicines' },
  { key: 'other', label: 'Other reasons' },
];

export const COPING_OPTIONS = [
  { key: 'borrow', label: 'Borrow or ask money from friends or relatives' },
  { key: 'loan', label: 'Apply for a loan from banks or cooperatives' },
  { key: 'pawn-sell', label: 'Pawn or sell valuables' },
  { key: 'promissory', label: 'Give promissory notes' },
  { key: 'other', label: 'Other ways' },
];

export const TRANSPORT_MODE_OPTIONS = [
  { value: 'public-transport', label: 'Public transport (jeep, bus, etc.)' },
  { value: 'private-car', label: 'Private car' },
  { value: 'other', label: 'Others' },
];

// FORM 230-SCH "Daily Food Intake: Adequate / Inadequate".
export const foodIntakeOptions = [
  { value: 'adequate', label: 'Adequate' },
  { value: 'inadequate', label: 'Inadequate' },
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

const pickFlags = (source, options) => {
  const selected = Object.fromEntries(
    [...options.map((option) => [option.key, Boolean(source?.[option.key])]), ['others', cleanText(source?.others, TEXT_MAX)]],
  );
  // "None of the above" is exclusive: choosing it clears every item and the
  // free-text entry, and choosing any item clears it, so a family can never own
  // nothing and a car at the same time.
  if (selected.none) {
    options.forEach((option) => {
      if (option.key !== 'none') selected[option.key] = false;
    });
    selected.others = '';
  } else if (selected.others || options.some((option) => option.key !== 'none' && selected[option.key])) {
    selected.none = false;
  }
  return selected;
};

const oneOfValues = (value, options) => (options.some((option) => option.value && option.value === value) ? value : '');

// A multi-select answer stored as option keys. A legacy free-text answer (saved
// before FORM 230-SCH options existed) is kept under "Other" so the student's
// words are never dropped.
const pickOptionKeys = (raw, options, otherKey = 'other') => {
  const legacyText = typeof raw === 'string' ? raw.trim() : '';
  const source = Array.isArray(raw) ? raw : (legacyText && !options.some((option) => option.key === legacyText) ? [] : [legacyText]);
  const keys = [...new Set(source.map((value) => String(value).trim()))].filter((value) => options.some((option) => option.key === value));
  if (legacyText && !keys.length && legacyText) return { keys: [otherKey], other: cleanText(legacyText, LONG_TEXT_MAX) };
  return { keys, other: '' };
};

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
  difficultyOther: 'Other reason for the financial difficulty',
  difficultyCoping: 'How the family copes',
  copingOther: 'Other way the family copes',
  allowanceDaily: 'Daily allowance',
  allowanceEnough: 'Whether the allowance is enough',
  foodIntakeAdequacy: 'Daily food intake',
  foodIntake: 'What you usually eat in a day',
  transportMode: 'Mode of transport',
  transportOther: 'Other mode of transport',
  expenseFood: 'Daily food expense',
  expenseTransport: 'Daily transport expense',
  expenseOther: 'Other daily expenses',
};

// Multi-select answers hold a list of option keys, so an empty value is `[]`.
export const MULTI_SELECT_ANSWER_KEYS = ['difficultyReasons', 'difficultyCoping'];

export const createEmptyFinancialAnswers = () => Object.fromEntries(
  Object.keys(FINANCIAL_ANSWER_FIELDS).map((key) => [key, MULTI_SELECT_ANSWER_KEYS.includes(key) ? [] : '']),
);

const yesNo = (raw) => (raw === 'yes' || raw === 'no' ? raw : '');

// Canonical shape of the answers: trimmed text, lowercase yes/no, numeric
// amounts. It never reports errors so a partial draft can always be saved.
export const normalizeFinancialAnswers = (raw = {}) => {
  const amount = (key) => {
    const parsed = toAmount(raw[key]);
    return parsed.invalid ? '' : parsed.value;
  };
  const reasons = pickOptionKeys(raw.difficultyReasons, DIFFICULTY_REASON_OPTIONS);
  const coping = pickOptionKeys(raw.difficultyCoping, COPING_OPTIONS);
  // A mode of transport saved as free text before the FORM 230-SCH options
  // existed is kept under "Others" instead of being dropped.
  const transport = cleanText(raw.transportMode, TEXT_MAX);
  const knownTransport = TRANSPORT_MODE_OPTIONS.some((option) => option.value === transport);
  const answers = {
    otherIncomeAnswer: yesNo(raw.otherIncomeAnswer),
    otherIncomeSources: cleanText(raw.otherIncomeSources, LONG_TEXT_MAX),
    otherIncomeMonthly: amount('otherIncomeMonthly'),
    difficultyAnswer: yesNo(raw.difficultyAnswer),
    difficultyReasons: reasons.keys,
    difficultyOther: cleanText(raw.difficultyOther || reasons.other, LONG_TEXT_MAX),
    difficultyCoping: coping.keys,
    copingOther: cleanText(raw.copingOther || coping.other, LONG_TEXT_MAX),
    allowanceDaily: amount('allowanceDaily'),
    allowanceEnough: yesNo(raw.allowanceEnough),
    foodIntakeAdequacy: oneOfValues(raw.foodIntakeAdequacy, foodIntakeOptions),
    foodIntake: cleanText(raw.foodIntake, LONG_TEXT_MAX),
    transportMode: knownTransport ? transport : (transport ? 'other' : ''),
    transportOther: knownTransport
      ? cleanText(raw.transportOther, TEXT_MAX)
      : cleanText(raw.transportOther || transport, TEXT_MAX),
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
    answers.difficultyReasons = [];
    answers.difficultyOther = '';
    answers.difficultyCoping = [];
    answers.copingOther = '';
  }
  if (!answers.difficultyReasons.includes('other')) answers.difficultyOther = '';
  if (!answers.difficultyCoping.includes('other')) answers.copingOther = '';
  if (answers.transportMode !== 'other') answers.transportOther = '';
  return answers;
};

// What is still missing for a submission. Mirrors financial_answers_complete()
// in the database (the client also asks for the income source details and the
// free-text follow-ups behind an "Other" option).
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
    if (!answers.difficultyReasons.length) need('difficultyReasons');
    if (answers.difficultyReasons.includes('other') && !answers.difficultyOther) need('difficultyOther');
    if (!answers.difficultyCoping.length) need('difficultyCoping');
    if (answers.difficultyCoping.includes('other') && !answers.copingOther) need('copingOther');
  }
  if (!isAmount(answers.allowanceDaily)) need('allowanceDaily');
  if (!answers.allowanceEnough) need('allowanceEnough');
  // A draft saved before the Adequate / Inadequate answer existed still counts
  // while its free-text description is present.
  if (!answers.foodIntakeAdequacy && !answers.foodIntake) need('foodIntakeAdequacy');
  if (!answers.transportMode) need('transportMode');
  if (answers.transportMode === 'other' && !answers.transportOther) need('transportOther');
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
const keyLabels = (options, keys = []) => keys.map((key) => options.find((option) => option.key === key)?.label || key).filter(Boolean);
const money = (value) => (isAmount(value) ? fmtCurrency(Number(value)) : '');
const flagList = (flags, options) => [
  ...options.filter((option) => flags?.[option.key]).map((option) => option.label),
  ...(flags?.others ? [flags.others] : []),
].join(', ');

const describeParent = (parent = {}, deceased, unknown = false) => {
  if (unknown) return 'Unknown / not listed';
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
  // FORM 230-SCH totals, derived from the family rows instead of asked twice.
  const siblings = Array.isArray(family.siblings) ? family.siblings : [];
  const studyingCount = siblings.filter((entry) => ['Studying', 'Aged 3 or below'].includes(entry?.status)).length;
  const workingCount = siblings.filter((entry) => ['Employed', 'Married'].includes(entry?.status)).length;
  const householdCount = Array.isArray(family.householdAdults) ? family.householdAdults.length : 0;
  if (financialProfile) {
    sections.push({
      key: 'finances',
      title: 'Household finances',
      rows: [
        { label: 'Perceived economic status', value: optionLabel(economicStatusOptions, financialProfile.economicStatus) },
        { label: 'Father', value: describeParent(financialProfile.father, family.fatherDeceased, family.fatherUnknown) },
        { label: 'Mother', value: describeParent(financialProfile.mother, family.motherDeceased, family.motherUnknown) },
        { label: 'Assets', value: flagList(financialProfile.assets, ASSET_OPTIONS) || 'None listed' },
        { label: 'Appliances and services', value: flagList(financialProfile.appliances, APPLIANCE_OPTIONS) || 'None listed' },
        ...(siblings.length || householdCount ? [{
          label: 'Household totals',
          value: [
            `Siblings studying or below 3 years old: ${studyingCount}`,
            `Siblings working or married: ${workingCount}`,
            `Other adults in the household: ${householdCount}`,
          ].join(' · '),
        }] : []),
      ],
    });
  }
  if (answers && Object.keys(answers).length) {
    const normalized = normalizeFinancialAnswers(answers);
    const answerText = (value) => (value === 'yes' ? 'Yes' : value === 'no' ? 'No' : '');
    const reasonText = keyLabels(DIFFICULTY_REASON_OPTIONS, normalized.difficultyReasons)
      .map((label) => (label === 'Other reasons' && normalized.difficultyOther ? `Other reasons: ${normalized.difficultyOther}` : label));
    const copingText = keyLabels(COPING_OPTIONS, normalized.difficultyCoping)
      .map((label) => (label === 'Other ways' && normalized.copingOther ? `Other ways: ${normalized.copingOther}` : label));
    sections.push({
      key: 'situation',
      title: 'Financial situation',
      rows: [
        { label: 'Other sources of income', value: normalized.otherIncomeAnswer === 'yes'
          ? [normalized.otherIncomeSources, money(normalized.otherIncomeMonthly) && `${money(normalized.otherIncomeMonthly)} a month`].filter(Boolean).join(' · ')
          : answerText(normalized.otherIncomeAnswer) },
        { label: 'Financial difficulty in the last 3 months', value: normalized.difficultyAnswer === 'yes'
          ? ['Yes', reasonText.join(', '), copingText.length ? `Coping: ${copingText.join(', ')}` : ''].filter(Boolean).join(' · ')
          : answerText(normalized.difficultyAnswer) },
        { label: 'Daily allowance', value: [money(normalized.allowanceDaily), normalized.allowanceEnough ? (normalized.allowanceEnough === 'yes' ? 'enough' : 'not enough') : ''].filter(Boolean).join(' · ') },
        { label: 'Daily food intake', value: [optionLabel(foodIntakeOptions, normalized.foodIntakeAdequacy), normalized.foodIntake].filter(Boolean).join(' · ') },
        { label: 'Mode of transport', value: [optionLabel(TRANSPORT_MODE_OPTIONS, normalized.transportMode), normalized.transportOther].filter(Boolean).join(' · ') },
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
