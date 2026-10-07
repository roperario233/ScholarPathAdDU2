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
  'yearStanding',
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
  // Additional profile attributes that feed matching and support Document Vault
  // verification. An incoming first-year picks a ranked program choice list (its
  // 1st choice is the degree program); IP community, PWD, and employment status
  // are self-reported and verifiable through the vault.
  'programChoice2',
  'programChoice3',
  'ipCommunity',
  'pwd',
  'employed',
];

export const SPONSOR_TIE_KEYS = ['gsisMemberDependent', 'afpDependent', 'usVeteranDependent'];

// Descriptive profile fields that are not inputs to the Smart Eligibility
// Checker. They live on `profileDraft` locally and are mirrored to the
// `profiles.profile_details` JSON column in Supabase. Family details are stored
// as one nested object.
export const PROFILE_DETAIL_KEYS = [
  'religion',
  'civilStatus',
  'completeAddress',
  'country',
  'residingAddress',
  'sameAsCompleteAddress',
  'familyDetails',
  // A longer free-text scholarship essay the student writes once and can reuse
  // across applications. Unlike the short bio it keeps its paragraph breaks.
  'essay',
];

// Fields stored on the authenticated account (`authUser` locally and the core
// `profiles` columns in Supabase).
export const ACCOUNT_FIELD_KEYS = ['fullName', 'phone', 'bio', 'studentNumber', 'degreeProgram', 'qpi', 'householdIncome', 'hasActiveGovernmentGrant'];
export const STAFF_EDITABLE_FIELD_KEYS = ['fullName', 'phone', 'bio'];
// Core profile fields mirrored into `profileDraft` for eligibility matching.
export const PROFILE_DRAFT_KEYS = ['degreeProgram', 'qpi', 'householdIncome', 'hasActiveGovernmentGrant'];

// Profile attributes that support verification through the Document Vault. A
// student uploads a proof document tagged with one or more of these keys and the
// Admissions Office verifies the document; the attribute state is then derived
// from the linked documents (see src/lib/verification.js). `proofType` names the
// suggested document type a student should upload for that attribute. Verification
// is informational in this prototype: it never blocks eligibility matching or
// applying, and QPI/income remain self-reported rather than Registrar-verified.
//
// Not every attribute needs proof. Attributes that are administrative or already
// evidenced elsewhere (AdDU student number, degree program, year standing, active
// government grant, and senior high school strand) are trusted as entered and are
// intentionally excluded here.
export const VERIFIABLE_ATTRIBUTE_OPTIONS = [
  { key: 'qpi', label: 'Annual QPI', section: 'academic', proofType: 'Transcript', hint: 'Upload your grade report or transcript showing your annual QPI.' },
  { key: 'academicStanding', label: 'Academic standing', section: 'academic', proofType: 'Transcript', hint: 'Upload a grade report or transcript reflecting your academic standing.' },
  { key: 'hsAverage', label: 'Senior high school general average', section: 'academic', proofType: 'HS Report Card', hint: 'Upload your senior high school report card showing your general average.' },
  { key: 'householdIncome', label: 'Annual household income', section: 'financial', proofType: 'Income Proof', hint: 'Upload your BIR-stamped ITR or a certificate of indigency.' },
  { key: 'employed', label: 'Employment status', section: 'financial', proofType: 'Certificate of Employment', hint: 'Upload a certificate of employment or your latest payslip.' },
  { key: 'honorsRank', label: 'Graduation honors', section: 'background', proofType: 'Certificate of Award', hint: 'Upload your Certificate of Award for your honors standing.' },
  { key: 'citizenship', label: 'Citizenship', section: 'background', proofType: 'Passport / PSA Birth Certificate', hint: 'Upload your passport or PSA birth certificate showing your citizenship.' },
  { key: 'ipCommunity', label: 'Indigenous People (IP) community', section: 'background', proofType: 'Certificate of Tribal Membership', hint: 'Upload your NCIP certificate of tribal membership or equivalent.' },
  { key: 'pwd', label: 'Person with Disability (PWD)', section: 'background', proofType: 'PWD ID', hint: 'Upload your PWD ID or medical certificate of disability.' },
];

export const VERIFIABLE_ATTRIBUTE_KEYS = VERIFIABLE_ATTRIBUTE_OPTIONS.map((option) => option.key);
export const getVerifiableAttributeOption = (key) => VERIFIABLE_ATTRIBUTE_OPTIONS.find((option) => option.key === key);

export const BIO_MAX_LENGTH = 280;
export const ESSAY_MAX_LENGTH = 5000;
export const FULL_NAME_MAX_LENGTH = 100;
export const PASSWORD_MIN_LENGTH = 8;

// Year standing is the single control a student picks. The eligibility engine
// and the profile gates still read the derived `applicantType` and `yearLevel`
// attributes, so `deriveYearStanding` / `resolveYearStanding` bridge the two
// directions and let records saved before this control existed keep resolving.
// An incoming first-year has no college QPI yet (its programs key off senior
// high school standing), while every continuing year reports a QPI.
export const yearStandingOptions = [
  { value: 'incoming-1st', label: 'Incoming 1st year' },
  { value: '1st', label: '1st year' },
  { value: '2nd', label: '2nd year' },
  { value: '3rd', label: '3rd year' },
  { value: '4th', label: '4th year' },
  { value: '5th', label: '5th year' },
];

const YEAR_STANDING_VALUES = new Set(yearStandingOptions.map((option) => option.value));
const YEAR_LEVEL_ORDINALS = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th' };

// Reconstructs the single standing from stored attributes: a saved standing
// wins, then the legacy `applicantType`, then the numeric `yearLevel`.
export const deriveYearStanding = ({ yearStanding, applicantType, yearLevel } = {}) => {
  if (YEAR_STANDING_VALUES.has(yearStanding)) return yearStanding;
  if (applicantType === 'first-year') return 'incoming-1st';
  return YEAR_LEVEL_ORDINALS[Number(yearLevel)] || '';
};

// Expands the chosen standing into everything the eligibility engine, the
// completeness checklist, and the onboarding gates read.
export const resolveYearStanding = (value) => {
  const yearStanding = YEAR_STANDING_VALUES.has(value) ? value : '';
  const isIncomingFirstYear = yearStanding === 'incoming-1st';
  const level = !yearStanding ? null : (isIncomingFirstYear ? 1 : Number(yearStanding.charAt(0)));
  return {
    yearStanding,
    isIncomingFirstYear,
    applicantType: isIncomingFirstYear ? 'first-year' : 'current',
    yearLevel: Number.isInteger(level) ? level : null,
  };
};

// Single source of truth for what a standing requires, so the onboarding modal,
// the My Profile sections, the validators, and the routing gates never re-derive
// the rules independently. Accepts a standing value or a profile-shaped object.
// An unanswered standing requires nothing yet; an incoming first-year reports
// senior high school standing and has no AdDU student number or college QPI,
// while every continuing year (1st–5th) reports both.
export const getStandingRequirements = (value) => {
  const yearStanding = value && typeof value === 'object' ? deriveYearStanding(value) : value;
  const resolved = resolveYearStanding(yearStanding);
  const isContinuing = Boolean(resolved.yearStanding) && !resolved.isIncomingFirstYear;
  return {
    ...resolved,
    isContinuing,
    requiresStudentNumber: isContinuing,
    requiresQpi: isContinuing,
    requiresHsStanding: resolved.isIncomingFirstYear,
    // Only an incoming first-year ranks program choices (1st, 2nd, 3rd), because
    // an enrolled student already has a single degree program.
    requiresProgramChoices: resolved.isIncomingFirstYear,
    // An incoming first-year is not enrolled yet, so the header reads as a
    // program/course being applied for; an enrolled student keeps the plain form.
    programLabel: resolved.isIncomingFirstYear ? 'Program / Course (to be enrolled)' : 'Program / Course',
  };
};

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

// Personal information options. Religion and civil status are descriptive only;
// they are never read by the Smart Eligibility Checker.
export const religionOptions = [
  { value: '', label: 'Prefer not to say' },
  { value: 'Roman Catholic', label: 'Roman Catholic' },
  { value: 'Protestant', label: 'Protestant' },
  { value: 'Iglesia ni Cristo', label: 'Iglesia ni Cristo' },
  { value: 'Islam', label: 'Islam' },
  { value: 'Buddhism', label: 'Buddhism' },
  { value: 'Hinduism', label: 'Hinduism' },
  { value: 'Other', label: 'Other' },
];

export const civilStatusOptions = [
  { value: '', label: 'Not specified' },
  { value: 'Single', label: 'Single' },
  { value: 'Married', label: 'Married' },
  { value: 'Separated', label: 'Separated' },
  { value: 'Widowed', label: 'Widowed' },
  { value: 'Annulled', label: 'Annulled' },
];

// Family details options and limits.
export const familyPositionOptions = [
  { value: '', label: 'Not specified' },
  { value: 'Only child', label: 'Only child' },
  { value: 'Eldest', label: 'Eldest' },
  { value: 'Middle', label: 'Middle' },
  { value: 'Youngest', label: 'Youngest' },
];

export const FAMILY_NAME_MAX_LENGTH = 100;
export const FAMILY_OCCUPATION_MAX_LENGTH = 100;
export const ADDRESS_MAX_LENGTH = 240;
export const COUNTRY_MAX_LENGTH = 60;

// Self-reported, Document-Vault-verifiable background answers.
export const ipCommunityOptions = [
  { value: '', label: 'Not specified' },
  { value: 'Yes', label: 'Yes' },
  { value: 'No', label: 'No' },
];

export const pwdOptions = [
  { value: '', label: 'Not specified' },
  { value: 'Yes', label: 'Yes' },
  { value: 'No', label: 'No' },
];

export const employmentOptions = [
  { value: '', label: 'Not specified' },
  { value: 'Not employed', label: 'Not employed' },
  { value: 'Part-time', label: 'Part-time employed' },
  { value: 'Full-time', label: 'Full-time employed' },
  { value: 'Self-employed', label: 'Self-employed' },
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

// Optional program choice: blank is allowed, otherwise it must be a known program.
const validateOptionalProgramChoice = (raw, academicPrograms) => {
  const value = String(raw ?? '').trim();
  if (!value) return ok('');
  return academicPrograms.length && !academicPrograms.some((program) => program.value === value)
    ? { value, error: 'Choose a valid program.' }
    : ok(value);
};

const ok = (value) => ({ value, error: '' });
const oneOf = (value, options, message) => (
  options.some((option) => option.value === value) ? ok(value) : { value, error: message }
);

// Free-text field: trims and collapses whitespace, caps the length, and treats a
// blank entry as an empty value (never a validation error).
const validateText = (raw, { max, message }) => {
  const value = String(raw ?? '').trim().replace(/\s+/g, ' ');
  return value.length > max ? { value, error: message } : ok(value);
};

export const validatePersonalSection = (form = {}) => {
  const bio = String(form.bio ?? '').trim();
  // The essay is longer than the bio and keeps its paragraph breaks, so it is
  // only trimmed at the edges and capped, never whitespace-collapsed.
  const essay = String(form.essay ?? '').trim();
  return collect({
    fullName: validateFullName(form.fullName),
    phone: validateMobileNumber(form.phone),
    bio: bio.length > BIO_MAX_LENGTH
      ? { value: bio, error: `Keep your bio within ${BIO_MAX_LENGTH} characters.` }
      : ok(bio),
    religion: oneOf(form.religion || '', religionOptions, 'Choose a religion option.'),
    civilStatus: oneOf(form.civilStatus || '', civilStatusOptions, 'Choose a civil status.'),
    essay: essay.length > ESSAY_MAX_LENGTH
      ? { value: essay, error: `Keep your essay within ${ESSAY_MAX_LENGTH} characters.` }
      : ok(essay),
  });
};

// Address panel. "Residing address" can mirror the complete address through the
// same-as toggle, so the validator resolves the effective residing address.
export const validateAddressSection = (form = {}) => {
  const sameAsCompleteAddress = Boolean(form.sameAsCompleteAddress);
  const result = collect({
    completeAddress: validateText(form.completeAddress, { max: ADDRESS_MAX_LENGTH, message: `Keep your complete address within ${ADDRESS_MAX_LENGTH} characters.` }),
    country: validateText(form.country, { max: COUNTRY_MAX_LENGTH, message: `Keep the country within ${COUNTRY_MAX_LENGTH} characters.` }),
    residingAddress: sameAsCompleteAddress
      ? ok('')
      : validateText(form.residingAddress, { max: ADDRESS_MAX_LENGTH, message: `Keep your residing address within ${ADDRESS_MAX_LENGTH} characters.` }),
  });
  return {
    values: {
      completeAddress: result.values.completeAddress,
      country: result.values.country,
      sameAsCompleteAddress,
      residingAddress: sameAsCompleteAddress ? result.values.completeAddress : result.values.residingAddress,
    },
    errors: result.errors,
  };
};

// Family details: parent names, occupations, and deceased status, plus family
// position and the number of siblings. All optional.
export const validateFamilySection = (form = {}) => {
  const family = form.familyDetails && typeof form.familyDetails === 'object' ? form.familyDetails : {};
  const result = collect({
    fatherName: validateText(family.fatherName, { max: FAMILY_NAME_MAX_LENGTH, message: `Keep the name within ${FAMILY_NAME_MAX_LENGTH} characters.` }),
    fatherOccupation: validateText(family.fatherOccupation, { max: FAMILY_OCCUPATION_MAX_LENGTH, message: `Keep the occupation within ${FAMILY_OCCUPATION_MAX_LENGTH} characters.` }),
    motherName: validateText(family.motherName, { max: FAMILY_NAME_MAX_LENGTH, message: `Keep the name within ${FAMILY_NAME_MAX_LENGTH} characters.` }),
    motherOccupation: validateText(family.motherOccupation, { max: FAMILY_OCCUPATION_MAX_LENGTH, message: `Keep the occupation within ${FAMILY_OCCUPATION_MAX_LENGTH} characters.` }),
    familyPosition: oneOf(family.familyPosition || '', familyPositionOptions, 'Choose your family position.'),
    numberOfSiblings: validateOptionalInteger(family.numberOfSiblings, { min: 0, max: 30, message: 'Enter the number of siblings as a whole number.' }),
  });
  return {
    values: {
      familyDetails: {
        fatherName: result.values.fatherName,
        fatherOccupation: result.values.fatherOccupation,
        fatherDeceased: Boolean(family.fatherDeceased),
        motherName: result.values.motherName,
        motherOccupation: result.values.motherOccupation,
        motherDeceased: Boolean(family.motherDeceased),
        familyPosition: result.values.familyPosition,
        numberOfSiblings: result.values.numberOfSiblings,
      },
    },
    errors: result.errors,
  };
};

export const validateAcademicSection = (form = {}, academicPrograms = []) => {
  const standing = getStandingRequirements(form.yearStanding);
  const result = collect({
    // An incoming first-year has not been issued an AdDU student number yet, so
    // only a continuing student is required to provide one.
    studentNumber: standing.requiresStudentNumber
      ? validateStudentNumber(form.studentNumber)
      : (isBlank(form.studentNumber) ? ok('') : validateStudentNumber(form.studentNumber)),
    degreeProgram: !form.degreeProgram || (academicPrograms.length && !academicPrograms.some((program) => program.value === form.degreeProgram))
      ? { value: form.degreeProgram || '', error: 'Choose your degree program.' }
      : ok(form.degreeProgram),
    yearStanding: standing.yearStanding
      ? ok(standing.yearStanding)
      : { value: form.yearStanding, error: 'Choose your year standing.' },
    academicStanding: oneOf(form.academicStanding, academicStandingOptions, 'Choose your academic standing.'),
    // An incoming first-year has no college QPI yet, so only a continuing year
    // is required to report one; a blank entry clears it.
    qpi: standing.requiresQpi ? validateQpi(form.qpi) : (isBlank(form.qpi) ? ok('') : validateQpi(form.qpi)),
    // Senior high school standing lives with the academic profile (see My
    // Profile); incoming first-years are matched on it instead of a QPI.
    hsStrand: oneOf(form.hsStrand || '', hsStrandOptions, 'Choose your senior high school strand.'),
    hsAverage: validateOptionalInteger(form.hsAverage, { min: 60, max: 100, message: 'Enter a general average from 60 to 100.' }),
    // Ranked program choices for an incoming first-year. Choice 1 is the degree
    // program above; choices 2 and 3 are optional and must differ from each other.
    programChoice2: validateOptionalProgramChoice(form.programChoice2, academicPrograms),
    programChoice3: validateOptionalProgramChoice(form.programChoice3, academicPrograms),
    // Derived so the eligibility engine keeps reading the same attributes.
    applicantType: ok(standing.applicantType),
    yearLevel: standing.yearLevel == null
      ? { value: '', error: 'Choose your year standing.' }
      : ok(standing.yearLevel),
  });

  // Incoming first-years are matched on senior high school standing rather than
  // QPI, so their strand and general average become required.
  if (standing.requiresHsStanding) {
    if (!result.values.hsStrand && !result.errors.hsStrand) result.errors.hsStrand = 'Choose your senior high school strand.';
    if (result.values.hsAverage === '' && !result.errors.hsAverage) result.errors.hsAverage = 'Add your senior high school general average.';
    // Program choices must be distinct when more than one is provided.
    if (result.values.programChoice2 && result.values.programChoice2 === result.values.degreeProgram) {
      result.errors.programChoice2 = 'Choose a different program from your 1st choice.';
    }
    if (result.values.programChoice3 && (result.values.programChoice3 === result.values.degreeProgram || result.values.programChoice3 === result.values.programChoice2)) {
      result.errors.programChoice3 = 'Choose a program different from your earlier choices.';
    }
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
    ipCommunity: oneOf(form.ipCommunity || '', ipCommunityOptions, 'Choose an IP community option.'),
    pwd: oneOf(form.pwd || '', pwdOptions, 'Choose a PWD option.'),
    employed: oneOf(form.employed || '', employmentOptions, 'Choose an employment status.'),
    honorsRank: oneOf(honorsRank, honorsRankOptions, 'Choose an honors standing.'),
    isHonorsGraduate: ok(Boolean(honorsRank)),
    graduatingClassSize: validateOptionalInteger(form.graduatingClassSize, { min: 1, max: 10000, message: 'Enter the graduating class size as a whole number.' }),
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
      yearStanding: academic.values.yearStanding,
      applicantType: academic.values.applicantType,
      yearLevel: academic.values.yearLevel,
      academicStanding: academic.values.academicStanding,
      qpi: academic.values.qpi,
      hsStrand: academic.values.hsStrand,
      hsAverage: academic.values.hsAverage,
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
  const { yearStanding, requiresStudentNumber, requiresQpi } = getStandingRequirements(profile);
  const items = [
    { key: 'fullName', label: 'Full name', section: 'personal', done: !validateFullName(profile.fullName).error },
    { key: 'phone', label: 'Philippine mobile number', section: 'personal', done: Boolean(formatPhilippineMobile(profile.phone || '')) },
  ];

  if (role === 'student') {
    items.push(
      { key: 'civilStatus', label: 'Civil status', section: 'personal', done: !isBlank(profile.civilStatus) },
      { key: 'essay', label: 'Scholarship essay', section: 'personal', done: !isBlank(profile.essay) },
      { key: 'studentNumber', label: 'AdDU student number', section: 'academic', done: !requiresStudentNumber || !validateStudentNumber(profile.studentNumber).error },
      { key: 'degreeProgram', label: 'Degree program', section: 'academic', done: !isBlank(profile.degreeProgram) },
      { key: 'yearStanding', label: 'Year standing', section: 'academic', done: Boolean(yearStanding) },
      { key: 'qpi', label: 'Annual QPI', section: 'academic', done: !requiresQpi || !validateQpi(profile.qpi).error },
      { key: 'householdIncome', label: 'Annual household income', section: 'financial', done: !validateHouseholdIncome(profile.householdIncome).error },
      { key: 'completeAddress', label: 'Complete address', section: 'address', done: !isBlank(profile.completeAddress) },
      { key: 'citizenship', label: 'Citizenship', section: 'background', done: !isBlank(profile.citizenship) },
      { key: 'ipCommunity', label: 'IP community', section: 'background', done: !isBlank(profile.ipCommunity) },
      { key: 'pwd', label: 'Person with Disability (PWD)', section: 'background', done: !isBlank(profile.pwd) },
      { key: 'employed', label: 'Employment status', section: 'background', done: !isBlank(profile.employed) },
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
