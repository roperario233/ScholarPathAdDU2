import { describe, expect, it } from 'vitest';
import {
  DENIAL_MESSAGE,
  evaluateApplicationGate,
  getAcademicCredential,
  getAcademicRequirement,
  getAdduInternalPrograms,
  getInternalScholarships,
  getScholarshipAcademicDisplay,
  isAdduInternalProgram,
  isInternalScholarship,
} from '../src/lib/eligibility';
import { getProfileSectionForField } from '../src/lib/profile';

const eligibleProfile = {
  qpi: 3.2,
  householdIncome: 180000,
  degreeProgram: 'BS Information Technology',
  citizenship: 'Filipino',
  isOnPrepaidPlan: false,
  hasSiblingOnAid: false,
  hasOtherActiveScholarship: false,
  academicStanding: 'good',
  applicantType: 'current',
  hasActiveGovernmentGrant: false,
};

const scholarship = {
  id: 'gia-1',
  title: 'Grant-in-Aid (GIA)',
  isActive: true,
  minimumQpi: 2.5,
  maximumIncome: 250000,
};

describe('internal scholarship eligibility gate', () => {
  it('recognizes the three internal scholarship programs by title', () => {
    expect(isInternalScholarship({ title: 'Jubilee Scholarship' })).toBe(true);
    expect(isInternalScholarship({ title: 'Grant-in-Aid (GIA)' })).toBe(true);
    expect(isInternalScholarship({ title: 'Student Assistant Program (Working Scholars)' })).toBe(true);
    expect(isInternalScholarship({ title: 'External donor scholarship' })).toBe(false);
  });

  it('filters the catalog down to internal scholarships', () => {
    expect(getInternalScholarships([
      scholarship,
      { id: 'external-1', title: 'External donor scholarship' },
    ])).toEqual([scholarship]);
  });

  it('keeps only GIA, Jubilee, and Student Assistant from the scholarship catalog', () => {
    const gia = { title: 'Grant-in-Aid (GIA)', ruleFamily: 'general-pool' };
    const jubilee = { title: 'Jubilee Scholarship Fund (Valedictorian & Salutatorian)', ruleFamily: 'honors' };
    const studentAssistant = { title: 'Student Assistant (SA) Program', ruleFamily: 'work-study' };
    const donorEndowment = {
      title: 'Ateneo Alumni Association of Canada',
      category: 'Internal Endowment',
      ruleFamily: 'general-pool',
      isExternal: false,
    };
    const externalProgram = { title: 'CHED Scholarship Program', ruleFamily: 'government-linked' };

    expect(getAdduInternalPrograms([
      gia,
      donorEndowment,
      jubilee,
      externalProgram,
      studentAssistant,
    ])).toEqual([gia, jubilee, studentAssistant]);
  });

  it('allows a qualified GIA profile', () => {
    expect(evaluateApplicationGate(eligibleProfile, scholarship)).toMatchObject({
      allowed: true,
      reasons: [],
    });
  });

  it('denies a profile below the scholarship QPI threshold', () => {
    const result = evaluateApplicationGate({ ...eligibleProfile, qpi: 2.2 }, scholarship);
    expect(result.allowed).toBe(false);
    expect(result.message).toBe(DENIAL_MESSAGE);
    expect(result.reasons).toContain('Needs QPI 2.50+.');
  });

  it('does not treat missing QPI or household income as zero', () => {
    const result = evaluateApplicationGate({ ...eligibleProfile, qpi: '', householdIncome: null }, scholarship);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('Enter a valid QPI before checking qualifications.');
    expect(result.reasons).toContain('Enter your household income before checking qualifications.');
  });

  it('allows Jubilee honors graduates beyond incoming first-year students', () => {
    const jubileeResult = evaluateApplicationGate({
      ...eligibleProfile,
      applicantType: 'current',
      isHonorsGraduate: true,
      graduatingClassSize: 100,
    }, { title: 'Jubilee Scholarship', isActive: true });
    expect(jubileeResult.allowed).toBe(true);
    expect(jubileeResult.reasons).not.toContain('Open only to incoming AdDU first-year students.');
  });

  it('allows Student Assistant applicants from any degree program', () => {
    const workingScholarsResult = evaluateApplicationGate(eligibleProfile, {
      title: 'Student Assistant Program (Working Scholars)',
      isActive: true,
      eligibleDegrees: ['BS Nursing'],
    });
    expect(workingScholarsResult.allowed).toBe(true);
    expect(workingScholarsResult.reasons).toEqual([]);
  });
});

// An incoming first-year has no collegiate QPI, so the general pool matches them
// on their senior high school general average instead. This is the eligibility
// half of the standing branch the profile layer already owns
// (getStandingRequirements in src/lib/profile.js).
const incomingFirstYear = {
  ...eligibleProfile,
  applicantType: 'first-year',
  yearLevel: 1,
  yearStanding: 'incoming-1st',
  qpi: '',
  hsStrand: 'STEM',
  hsAverage: 90,
};

describe('academic requirements by year standing', () => {
  it('resolves the academic credential from the standing', () => {
    expect(getAcademicCredential({ yearStanding: 'incoming-1st' })).toBe('hsAverage');
    expect(getAcademicCredential({ yearStanding: '3rd' })).toBe('qpi');
    expect(getAcademicCredential({ applicantType: 'current', yearLevel: 4 })).toBe('qpi');
  });

  it('resolves the per-standing requirement and honors a catalog override', () => {
    expect(getAcademicRequirement({ yearStanding: 'incoming-1st' }, {})).toMatchObject({ credential: 'hsAverage', shortLabel: 'SHS GWA', min: 85, floorLabel: '85' });
    // A scholarship can override the incoming first-year floor.
    expect(getAcademicRequirement({ yearStanding: 'incoming-1st' }, { minimumShsAverage: 92 }).min).toBe(92);
    expect(getAcademicRequirement({ yearStanding: '2nd' }, { minimumQpi: 3 })).toMatchObject({ credential: 'qpi', shortLabel: 'QPI', min: 3, floorLabel: '3.00' });
  });

  it('gates an incoming first-year on the senior high school general average', () => {
    expect(evaluateApplicationGate(incomingFirstYear, scholarship)).toMatchObject({ allowed: true, reasons: [] });
  });

  it('denies an incoming first-year below the senior high school floor with the SHS reason', () => {
    const result = evaluateApplicationGate({ ...incomingFirstYear, hsAverage: 80 }, scholarship);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('Needs a senior high school general average of 85+.');
    expect(result.reasons).not.toContain('Needs QPI 2.50+.');
  });

  it('asks an incoming first-year for the SHS average and never for a QPI', () => {
    const result = evaluateApplicationGate({ ...incomingFirstYear, hsAverage: '' }, scholarship);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('Enter your senior high school general average before checking qualifications.');
    expect(result.reasons).not.toContain('Enter a valid QPI before checking qualifications.');
  });

  it('shows the standing-appropriate requirement chip and hides it when there is no academic gate', () => {
    expect(getScholarshipAcademicDisplay(incomingFirstYear, { ruleFamily: 'general-pool' })).toMatchObject({ label: 'SHS GWA', floorLabel: '85', credential: 'hsAverage' });
    expect(getScholarshipAcademicDisplay({ yearStanding: '2nd' }, { ruleFamily: 'general-pool' })).toMatchObject({ label: 'QPI', floorLabel: '2.50', credential: 'qpi' });
    // Honors and work-study gate on other criteria, so they show no academic chip.
    expect(getScholarshipAcademicDisplay({ yearStanding: '2nd' }, { ruleFamily: 'honors' })).toBeNull();
    expect(getScholarshipAcademicDisplay({ yearStanding: '2nd' }, { ruleFamily: 'work-study' })).toBeNull();
  });
});

// Each failed check carries the profile field that resolves it, so the Smart
// Eligibility Checker can link the reason to its My Profile section.
describe('eligibility issues link to My Profile sections', () => {
  const fieldsOf = (result) => result.issues.map((item) => item.field);

  it('keeps reasons identical to the issue messages', () => {
    const result = evaluateApplicationGate({ ...eligibleProfile, qpi: 2.2, householdIncome: 400000 }, scholarship);
    expect(result.reasons).toEqual(result.issues.map((item) => item.message));
  });

  it('tags the academic and income reasons with their profile fields', () => {
    expect(fieldsOf(evaluateApplicationGate({ ...eligibleProfile, qpi: 2.2 }, scholarship))).toContain('qpi');
    expect(fieldsOf(evaluateApplicationGate({ ...eligibleProfile, householdIncome: null }, scholarship))).toContain('householdIncome');
    expect(fieldsOf(evaluateApplicationGate({ ...incomingFirstYear, hsAverage: 80 }, scholarship))).toContain('hsAverage');
  });

  it('tags the Jubilee honors criteria and maps them to Eligibility background', () => {
    const fields = fieldsOf(evaluateApplicationGate(eligibleProfile, { title: 'Jubilee Scholarship', isActive: true }));
    expect(fields).toEqual(expect.arrayContaining(['honorsRank', 'graduatingClassSize']));
    expect(getProfileSectionForField('honorsRank')).toMatchObject({ key: 'background' });
    expect(getProfileSectionForField('householdIncome')).toMatchObject({ key: 'financial' });
    expect(getProfileSectionForField('qpi')).toMatchObject({ key: 'academic' });
  });

  it('leaves a closed deadline without a profile link', () => {
    const result = evaluateApplicationGate(eligibleProfile, { ...scholarship, isActive: false });
    expect(result.issues).toContainEqual({ message: 'Inactive or past deadline.', field: null });
    expect(getProfileSectionForField(null)).toBeNull();
  });

// Only the three Appendix A tracks are in scope for an application. The scope is
// decided by the title, so an unrelated internal catalog entry that shares a
// rule family (for example a donor endowment stored as `general-pool`) is
// excluded even though `isInternalScholarship` would accept it.
describe('in-scope AdDU internal tracks', () => {
  const gia = { title: 'Grant-in-Aid (GIA)', ruleFamily: 'general-pool' };
  const jubilee = { title: 'Jubilee Scholarship Fund (Valedictorian & Salutatorian)', ruleFamily: 'honors' };
  const sa = { title: 'Student Assistant (SA) Program', ruleFamily: 'work-study' };

  it('accepts the three canonical tracks', () => {
    expect(isAdduInternalProgram(gia)).toBe(true);
    expect(isAdduInternalProgram(jubilee)).toBe(true);
    expect(isAdduInternalProgram(sa)).toBe(true);
  });

  it('accepts the title variants the catalog and documents use', () => {
    expect(isAdduInternalProgram({ title: 'Jubilee Scholarship' })).toBe(true);
    expect(isAdduInternalProgram({ title: 'Student Assistant Program (Working Scholars)' })).toBe(true);
    expect(isAdduInternalProgram({ title: 'GIA' })).toBe(true);
  });

  it('rejects an unrelated internal entry that shares a rule family', () => {
    const villanueva = {
      title: 'Antonio A. Villanueva Endowment Fund',
      category: 'Internal Endowment',
      ruleFamily: 'general-pool',
      isExternal: false,
    };
    // The looser catalog helper still accepts it, which is exactly why the
    // lifecycle must not rely on it.
    expect(isInternalScholarship(villanueva)).toBe(true);
    expect(isAdduInternalProgram(villanueva)).toBe(false);
  });

  it('rejects external and government-linked entries', () => {
    expect(isAdduInternalProgram({ title: 'CHED Scholarship Program', ruleFamily: 'government-linked' })).toBe(false);
    expect(isAdduInternalProgram({})).toBe(false);
    expect(isAdduInternalProgram()).toBe(false);
  });

  it('refuses to start or gate an application for an out-of-scope program', () => {
    const villanueva = { title: 'Antonio A. Villanueva Endowment Fund', ruleFamily: 'general-pool', isActive: true };
    const result = evaluateApplicationGate(eligibleProfile, villanueva);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('The Smart Eligibility Checker only evaluates AdDU internal scholarships.');
  });
});

});