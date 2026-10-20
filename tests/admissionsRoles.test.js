import { describe, expect, it } from 'vitest';
import {
  ADMISSIONS_APPROVAL_STATUSES,
  ADMISSIONS_OFFICE_ROLES,
  getNextApplicationStatuses,
  isAdmissionsHeadRole,
  isAdmissionsReviewerRole,
  isAdmissionsStaffRole,
} from '../src/lib/constants';
import { getApprovalQueue, getReviewQueue } from '../src/lib/admissionsOffice';
import { describeStatusActor } from '../src/lib/applicationRequirements';

const application = (overrides = {}) => ({
  id: 'app-1',
  status: 'Submitted',
  studentName: 'Ada Cruz',
  scholarshipTitle: 'Grant-in-Aid (GIA)',
  attachedDocuments: [],
  timeline: [],
  statusLog: [],
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

// The Admissions Office is one office with two accountability lanes: Staff
// prepare a case, the Head decides it. These tests pin the boundary so a later
// refactor cannot quietly let one account do both again.
describe('Admissions Office lane predicates', () => {
  it('separates Staff from the Head', () => {
    expect(isAdmissionsStaffRole('admissions_office')).toBe(true);
    expect(isAdmissionsStaffRole('admissions_head')).toBe(false);
    expect(isAdmissionsHeadRole('admissions_head')).toBe(true);
    expect(isAdmissionsHeadRole('admissions_office')).toBe(false);
    expect(isAdmissionsReviewerRole('admissions_office')).toBe(true);
    expect(isAdmissionsReviewerRole('admissions_head')).toBe(true);
    expect(isAdmissionsReviewerRole('department_chair')).toBe(false);
    expect(ADMISSIONS_OFFICE_ROLES).toEqual(['admissions_office', 'admissions_head']);
  });
});

describe('Admissions Office lane authority', () => {
  it('stops Staff at the sub-committee recommendation', () => {
    expect(getNextApplicationStatuses('Recommended', 'admissions_office')).toEqual([]);
    expect(getNextApplicationStatuses('Approved', 'admissions_office')).toEqual([]);
    expect(getNextApplicationStatuses('Released', 'admissions_office')).toEqual([]);
  });

  it('gives the Head every Staff stage as well', () => {
    ['Submitted', 'Under Review', 'For Verification', 'Endorsed', 'Interview']
      .forEach((status) => expect(getNextApplicationStatuses(status, 'admissions_head').length).toBeGreaterThan(0));
  });

  it('lets the Head approve and release on top of the Staff stages', () => {
    expect(getNextApplicationStatuses('Recommended', 'admissions_head')).toEqual(['Approved', 'Rejected']);
    expect(getNextApplicationStatuses('Approved', 'admissions_head')).toEqual(['Released']);
    expect(ADMISSIONS_APPROVAL_STATUSES).toEqual(['Recommended', 'Approved']);
  });
});

describe('Admissions Office lane queues', () => {
  const applications = [
    application({ id: 'submitted', status: 'Submitted' }),
    application({ id: 'verification', status: 'For Verification' }),
    application({ id: 'recommended', status: 'Recommended' }),
    application({ id: 'approved', status: 'Approved' }),
    application({ id: 'released', status: 'Released' }),
  ];

  it('keeps the Head decision queue out of the Staff review queue', () => {
    expect(getReviewQueue(applications).map((entry) => entry.id)).toEqual(['submitted', 'verification']);
  });

  it('gives the Head the approval queue', () => {
    expect(getApprovalQueue(applications).map((entry) => entry.id)).toEqual(['recommended']);
  });
});

describe('Admissions Office actor labels', () => {
  it('distinguishes Staff verification from Head approval in the status history', () => {
    expect(describeStatusActor({ actorRole: 'admissions_office', actorName: 'Ben Reyes' }, true)).toBe('Ben Reyes');
    expect(describeStatusActor({ actorRole: 'admissions_office', actorName: null }, true)).toBe('Admissions Office Staff');
    expect(describeStatusActor({ actorRole: 'admissions_head', actorName: null }, true)).toBe('Admissions Office Head');
  });
});
