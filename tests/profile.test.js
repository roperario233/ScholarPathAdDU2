import { describe, expect, it } from 'vitest';
import {
  deriveYearStanding,
  getProfileCompleteness,
  getStandingRequirements,
  pickEligibilityAttributes,
  pickFields,
  resolveYearStanding,
  validateAcademicSection,
  validateAddressSection,
  validateBackgroundSection,
  validateFamilySection,
  validateFinancialSection,
  validateMobileNumber,
  validateOnboardingEssentials,
  validatePasswordChange,
  validatePersonalSection,
  validateQpi,
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

describe('section validators', () => {
  it('normalizes personal information and limits the bio length', () => {
    const valid = validatePersonalSection({ fullName: '  Ana   Cruz ', phone: '0917 123 4567', bio: ' Hello ', religion: 'Roman Catholic', civilStatus: 'Single' });
    expect(valid.errors).toEqual({});
    expect(valid.values).toEqual({ fullName: 'Ana Cruz', phone: '+63 917 123 4567', bio: 'Hello', religion: 'Roman Catholic', civilStatus: 'Single', essay: '' });

    expect(validatePersonalSection({ fullName: 'A', bio: 'x'.repeat(281) }).errors).toMatchObject({
      fullName: expect.any(String),
      bio: expect.any(String),
    });
    // An unknown religion or civil status is rejected.
    expect(validatePersonalSection({ fullName: 'Ana Cruz', religion: 'Jedi', civilStatus: 'Single' }).errors.religion).toBeTruthy();
  });

  it('keeps paragraph breaks in the scholarship essay and enforces the cap', () => {
    const kept = validatePersonalSection({ fullName: 'Ana Cruz', essay: '  First paragraph.\n\nSecond paragraph.  ' });
    expect(kept.errors).toEqual({});
    expect(kept.values.essay).toBe('First paragraph.\n\nSecond paragraph.');

    expect(validatePersonalSection({ fullName: 'Ana Cruz', essay: 'x'.repeat(5001) }).errors.essay).toMatch(/essay/);
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
      motherName: 'Liza Espinosa',
      motherOccupation: '',
      motherDeceased: true,
      familyPosition: 'Eldest',
      numberOfSiblings: 2,
    });
    expect(validateFamilySection({ familyDetails: { familyPosition: 'First born' } }).errors.familyPosition).toBeTruthy();
    expect(validateFamilySection({ familyDetails: { numberOfSiblings: 'lots' } }).errors.numberOfSiblings).toBeTruthy();
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
    expect(validateAcademicSection({ ...base, studentNumber: '2023001', yearStanding: '2nd', qpi: '3.1', hsStrand: 'x' }, programs).errors.hsStrand).toBeTruthy();
    expect(validateAcademicSection({ ...base, studentNumber: '', yearStanding: '' }, programs).errors.yearStanding).toBeTruthy();
    expect(validateAcademicSection({ ...base, degreeProgram: 'BS Unknown', studentNumber: '', yearStanding: 'incoming-1st', hsStrand: 'STEM', hsAverage: '94', qpi: '' }, programs).errors.degreeProgram).toBeTruthy();
  });

  it('validates ranked program choices for incoming first-years', () => {
    const base = { degreeProgram: 'BS Information Technology', academicStanding: 'good', studentNumber: '', yearStanding: 'incoming-1st', hsStrand: 'STEM', hsAverage: '94', qpi: '' };
    const ok = validateAcademicSection({ ...base, programChoice2: 'BS Computer Science' }, programs);
    // Only the one seeded program is known to the validator; an unknown choice fails.
    expect(ok.errors.programChoice2).toBeTruthy();
    // A duplicate of the 1st choice is rejected.
    expect(validateAcademicSection({ ...base, programChoice2: 'BS Information Technology' }, programs).errors.programChoice2).toBeTruthy();
    // A continuing student is not asked for program choices.
    expect(validateAcademicSection({ degreeProgram: 'BS Information Technology', academicStanding: 'good', studentNumber: '2023001', yearStanding: '3rd', qpi: '3.1', programChoice2: 'BS Information Technology' }, programs).errors.programChoice2).toBeUndefined();
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

    const valid = validateBackgroundSection({ citizenship: 'Filipino', honorsRank: 'Salutatorian', graduatingClassSize: '120', sponsorTies: { afpDependent: true } });
    expect(valid.errors).toEqual({});
    expect(valid.values).toMatchObject({
      isHonorsGraduate: true,
      graduatingClassSize: 120,
      sponsorTies: { gsisMemberDependent: false, afpDependent: true, usVeteranDependent: false },
    });
    // Senior high school standing now lives with the academic profile.
    expect(valid.values).not.toHaveProperty('hsAverage');
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
    expect(getStandingRequirements('incoming-1st')).toMatchObject({ requiresStudentNumber: false, requiresQpi: false, requiresHsStanding: true, requiresProgramChoices: true, programLabel: 'Program / Course (to be enrolled)' });
    expect(getStandingRequirements('4th')).toMatchObject({ yearStanding: '4th', requiresStudentNumber: true, requiresQpi: true, requiresHsStanding: false, requiresProgramChoices: false, programLabel: 'Program / Course' });
    // Accepts a profile-shaped object too, for the routing gates.
    expect(getStandingRequirements({ applicantType: 'current', yearLevel: 3 })).toMatchObject({ yearStanding: '3rd', requiresStudentNumber: true, requiresProgramChoices: false });
    // An unanswered standing requires nothing yet, so no standing-specific field
    // shows before the student picks one.
    expect(getStandingRequirements('')).toMatchObject({ yearStanding: '', requiresStudentNumber: false, requiresQpi: false, requiresHsStanding: false, requiresProgramChoices: false });
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
  it('scores a complete student profile and points missing items to their section', () => {
    const completeStudent = {
      ...studentProfile,
      civilStatus: 'Single',
      essay: 'My scholarship essay.',
      studentNumber: '2023001',
      completeAddress: '123 Rizal St, Davao City',
      ipCommunity: 'No',
      pwd: 'No',
      employed: 'Not employed',
    };
    const completeness = getProfileCompleteness({ ...completeStudent, studentNumber: '' }, 'student');
    const missing = completeness.items.filter((item) => !item.done);
    expect(missing).toEqual([expect.objectContaining({ key: 'studentNumber', section: 'academic' })]);
    // The essay is a tracked personal-information item.
    expect(completeness.items).toContainEqual(expect.objectContaining({ key: 'essay', section: 'personal', done: true }));
    expect(completeness.percent).toBe(Math.round((13 / 14) * 100));
  });

  it('only asks staff for personal information', () => {
    const completeness = getProfileCompleteness(chairProfile, 'department_chair');
    expect(completeness.items.map((item) => item.section)).toEqual(['personal', 'personal']);
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
