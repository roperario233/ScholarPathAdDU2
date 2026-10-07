import { formatPhilippineMobile } from '../../supabase/functions/_shared/sms.js';

// Profile fields the Smart Eligibility Checker reads beyond the core academic
// columns (QPI, household income, degree program, active government grant).
// They feed the universal gate, the Exclusion Flag Hierarchy, the honors track,
// and the government-linked evaluators in src/lib/eligibility.js. Locally they
// live on `profileDraft`; in Supabase they are mirrored to
// `profiles.eligibility_attributes`.
export const ELIGIBILITY_ATTRIBUTE_KEYS = [
  'citizenship',
  'academicStanding',
  'applicantType',
  'yearLevel',
  'isHonorsGraduate',
  'honorsRank',
  'graduatingClassSize',
  'hsStrand',
  'hsAverage',
  'isOnPrepaidPlan',
  'hasSiblingOnAid',
  'hasOtherActiveScholarship',
  'sponsorTies',
];

export const SPONSOR_TIE_KEYS = ['gsisMemberDependent', 'afpDependent', 'usVeteranDependent'];

// Fields stored on the authenticated account (`authUser` locally and the core
// `profiles` columns in Supabase).
export const ACCOUNT_FIELD_KEYS = ['fullName', 'phone', 'bio', 'studentNumber', 'degreeProgram', 'qpi', 'householdIncome', 'hasActiveGovernmentGrant'];
export const STAFF_EDITABLE_FIELD_KEYS = ['fullName', 'phone', 'bio'];
// Core profile fields mirrored into `profileDraft` for eligibility matching.
export const PROFILE_DRAFT_KEYS = ['degreeProgram', 'qpi', 'householdIncome', 'hasActiveGovernmentGrant'];

export const BIO_MAX_LENGTH = 280;
export const FULL_NAME_MAX_LENGTH = 100;
export const PASSWORD_MIN_LENGTH = 8;

export const yearLevelOptions = [1, 2, 3, 4, 5].map((level) => ({ value: level, label: `Year ${level}` }));

export const applicantTypeOptions = [
  { value: 'first-year', label: 'Incoming first-year student' },
  { value: 'current', label: 'Continuing student' },
];

export const academicStandingOptions = [
  { value: 'good', label: 'Good academic standing' },
  { value: 'probation', label: 'Academic probation' },
  { value: 'disqualified', label: 'Academically disqualified' },
];

export const citizenshipOptions = [
  { value: 'Filipino', label: 'Filipino' },
  { value: 'Non-Filipino', label: 'Non-Filipino' },
];

export const honorsRankOptions = [
  { value: '', label: 'None' },
  { value: 'Valedictorian', label: 'Valedictorian' },
  { value: 'Salutatorian', label: 'Salutatorian' },
];

export const hsStrandOptions = [
  { value: '', label: 'Not specified' },
  { value: 'STEM', label: 'STEM' },
  { value: 'ABM', label: 'ABM' },
  { value: 'HUMSS', label: 'HUMSS' },
  { value: 'GAS', label: 'GAS' },
  { value: 'TVL', label: 'TVL' },
  { value: 'Arts and Design', label: 'Arts and Design' },
  { value: 'Sports', label: 'Sports' },
];

const hasOwn = (source, key) => Object.prototype.hasOwnProperty.call(source, key);
const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';

export const pickFields = (source = {}, keys = []) => Object.fromEntries(
  keys.filter((key) => hasOwn(source, key) && source[key] !== undefined).map((key) => [key, source[key]]),
);

// Returns only the known eligibility attributes, with sponsor ties narrowed to
// booleans so stored JSON cannot inject unexpected keys into the matcher.
export const pickEligibilityAttributes = (source) => {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const picked = pickFields(source, ELIGIBILITY_ATTRIBUTE_KEYS);
  if (hasOwn(picked, 'sponsorTies')) {
    const ties = picked.sponsorTies && typeof picked.sponsorTies === 'object' ? picked.sponsorTies : {};
    picked.sponsorTies = Object.fromEntries(SPONSOR_TIE_KEYS.map((key) => [key, Boolean(ties[key])]));
  }
  return picked;
};

// Field validators return `{ value, error }` so forms and the onboarding modal
// share one set of rules and messages.
export const validateFullName = (raw) => {
  const value = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (value.length < 2) return { value, error: 'Enter your full name.' };
  if (value.length > FULL_NAME_MAX_LENGTH) return { value, error: `Keep your full name within ${FULL_NAME_MAX_LENGTH} characters.` };
  return { value, error: '' };
};

export const validateStudentNumber = (raw) => {
  const value = String(raw ?? '').trim();
  return /^\d{4,12}$/.test(value)
    ? { value, error: '' }
    : { value, error: 'Enter your AdDU student number using 4–12 digits.' };
};

export const validateQpi = (raw) => {
  const value = Number(raw);
  if (isBlank(raw) || !Number.isFinite(value) || value < 0 || value > 4) {
    return { value: raw, error: 'Enter your annual QPI from 0.00 to 4.00.' };
  }
  return { value: Math.round(value * 100) / 100, error: '' };
};

export const validateHouseholdIncome = (raw) => {
  const value = Number(raw);
  if (isBlank(raw) || !Number.isFinite(value) || value < 0) {
    return { value: raw, error: 'Enter a valid annual household income in Philippine pesos.' };
  }
  return { value: Math.round(value), error: '' };
};

// Optional field: a blank entry clears the number (null).
export const validateMobileNumber = (raw) => {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return { value: null, error: '' };
  const value = formatPhilippineMobile(trimmed);
  return value
    ? { value, error: '' }
    : { value: trimmed, error: 'Enter a valid Philippine mobile number, e.g. 0917 123 4567.' };
};

const validateOptionalInteger = (raw, { min, max, message }) => {
  if (isBlank(raw)) return { value: '', error: '' };
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max
    ? { value, error: '' }
    : { value: raw, error: message };
};

const collect = (entries) => {
  const values = {};
  const errors = {};
  Object.entries(entries).forEach(([key, result]) => {
    values[key] = result.value;
    if (result.error) errors[key] = result.error;
  });
  return { values, errors };
};

const ok = (value) => ({ value, error: '' });
const oneOf = (value, options, message) => (
  options.some((option) => option.value === value) ? ok(value) : { value, error: message }
);

export const validatePersonalSection = (form = {}) => {
  const bio = String(form.bio ?? '').trim();
  return collect({
    fullName: validateFullName(form.fullName),
    phone: validateMobileNumber(form.phone),
    bio: bio.length > BIO_MAX_LENGTH
      ? { value: bio, error: `Keep your bio within ${BIO_MAX_LENGTH} characters.` }
      : ok(bio),
  });
};

export const validateAcademicSection = (form = {}, academicPrograms = []) => {
  const yearLevel = Number(form.yearLevel);
  const result = collect({
    studentNumber: validateStudentNumber(form.studentNumber),
    degreeProgram: !form.degreeProgram || (academicPrograms.length && !academicPrograms.some((program) => program.value === form.degreeProgram))
      ? { value: form.degreeProgram || '', error: 'Choose your degree program.' }
      : ok(form.degreeProgram),
    yearLevel: yearLevelOptions.some((option) => option.value === yearLevel)
      ? ok(yearLevel)
      : { value: form.yearLevel, error: 'Choose your current year level.' },
    applicantType: oneOf(form.applicantType, applicantTypeOptions, 'Choose your applicant type.'),
    academicStanding: oneOf(form.academicStanding, academicStandingOptions, 'Choose your academic standing.'),
    qpi: validateQpi(form.qpi),
  });

  if (!result.errors.yearLevel && !result.errors.applicantType && result.values.applicantType === 'first-year' && result.values.yearLevel > 1) {
    result.errors.yearLevel = 'Incoming first-year students are in year level 1.';
  }
  return result;
};

export const validateFinancialSection = (form = {}) => collect({
  householdIncome: validateHouseholdIncome(form.householdIncome),
  hasActiveGovernmentGrant: ok(Boolean(form.hasActiveGovernmentGrant)),
  hasOtherActiveScholarship: ok(Boolean(form.hasOtherActiveScholarship)),
  hasSiblingOnAid: ok(Boolean(form.hasSiblingOnAid)),
  isOnPrepaidPlan: ok(Boolean(form.isOnPrepaidPlan)),
});

export const validateBackgroundSection = (form = {}) => {
  const honorsRank = form.honorsRank || '';
  const result = collect({
    citizenship: oneOf(form.citizenship, citizenshipOptions, 'Choose your citizenship.'),
    honorsRank: oneOf(honorsRank, honorsRankOptions, 'Choose an honors standing.'),
    isHonorsGraduate: ok(Boolean(honorsRank)),
    graduatingClassSize: validateOptionalInteger(form.graduatingClassSize, { min: 1, max: 10000, message: 'Enter the graduating class size as a whole number.' }),
    hsStrand: oneOf(form.hsStrand || '', hsStrandOptions, 'Choose your senior high school strand.'),
    hsAverage: validateOptionalInteger(form.hsAverage, { min: 60, max: 100, message: 'Enter a general average from 60 to 100.' }),
    sponsorTies: ok(Object.fromEntries(SPONSOR_TIE_KEYS.map((key) => [key, Boolean(form.sponsorTies?.[key])]))),
  });

  if (honorsRank && result.values.graduatingClassSize === '' && !result.errors.graduatingClassSize) {
    result.errors.graduatingClassSize = 'Add your graduating class size to support your honors standing.';
  }
  return result;
};

// First-login onboarding collects the essentials the Smart Eligibility Checker
// needs beyond the credentials form. It reuses the same section rules as My
// Profile so the onboarding modal and the profile editor never disagree.
export const validateOnboardingEssentials = (form = {}, academicPrograms = []) => {
  const academic = validateAcademicSection(form, academicPrograms);
  const financial = validateFinancialSection(form);
  const phone = validateMobileNumber(form.phone);
  const citizenship = oneOf(form.citizenship, citizenshipOptions, 'Choose your citizenship.');

  const errors = { ...academic.errors, ...financial.errors };
  if (phone.error) errors.phone = phone.error;
  if (citizenship.error) errors.citizenship = citizenship.error;

  return {
    values: {
      studentNumber: academic.values.studentNumber,
      degreeProgram: academic.values.degreeProgram,
      yearLevel: academic.values.yearLevel,
      applicantType: academic.values.applicantType,
      academicStanding: academic.values.academicStanding,
      qpi: academic.values.qpi,
      householdIncome: financial.values.householdIncome,
      hasActiveGovernmentGrant: financial.values.hasActiveGovernmentGrant,
      phone: phone.value,
      citizenship: citizenship.value,
    },
    errors,
  };
};

export const validatePasswordChange = ({ password = '', confirmPassword = '' } = {}) => {
  const errors = {};
  if (password.length < PASSWORD_MIN_LENGTH || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    errors.password = `Use at least ${PASSWORD_MIN_LENGTH} characters with letters and numbers.`;
  }
  if (password !== confirmPassword) errors.confirmPassword = 'The passwords do not match.';
  return { values: { password }, errors };
};

export const getProfileCompleteness = (profile = {}, role = 'student') => {
  const items = [
    { key: 'fullName', label: 'Full name', section: 'personal', done: !validateFullName(profile.fullName).error },
    { key: 'phone', label: 'Philippine mobile number', section: 'personal', done: Boolean(formatPhilippineMobile(profile.phone || '')) },
  ];

  if (role === 'student') {
    items.push(
      { key: 'studentNumber', label: 'AdDU student number', section: 'academic', done: !validateStudentNumber(profile.studentNumber).error },
      { key: 'degreeProgram', label: 'Degree program', section: 'academic', done: !isBlank(profile.degreeProgram) },
      { key: 'yearLevel', label: 'Year level', section: 'academic', done: !isBlank(profile.yearLevel) },
      { key: 'qpi', label: 'Annual QPI', section: 'academic', done: !validateQpi(profile.qpi).error },
      { key: 'householdIncome', label: 'Annual household income', section: 'financial', done: !validateHouseholdIncome(profile.householdIncome).error },
      { key: 'citizenship', label: 'Citizenship', section: 'background', done: !isBlank(profile.citizenship) },
    );
  }

  const completed = items.filter((item) => item.done).length;
  return {
    items,
    completed,
    total: items.length,
    percent: Math.round((completed / items.length) * 100),
  };
};
