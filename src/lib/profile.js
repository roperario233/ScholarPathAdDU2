import { formatPhilippineMobile } from '../../supabase/functions/_shared/sms.js';
import { generalDocumentTypeOptions, getDocumentTypeLabel } from './constants';

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
  // FORM 230-SCH "Applicant Status": Incoming First Year, Current Ateneo Student
  // (College), or Transferee. The year standing already carries the first two, so
  // only the transferee answer is stored. It is kept apart from `yearStanding`
  // because the standing decides whether the QPI or the senior high school
  // average is read, and adding a standing value would break that branch.
  'isTransferee',
];

export const SPONSOR_TIE_KEYS = ['gsisMemberDependent', 'afpDependent', 'usVeteranDependent'];

// Descriptive profile fields that are not inputs to the Smart Eligibility
// Checker. They live on `profileDraft` locally and are mirrored to the
// `profiles.profile_details` JSON column in Supabase. Family details are stored
// as one nested object.
export const PROFILE_DETAIL_KEYS = [
  // FORM 230-SCH asks for the name as Last, First, Middle. The three parts are
  // stored alongside `fullName`, which stays the single display value on
  // `profiles.full_name` and the only name the profile gate requires, so a
  // student who has not split their name is never blocked from applying.
  'firstName',
  'middleName',
  'lastName',
  'religion',
  'civilStatus',
  'completeAddress',
  'country',
  'residingAddress',
  'sameAsCompleteAddress',
  'familyDetails',
  // FORM 230-SCH details (Application for Financial Aid). Stable facts that are
  // reused across applications; the sensitive financial ones live in the
  // office-only student_financial_profiles table instead (see financialDetails.js).
  'birthdate',
  'sexAtBirth',
  'pronouns',
  'housingType',
  'housingOther',
  'schoolLastAttended',
  'awards',
  'ipGroupName',
  'previousGrants',
  'communityService',
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

// The My Profile section that edits each eligibility field, so a failed Smart
// Eligibility Checker reason can link straight to where the student fixes it.
// The keys match the `issues[].field` tags in src/lib/eligibility.js and the
// section keys in src/pages/ProfileView.jsx.
const ACADEMIC_PROFILE_SECTION = { key: 'academic', label: 'Academic profile' };
const FINANCIAL_PROFILE_SECTION = { key: 'financial', label: 'Household and financial aid' };
const BACKGROUND_PROFILE_SECTION = { key: 'background', label: 'Eligibility background' };
export const ELIGIBILITY_FIELD_PROFILE_SECTIONS = {
  yearStanding: ACADEMIC_PROFILE_SECTION,
  degreeProgram: ACADEMIC_PROFILE_SECTION,
  academicStanding: ACADEMIC_PROFILE_SECTION,
  qpi: ACADEMIC_PROFILE_SECTION,
  hsAverage: ACADEMIC_PROFILE_SECTION,
  hsStrand: ACADEMIC_PROFILE_SECTION,
  householdIncome: FINANCIAL_PROFILE_SECTION,
  hasOtherActiveScholarship: FINANCIAL_PROFILE_SECTION,
  hasSiblingOnAid: FINANCIAL_PROFILE_SECTION,
  isOnPrepaidPlan: FINANCIAL_PROFILE_SECTION,
  citizenship: BACKGROUND_PROFILE_SECTION,
  honorsRank: BACKGROUND_PROFILE_SECTION,
  graduatingClassSize: BACKGROUND_PROFILE_SECTION,
  sponsorTies: BACKGROUND_PROFILE_SECTION,
};
export const getProfileSectionForField = (field) => (field && ELIGIBILITY_FIELD_PROFILE_SECTIONS[field]) || null;

// Profile attributes that support verification through the Document Vault. A
// student uploads one proof document for an attribute and the Admissions Office
// verifies it; the attribute state is then derived from the linked documents
// (see src/lib/verification.js). `acceptedDocumentTypes` lists the document
// types that count as proof for that attribute (values from `documentTypeOptions`
// in src/lib/constants.js), so the vault can offer the accepted types instead of
// a free-text type and title. Verification never blocks eligibility matching or
// starting an application, but a submission needs a current proof attached for
// each answer it relies on (getApplicationReadiness in applicationRequirements.js).
// QPI and income remain self-reported rather than Registrar-verified.
//
// Not every attribute needs proof. Attributes that are administrative or already
// evidenced elsewhere (AdDU student number, degree program, year standing, active
// government grant, and senior high school strand) are trusted as entered and are
// intentionally excluded here.
//
// `annual` marks an attribute whose proof only covers one academic year (the
// annual QPI and household income), so a file uploaded in an earlier academic
// year is outdated even when the declared value has not changed.
//
// `typeStanding` scopes an accepted type to one standing: a college grade
// report proves an enrolled student's QPI and academic standing, while a senior
// high school report card proves an incoming first-year's general average and
// academic standing. An unset standing accepts every listed type.
//
// `proofRequired(profile, standing)` says whether the current answer needs proof
// at all. An attribute without the rule always needs proof. `skipReason` says
// why an answer needs none, and each reason reads as its own verification state
// (deriveAttributeStatus in src/lib/verification.js) instead of one blanket
// "Not needed" that could not tell them apart:
//   - `standing`: the answer is not read for this year standing, so a QPI for an
//     incoming first-year (and a senior high school average for an enrolled
//     student) reads `Not applicable`.
//   - `claim`: the answer is recorded and claims nothing (IP community "No", PWD
//     "No", "Not employed", no honors), so it reads `No proof needed`.
//   - `unanswered`: the optional answer is still "Not specified", so no rule is
//     decided yet and it reads `Not answered`.
// An option without `skipReason` falls back to `claim`.
// `claimLabel` names the extra requirement row an application gains when the
// answer is a claim (getClaimProofRequirements in applicationRequirements.js).
//
// `value(profile)` reads the declared answer when it is not a top-level profile
// key: the residing address resolves the "same as my complete address" toggle,
// and the parents' names come from the nested family details. getAttributeValue()
// is the single accessor every attestation and staleness check reads.
//
// `compareValue: false` marks an answer a proof cannot be compared against: the
// family details are lists of names, not one recorded value. Such an answer is
// never attested, so its proof stays current until the Admissions Office reverts
// the file. The client and the database agree because document_proof_is_current()
// only compares the keys present in `attested_values`.
//
// The address and family answers are verified like the academic, financial, and
// background ones (Consultation 2): a proof of billing or a barangay certificate
// of residency proves the address, and a PSA birth certificate or the same
// certificate proves the family details. Every in-scope track asks for both
// (DEFAULT_REQUIRED_DOCUMENTS in applicationRequirements.js).
export const VERIFIABLE_ATTRIBUTE_OPTIONS = [
  {
    key: 'qpi', label: 'Annual QPI', section: 'academic', annual: true,
    acceptedDocumentTypes: ['Grade Report', 'Transcript'],
    typeStanding: { 'Grade Report': 'continuing', Transcript: 'continuing' },
    proofRequired: (_profile, standing) => !standing.isIncomingFirstYear,
    skipReason: 'standing',
    hint: 'Upload your grade report or transcript showing your annual QPI.',
  },
  {
    key: 'hsAverage', label: 'Senior high school general average', section: 'academic',
    acceptedDocumentTypes: ['HS Report Card'],
    typeStanding: { 'HS Report Card': 'incoming' },
    proofRequired: (profile, standing) => standing.isIncomingFirstYear || (!standing.yearStanding && !isBlank(profile.hsAverage)),
    // Only a continuing year skips it; with no standing chosen the answer is
    // merely unanswered, not inapplicable.
    skipReason: (profile, standing) => (standing.yearStanding ? 'standing' : 'unanswered'),
    hint: 'Upload your senior high school report card showing your general average.',
  },
  {
    key: 'academicStanding', label: 'Academic standing', section: 'academic',
    acceptedDocumentTypes: ['Grade Report', 'Transcript', 'HS Report Card'],
    typeStanding: { 'Grade Report': 'continuing', Transcript: 'continuing', 'HS Report Card': 'incoming' },
    hint: 'Upload your latest grade report or transcript (or your senior high school report card if you are an incoming first-year).',
  },
  { key: 'householdIncome', label: 'Annual household income', section: 'financial', annual: true, acceptedDocumentTypes: ['Income Proof', 'Certificate of Indigency'], hint: 'Upload your BIR-stamped ITR or a certificate of indigency.' },
  {
    key: 'employed', label: 'Employment status', section: 'financial',
    acceptedDocumentTypes: ['Certificate of Employment', 'Payslip'],
    proofRequired: (profile) => !isBlank(profile.employed) && profile.employed !== 'Not employed',
    skipReason: (profile) => (isBlank(profile.employed) ? 'unanswered' : 'claim'),
    claimLabel: 'Proof of employment',
    hint: 'Upload a certificate of employment or your latest payslip.',
  },
  {
    key: 'honorsRank', label: 'Graduation honors', section: 'background',
    acceptedDocumentTypes: ['Certificate of Award'],
    proofRequired: (profile) => !isBlank(profile.honorsRank),
    // "None" is the recorded answer for blank honors, so it needs no proof rather
    // than reading as unanswered.
    skipReason: 'claim',
    claimLabel: 'Proof of graduation honors',
    hint: 'Upload your Certificate of Award for your honors standing.',
  },
  { key: 'citizenship', label: 'Citizenship', section: 'background', acceptedDocumentTypes: ['PSA Birth Certificate', 'Philippine National ID', "Driver's License", 'Passport'], hint: 'Upload a PSA birth certificate, national ID, driver’s license, or passport showing your citizenship.' },
  {
    key: 'ipCommunity', label: 'Indigenous People (IP) community', section: 'background',
    acceptedDocumentTypes: ['Certificate of Tribal Membership'],
    proofRequired: (profile) => profile.ipCommunity === 'Yes',
    skipReason: (profile) => (isBlank(profile.ipCommunity) ? 'unanswered' : 'claim'),
    claimLabel: 'Proof of IP community membership',
    hint: 'Upload your NCIP certificate of tribal membership or equivalent.',
  },
  {
    key: 'pwd', label: 'Person with Disability (PWD)', section: 'background',
    acceptedDocumentTypes: ['PWD ID', 'Medical Certificate'],
    proofRequired: (profile) => profile.pwd === 'Yes',
    skipReason: (profile) => (isBlank(profile.pwd) ? 'unanswered' : 'claim'),
    claimLabel: 'Proof of PWD status',
    hint: 'Upload your PWD ID or medical certificate of disability.',
  },
  {
    key: 'completeAddress', label: 'Complete address', section: 'address',
    acceptedDocumentTypes: ['Proof of Billing', 'Certificate of Residency'],
    hint: 'Upload a proof of billing or a barangay certificate of residency showing the address you declared.',
  },
  {
    key: 'residingAddress', label: 'Residing address', section: 'address',
    acceptedDocumentTypes: ['Proof of Billing', 'Certificate of Residency'],
    // While the "same as my complete address" toggle is on there is only one
    // address to prove, so one file answers both attributes.
    value: (profile) => (profile.sameAsCompleteAddress === false ? profile.residingAddress : profile.completeAddress),
    hint: 'Upload a proof of billing for the address you stay at while studying.',
  },
  {
    key: 'parents', label: "Parents' names", section: 'family',
    acceptedDocumentTypes: ['PSA Birth Certificate'],
    // The names are shown to the reviewer but never compared: a birth
    // certificate is not invalidated by a corrected profile entry, and the file
    // already carries the citizenship requirement of every in-scope track.
    compareValue: false,
    value: (profile) => familyNames(profile).parents,
    hint: 'Upload your PSA birth certificate showing your parents’ names.',
  },
  {
    key: 'householdMembers', label: 'Siblings and household members', section: 'family',
    acceptedDocumentTypes: ['Certificate of Residency'],
    // A list of names, not one declared value, so it is shown but not compared.
    compareValue: false,
    value: (profile) => familyNames(profile).household,
    hint: 'Upload a barangay certificate of residency that lists the members of your household.',
  },
];

export const VERIFIABLE_ATTRIBUTE_KEYS = VERIFIABLE_ATTRIBUTE_OPTIONS.map((option) => option.key);
export const getVerifiableAttributeOption = (key) => VERIFIABLE_ATTRIBUTE_OPTIONS.find((option) => option.key === key);

// Whether a type an attribute accepts applies to the profile's standing. With no
// profile (or no standing yet) every accepted type applies.
const typeAppliesToStanding = (option, documentType, profile) => {
  const scope = option.typeStanding?.[documentType];
  if (!scope || !profile) return true;
  const standing = getStandingRequirements(profile);
  if (!standing.yearStanding) return true;
  return scope === 'incoming' ? standing.isIncomingFirstYear : standing.isContinuing;
};

// The single type-to-attribute map: the profile attributes a document of this
// type proves for this student's standing. Every upload path (the Document
// Vault, the application workspace, and the rejected-file replacement) links a
// file through this map, so the same type always proves the same answers and
// verifying it always verifies them. Mirrored by document_type_attributes() in
// supabase/migrations/20261028000000_require_current_attribute_proofs.sql.
export const getProvenAttributes = (documentType, profile = null) => (
  documentType
    ? VERIFIABLE_ATTRIBUTE_OPTIONS
      .filter((option) => option.acceptedDocumentTypes.includes(documentType) && typeAppliesToStanding(option, documentType, profile))
      .map((option) => option.key)
    : []
);

// The names the family details answer with: the parents for the birth
// certificate and the siblings plus other household adults for the barangay
// certificate. Exported so the snapshot and the reviewer pane read them the same
// way, including from a frozen application snapshot.
export const familyNames = (profile = {}) => {
  const family = profile && typeof profile === 'object' && profile.familyDetails && typeof profile.familyDetails === 'object'
    ? profile.familyDetails
    : {};
  const clean = (value) => String(value ?? '').trim();
  const joinPeople = (rows) => (Array.isArray(rows) ? rows.map((row) => clean(row?.name)).filter(Boolean).join(', ') : '');
  return {
    parents: [clean(family.fatherName), clean(family.motherName)].filter(Boolean).join(' · '),
    household: [joinPeople(family.siblings), joinPeople(family.householdAdults)].filter(Boolean).join(', '),
  };
};

// The declared answer of a verifiable attribute. Most answers are a top-level
// profile key; the residing address resolves from the address toggle and the
// family answers from the nested family details through the option's `value()`.
// Every attestation, staleness check, and reviewer value reads this accessor, so
// the client and student_profile_answers() in the database stay in step.
export const getAttributeValue = (key, profile = {}) => {
  const source = profile && typeof profile === 'object' ? profile : {};
  const option = getVerifiableAttributeOption(key);
  return option?.value ? option.value(source) : source[key];
};

// Whether a proof records the value it was uploaded to prove. An answer marked
// `compareValue: false` (the family lists) is never attested, so its proof cannot
// read Outdated: it stays a current proof until the Admissions Office reverts it.
export const isComparableAttribute = (key) => getVerifiableAttributeOption(key)?.compareValue !== false;

// Whether the student's current answer needs proof. An answer that claims
// nothing (for example IP community "No") needs no document, and an attribute
// that does not apply to the standing (a QPI for an incoming first-year) needs
// none either.
export const isProofRequired = (key, profile = {}) => {
  const option = getVerifiableAttributeOption(key);
  if (!option) return false;
  if (!option.proofRequired) return true;
  const source = profile && typeof profile === 'object' ? profile : {};
  return Boolean(option.proofRequired(source, getStandingRequirements(source)));
};

// Why the current answer needs no proof: 'standing' when the answer is not read
// for the student's year standing, 'unanswered' while an optional answer is still
// "Not specified", and 'claim' once it is recorded and asserts nothing. Null
// while proof is required, or for a key that is not a verifiable attribute.
export const getProofSkipReason = (key, profile = {}) => {
  const option = getVerifiableAttributeOption(key);
  if (!option || isProofRequired(key, profile)) return null;
  const source = profile && typeof profile === 'object' ? profile : {};
  const rule = option.skipReason;
  if (typeof rule === 'function') return rule(source, getStandingRequirements(source));
  return rule || 'claim';
};

// The claim-style attributes the student's answers currently assert (IP
// community "Yes", PWD "Yes", employed, honors). Each needs proof attached to an
// application, so the application gains one requirement row per claim.
export const getClaimedAttributes = (profile = {}) => (
  VERIFIABLE_ATTRIBUTE_OPTIONS
    .filter((option) => option.claimLabel && isProofRequired(option.key, profile))
    .map((option) => option.key)
);

// AdDU academic years start in June, so May 2027 belongs to 2026-2027. Shared by
// the annual QPI records and the annual-proof expiry in src/lib/verification.js.
export const getCurrentAcademicYear = (date = new Date()) => {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 5 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
};

const NUMERIC_VERIFIABLE_ATTRIBUTE_KEYS = ['qpi', 'hsAverage', 'householdIncome'];

// The comparable form of a declared attribute value. A vault document stores
// the value it was uploaded to prove in this form (`attestedValues`), and the
// verification helpers compare it with the current profile value the same way,
// so "3.20" and 3.2 count as the same QPI. A blank value is null.
export const normalizeAttestedValue = (key, value) => {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (NUMERIC_VERIFIABLE_ATTRIBUTE_KEYS.includes(key)) {
    const number = Number(text);
    if (!Number.isFinite(number)) return null;
    return key === 'householdIncome' ? number : Math.round(number * 100) / 100;
  }
  return text;
};

// The value a proof records at upload: the declared answer in comparable form,
// or null for an answer a proof cannot be compared against (isComparableAttribute
// is false, so nothing is attested and the database never compares it).
export const getAttestedValue = (key, profile = {}) => (
  isComparableAttribute(key) ? normalizeAttestedValue(key, getAttributeValue(key, profile)) : null
);

// The document types a profile attribute accepts as proof, shaped as picker
// options (`{ value, label }`). An unknown attribute yields an empty list. With a
// profile, types scoped to the other standing are left out.
export const getAcceptedDocumentTypes = (key, profile = null) => {
  const option = getVerifiableAttributeOption(key);
  if (!option) return [];
  return option.acceptedDocumentTypes
    .filter((value) => typeAppliesToStanding(option, value, profile))
    .map((value) => ({ value, label: getDocumentTypeLabel(value) }));
};

// The vault derives a document's title from the attribute it proves and its
// document type, so the student never types one. A general (non-attribute)
// document is titled by its document type alone.
export const getDocumentTitle = ({ attributeKey, documentType } = {}) => {
  const attribute = attributeKey ? getVerifiableAttributeOption(attributeKey) : null;
  const typeLabel = getDocumentTypeLabel(documentType);
  return attribute ? `${attribute.label} — ${typeLabel}` : typeLabel;
};

// The vault's single grouped picker encodes the chosen attribute and document
// type together as one string (`"citizenship::Passport"`, or `"::Application
// Form"` for a general document), so one selection sets both.
export const documentSelectionSeparator = '::';
export const encodeDocumentSelection = (attributeKey = '', documentType = '') =>
  `${attributeKey}${documentSelectionSeparator}${documentType}`;
export const decodeDocumentSelection = (value) => {
  const [attributeKey = '', documentType = ''] = String(value ?? '').split(documentSelectionSeparator);
  return { attributeKey, documentType };
};

// The grouped option list for the vault upload picker, mirroring the
// program/course picker in My Profile: each verifiable attribute is a group
// header with the document types it accepts listed below it, preceded by a
// "General documents" group for files that prove no profile answer. A type that
// proves an answer for this standing is listed only under its attribute, so the
// same type cannot be uploaded once as a proof and once as a plain file; when it
// also proves another answer (a grade report proves the QPI and academic
// standing) the item says so. Attributes with no type for the standing (a
// senior high school average for an enrolled student) are left out.
export const buildDocumentPickerOptions = (profile = null) => {
  const alsoProves = (documentType, key) => {
    const others = getProvenAttributes(documentType, profile).filter((other) => other !== key);
    return others.length ? ` · also proves ${others.map((other) => getVerifiableAttributeOption(other)?.label || other).join(', ')}` : '';
  };
  return [
    { value: 'group-general', label: 'General documents', isGroup: true },
    ...generalDocumentTypeOptions
      .filter((type) => !getProvenAttributes(type.value, profile).length)
      .map((type) => ({ value: encodeDocumentSelection('', type.value), label: type.label })),
    ...VERIFIABLE_ATTRIBUTE_OPTIONS.flatMap((option) => {
      const types = getAcceptedDocumentTypes(option.key, profile);
      if (!types.length) return [];
      return [
        { value: `group-${option.key}`, label: option.label, isGroup: true },
        ...types.map((type) => ({ value: encodeDocumentSelection(option.key, type.value), label: `${type.label}${alsoProves(type.value, option.key)}` })),
      ];
    }),
  ];
};

// The picker entry for a document type: under the first attribute it proves for
// this standing, otherwise as a general document.
export const getDocumentSelectionForType = (documentType, profile = null) => (
  encodeDocumentSelection(getProvenAttributes(documentType, profile)[0] || '', documentType || '')
);

export const BIO_MAX_LENGTH = 280;
export const ESSAY_MAX_LENGTH = 5000;
export const FULL_NAME_MAX_LENGTH = 100;
export const NAME_PART_MAX_LENGTH = 60;
export const PASSWORD_MIN_LENGTH = 8;

// FORM 230-SCH prints the name as "Last Name, First Name, Middle Name". The
// parts are optional details: a profile that only holds `fullName` (every account
// created before the parts existed) still applies, prints, and matches, so the
// form falls back to it whenever the parts are blank.
export const composeFullName = ({ firstName, middleName, lastName } = {}) => {
  const clean = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
  const last = clean(lastName);
  const given = [clean(firstName), clean(middleName)].filter(Boolean).join(' ');
  if (last && given) return `${last}, ${given}`;
  return last || given;
};

// Last, First Middle | First Middle Last | a single name. Returns blank parts when
// the stored value cannot be split with confidence, so the student types it once
// instead of the app guessing wrong.
export const splitLegacyFullName = (fullName) => {
  const value = String(fullName ?? '').trim().replace(/\s+/g, ' ');
  if (!value) return { firstName: '', middleName: '', lastName: '' };
  if (value.includes(',')) {
    const [lastPart, ...rest] = value.split(',');
    const given = rest.join(',').trim().split(' ');
    return {
      firstName: given[0] || '',
      middleName: given.slice(1).join(' '),
      lastName: lastPart.trim(),
    };
  }
  const words = value.split(' ');
  if (words.length < 2) return { firstName: '', middleName: '', lastName: '' };
  return {
    firstName: words[0],
    middleName: words.length > 2 ? words.slice(1, -1).join(' ') : '',
    lastName: words[words.length - 1],
  };
};


// Year standing is the single control a student picks. The eligibility engine
// and the profile gates still read the derived `applicantType` and `yearLevel`
// attributes, so `deriveYearStanding` / `resolveYearStanding` bridge the two
// directions and let records saved before this control existed keep resolving.
// An incoming first-year has no college QPI yet (its programs key off senior
// high school standing), while every continuing year reports a QPI.
//
// The labels follow the Admissions Office calendar: offers open in the summer, so
// a standing names the year the applicant is going into. A first-year applicant is
// therefore the incoming first-year, which is why `1st` is retired from the picker
// (a record saved with it still resolves — see YEAR_STANDING_LABELS). The stored
// values stay stable because the eligibility branch, the Document Vault standing
// scope, and the database checks all read them.
export const yearStandingOptions = [
  { value: 'incoming-1st', label: 'Incoming 1st year' },
  { value: '2nd', label: 'Incoming 2nd year' },
  { value: '3rd', label: 'Incoming 3rd year' },
  { value: '4th', label: 'Incoming 4th year' },
  { value: '5th', label: 'Incoming 5th year' },
];

// Every label the app can print, including the retired `1st`, so a stored profile
// or a frozen snapshot recorded before this change still shows a year.
export const YEAR_STANDING_LABELS = {
  'incoming-1st': 'Incoming 1st year',
  '1st': '1st year',
  '2nd': 'Incoming 2nd year',
  '3rd': 'Incoming 3rd year',
  '4th': 'Incoming 4th year',
  '5th': 'Incoming 5th year',
};

export const getYearStandingLabel = (value) => YEAR_STANDING_LABELS[value] || '';

// A student who is already enrolled reports the year they are going into, so
// `Incoming 1st year` belongs to the applicant status and is never offered here.
export const continuingYearStandingOptions = yearStandingOptions.filter((option) => option.value !== 'incoming-1st');

// Which standings the picker offers for an answered FORM 230-SCH applicant
// status. An incoming first-year has nothing to pick (the status already says it),
// while an unanswered status keeps the full list so a profile saved before the
// status existed is never locked out.
export const getYearStandingOptions = (applicantStatus = '') => {
  if (applicantStatus === 'incoming') return [];
  if (applicantStatus === 'current' || applicantStatus === 'transferee') return continuingYearStandingOptions;
  return yearStandingOptions;
};

const YEAR_STANDING_VALUES = new Set(['1st', ...yearStandingOptions.map((option) => option.value)]);
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
// while every continuing year reports a QPI.
export const getStandingRequirements = (value) => {
  const yearStanding = value && typeof value === 'object' ? deriveYearStanding(value) : value;
  const resolved = resolveYearStanding(yearStanding);
  const isContinuing = Boolean(resolved.yearStanding) && !resolved.isIncomingFirstYear;
  return {
    ...resolved,
    isContinuing,
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

// An AdDU student number is issued to an enrolled Ateneo student, so it is tied to
// the FORM 230-SCH applicant status rather than to the year standing alone: an
// incoming first-year has not been issued one yet, and a transferee's record
// belongs to the institution they left. My Profile therefore asks for it only for
// a current Ateneo student, and every surface (the onboarding modal, the section
// validator, the completeness gate, and the App routing gates) reads this one rule.
export const requiresStudentNumber = (profile = {}) => {
  const standing = getStandingRequirements(profile);
  return standing.isContinuing && profile.isTransferee !== 'Yes';
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

export const siblingStatusOptions = [
  { value: '', label: 'Select status' },
  { value: 'Studying', label: 'Still studying' },
  { value: 'Aged 3 or below', label: 'Aged 3 or below' },
  { value: 'Employed', label: 'Employed' },
  { value: 'Married', label: 'Married' },
];

// FORM 230-SCH personal and background options.
export const sexAtBirthOptions = [
  { value: '', label: 'Select' },
  { value: 'Female', label: 'Female' },
  { value: 'Male', label: 'Male' },
];

export const housingTypeOptions = [
  { value: '', label: 'Not applicable (I live at home)' },
  { value: 'Boarding house or dormitory', label: 'Boarding house or dormitory' },
  { value: 'With relatives', label: 'With relatives' },
  { value: 'Other', label: 'Other' },
];

export const communityServiceOptions = [
  { value: '', label: 'Select' },
  { value: 'Yes', label: 'Yes' },
  { value: 'No', label: 'No' },
];

// FORM 230-SCH "Applicant Status". The three answers are a display layer over
// `yearStanding` (Incoming 1st year, then Incoming 2nd-5th year) plus
// `isTransferee`, so the eligibility branch between the QPI and the senior high
// school average is never rewritten by a status change. The status also decides
// which of the two controls My Profile shows (see getYearStandingOptions).
export const APPLICANT_STATUS_VALUES = ['incoming', 'current', 'transferee'];
export const applicantStatusOptions = [
  { value: 'incoming', label: 'Incoming First Year' },
  { value: 'current', label: 'Current Ateneo Student (College)' },
  { value: 'transferee', label: 'Transferee' },
];

export const isTransfereeOptions = [
  { value: '', label: 'Select' },
  { value: 'No', label: 'No' },
  { value: 'Yes', label: 'Yes' },
];

export const getApplicantStatus = ({ yearStanding, isTransferee } = {}) => {
  const standing = deriveYearStanding({ yearStanding });
  if (standing === 'incoming-1st') return 'incoming';
  // A recorded transferee answer still describes the applicant while the year is
  // being re-picked, so the status control is not left blank behind it.
  if (!standing) return isTransferee === 'Yes' ? 'transferee' : '';
  return isTransferee === 'Yes' ? 'transferee' : 'current';
};

// The academic-profile draft after the applicant status changes. The status is kept
// in the draft as its own answer, so choosing Current or Transferee before a year
// is picked no longer snaps the control back to blank while the form re-derives the
// status from an unanswered standing. The year standing and the transferee answer
// move with it, so the two controls can never disagree: an incoming first-year is
// always Incoming 1st year and never a transferee, and a year the new status does
// not offer is cleared instead of guessed. Only an incoming first-year ranks a 2nd
// and 3rd program choice, so those are dropped on the way out.
export const applyApplicantStatus = (values = {}, status = '') => {
  const keepsStanding = status === 'incoming'
    ? false
    : getYearStandingOptions(status).some((option) => option.value === values.yearStanding);
  return {
    applicantStatus: status,
    yearStanding: status === 'incoming' ? 'incoming-1st' : keepsStanding ? values.yearStanding : '',
    isTransferee: status === 'transferee' ? 'Yes' : status ? 'No' : '',
    ...(status === 'incoming' ? {} : { programChoice2: '', programChoice3: '' }),
  };
};

// Answering the status by picking the year instead: the incoming standing is the
// Incoming First Year status, so the two controls stay in step either way. A
// continuing year leaves the status to the student, because only they know whether
// they are a transferee.
export const applyYearStanding = (value = '') => (
  value === 'incoming-1st'
    ? { yearStanding: value, applicantStatus: 'incoming', isTransferee: 'No' }
    : { yearStanding: value }
);

export const getApplicantStatusLabel = (profile = {}) => {
  const status = getApplicantStatus(profile);
  return applicantStatusOptions.find((option) => option.value === status)?.label || '';
};

// A transferee has already attended college, so the "School last attended" block
// records that college instead of a senior high school (FORM 230-SCH).
export const isTransfereeProfile = (profile = {}) => profile?.isTransferee === 'Yes';

export const grantTypeOptions = [
  { value: 'Government', label: 'Government (CHED, DOST, STEP, GSIS, others)' },
  { value: 'Private', label: 'Private' },
];

export const grantStatusOptions = [
  { value: 'applied', label: 'Applied for' },
  { value: 'accepted', label: 'Accepted' },
];

// FORM 230-SCH asks separately whether the applicant enjoyed financial aid in
// senior high school, applied for or received a government grant, and applied for
// or received a private one. One grant list with a level answers all three.
export const grantLevelOptions = [
  { value: 'Senior high school', label: 'Senior high school' },
  { value: 'College', label: 'College' },
  { value: 'Both', label: 'Senior high school and college' },
];

// The grants that answer "Did the applicant enjoy any form of financial aid in
// senior high school?" — a grant the student applied for or received at that level.
export const getShsFinancialAid = (previousGrants = []) => (
  Array.isArray(previousGrants)
    ? previousGrants.filter((entry) => ['Senior high school', 'Both'].includes(entry?.level))
    : []
);

export const PRONOUNS_MAX_LENGTH = 40;
export const SCHOOL_FIELD_MAX_LENGTH = 100;
export const AWARDS_MAX_LENGTH = 500;
export const MAX_SIBLING_ROWS = 15;
export const MAX_HOUSEHOLD_ADULT_ROWS = 10;
export const MAX_GRANT_ROWS = 10;

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

// `profiles.profile_details` is replaced on write, so a section save sends the
// stored detail fields merged with the section's own patch. Writing the patch
// alone would erase every other section's details on the server.
export const mergeProfileDetails = (storedProfile, detailPatch) => ({
  ...pickFields(storedProfile || {}, PROFILE_DETAIL_KEYS),
  ...detailPatch,
});

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

const HS_AVERAGE_RULE = { min: 60, max: 100, message: 'Enter a general average from 60 to 100.' };

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

// One ranked program choice excludes the programs already chosen in the other
// two slots, so an incoming first-year cannot rank the same program twice. A
// slot always keeps its own current value: SelectPicker falls back to the first
// option when the selected value is missing, which would display the wrong
// program while the student is correcting the field. Group headings whose
// programs were all hidden are dropped so the picker never shows an empty
// category. Shared by the first-login modal and the My Profile section so the
// two surfaces cannot disagree about what is still selectable.
export const getProgramChoiceOptions = (options = [], { slot = 'degreeProgram', degreeProgram = '', programChoice2 = '', programChoice3 = '' } = {}) => {
  const choices = { degreeProgram, programChoice2, programChoice3 };
  const blocked = new Set(
    Object.entries(choices)
      .filter(([key, value]) => key !== slot && value)
      .map(([, value]) => String(value).trim()),
  );
  const current = String(choices[slot] ?? '').trim();
  const kept = options.filter((option) => option.isGroup || option.value === current || !blocked.has(String(option.value).trim()));

  const result = [];
  let group = null;
  kept.forEach((option) => {
    if (option.isGroup) {
      group = option;
      return;
    }
    if (group) {
      result.push(group);
      group = null;
    }
    result.push(option);
  });
  return result;
};

// Free-text field: trims and collapses whitespace, caps the length, and treats a
// blank entry as an empty value (never a validation error).
const validateText = (raw, { max, message }) => {
  const value = String(raw ?? '').trim().replace(/\s+/g, ' ');
  return value.length > max ? { value, error: message } : ok(value);
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const todayKey = () => new Date().toISOString().slice(0, 10);

// ISO calendar date (YYYY-MM-DD) that is a real day and not in the future.
// Blank is allowed; completeness decides whether the answer is required.
export const validateOptionalDate = (raw, { label, minYear = 1930 } = {}) => {
  const value = String(raw ?? '').trim();
  if (!value) return ok('');
  const parsed = new Date(`${value}T00:00:00Z`);
  const isRealDate = DATE_PATTERN.test(value)
    && !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
  if (!isRealDate) return { value, error: `Enter ${label || 'the date'} as a valid date.` };
  if (Number(value.slice(0, 4)) < minYear || value > todayKey()) {
    return { value, error: `Enter ${label || 'the date'} as a past date.` };
  }
  return ok(value);
};

const toWholeNumber = (raw, { min, max }) => {
  if (isBlank(raw)) return { value: '', error: false };
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max
    ? { value, error: false }
    : { value: raw, error: true };
};

// Repeatable-row validator for the siblings, household adults and grants lists.
// `columns` maps a row key to its normalizer: `{ text: max }`, `{ age: true }`
// or `{ options: [...] }`. A row with every column blank is dropped. Returns the
// cleaned rows and the first error (rows are small, so one message is enough).
const validateRows = (raw, { max, label, columns, required = [] }) => {
  const rows = Array.isArray(raw) ? raw : [];
  const cleaned = [];
  let error = '';
  rows.forEach((entry, index) => {
    const row = {};
    Object.entries(columns).forEach(([key, rule]) => {
      if (rule.age) {
        const age = toWholeNumber(entry?.[key], { min: 0, max: 120 });
        row[key] = age.value;
        if (age.error && !error) error = `${label} ${index + 1}: enter the age as a whole number from 0 to 120.`;
      } else if (rule.amount) {
        // A peso amount: blank is allowed, otherwise 0 or more.
        const rawAmount = String(entry?.[key] ?? '').trim();
        if (!rawAmount) {
          row[key] = '';
        } else {
          const amount = Number(rawAmount.replace(/,/g, ''));
          row[key] = Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : rawAmount;
          if ((!Number.isFinite(amount) || amount < 0) && !error) error = `${label} ${index + 1}: enter the amount as a number of 0 or more.`;
        }
      } else if (rule.options) {
        const value = String(entry?.[key] ?? '');
        row[key] = rule.options.some((option) => option.value === value) ? value : '';
      } else {
        const text = validateText(entry?.[key], { max: rule.text, message: '' });
        row[key] = text.value.slice(0, rule.text);
        if (text.error && !error) error = `${label} ${index + 1}: keep each entry within ${rule.text} characters.`;
      }
    });
    if (Object.values(row).every((value) => value === '' || value === undefined)) return;
    const missing = required.find((key) => row[key] === '' || row[key] === undefined);
    if (missing && !error) error = `${label} ${index + 1}: fill in the ${missing === 'name' ? 'name' : missing}.`;
    cleaned.push(row);
  });
  if (cleaned.length > max && !error) error = `List at most ${max} entries.`;
  return { value: cleaned.slice(0, max), error };
};

export const validatePersonalSection = (form = {}) => {
  const bio = String(form.bio ?? '').trim();
  // The essay is longer than the bio and keeps its paragraph breaks, so it is
  // only trimmed at the edges and capped, never whitespace-collapsed.
  const essay = String(form.essay ?? '').trim();
  const result = collect({
    firstName: validateText(form.firstName, { max: NAME_PART_MAX_LENGTH, message: `Keep your first name within ${NAME_PART_MAX_LENGTH} characters.` }),
    middleName: validateText(form.middleName, { max: NAME_PART_MAX_LENGTH, message: `Keep your middle name within ${NAME_PART_MAX_LENGTH} characters.` }),
    lastName: validateText(form.lastName, { max: NAME_PART_MAX_LENGTH, message: `Keep your last name within ${NAME_PART_MAX_LENGTH} characters.` }),
    fullName: validateFullName(form.fullName),
    phone: validateMobileNumber(form.phone),
    bio: bio.length > BIO_MAX_LENGTH
      ? { value: bio, error: `Keep your bio within ${BIO_MAX_LENGTH} characters.` }
      : ok(bio),
    religion: oneOf(form.religion || '', religionOptions, 'Choose a religion option.'),
    civilStatus: oneOf(form.civilStatus || '', civilStatusOptions, 'Choose a civil status.'),
    birthdate: validateOptionalDate(form.birthdate, { label: 'your birthdate' }),
    sexAtBirth: oneOf(form.sexAtBirth || '', sexAtBirthOptions, 'Choose an option.'),
    pronouns: validateText(form.pronouns, { max: PRONOUNS_MAX_LENGTH, message: `Keep the pronouns within ${PRONOUNS_MAX_LENGTH} characters.` }),
    essay: essay.length > ESSAY_MAX_LENGTH
      ? { value: essay, error: `Keep your default statement within ${ESSAY_MAX_LENGTH} characters.` }
      : ok(essay),
  });
  // The name parts are what FORM 230-SCH prints (Last, First, Middle), so once
  // they are filled in they become the display name and `profiles.full_name`
  // never disagrees with them. A profile that only holds the single name keeps
  // working untouched.
  const composed = composeFullName(result.values);
  if (composed && !result.errors.firstName && !result.errors.lastName) {
    const composedName = validateFullName(composed);
    result.values.fullName = composedName.value;
    if (composedName.error) result.errors.fullName = composedName.error;
    else delete result.errors.fullName;
  }
  return result;
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
    housingType: oneOf(form.housingType || '', housingTypeOptions, 'Choose where you stay while studying.'),
    housingOther: validateText(form.housingOther, { max: SCHOOL_FIELD_MAX_LENGTH, message: `Keep this within ${SCHOOL_FIELD_MAX_LENGTH} characters.` }),
  });
  if (result.values.housingType === 'Other' && !result.values.housingOther && !result.errors.housingOther) {
    result.errors.housingOther = 'Describe where you stay.';
  }
  return {
    values: {
      housingType: result.values.housingType,
      housingOther: result.values.housingType === 'Other' ? result.values.housingOther : '',
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
    fatherAge: validateOptionalInteger(family.fatherAge, { min: 15, max: 120, message: 'Enter the age as a whole number from 15 to 120.' }),
    motherAge: validateOptionalInteger(family.motherAge, { min: 15, max: 120, message: 'Enter the age as a whole number from 15 to 120.' }),
    fatherDateOfDeath: validateOptionalDate(family.fatherDeceased ? family.fatherDateOfDeath : '', { label: 'the date of death' }),
    motherDateOfDeath: validateOptionalDate(family.motherDeceased ? family.motherDateOfDeath : '', { label: 'the date of death' }),
    siblings: validateRows(family.siblings, {
      max: MAX_SIBLING_ROWS,
      label: 'Sibling',
      columns: {
        name: { text: FAMILY_NAME_MAX_LENGTH },
        age: { age: true },
        relationship: { text: FAMILY_OCCUPATION_MAX_LENGTH },
        status: { options: siblingStatusOptions },
      },
      required: ['name'],
    }),
    householdAdults: validateRows(family.householdAdults, {
      max: MAX_HOUSEHOLD_ADULT_ROWS,
      label: 'Household member',
      columns: {
        name: { text: FAMILY_NAME_MAX_LENGTH },
        age: { age: true },
        relationship: { text: FAMILY_OCCUPATION_MAX_LENGTH },
      },
      required: ['name'],
    }),
  });
  return {
    values: {
      familyDetails: {
        fatherName: result.values.fatherName,
        fatherOccupation: result.values.fatherOccupation,
        fatherDeceased: Boolean(family.fatherDeceased),
        fatherAge: result.values.fatherAge,
        fatherDateOfDeath: result.values.fatherDateOfDeath,
        motherName: result.values.motherName,
        motherOccupation: result.values.motherOccupation,
        motherDeceased: Boolean(family.motherDeceased),
        motherAge: result.values.motherAge,
        motherDateOfDeath: result.values.motherDateOfDeath,
        familyPosition: result.values.familyPosition,
        numberOfSiblings: result.values.numberOfSiblings,
        siblings: result.values.siblings,
        householdAdults: result.values.householdAdults,
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
    // An AdDU student number is issued to a current Ateneo student, so only that
    // applicant status requires one; a transferee and an incoming first-year are
    // not asked, and a value they already stored is kept instead of cleared.
    studentNumber: requiresStudentNumber(form)
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
    // The strand is an incoming-first-year answer: My Profile shows it only for that
    // standing, so another standing keeps whatever it already recorded and a hidden
    // field can never fail the section.
    hsStrand: standing.requiresHsStanding
      ? oneOf(form.hsStrand || '', hsStrandOptions, 'Choose your senior high school strand.')
      : ok(hsStrandOptions.some((option) => option.value === (form.hsStrand || '')) ? (form.hsStrand || '') : ''),
    hsAverage: validateOptionalInteger(form.hsAverage, HS_AVERAGE_RULE),
    // FORM 230-SCH ranks a 1st and 2nd choice for an incoming first-year ("in case
    // there is a scholarship slot in other programs"). A student who is already
    // enrolled holds a degree program, so its pickers are not offered and any
    // inherited list is cleared instead of kept.
    programChoice2: standing.requiresProgramChoices ? validateOptionalProgramChoice(form.programChoice2, academicPrograms) : ok(''),
    programChoice3: standing.requiresProgramChoices ? validateOptionalProgramChoice(form.programChoice3, academicPrograms) : ok(''),
    // Applicant Status: a transferee already attended college. The answer is kept
    // apart from the year standing so the QPI / senior high school average branch
    // never changes. A blank answer is allowed here, like civil status and the
    // other optional selects, because the first-login modal does not ask for it;
    // the completeness checklist and the database gate require it to apply.
    // An incoming first-year is not a transferee, and an answered standing already
    // separates a current student from a transferee, so the answer is recorded
    // instead of being left blank while the control always shows one of the three.
    isTransferee: standing.isIncomingFirstYear
      ? ok('No')
      : standing.yearStanding
        ? ok(form.isTransferee === 'Yes' ? 'Yes' : 'No')
        : oneOf(form.isTransferee || '', isTransfereeOptions, 'Choose your applicant status.'),
    // FORM 230-SCH education details, stored with the descriptive profile fields.
    schoolLastAttended: ok({
      name: validateText(form.schoolLastAttended?.name, { max: SCHOOL_FIELD_MAX_LENGTH, message: '' }).value.slice(0, SCHOOL_FIELD_MAX_LENGTH),
      city: validateText(form.schoolLastAttended?.city, { max: SCHOOL_FIELD_MAX_LENGTH, message: '' }).value.slice(0, SCHOOL_FIELD_MAX_LENGTH),
      province: validateText(form.schoolLastAttended?.province, { max: SCHOOL_FIELD_MAX_LENGTH, message: '' }).value.slice(0, SCHOOL_FIELD_MAX_LENGTH),
    }),
    awards: validateText(form.awards, { max: AWARDS_MAX_LENGTH, message: `Keep the awards within ${AWARDS_MAX_LENGTH} characters.` }),
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
  }
  // An incoming first-year's program choices must be distinct from each other.
  // The comparison is trimmed so a stray space can never slip a duplicate past the
  // picker's exact-value filtering. (A non-incoming standing carries no choices,
  // so both comparisons are skipped.)
  {
    const firstChoice = String(result.values.degreeProgram ?? '').trim();
    const secondChoice = String(result.values.programChoice2 ?? '').trim();
    const thirdChoice = String(result.values.programChoice3 ?? '').trim();
    if (secondChoice && secondChoice === firstChoice) {
      result.errors.programChoice2 = 'Choose a different program from your 1st choice.';
    }
    if (thirdChoice && (thirdChoice === firstChoice || thirdChoice === secondChoice)) {
      result.errors.programChoice3 = 'Choose a program different from your earlier choices.';
    }
  }
  return result;
};

export const validateFinancialSection = (form = {}) => collect({
  householdIncome: validateHouseholdIncome(form.householdIncome),
  // Supported account field; keep it boolean, but do not require an answer.
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
    ipGroupName: form.ipCommunity === 'Yes'
      ? validateText(form.ipGroupName, { max: SCHOOL_FIELD_MAX_LENGTH, message: `Keep the group name within ${SCHOOL_FIELD_MAX_LENGTH} characters.` })
      : ok(''),
    communityService: oneOf(form.communityService || '', communityServiceOptions, 'Choose an option.'),
    previousGrants: validateRows(form.previousGrants, {
      max: MAX_GRANT_ROWS,
      label: 'Grant',
      columns: {
        type: { options: grantTypeOptions },
        name: { text: SCHOOL_FIELD_MAX_LENGTH },
        level: { options: grantLevelOptions },
        status: { options: grantStatusOptions },
        institution: { text: SCHOOL_FIELD_MAX_LENGTH },
        amount: { amount: true },
      },
      required: ['name', 'type', 'status'],
    }),
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
      // An incoming first-year ranks a 2nd and 3rd program choice alongside the
      // degree program (its 1st choice); they ride along so the onboarding modal
      // and My Profile store the same ranked list.
      programChoice2: academic.values.programChoice2,
      programChoice3: academic.values.programChoice3,
      householdIncome: financial.values.householdIncome,
      // The active-grant response is optional in the form, but its current
      // boolean value must be carried through onboarding when supplied.
      hasActiveGovernmentGrant: Boolean(form.hasActiveGovernmentGrant),
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

// The My Profile completeness checklist, split into the answers an application
// needs (`application`: read by the Smart Eligibility Checker's application gate
// and frozen in the submitted profile snapshot) and the descriptive answers no
// application requires (`details`). Items follow getStandingRequirements(): an
// incoming first-year is asked for a senior high school general average and
// strand instead of an AdDU student number and QPI, and an item that does not
// apply to the standing is left out rather than counted as done.
export const PROFILE_COMPLETENESS_GROUPS = [
  { key: 'application', label: 'Needed to apply' },
  { key: 'details', label: 'Additional details' },
];

const countDone = (items) => items.filter((item) => item.done).length;

// The profile-first gate: an application can only be started once every
// "Needed to apply" item for the student's standing is complete. Returns the
// missing items (each with its My Profile section) so the Scholarship Explorer
// can link the student straight to them. Mirrored for the in-scope tracks by
// enforce_student_application_update on insert.
const hasNumber = (value) => !isBlank(value) && Number.isFinite(Number(value)) && Number(value) >= 0;

export const PARENT_EMPLOYMENT_VALUES = ['employed', 'self-employed', 'unemployed'];
export const ECONOMIC_STATUS_VALUES = ['lower', 'middle', 'upper'];

// A parent counts as answered when marked deceased in Family details, or when
// the Household finances section records an employment status and an annual
// income (0 is valid). Mirrors parent_finances_answered() in the database.
export const isParentFinancesAnswered = (profile = {}, parent = 'father') => {
  if (profile.familyDetails?.[`${parent}Deceased`] === true) return true;
  const details = profile.financialProfile?.[parent] || {};
  return PARENT_EMPLOYMENT_VALUES.includes(details.employmentStatus) && hasNumber(details.annualIncome);
};

export const getApplicationProfileGate = (profile = {}) => {
  const missing = getProfileCompleteness(profile, 'student').items
    .filter((item) => item.group === 'application' && !item.done);
  return {
    allowed: missing.length === 0,
    missing,
    reasons: missing.length
      ? [`Complete your profile before applying: ${missing.map((item) => item.label).join(', ')}.`]
      : [],
  };
};

export const getProfileCompleteness = (profile = {}, role = 'student') => {
  const standing = getStandingRequirements(profile);
  const isStudent = role === 'student';
  const items = [];
  const add = (group, key, label, section, done) => items.push({ group, key, label, section, done: Boolean(done) });

  // Staff have no applications, so their two items are plain details.
  add(isStudent ? 'application' : 'details', 'fullName', 'Full name', 'personal', !validateFullName(profile.fullName).error);
  if (isStudent) {
    add('application', 'yearStanding', 'Year standing', 'academic', standing.yearStanding);
    // An AdDU student number is issued to a current Ateneo student, so a transferee
    // and an incoming first-year are never asked for one.
    if (requiresStudentNumber(profile)) add('application', 'studentNumber', 'AdDU student number', 'academic', !validateStudentNumber(profile.studentNumber).error);
    add('application', 'degreeProgram', standing.isIncomingFirstYear ? 'Program to be enrolled' : 'Degree program', 'academic', !isBlank(profile.degreeProgram));
    add('application', 'academicStanding', 'Academic standing', 'academic', academicStandingOptions.some((option) => option.value === profile.academicStanding));
    if (standing.requiresQpi) add('application', 'qpi', 'Annual QPI', 'academic', !validateQpi(profile.qpi).error);
    if (standing.requiresHsStanding) add('application', 'hsAverage', 'Senior high school general average', 'academic', !isBlank(profile.hsAverage) && !validateOptionalInteger(profile.hsAverage, HS_AVERAGE_RULE).error);
    add('application', 'householdIncome', 'Annual household income', 'financial', !validateHouseholdIncome(profile.householdIncome).error);
    add('application', 'citizenship', 'Citizenship', 'background', citizenshipOptions.some((option) => option.value === profile.citizenship));
    add('application', 'civilStatus', 'Civil status', 'personal', !isBlank(profile.civilStatus));
    if (standing.requiresHsStanding) add('application', 'hsStrand', 'Senior high school strand', 'academic', !isBlank(profile.hsStrand));
    add('application', 'completeAddress', 'Complete address', 'address', !isBlank(profile.completeAddress));
    add('application', 'ipCommunity', 'IP community', 'background', !isBlank(profile.ipCommunity));
    add('application', 'pwd', 'Person with Disability (PWD)', 'background', !isBlank(profile.pwd));
    add('application', 'employed', 'Employment status', 'background', !isBlank(profile.employed));
    // FORM 230-SCH Applicant Status. The year standing already answers "Incoming
    // First Year" and "Current Ateneo Student (College)", so the new answer only
    // distinguishes a transferee from a current student.
    add('application', 'applicantStatus', 'Applicant status', 'academic', isTransfereeOptions.some((option) => option.value && option.value === profile.isTransferee));
    // FORM 230-SCH core answers. The financial ones come from the office-only
    // student_financial_profiles row, merged into `profile.financialProfile`.
    add('application', 'birthdate', 'Birthdate', 'personal', DATE_PATTERN.test(String(profile.birthdate || '')));
    add('application', 'sexAtBirth', 'Sex assigned at birth', 'personal', sexAtBirthOptions.some((option) => option.value && option.value === profile.sexAtBirth));
    if (standing.requiresHsStanding || isTransfereeProfile(profile)) {
      add('application', 'schoolLastAttended', isTransfereeProfile(profile) ? 'College last attended' : 'Senior high school last attended', 'academic', !isBlank(profile.schoolLastAttended?.name));
    }
    add('application', 'communityService', 'Willingness to render community service', 'background', communityServiceOptions.some((option) => option.value && option.value === profile.communityService));
    add('application', 'economicStatus', 'Perceived economic status', 'finances', ECONOMIC_STATUS_VALUES.includes(profile.financialProfile?.economicStatus));
    add('application', 'fatherFinances', 'Father\'s employment and income', 'finances', isParentFinancesAnswered(profile, 'father'));
    add('application', 'motherFinances', 'Mother\'s employment and income', 'finances', isParentFinancesAnswered(profile, 'mother'));
  }
  // The application form asks every applicant for a contact number, so it is
  // needed to apply; staff keep it as a plain detail.
  add(isStudent ? 'application' : 'details', 'phone', 'Philippine mobile number', 'personal', formatPhilippineMobile(profile.phone || ''));
  if (isStudent) {
  }

  const groups = PROFILE_COMPLETENESS_GROUPS
    .map((group) => {
      const groupItems = items.filter((item) => item.group === group.key);
      return { ...group, items: groupItems, completed: countDone(groupItems), total: groupItems.length };
    })
    .filter((group) => group.total > 0);
  const completed = countDone(items);
  return {
    standing,
    items,
    groups,
    completed,
    total: items.length,
    percent: Math.round((completed / items.length) * 100),
  };
};
