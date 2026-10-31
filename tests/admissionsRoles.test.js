import { describe, expect, it } from 'vitest';
import {
  ADMISSIONS_APPROVAL_STATUSES,
  ADMISSIONS_OFFICE_ROLES,
  getNextApplicationStatuses,
  isAdmissionsAdminRole,
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

// The Admissions Office is one office with two lanes. Since Consultation 2 the
// Admin verifies, forwards, and releases, and Staff only read. These tests pin the
// boundary so a later refactor cannot quietly hand Staff a stage move again.
describe('Admissions Office lane predicates', () => {
  it('separates Staff from the Admin', () => {
    expect(isAdmissionsStaffRole('admissions_office')).toBe(true);
    expect(isAdmissionsStaffRole('admissions_admin')).toBe(false);
    expect(isAdmissionsAdminRole('admissions_admin')).toBe(true);
    expect(isAdmissionsAdminRole('admissions_office')).toBe(false);
    expect(isAdmissionsReviewerRole('admissions_office')).toBe(true);
    expect(isAdmissionsReviewerRole('admissions_admin')).toBe(true);
    expect(isAdmissionsReviewerRole('department_chair')).toBe(false);
    expect(ADMISSIONS_OFFICE_ROLES).toEqual(['admissions_office', 'admissions_admin']);
  });
});

describe('Admissions Office lane authority', () => {
  it('gives Staff no stage move', () => {
    ['Submitted', 'For Verification', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released']
      .forEach((status) => expect(getNextApplicationStatuses(status, 'admissions_office')).toEqual([]));
  });

  it('gives the Admin every preparation stage', () => {
    ['Submitted', 'Under Review', 'For Verification', 'Endorsed', 'Interview']
      .forEach((status) => expect(getNextApplicationStatuses(status, 'admissions_admin').length).toBeGreaterThan(0));
  });

  it('keeps the Admin approval override and gives the Admin the final check', () => {
    expect(getNextApplicationStatuses('Recommended', 'admissions_admin')).toEqual(['Approved', 'Rejected']);
    expect(getNextApplicationStatuses('Approved', 'admissions_admin')).toEqual(['Released', 'Rejected']);
    expect(ADMISSIONS_APPROVAL_STATUSES).toEqual(['Approved']);
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

  it('keeps the Admin decision queue out of the Staff review queue', () => {
    expect(getReviewQueue(applications).map((entry) => entry.id)).toEqual(['submitted', 'verification']);
  });

  it('gives the Admin the approval queue', () => {
    expect(getApprovalQueue(applications).map((entry) => entry.id)).toEqual(['recommended']);
  });
});

describe('Admissions Office actor labels', () => {
  it('distinguishes Staff verification from Admin approval in the status history', () => {
    expect(describeStatusActor({ actorRole: 'admissions_office', actorName: 'Ben Reyes' }, true)).toBe('Ben Reyes');
    expect(describeStatusActor({ actorRole: 'admissions_office', actorName: null }, true)).toBe('Admissions Office Staff');
    expect(describeStatusActor({ actorRole: 'admissions_admin', actorName: null }, true)).toBe('Admissions Office Admin');
  });
});
