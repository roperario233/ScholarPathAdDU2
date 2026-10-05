import { describe, expect, it } from 'vitest';
import {
  DENIAL_MESSAGE,
  evaluateApplicationGate,
  getAdduInternalPrograms,
  getInternalScholarships,
  isInternalScholarship,
} from '../src/lib/eligibility';

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
    const donorEndowment = { title: 'Ateneo Alumni Association of Canada', ruleFamily: 'general-pool' };
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

  it('uses title fallback to evaluate Jubilee and Working Scholars rule families', () => {
    const jubileeResult = evaluateApplicationGate({
      ...eligibleProfile,
      applicantType: 'current',
      isHonorsGraduate: false,
      graduatingClassSize: 100,
    }, { title: 'Jubilee Scholarship', isActive: true });
    expect(jubileeResult.allowed).toBe(false);
    expect(jubileeResult.reasons).toContain('Open only to incoming AdDU first-year students.');

    const workingScholarsResult = evaluateApplicationGate(eligibleProfile, {
      title: 'Student Assistant Program (Working Scholars)',
      isActive: true,
      eligibleDegrees: ['BS Nursing'],
    });
    expect(workingScholarsResult.allowed).toBe(false);
    expect(workingScholarsResult.reasons).toContain('Currently limited to BS Nursing.');
  });
});