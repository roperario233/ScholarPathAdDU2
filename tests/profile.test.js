import { describe, expect, it } from 'vitest';
import {
  getProfileCompleteness,
  pickEligibilityAttributes,
  pickFields,
  validateAcademicSection,
  validateBackgroundSection,
  validateFinancialSection,
  validateMobileNumber,
  validateOnboardingEssentials,
  validatePasswordChange,
  validatePersonalSection,
  validateQpi,
} from '../src/lib/profile';
import { checkAdduInternalGate } from '../src/lib/eligibility';
import { demoUsers } from '../src/lib/demoState';

const programs = [{ value: 'BS Information Technology', label: 'BS Information Technology', department: 'College of Computer Studies (CCS)', category: 'Computer Studies' }];

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
    const valid = validatePersonalSection({ fullName: '  Ana   Cruz ', phone: '0917 123 4567', bio: ' Hello ' });
    expect(valid.errors).toEqual({});
    expect(valid.values).toEqual({ fullName: 'Ana Cruz', phone: '+63 917 123 4567', bio: 'Hello' });

    expect(validatePersonalSection({ fullName: 'A', bio: 'x'.repeat(281) }).errors).toMatchObject({
      fullName: expect.any(String),
      bio: expect.any(String),
    });
  });

  it('requires a known degree program and a year level consistent with first-year applicants', () => {
    const base = { studentNumber: '2023001', degreeProgram: 'BS Information Technology', yearLevel: '1', applicantType: 'first-year', academicStanding: 'good', qpi: '3.1' };
    const valid = validateAcademicSection(base, programs);
    expect(valid.errors).toEqual({});
    expect(valid.values).toMatchObject({ yearLevel: 1, qpi: 3.1 });

    expect(validateAcademicSection({ ...base, degreeProgram: 'BS Unknown' }, programs).errors.degreeProgram).toBeTruthy();
    expect(validateAcademicSection({ ...base, yearLevel: '3' }, programs).errors.yearLevel).toMatch(/first-year/);
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

    const valid = validateBackgroundSection({ citizenship: 'Filipino', honorsRank: 'Salutatorian', graduatingClassSize: '120', hsAverage: '95', sponsorTies: { afpDependent: true } });
    expect(valid.errors).toEqual({});
    expect(valid.values).toMatchObject({
      isHonorsGraduate: true,
      graduatingClassSize: 120,
      hsAverage: 95,
      sponsorTies: { gsisMemberDependent: false, afpDependent: true, usVeteranDependent: false },
    });
  });

  it('requires a matching password with letters and numbers', () => {
    expect(validatePasswordChange({ password: 'abc12345', confirmPassword: 'abc12345' }).errors).toEqual({});
    expect(validatePasswordChange({ password: 'short1', confirmPassword: 'short1' }).errors.password).toBeTruthy();
    expect(validatePasswordChange({ password: 'abc12345', confirmPassword: 'abc12346' }).errors.confirmPassword).toBeTruthy();
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
  it('scores the demo student profile and points missing items to their section', () => {
    const completeness = getProfileCompleteness({ ...demoUsers.student, studentNumber: '' }, 'student');
    const missing = completeness.items.filter((item) => !item.done);
    expect(missing).toEqual([expect.objectContaining({ key: 'studentNumber', section: 'academic' })]);
    expect(completeness.percent).toBe(Math.round((7 / 8) * 100));
  });

  it('only asks staff for personal information', () => {
    const completeness = getProfileCompleteness(demoUsers.chair, 'department_chair');
    expect(completeness.items.map((item) => item.section)).toEqual(['personal', 'personal']);
    expect(completeness.percent).toBe(100);
  });
});

describe('validateOnboardingEssentials', () => {
  const base = {
    studentNumber: '2023001',
    degreeProgram: 'BS Information Technology',
    yearLevel: '2',
    applicantType: 'current',
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
      yearLevel: 2,
      applicantType: 'current',
      academicStanding: 'good',
      qpi: 3.1,
      householdIncome: 240000,
      hasActiveGovernmentGrant: false,
      phone: '+63 917 123 4567',
      citizenship: 'Filipino',
    });
  });

  it('reuses the shared section rules for the essentials', () => {
    expect(validateOnboardingEssentials({ ...base, citizenship: '' }, programs).errors.citizenship).toBeTruthy();
    expect(validateOnboardingEssentials({ ...base, applicantType: 'first-year', yearLevel: '3' }, programs).errors.yearLevel).toMatch(/first-year/);
    expect(validateOnboardingEssentials({ ...base, householdIncome: '' }, programs).errors.householdIncome).toBeTruthy();
    expect(validateOnboardingEssentials({ ...base, phone: '12345' }, programs).errors.phone).toMatch(/Philippine mobile/);
  });
});
