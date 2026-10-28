import { describe, expect, it } from 'vitest';
import {
  applyApplicantStatus,
  applyYearStanding,
  composeFullName,
  deriveYearStanding,
  getApplicantStatus,
  getApplicantStatusLabel,
  getApplicationProfileGate,
  getClaimedAttributes,
  getCurrentAcademicYear,
  getProgramChoiceOptions,
  getProofSkipReason,
  getShsFinancialAid,
  getYearStandingLabel,
  getYearStandingOptions,
  isParentFinancesAnswered,
  isGrantListActive,
  isProofRequired,
  isTransfereeProfile,
  getProfileCompleteness,
  normalizeAttestedValue,
  getStandingRequirements,
  mergeProfileDetails,
  pickEligibilityAttributes,
  pickFields,
  resolveYearStanding,
  requiresStudentNumber,
  splitLegacyFullName,
  validateAcademicSection,
  validateAddressSection,
  validateBackgroundSection,
  validateFamilySection,
  validateOptionalDate,
  validateFinancialSection,
  validateMobileNumber,
  validateOnboardingEssentials,
  validatePasswordChange,
  validatePersonalSection,
  validateQpi,
  yearStandingOptions,
} from '../src/lib/profile';
import { checkAdduInternalGate } from '../src/lib/eligibility';

const programs = [{ value: 'BS Information Technology', label: 'BS Information Technology', department: 'College of Computer Studies (CCS)', category: 'Computer Studies' }];

// Minimal fixtures for the completeness tests. They replace the demo-user
// records that were removed along with demo mode.
const studentProfile = {
  fullName: 'Eriel John Espinosa',
  phone: '+63 912 345 6789',
  degreeProgram: 'BS Information Technology',
  yearStanding: '2nd',
  qpi: 2.86,
  householdIncome: 240000,
  citizenship: 'Filipino',
};
const chairProfile = {
  fullName: 'Department Chair',
  phone: '+63 918 000 0000',
};

// The FORM 230-SCH "Needed to apply" answers: applicant status, birthdate, sex,
// school, community service, and the office-only household finances merged in as
// financialProfile.
const formCore = {
  civilStatus: 'Single',
  completeAddress: '123 Rizal St, Davao City',
  ipCommunity: 'No',
  pwd: 'No',
  employed: 'Not employed',
  isTransferee: 'No',
  phone: '0917 123 4567',
  hsStrand: 'STEM',
  birthdate: '2005-04-12',
  sexAtBirth: 'Female',
  communityService: 'Yes',
  schoolLastAttended: { name: 'Davao Senior High School', city: 'Davao City', province: 'Davao del Sur' },
  financialProfile: {
    economicStatus: 'lower',
    father: { employmentStatus: 'employed', annualIncome: 120000 },
    mother: { employmentStatus: 'unemployed', annualIncome: 0 },
  },
};

describe('field validators', () => {
  it('rounds QPI to two decimals and rejects values outside 0.00–4.00', () => {
    expect(validateQpi('3.256')).toEqual({ value: 3.26, error: '' });
    expect(validateQpi('4.5').error).toMatch(/0\.00 to 4\.00/);
    expect(validateQpi('').error).toBeTruthy();
  });

  it('treats a blank mobile number as cleared and formats valid Philippine numbers', () => {
    expect(validateMobileNumber('  ')).toEqual({ value: null, error: '' });
    expect(validateMobileNumber('09171234567')).toEqual({ value: '+63 917 123 4567', error: '' });
    expect(validateMobileNumber('12345').error).toMatch(/Philippine mobile/);
  });
});

describe('FORM 230-SCH applicant status and name parts', () => {
  it('composes the printed name as Last, First Middle', () => {
    expect(composeFullName({ lastName: ' Dela  Cruz ', firstName: 'Juan', middleName: 'Santos' })).toBe('Dela Cruz, Juan Santos');
    expect(composeFullName({ lastName: 'Dela Cruz', firstName: 'Juan', middleName: '' })).toBe('Dela Cruz, Juan');
    expect(composeFullName({ firstName: 'Juan' })).toBe('Juan');
    expect(composeFullName({})).toBe('');
  });

  it('splits only an unambiguous stored name', () => {
    expect(splitLegacyFullName('Dela Cruz, Juan Santos')).toEqual({ firstName: 'Juan', middleName: 'Santos', lastName: 'Dela Cruz' });
    expect(splitLegacyFullName('Juan Dela Cruz')).toEqual({ firstName: 'Juan', middleName: 'Dela', lastName: 'Cruz' });
    expect(splitLegacyFullName('Prince')).toEqual({ firstName: '', middleName: '', lastName: '' });
  });

  it('lets the name parts become the display name without breaking the single name', () => {
    const withParts = validatePersonalSection({ fullName: 'Old Name', lastName: 'Reyes', firstName: 'Ana', middleName: 'Cruz' });
    expect(withParts.errors).toEqual({});
    expect(withParts.values.fullName).toBe('Reyes, Ana Cruz');
    // A profile that only holds the single name is untouched.
    expect(validatePersonalSection({ fullName: 'Ana Reyes' }).values.fullName).toBe('Ana Reyes');
  });

  it('derives the applicant status from the standing and the transferee answer', () => {
    expect(getApplicantStatus({ yearStanding: 'incoming-1st' })).toBe('incoming');
    expect(getApplicantStatus({ yearStanding: '2nd', isTransferee: 'No' })).toBe('current');
    expect(getApplicantStatus({ yearStanding: '2nd', isTransferee: 'Yes' })).toBe('transferee');
    expect(getApplicantStatus({})).toBe('');
    // The answer survives while the year is being re-picked.
    expect(getApplicantStatus({ isTransferee: 'Yes' })).toBe('transferee');
    expect(getApplicantStatus({ isTransferee: 'No' })).toBe('');
    expect(getApplicantStatusLabel({ yearStanding: '2nd', isTransferee: 'Yes' })).toBe('Transferee');
    expect(isTransfereeProfile({ isTransferee: 'Yes' })).toBe(true);
  });

  it('keeps the applicant status out of the first-login essentials but in the gate', () => {
    const onboarding = validateOnboardingEssentials({
      studentNumber: '2023001', degreeProgram: 'BS Information Technology', yearStanding: '2nd',
      academicStanding: 'good', qpi: '3.1', householdIncome: '180000', citizenship: 'Filipino', phone: '0917 123 4567',
    }, programs);
    expect(onboarding.errors).toEqual({});
    const missing = getApplicationProfileGate({
      fullName: 'Ana Reyes', yearStanding: '2nd', studentNumber: '202300001', degreeProgram: 'BS Information Technology',
      academicStanding: 'good', qpi: 3.2, householdIncome: 180000, citizenship: 'Filipino', ...formCore, isTransferee: '',
    }).missing.map((item) => item.key);
    expect(missing).toEqual(['applicantStatus']);
  });

  it('asks a transferee for the college last attended', () => {
    const completeTransferee = {
      fullName: 'Ana Reyes', yearStanding: '2nd', studentNumber: '202300001', degreeProgram: 'BS Information Technology',
      academicStanding: 'good', qpi: 3.2, householdIncome: 180000, citizenship: 'Filipino',
      ...formCore, isTransferee: 'Yes', schoolLastAttended: { name: '' },
    };
    const gate = getApplicationProfileGate(completeTransferee);
    expect(gate.missing.map((item) => [item.key, item.label])).toEqual([['schoolLastAttended', 'College last attended']]);
  });

  it('finds the senior high school grants', () => {
    const grants = [
      { name: 'CHED', level: 'Senior high school' },
      { name: 'DOST', level: 'College' },
      { name: 'SHS voucher', level: 'Both' },
    ];
    expect(getShsFinancialAid(grants).map((entry) => entry.name)).toEqual(['CHED', 'SHS voucher']);
    expect(getShsFinancialAid(undefined)).toEqual([]);
  });
});

describe('section validators', () => {
  it('normalizes personal information and requires a full name', () => {
    const valid = validatePersonalSection({ fullName: '  Ana   Cruz ', phone: '0917 123 4567', religion: 'Roman Catholic', civilStatus: 'Single' });
    expect(valid.errors).toEqual({});
    expect(valid.values).toEqual({ firstName: '', middleName: '', lastName: '', fullName: 'Ana Cruz', phone: '+63 917 123 4567', religion: 'Roman Catholic', civilStatus: 'Single', birthdate: '', sexAtBirth: '', pronouns: '', essay: '' });

    expect(validatePersonalSection({ fullName: 'A' }).errors).toMatchObject({
      fullName: expect.any(String),
    });
    // An unknown religion or civil status is rejected.
    expect(validatePersonalSection({ fullName: 'Ana Cruz', religion: 'Jedi', civilStatus: 'Single' }).errors.religion).toBeTruthy();
  });

  it('keeps paragraph breaks in the statement/essay and enforces the cap', () => {
    const kept = validatePersonalSection({ fullName: 'Ana Cruz', essay: '  First paragraph.\n\nSecond paragraph.  ' });
    expect(kept.errors).toEqual({});
    expect(kept.values.essay).toBe('First paragraph.\n\nSecond paragraph.');

    expect(validatePersonalSection({ fullName: 'Ana Cruz', essay: 'x'.repeat(5001) }).errors.essay).toMatch(/default statement/);
  });

  it('resolves the residing address from the same-as-complete-address toggle', () => {
    const mirrored = validateAddressSection({ completeAddress: '123 Rizal St, Davao City', country: 'Philippines', sameAsCompleteAddress: true, residingAddress: 'ignored' });
    expect(mirrored.errors).toEqual({});
    expect(mirrored.values).toMatchObject({ completeAddress: '123 Rizal St, Davao City', country: 'Philippines', sameAsCompleteAddress: true, residingAddress: '123 Rizal St, Davao City' });

    const separate = validateAddressSection({ completeAddress: '123 Rizal St', country: 'Philippines', sameAsCompleteAddress: false, residingAddress: '  Boarding house, Davao City  ' });
    expect(separate.errors).toEqual({});
    expect(separate.values.residingAddress).toBe('Boarding house, Davao City');

    expect(validateAddressSection({ completeAddress: 'x'.repeat(241) }).errors.completeAddress).toBeTruthy();
  });

  it('normalizes family details and validates the sibling count', () => {
    const result = validateFamilySection({
      familyDetails: { fatherName: '  Roberto   Espinosa ', fatherOccupation: 'Fisherman', fatherDeceased: false, motherName: 'Liza Espinosa', motherDeceased: true, familyPosition: 'Eldest', numberOfSiblings: '2' },
    });
    expect(result.errors).toEqual({});
    expect(result.values.familyDetails).toEqual({
      fatherName: 'Roberto Espinosa',
      fatherOccupation: 'Fisherman',
      fatherDeceased: false,
      fatherAge: '',
      fatherDateOfDeath: '',
      motherName: 'Liza Espinosa',
      motherOccupation: '',
      motherDeceased: true,
      motherAge: '',
      motherDateOfDeath: '',
      familyPosition: 'Eldest',
      numberOfSiblings: 2,
      siblings: [],
      householdAdults: [],
    });
    expect(validateFamilySection({ familyDetails: { familyPosition: 'First born' } }).errors.familyPosition).toBeTruthy();
    expect(validateFamilySection({ familyDetails: { numberOfSiblings: 'lots' } }).errors.numberOfSiblings).toBeTruthy();
  });

  it('validates the FORM 230-SCH personal details', () => {
    const valid = validatePersonalSection({ fullName: 'Ana Cruz', birthdate: '2005-04-12', sexAtBirth: 'Female', pronouns: '  she/her ' });
    expect(valid.errors).toEqual({});
    expect(valid.values).toMatchObject({ birthdate: '2005-04-12', sexAtBirth: 'Female', pronouns: 'she/her' });

    expect(validatePersonalSection({ fullName: 'Ana Cruz', birthdate: '2005-02-31' }).errors.birthdate).toBeTruthy();
    expect(validatePersonalSection({ fullName: 'Ana Cruz', birthdate: '2999-01-01' }).errors.birthdate).toBeTruthy();
    expect(validatePersonalSection({ fullName: 'Ana Cruz', sexAtBirth: 'Other' }).errors.sexAtBirth).toBeTruthy();
    expect(validateOptionalDate('').error).toBe('');
  });

  it('keeps the housing detail only for the Other option', () => {
    const other = validateAddressSection({ completeAddress: 'x', housingType: 'Other', housingOther: ' Rented room ' });
    expect(other.errors).toEqual({});
    expect(other.values).toMatchObject({ housingType: 'Other', housingOther: 'Rented room' });
    expect(validateAddressSection({ completeAddress: 'x', housingType: 'Other', housingOther: '' }).errors.housingOther).toBeTruthy();
    expect(validateAddressSection({ completeAddress: 'x', housingType: 'With relatives', housingOther: 'ignored' }).values.housingOther).toBe('');
    expect(validateAddressSection({ completeAddress: 'x', housingType: 'Castle' }).errors.housingType).toBeTruthy();
  });

  it('cleans the sibling and household member lists and drops blank rows', () => {
    const result = validateFamilySection({
      familyDetails: {
        fatherDeceased: true,
        fatherDateOfDeath: '2020-05-01',
        fatherAge: '60',
        siblings: [
          { name: '  Mika  Cruz ', age: '12', relationship: 'Sister', status: 'Studying' },
          { name: '', age: '', relationship: '', status: '' },
          { name: 'Paolo', age: '3', status: 'Aged 3 or below' },
        ],
        householdAdults: [{ name: 'Lola Ana', age: '70', relationship: 'Grandmother' }],
      },
    });
    expect(result.errors).toEqual({});
    expect(result.values.familyDetails.siblings).toEqual([
      { name: 'Mika Cruz', age: 12, relationship: 'Sister', status: 'Studying' },
      { name: 'Paolo', age: 3, relationship: '', status: 'Aged 3 or below' },
    ]);
    expect(result.values.familyDetails.householdAdults).toEqual([{ name: 'Lola Ana', age: 70, relationship: 'Grandmother' }]);
    // The date of death only counts for a deceased parent; the age is ignored text for the living.
    expect(result.values.familyDetails.fatherDateOfDeath).toBe('2020-05-01');
    expect(validateFamilySection({ familyDetails: { motherDeceased: false, motherDateOfDeath: '2020-05-01' } }).values.familyDetails.motherDateOfDeath).toBe('');
    expect(validateFamilySection({ familyDetails: { siblings: [{ name: 'Mika', age: '200' }] } }).errors.siblings).toMatch(/Sibling 1/);
    expect(validateFamilySection({ familyDetails: { siblings: [{ name: '', age: '9' }] } }).errors.siblings).toMatch(/name/);
  });

  it('validates the education, IP group, community service and grants answers', () => {
    const academic = validateAcademicSection({
      yearStanding: '2nd', degreeProgram: 'BS Information Technology', academicStanding: 'good', studentNumber: '2023001', qpi: '3',
      schoolLastAttended: { name: ' Davao SHS ', city: 'Davao City', province: '' }, awards: ' With honors ',
    }, programs);
    expect(academic.values.schoolLastAttended).toEqual({ name: 'Davao SHS', city: 'Davao City', province: '' });
    expect(academic.values.awards).toBe('With honors');

    const background = validateBackgroundSection({
      citizenship: 'Filipino', householdIncome: '240000', ipCommunity: 'Yes', ipGroupName: ' Bagobo ', communityService: 'Yes',
      previousGrants: [{ type: 'Government', name: 'CHED', status: 'applied', institution: '' }, { type: '', name: '', status: '', institution: '' }],
    });
    expect(background.errors).toEqual({});
    expect(background.values).toMatchObject({ ipGroupName: 'Bagobo', communityService: 'Yes' });
    expect(background.values.previousGrants).toEqual([{ type: 'Government', name: 'CHED', level: '', status: 'applied', institution: '', amount: '' }]);
    expect(validateBackgroundSection({ citizenship: 'Filipino', ipCommunity: 'No', ipGroupName: 'Bagobo' }).values.ipGroupName).toBe('');
    expect(validateBackgroundSection({ citizenship: 'Filipino', previousGrants: [{ name: 'DOST' }] }).errors.previousGrants).toMatch(/Grant 1/);
  });

  it('derives applicant type and year level from the year standing', () => {
    const base = { degreeProgram: 'BS Information Technology', academicStanding: 'good' };
    const incoming = validateAcademicSection({ ...base, studentNumber: '', yearStanding: 'incoming-1st', hsStrand: 'STEM', hsAverage: '94', qpi: '' }, programs);
    expect(incoming.errors).toEqual({});
    expect(incoming.values).toMatchObject({ yearStanding: 'incoming-1st', applicantType: 'first-year', yearLevel: 1, qpi: '' });

    const continuing = validateAcademicSection({ ...base, studentNumber: '2023001', yearStanding: '3rd', qpi: '3.1' }, programs);
    expect(continuing.errors).toEqual({});
    expect(continuing.values).toMatchObject({ yearStanding: '3rd', applicantType: 'current', yearLevel: 3, qpi: 3.1 });

    // A continuing student must report a QPI and an AdDU student number; an
    // incoming first-year must report senior high school standing instead.
    expect(validateAcademicSection({ ...base, studentNumber: '2023001', yearStanding: '2nd', qpi: '' }, programs).errors.qpi).toBeTruthy();
    expect(validateAcademicSection({ ...base, studentNumber: '', yearStanding: '2nd', qpi: '3.1' }, programs).errors.studentNumber).toBeTruthy();
    expect(validateAcademicSection({ ...base, studentNumber: '', yearStanding: 'incoming-1st', qpi: '' }, programs).errors.hsAverage).toBeTruthy();
    expect(validateAcademicSection({ ...base, studentNumber: '2023001', yearStanding: '2nd', qpi: '3.1', hsStrand: 'x' }, programs).errors.hsStrand).toBeUndefined();
    // The strand is asked only of an incoming first-year, and only there is it
    // validated; another standing keeps a valid recorded answer.
    expect(validateAcademicSection({ ...base, yearStanding: 'incoming-1st', hsStrand: 'x', hsAverage: '94' }, programs).errors.hsStrand).toBeTruthy();
    expect(validateAcademicSection({ ...base, studentNumber: '2023001', yearStanding: '2nd', qpi: '3.1', isTransferee: 'No', hsStrand: 'STEM' }, programs).values.hsStrand).toBe('STEM');
    expect(validateAcademicSection({ ...base, studentNumber: '', yearStanding: '' }, programs).errors.yearStanding).toBeTruthy();
    expect(validateAcademicSection({ ...base, degreeProgram: 'BS Unknown', studentNumber: '', yearStanding: 'incoming-1st', hsStrand: 'STEM', hsAverage: '94', qpi: '' }, programs).errors.degreeProgram).toBeTruthy();
  });

  it('validates ranked program choices for incoming first-years', () => {
    const base = { degreeProgram: 'BS Information Technology', academicStanding: 'good', studentNumber: '', yearStanding: 'incoming-1st', hsStrand: 'STEM', hsAverage: '94', qpi: '' };
    const choices = [
      ...programs,
      { value: 'BS Computer Science', label: 'BS Computer Science', department: 'College of Computer Studies (CCS)', category: 'Computer Studies' },
      { value: 'BS Accountancy', label: 'BS Accountancy', department: 'School of Business and Governance (SBG)', category: 'Business' },
    ];
    // Only a known program can be chosen.
    expect(validateAcademicSection({ ...base, programChoice2: 'BS Unknown' }, choices).errors.programChoice2).toBeTruthy();
    // Each ranked choice must differ from the ones before it.
    expect(validateAcademicSection({ ...base, programChoice2: 'BS Information Technology' }, choices).errors.programChoice2).toBeTruthy();
    expect(validateAcademicSection({ ...base, programChoice2: 'BS Computer Science', programChoice3: 'BS Information Technology' }, choices).errors.programChoice3).toBeTruthy();
    expect(validateAcademicSection({ ...base, programChoice2: 'BS Computer Science', programChoice3: 'BS Computer Science' }, choices).errors.programChoice3).toBeTruthy();
    // A padded duplicate is still a duplicate.
    expect(validateAcademicSection({ ...base, programChoice2: '  BS Information Technology  ' }, choices).errors.programChoice2).toBeTruthy();
    // Three distinct choices pass.
    const ranked = validateAcademicSection({ ...base, programChoice2: 'BS Computer Science', programChoice3: 'BS Accountancy' }, choices);
    expect(ranked.errors).toEqual({});
    expect(ranked.values).toMatchObject({ programChoice2: 'BS Computer Science', programChoice3: 'BS Accountancy' });
    // Only an incoming first-year ranks a 2nd and 3rd choice, so a continuing
    // student's inherited list is cleared instead of validated or kept.
    const continuing = validateAcademicSection({ degreeProgram: 'BS Information Technology', academicStanding: 'good', studentNumber: '2023001', yearStanding: '3rd', qpi: '3.1', programChoice2: 'BS Computer Science', programChoice3: 'BS Accountancy' }, choices);
    expect(continuing.errors.programChoice2).toBeUndefined();
    expect(continuing.values).toMatchObject({ programChoice2: '', programChoice3: '' });
    const duplicated = validateAcademicSection({ degreeProgram: 'BS Information Technology', academicStanding: 'good', studentNumber: '2023001', yearStanding: '3rd', qpi: '3.1', programChoice2: 'BS Information Technology' }, choices);
    expect(duplicated.errors.programChoice2).toBeUndefined();
    expect(duplicated.values.programChoice2).toBe('');
  });

  it('offers only the programs not already chosen in another slot', () => {
    const options = [
      { value: 'group-Computer Studies', label: 'Computer Studies', isGroup: true },
      { value: 'BS Information Technology', label: 'BS Information Technology' },
      { value: 'BS Computer Science', label: 'BS Computer Science' },
      { value: 'group-Business', label: 'Business', isGroup: true },
      { value: 'BS Accountancy', label: 'BS Accountancy' },
    ];
    const selections = { degreeProgram: 'BS Information Technology', programChoice2: 'BS Computer Science', programChoice3: '' };
    const valuesOf = (list) => list.filter((option) => !option.isGroup).map((option) => option.value);

    // The 2nd and 3rd choice hide the program already used as the 1st choice.
    expect(valuesOf(getProgramChoiceOptions(options, { slot: 'programChoice2', ...selections }))).toEqual(['BS Computer Science', 'BS Accountancy']);
    expect(valuesOf(getProgramChoiceOptions(options, { slot: 'programChoice3', ...selections }))).toEqual(['BS Accountancy']);
    // The 1st choice hides the program already used as the 2nd choice.
    expect(valuesOf(getProgramChoiceOptions(options, { slot: 'degreeProgram', ...selections }))).toEqual(['BS Information Technology', 'BS Accountancy']);
    // A slot always keeps its own current value, so the picker never shows the
    // wrong program while the field is being corrected.
    const corrected = { degreeProgram: 'BS Information Technology', programChoice2: 'BS Information Technology', programChoice3: '' };
    expect(valuesOf(getProgramChoiceOptions(options, { slot: 'programChoice2', ...corrected }))).toEqual(['BS Information Technology', 'BS Computer Science', 'BS Accountancy']);
    // Group headings survive only when one of their programs is still selectable.
    expect(getProgramChoiceOptions(options, { slot: 'programChoice3', degreeProgram: 'BS Information Technology', programChoice2: 'BS Computer Science', programChoice3: '' }).map((option) => option.value)).toEqual(['group-Business', 'BS Accountancy']);
    // With no other choices made, a slot still lists every program.
    expect(valuesOf(getProgramChoiceOptions(options, { slot: 'programChoice3' }))).toHaveLength(3);
    // Once all three slots are filled, each slot keeps only its own value.
    expect(valuesOf(getProgramChoiceOptions(options, { slot: 'programChoice3', degreeProgram: 'BS Information Technology', programChoice2: 'BS Computer Science', programChoice3: 'BS Accountancy' }))).toEqual(['BS Accountancy']);
  });

  it('keeps financial flags boolean so the Exclusion Flag Hierarchy reads them directly', () => {
    const { values, errors } = validateFinancialSection({ householdIncome: '240000', isOnPrepaidPlan: 1 });
    expect(errors).toEqual({});
    expect(values).toEqual({
      householdIncome: 240000,
      hasActiveGovernmentGrant: false,
      hasOtherActiveScholarship: false,
      hasSiblingOnAid: false,
      isOnPrepaidPlan: true,
    });
    expect(checkAdduInternalGate(values).passed).toBe(false);
  });

  it('derives honors graduate status and requires a class size for an honors standing', () => {
    const honors = validateBackgroundSection({ citizenship: 'Filipino', honorsRank: 'Valedictorian', graduatingClassSize: '' });
    expect(honors.errors.graduatingClassSize).toBeTruthy();

    const valid = validateBackgroundSection({ citizenship: 'Filipino', householdIncome: '240000', honorsRank: 'Salutatorian', graduatingClassSize: '120', sponsorTies: { afpDependent: true } });
    expect(valid.errors).toEqual({});
    expect(valid.values).toMatchObject({
      isHonorsGraduate: true,
      graduatingClassSize: 120,
      sponsorTies: { gsisMemberDependent: false, afpDependent: true, usVeteranDependent: false },
    });
    // Senior high school standing now lives with the academic profile.
    expect(valid.values).not.toHaveProperty('hsAverage');
  });

  it('edits the household income and the exclusion answers in Eligibility background', () => {
    const background = validateBackgroundSection({ citizenship: 'Filipino', householdIncome: '240000', hasActiveGovernmentGrant: true });
    expect(background.errors.householdIncome).toBeUndefined();
    expect(background.values).toMatchObject({ householdIncome: 240000, hasActiveGovernmentGrant: true });
    // Income is still needed to apply, and it is now a background answer.
    expect(validateBackgroundSection({ citizenship: 'Filipino', householdIncome: '' }).errors.householdIncome).toBeTruthy();
    expect(getProfileCompleteness({ householdIncome: 240000 }).items.find((item) => item.key === 'householdIncome').section).toBe('background');
  });

  it('opens the grant list only for the answers that say the student receives aid', () => {
    expect(isGrantListActive({})).toBe(false);
    expect(isGrantListActive({ hasActiveGovernmentGrant: true })).toBe(true);
    expect(isGrantListActive({ hasOtherActiveScholarship: true })).toBe(true);
    expect(isGrantListActive({ isOnPrepaidPlan: true })).toBe(true);
    // A sibling on AdDU financial aid is about the sibling, not the applicant.
    expect(isGrantListActive({ hasSiblingOnAid: true })).toBe(false);
    // A saved row keeps the list open, so a recorded grant never becomes unreachable.
    expect(isGrantListActive({ previousGrants: [{ name: 'CHED' }] })).toBe(true);
  });

  it('requires at least one grant while the list is open', () => {
    const open = validateBackgroundSection({ citizenship: 'Filipino', householdIncome: '240000', hasOtherActiveScholarship: true });
    expect(open.errors.previousGrants).toMatch(/at least one grant/);

    const completed = validateBackgroundSection({
      citizenship: 'Filipino',
      householdIncome: '240000',
      isOnPrepaidPlan: true,
      previousGrants: [{ type: 'Government', name: 'CHED', status: 'accepted', institution: 'CHED', amount: '12000' }],
    });
    expect(completed.errors).toEqual({});
    expect(completed.values.previousGrants).toEqual([{ type: 'Government', name: 'CHED', level: '', status: 'accepted', institution: 'CHED', amount: 12000 }]);
  });

  it('never asks for a grant when no aid answer is on', () => {
    const closed = validateBackgroundSection({ citizenship: 'Filipino', householdIncome: '240000', hasSiblingOnAid: true });
    expect(closed.errors.previousGrants).toBeUndefined();
    expect(closed.values.previousGrants).toEqual([]);
  });

  it('requires a matching password with letters and numbers', () => {
    expect(validatePasswordChange({ password: 'abc12345', confirmPassword: 'abc12345' }).errors).toEqual({});
    expect(validatePasswordChange({ password: 'short1', confirmPassword: 'short1' }).errors.password).toBeTruthy();
    expect(validatePasswordChange({ password: 'abc12345', confirmPassword: 'abc12346' }).errors.confirmPassword).toBeTruthy();
  });
});

describe('year standing', () => {
  it('derives a single standing from legacy attributes and expands it back', () => {
    expect(deriveYearStanding({ applicantType: 'first-year', yearLevel: 1 })).toBe('incoming-1st');
    expect(deriveYearStanding({ applicantType: 'current', yearLevel: 3 })).toBe('3rd');
    expect(deriveYearStanding({ yearStanding: '5th', applicantType: 'current', yearLevel: 2 })).toBe('5th');
    expect(deriveYearStanding({})).toBe('');

    expect(resolveYearStanding('incoming-1st')).toMatchObject({ isIncomingFirstYear: true, applicantType: 'first-year', yearLevel: 1 });
    expect(resolveYearStanding('4th')).toMatchObject({ isIncomingFirstYear: false, applicantType: 'current', yearLevel: 4 });
    expect(resolveYearStanding('')).toMatchObject({ yearStanding: '', yearLevel: null });
  });

  it('reports what each standing requires in one place', () => {
    expect(getStandingRequirements('incoming-1st')).toMatchObject({ requiresQpi: false, requiresHsStanding: true, requiresProgramChoices: true, programLabel: 'Program / Course (to be enrolled)' });
    expect(getStandingRequirements('4th')).toMatchObject({ yearStanding: '4th', requiresQpi: true, requiresHsStanding: false, requiresProgramChoices: false, programLabel: 'Program / Course' });
    // Accepts a profile-shaped object too, for the routing gates.
    expect(getStandingRequirements({ applicantType: 'current', yearLevel: 3 })).toMatchObject({ yearStanding: '3rd', requiresProgramChoices: false });
    // An unanswered standing requires nothing yet, so no standing-specific field
    // shows before the student picks one.
    expect(getStandingRequirements('')).toMatchObject({ yearStanding: '', requiresQpi: false, requiresHsStanding: false, requiresProgramChoices: false });
  });

  it('asks only a current Ateneo student for an AdDU student number', () => {
    // The number is issued by AdDU, so an incoming first-year has none yet and a
    // transferee's record belongs to the college they left.
    expect(requiresStudentNumber({ yearStanding: '2nd', isTransferee: 'No' })).toBe(true);
    expect(requiresStudentNumber({ yearStanding: '5th', isTransferee: 'No' })).toBe(true);
    expect(requiresStudentNumber({ yearStanding: '2nd', isTransferee: 'Yes' })).toBe(false);
    expect(requiresStudentNumber({ yearStanding: 'incoming-1st', isTransferee: 'No' })).toBe(false);
    expect(requiresStudentNumber({ yearStanding: '', isTransferee: 'No' })).toBe(false);
    // A transferee's profile is complete without one, and the section accepts it.
    const transferee = validateAcademicSection({ degreeProgram: 'BS Information Technology', academicStanding: 'good', studentNumber: '', yearStanding: '2nd', qpi: '3.1', isTransferee: 'Yes' }, programs);
    expect(transferee.errors).toEqual({});
    expect(transferee.values.studentNumber).toBe('');
    // The first-login essentials follow the same rule, so a transferee is never
    // blocked by a field the modal does not show.
    const onboarding = validateOnboardingEssentials({
      studentNumber: '', degreeProgram: 'BS Information Technology', yearStanding: '2nd', isTransferee: 'Yes',
      academicStanding: 'good', qpi: '3.1', householdIncome: '180000', citizenship: 'Filipino', phone: '0917 123 4567',
    }, programs);
    expect(onboarding.errors).toEqual({});
  });

  it('names each standing as the year the applicant is going into', () => {
    // Offers open in the summer, so a continuing applicant answers with the year
    // they are going into and `1st year` is no longer offered.
    expect(yearStandingOptions.map((option) => option.value)).toEqual(['incoming-1st', '2nd', '3rd', '4th', '5th']);
    expect(yearStandingOptions.map((option) => option.label)).toEqual(['Incoming 1st year', 'Incoming 2nd year', 'Incoming 3rd year', 'Incoming 4th year', 'Incoming 5th year']);
    expect(getYearStandingLabel('3rd')).toBe('Incoming 3rd year');
  });

  it('offers only the standings the applicant status allows', () => {
    // An incoming first-year has nothing to pick, and an enrolled applicant is
    // never offered the incoming-first-year standing.
    expect(getYearStandingOptions('incoming')).toEqual([]);
    expect(getYearStandingOptions('current').map((option) => option.value)).toEqual(['2nd', '3rd', '4th', '5th']);
    expect(getYearStandingOptions('transferee').map((option) => option.value)).toEqual(['2nd', '3rd', '4th', '5th']);
    // An unanswered status keeps the full list, so a profile saved before the
    // status existed is never locked out of its own standing.
    expect(getYearStandingOptions('').map((option) => option.value)).toEqual(['incoming-1st', '2nd', '3rd', '4th', '5th']);
  });

  it('keeps a standing saved before the labels changed', () => {
    expect(deriveYearStanding({ yearStanding: '1st', applicantType: 'current', yearLevel: 1 })).toBe('1st');
    expect(resolveYearStanding('1st')).toMatchObject({ yearStanding: '1st', isIncomingFirstYear: false, applicantType: 'current', yearLevel: 1 });
    expect(getStandingRequirements('1st')).toMatchObject({ requiresQpi: true, requiresHsStanding: false });
    expect(requiresStudentNumber({ yearStanding: '1st', isTransferee: 'No' })).toBe(true);
    expect(getYearStandingLabel('1st')).toBe('1st year');
  });

  it('keeps an incoming first-year from also being a transferee', () => {
    const incoming = validateAcademicSection({ degreeProgram: 'BS Information Technology', academicStanding: 'good', yearStanding: 'incoming-1st', hsStrand: 'STEM', hsAverage: '94', isTransferee: 'Yes' }, programs);
    expect(incoming.values.isTransferee).toBe('No');
    const transferee = validateAcademicSection({ degreeProgram: 'BS Information Technology', academicStanding: 'good', studentNumber: '2023001', yearStanding: '2nd', qpi: '3.1', isTransferee: 'Yes' }, programs);
    expect(transferee.values.isTransferee).toBe('Yes');
    // An answered standing records the status the control shows, instead of leaving
    // it blank while the student believes they answered it.
    const current = validateAcademicSection({ degreeProgram: 'BS Information Technology', academicStanding: 'good', studentNumber: '2023001', yearStanding: '2nd', qpi: '3.1', isTransferee: '' }, programs);
    expect(current.values.isTransferee).toBe('No');
  });

  it('keeps the applicant status answer while the year is still unanswered', () => {
    // Regression: the status used to be re-derived from the year standing, so
    // choosing Current or Transferee before a year snapped it back to the
    // placeholder and the control could not be used.
    expect(applyApplicantStatus({ yearStanding: '' }, 'current')).toMatchObject({ applicantStatus: 'current', yearStanding: '', isTransferee: 'No' });
    expect(applyApplicantStatus({ yearStanding: '' }, 'transferee')).toMatchObject({ applicantStatus: 'transferee', yearStanding: '', isTransferee: 'Yes' });
    // A year the new status still offers is kept; one it cannot offer is cleared.
    expect(applyApplicantStatus({ yearStanding: '3rd' }, 'transferee')).toMatchObject({ applicantStatus: 'transferee', yearStanding: '3rd', isTransferee: 'Yes' });
    expect(applyApplicantStatus({ yearStanding: 'incoming-1st' }, 'current')).toMatchObject({ yearStanding: '' });
    // Incoming answers the standing and its transferee question, and leaves the
    // ranked choices alone because they belong to that case.
    const incoming = applyApplicantStatus({ yearStanding: '2nd' }, 'incoming');
    expect(incoming).toMatchObject({ applicantStatus: 'incoming', yearStanding: 'incoming-1st', isTransferee: 'No' });
    expect(incoming).not.toHaveProperty('programChoice2');
    // Picking the incoming year answers the status too, so the two controls agree.
    expect(applyYearStanding('incoming-1st')).toMatchObject({ yearStanding: 'incoming-1st', applicantStatus: 'incoming', isTransferee: 'No' });
    expect(applyYearStanding('4th')).toEqual({ yearStanding: '4th' });
  });
});

describe('profile field picking', () => {
  it('keeps only known eligibility attributes and boolean sponsor ties', () => {
    expect(pickEligibilityAttributes({ citizenship: 'Filipino', role: 'admissions_office', sponsorTies: { gsisMemberDependent: 'yes', injected: true } })).toEqual({
      citizenship: 'Filipino',
      sponsorTies: { gsisMemberDependent: true, afpDependent: false, usVeteranDependent: false },
    });
    expect(pickEligibilityAttributes(null)).toEqual({});
    expect(pickEligibilityAttributes(['citizenship'])).toEqual({});
  });

  it('skips undefined values so a section never clears fields it did not edit', () => {
    expect(pickFields({ fullName: 'Ana', phone: undefined, department: 'CCS' }, ['fullName', 'phone'])).toEqual({ fullName: 'Ana' });
  });
});

describe('getProfileCompleteness', () => {
  const completeStudent = {
    ...studentProfile,
    academicStanding: 'good',
    civilStatus: 'Single',
    essay: 'My statement/essay.',
    studentNumber: '2023001',
    completeAddress: '123 Rizal St, Davao City',
    ipCommunity: 'No',
    pwd: 'No',
    employed: 'Not employed',
    ...formCore,
  };
  const keysOf = (completeness, group) => completeness.items.filter((item) => item.group === group).map((item) => item.key);

  it('scores a complete student profile and points missing items to their section', () => {
    const completeness = getProfileCompleteness({ ...completeStudent, studentNumber: '' }, 'student');
    const missing = completeness.items.filter((item) => !item.done);
    expect(missing).toEqual([expect.objectContaining({ key: 'studentNumber', section: 'academic', group: 'application' })]);
    // The default statement/essay is an optional template, not a tracked item.
    expect(completeness.items.map((item) => item.key)).not.toContain('essay');
    expect(completeness.percent).toBe(Math.round((20 / 21) * 100));
  });

  it('separates what an application needs from the descriptive details', () => {
    const completeness = getProfileCompleteness(completeStudent, 'student');
    expect(keysOf(completeness, 'application')).toEqual(['fullName', 'yearStanding', 'studentNumber', 'degreeProgram', 'academicStanding', 'qpi', 'householdIncome', 'citizenship', 'civilStatus', 'completeAddress', 'ipCommunity', 'pwd', 'employed', 'applicantStatus', 'birthdate', 'sexAtBirth', 'communityService', 'economicStatus', 'fatherFinances', 'motherFinances', 'phone']);
    expect(keysOf(completeness, 'details')).toEqual([]);
    expect(completeness.groups.map((group) => [group.key, group.completed, group.total])).toEqual([['application', 21, 21]]);
    expect(completeness.percent).toBe(100);
  });

  it('asks an incoming first-year for senior high school standing instead of a student number and QPI', () => {
    const incoming = { ...completeStudent, yearStanding: 'incoming-1st', studentNumber: '', qpi: '', hsStrand: '', hsAverage: '' };
    const completeness = getProfileCompleteness(incoming, 'student');
    const keys = completeness.items.map((item) => item.key);
    // Items that do not apply are left out, not counted as done.
    expect(keys).not.toContain('studentNumber');
    expect(keys).not.toContain('qpi');
    expect(keysOf(completeness, 'application')).toContain('hsAverage');
    expect(keysOf(completeness, 'application')).toContain('hsStrand');
    expect(completeness.items.find((item) => item.key === 'degreeProgram').label).toBe('Program to be enrolled');
    expect(completeness.items.filter((item) => !item.done).map((item) => item.key)).toEqual(['hsAverage', 'hsStrand']);

    const filled = getProfileCompleteness({ ...incoming, hsStrand: 'STEM', hsAverage: 92 }, 'student');
    expect(filled.percent).toBe(100);
    expect(getProfileCompleteness({ ...incoming, hsStrand: 'STEM', hsAverage: 59 }, 'student').percent).toBeLessThan(100);
  });

  it('only asks staff for personal information', () => {
    const completeness = getProfileCompleteness(chairProfile, 'department_chair');
    expect(completeness.items.map((item) => item.section)).toEqual(['personal', 'personal']);
    expect(completeness.groups).toHaveLength(1);
    expect(completeness.percent).toBe(100);
  });
});

describe('validateOnboardingEssentials', () => {
  const base = {
    studentNumber: '2023001',
    degreeProgram: 'BS Information Technology',
    yearStanding: '2nd',
    academicStanding: 'good',
    qpi: '3.1',
    householdIncome: '240000',
    hasActiveGovernmentGrant: false,
    phone: '09171234567',
    citizenship: 'Filipino',
  };

  it('normalizes the first-login essentials into profile-ready values', () => {
    const result = validateOnboardingEssentials(base, programs);
    expect(result.errors).toEqual({});
    expect(result.values).toEqual({
      studentNumber: '2023001',
      degreeProgram: 'BS Information Technology',
      yearStanding: '2nd',
      applicantType: 'current',
      yearLevel: 2,
      academicStanding: 'good',
      qpi: 3.1,
      hsStrand: '',
      hsAverage: '',
      programChoice2: '',
      programChoice3: '',
      householdIncome: 240000,
      hasActiveGovernmentGrant: false,
      phone: '+63 917 123 4567',
      citizenship: 'Filipino',
    });
  });

  it('carries the ranked program choices for an incoming first-year', () => {
    const incoming = {
      degreeProgram: 'BS Information Technology',
      yearStanding: 'incoming-1st',
      academicStanding: 'good',
      qpi: '',
      hsStrand: 'STEM',
      hsAverage: '94',
      householdIncome: '240000',
      hasActiveGovernmentGrant: false,
      phone: '',
      citizenship: 'Filipino',
    };

    // A continuing student keeps both choices empty.
    expect(validateOnboardingEssentials(base, programs).values).toMatchObject({ programChoice2: '', programChoice3: '' });

    // An incoming first-year's ranked choices round-trip through onboarding.
    const ranked = validateOnboardingEssentials({ ...incoming, programChoice2: 'BS Information Technology', programChoice3: '' }, programs);
    // The 1st choice cannot repeat as the 2nd choice.
    expect(ranked.errors.programChoice2).toBeTruthy();

    // A choice cannot repeat in a later slot either; three distinct programs pass.
    const rankedPrograms = [...programs, { value: 'BS Computer Science', label: 'BS Computer Science', department: 'College of Computer Studies (CCS)', category: 'Computer Studies' }];
    expect(validateOnboardingEssentials({ ...incoming, programChoice2: 'BS Computer Science', programChoice3: 'BS Computer Science' }, rankedPrograms).errors.programChoice3).toBeTruthy();
    expect(validateOnboardingEssentials({ ...incoming, programChoice2: 'BS Computer Science', programChoice3: '' }, rankedPrograms).errors).toEqual({});

    const clean = validateOnboardingEssentials({ ...incoming, programChoice2: '', programChoice3: '' }, programs);
    expect(clean.errors).toEqual({});
    expect(clean.values).toMatchObject({ programChoice2: '', programChoice3: '' });
  });

  it('reuses the shared section rules for the essentials', () => {
    expect(validateOnboardingEssentials({ ...base, citizenship: '' }, programs).errors.citizenship).toBeTruthy();
    // An incoming first-year needs senior high school standing, not a QPI.
    expect(validateOnboardingEssentials({ ...base, yearStanding: 'incoming-1st', qpi: '' }, programs).errors.hsAverage).toBeTruthy();
    expect(validateOnboardingEssentials({ ...base, yearStanding: 'incoming-1st', qpi: '', hsStrand: 'STEM', hsAverage: '94' }, programs).errors).toEqual({});
    expect(validateOnboardingEssentials({ ...base, householdIncome: '' }, programs).errors.householdIncome).toBeTruthy();
    expect(validateOnboardingEssentials({ ...base, phone: '12345' }, programs).errors.phone).toMatch(/Philippine mobile/);
  });
});

describe('getCurrentAcademicYear', () => {
  it('starts the academic year in June', () => {
    expect(getCurrentAcademicYear(new Date(2026, 4, 31))).toBe('2025-2026');
    expect(getCurrentAcademicYear(new Date(2026, 5, 1))).toBe('2026-2027');
  });
});

describe('normalizeAttestedValue', () => {
  it('compares numeric attributes by value', () => {
    expect(normalizeAttestedValue('qpi', '3.20')).toBe(3.2);
    expect(normalizeAttestedValue('qpi', 3.456)).toBe(3.46);
    expect(normalizeAttestedValue('hsAverage', '92')).toBe(92);
    expect(normalizeAttestedValue('householdIncome', '250000')).toBe(250000);
    expect(normalizeAttestedValue('qpi', 'abc')).toBeNull();
  });

  it('trims option answers and maps blanks to null', () => {
    expect(normalizeAttestedValue('citizenship', ' Filipino ')).toBe('Filipino');
    expect(normalizeAttestedValue('pwd', 'No')).toBe('No');
    expect(normalizeAttestedValue('employed', '')).toBeNull();
    expect(normalizeAttestedValue('qpi', null)).toBeNull();
    expect(normalizeAttestedValue('honorsRank', undefined)).toBeNull();
  });
});

describe('isProofRequired', () => {
  it('asks for proof only when the answer claims something', () => {
    expect(isProofRequired('ipCommunity', { ipCommunity: 'Yes' })).toBe(true);
    expect(isProofRequired('ipCommunity', { ipCommunity: 'No' })).toBe(false);
    expect(isProofRequired('pwd', { pwd: '' })).toBe(false);
    expect(isProofRequired('employed', { employed: 'Part-time' })).toBe(true);
    expect(isProofRequired('employed', { employed: 'Not employed' })).toBe(false);
    expect(isProofRequired('honorsRank', { honorsRank: 'Valedictorian' })).toBe(true);
    expect(isProofRequired('honorsRank', { honorsRank: '' })).toBe(false);
  });

  it('follows the year standing for the academic credential', () => {
    expect(isProofRequired('qpi', { yearStanding: '2nd' })).toBe(true);
    expect(isProofRequired('qpi', { yearStanding: 'incoming-1st' })).toBe(false);
    expect(isProofRequired('hsAverage', { yearStanding: 'incoming-1st' })).toBe(true);
    expect(isProofRequired('hsAverage', { yearStanding: '3rd', hsAverage: 90 })).toBe(false);
  });

  it('always asks for proof of income, citizenship, and academic standing', () => {
    ['householdIncome', 'citizenship', 'academicStanding'].forEach((key) => expect(isProofRequired(key, {})).toBe(true));
    expect(isProofRequired('not-an-attribute', {})).toBe(false);
  });

  it('lists the claims a profile makes', () => {
    expect(getClaimedAttributes({ ipCommunity: 'Yes', pwd: 'No', employed: 'Full-time', honorsRank: '' })).toEqual(['employed', 'ipCommunity']);
    expect(getClaimedAttributes({})).toEqual([]);
  });
});

describe('getProofSkipReason', () => {
  it('names why an answer needs no proof', () => {
    expect(getProofSkipReason('qpi', { yearStanding: 'incoming-1st' })).toBe('standing');
    expect(getProofSkipReason('hsAverage', { yearStanding: '2nd' })).toBe('standing');
    expect(getProofSkipReason('ipCommunity', { ipCommunity: 'No' })).toBe('claim');
    expect(getProofSkipReason('employed', { employed: 'Not employed' })).toBe('claim');
    expect(getProofSkipReason('honorsRank', { honorsRank: '' })).toBe('claim');
  });

  it('separates an unanswered optional answer from one that claims nothing', () => {
    expect(getProofSkipReason('ipCommunity', { ipCommunity: '' })).toBe('unanswered');
    expect(getProofSkipReason('pwd', { pwd: '' })).toBe('unanswered');
    expect(getProofSkipReason('employed', { employed: '' })).toBe('unanswered');
    // No standing chosen yet: the senior high school average is unanswered rather
    // than inapplicable, so it never reads as something the student does not need.
    expect(getProofSkipReason('hsAverage', {})).toBe('unanswered');
  });

  it('is null while a proof is required, and for an unknown attribute', () => {
    expect(getProofSkipReason('hsAverage', { yearStanding: 'incoming-1st' })).toBeNull();
    expect(getProofSkipReason('qpi', { yearStanding: '2nd' })).toBeNull();
    expect(getProofSkipReason('ipCommunity', { ipCommunity: 'Yes' })).toBeNull();
    expect(getProofSkipReason('householdIncome', {})).toBeNull();
    expect(getProofSkipReason('not-an-attribute', {})).toBeNull();
  });
});

describe('getApplicationProfileGate', () => {
  const complete = {
    fullName: 'Ana Reyes',
    yearStanding: '2nd',
    studentNumber: '202300001',
    degreeProgram: 'BS Information Technology',
    academicStanding: 'good',
    qpi: 3.2,
    householdIncome: 180000,
    citizenship: 'Filipino',
    ...formCore,
  };

  it('allows a profile whose "Needed to apply" answers are complete', () => {
    expect(getApplicationProfileGate(complete)).toEqual({ allowed: true, missing: [], reasons: [] });
  });

  it('lists the missing answers with the section that holds each', () => {
    const gate = getApplicationProfileGate({ ...complete, citizenship: '', qpi: '' });
    expect(gate.allowed).toBe(false);
    expect(gate.missing.map((item) => [item.key, item.section])).toEqual([['qpi', 'academic'], ['citizenship', 'background']]);
    expect(gate.reasons[0]).toBe('Complete your profile before applying: Annual QPI, Citizenship.');
  });

  it('asks an incoming first-year for the senior high school average instead of a QPI', () => {
    const gate = getApplicationProfileGate({ ...complete, yearStanding: 'incoming-1st', studentNumber: '', qpi: '' });
    expect(gate.missing.map((item) => item.key)).toEqual(['hsAverage']);
    expect(getApplicationProfileGate({ ...complete, yearStanding: 'incoming-1st', studentNumber: '', qpi: '', hsAverage: 91 }).allowed).toBe(true);
  });
});

describe('mergeProfileDetails', () => {
  it('keeps the stored details of other sections when one section saves', () => {
    const stored = { religion: 'Roman Catholic', civilStatus: 'Single', essay: 'Kept', familyDetails: { fatherName: 'Roberto' }, qpi: 1.5 };
    const merged = mergeProfileDetails(stored, { completeAddress: 'Davao City', country: 'Philippines' });
    expect(merged).toEqual({
      religion: 'Roman Catholic',
      civilStatus: 'Single',
      essay: 'Kept',
      familyDetails: { fatherName: 'Roberto' },
      completeAddress: 'Davao City',
      country: 'Philippines',
    });
  });

  it('lets the saved section overwrite its own keys and tolerates a missing profile', () => {
    expect(mergeProfileDetails({ religion: 'Islam' }, { religion: '' })).toEqual({ religion: '' });
    expect(mergeProfileDetails(null, { country: 'Philippines' })).toEqual({ country: 'Philippines' });
  });
});

describe('FORM 230-SCH core answers', () => {
  const complete = {
    fullName: 'Ana Reyes', yearStanding: '2nd', studentNumber: '202300001', degreeProgram: 'BS Information Technology',
    academicStanding: 'good', qpi: 3.2, householdIncome: 180000, citizenship: 'Filipino', ...formCore,
  };

  it('asks for each core answer and links it to the section that holds it', () => {
    const gate = getApplicationProfileGate({
      ...complete, birthdate: '', sexAtBirth: '', communityService: '', financialProfile: undefined,
    });
    expect(gate.missing.map((item) => [item.key, item.section])).toEqual([
      ['birthdate', 'personal'],
      ['sexAtBirth', 'personal'],
      ['communityService', 'background'],
      ['economicStatus', 'finances'],
      ['fatherFinances', 'finances'],
      ['motherFinances', 'finances'],
    ]);
  });

  it('requires civil status, address, IP community, PWD, employment, mobile number and (incoming) strand before applying', () => {
    const gate = getApplicationProfileGate({ ...complete, civilStatus: '', completeAddress: '', ipCommunity: '', pwd: '', employed: '', phone: '' });
    expect(gate.missing.map((item) => [item.key, item.section])).toEqual([
      ['civilStatus', 'personal'],
      ['completeAddress', 'address'],
      ['ipCommunity', 'background'],
      ['pwd', 'background'],
      ['employed', 'background'],
      ['phone', 'personal'],
    ]);
    const incoming = { ...complete, yearStanding: 'incoming-1st', studentNumber: '', qpi: '', hsAverage: 90, hsStrand: '' };
    expect(getApplicationProfileGate(incoming).missing.map((item) => [item.key, item.section])).toEqual([['hsStrand', 'academic']]);
    expect(getApplicationProfileGate({ ...complete, hsStrand: '' }).allowed).toBe(true);
  });

  it('asks only an incoming first-year for the senior high school last attended', () => {
    const incoming = { ...complete, yearStanding: 'incoming-1st', studentNumber: '', qpi: '', hsAverage: 90, schoolLastAttended: { name: '' } };
    expect(getApplicationProfileGate(incoming).missing.map((item) => item.key)).toEqual(['schoolLastAttended']);
    expect(getApplicationProfileGate({ ...complete, schoolLastAttended: { name: '' } }).allowed).toBe(true);
  });

  it('counts a deceased parent as answered and accepts a 0 income', () => {
    expect(isParentFinancesAnswered({ familyDetails: { fatherDeceased: true } }, 'father')).toBe(true);
    expect(isParentFinancesAnswered({ financialProfile: { mother: { employmentStatus: 'unemployed', annualIncome: 0 } } }, 'mother')).toBe(true);
    expect(isParentFinancesAnswered({ financialProfile: { mother: { employmentStatus: 'unemployed', annualIncome: '' } } }, 'mother')).toBe(false);
    expect(isParentFinancesAnswered({ financialProfile: { mother: { employmentStatus: 'retired', annualIncome: 10 } } }, 'mother')).toBe(false);
    expect(isParentFinancesAnswered({}, 'father')).toBe(false);
  });
});
