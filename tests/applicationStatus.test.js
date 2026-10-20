import { describe, expect, it } from 'vitest';
import { ADMISSIONS_REVIEW_EXCLUDED_STATUSES, AUTOMATIC_STAGE_STATUSES, applicationStatuses, countApplicationsToReview, getApplicationStatusGuidance, getApplicationStatusLabel, getNextApplicationStatuses, getStageActionLabel } from '../src/lib/constants';

const application = (overrides = {}) => ({
  id: overrides.id || 'app-1',
  studentId: overrides.studentId || 'student-1',
  studentDepartment: overrides.studentDepartment || 'College of Computer Studies (CCS)',
  status: overrides.status || 'Submitted',
  ...overrides,
});

describe('role-aware application stage actions', () => {
  it('lets the Department Chair endorse but not conduct central review decisions', () => {
    expect(getNextApplicationStatuses('For Endorsement', 'department_chair')).toEqual(['Endorsed']);
    expect(getNextApplicationStatuses('Endorsed', 'department_chair')).toEqual([]);
    expect(getNextApplicationStatuses('Interview', 'department_chair')).toEqual([]);
  });

  it('reserves verification, interview, approval, and release actions for Admissions Office', () => {
    expect(getNextApplicationStatuses('For Verification', 'admissions_office')).toEqual(['For Endorsement', 'Rejected']);
    // scheduleInterview and recordDeliberation in App.jsx pass through this map.
    expect(getNextApplicationStatuses('Endorsed', 'admissions_office')).toEqual(['Interview', 'Rejected']);
    expect(getNextApplicationStatuses('Interview', 'admissions_office')).toEqual(['Recommended', 'Rejected']);
    expect(getNextApplicationStatuses('Recommended', 'admissions_office')).toContain('Approved');
    expect(getNextApplicationStatuses('Approved', 'admissions_office')).toEqual(['Released']);
  });

  it('preserves the generic legacy status map when no role is supplied', () => {
    expect(getNextApplicationStatuses('For Verification')).toEqual(['For Endorsement', 'Rejected']);
  });
});

// Opening an application starts its review, so "Under Review" is a move the
// review surface performs itself rather than a button in the action bar.
describe('automatic review start', () => {
  it('marks Under Review as an automatic transition', () => {
    expect(AUTOMATIC_STAGE_STATUSES).toEqual(['Under Review']);
  });

  it('still permits the automatic write and the direct verification fallback', () => {
    // changeApplicationStatus guards the automatic write with this map, and a
    // Submitted application may still continue straight to verification when
    // that write did not land.
    expect(getNextApplicationStatuses('Submitted', 'admissions_office')).toEqual(['Under Review', 'For Verification', 'Rejected']);
  });
});

describe('countApplicationsToReview', () => {
  const applications = [
    application({ id: 'a-draft', studentId: 'student-1', status: 'Draft' }),
    application({ id: 'a-submitted', studentId: 'student-1', status: 'Submitted' }),
    application({ id: 'a-review', studentId: 'student-1', status: 'Under Review' }),
    application({ id: 'a-verify', studentId: 'student-1', status: 'For Endorsement' }),
    application({ id: 'a-approved', studentId: 'student-1', status: 'Approved' }),
    application({ id: 'a-released', studentId: 'student-1', status: 'Released' }),
    application({ id: 'a-rejected', studentId: 'student-1', status: 'Rejected' }),
    application({
      id: 'a-other-dept',
      studentId: 'student-2',
      studentDepartment: 'School of Business and Governance (SBG)',
      status: 'For Endorsement',
    }),
  ];

  it('counts a student\'s own live applications, excluding Rejected and Approved', () => {
    // Only Rejected and Approved are closed for a student (preserved behavior),
    // so Draft, Submitted, Under Review, For Verification, and Released count.
    expect(countApplicationsToReview(applications, { role: 'student', studentId: 'student-1' })).toBe(5);
    expect(countApplicationsToReview(applications, { role: 'student', studentId: 'student-2' })).toBe(1);
  });

  it('counts every application awaiting an Admissions Office SOP action', () => {
    const expected = applications.filter((entry) => !ADMISSIONS_REVIEW_EXCLUDED_STATUSES.includes(entry.status)).length;
    expect(countApplicationsToReview(applications, { role: 'admissions_office' })).toBe(expected);
    expect(countApplicationsToReview(applications, { role: 'admissions_office' })).toBe(4);
  });

  it('counts only the department\'s pending queue for a Department Chair', () => {
    expect(countApplicationsToReview(applications, {
      role: 'department_chair',
      department: 'College of Computer Studies (CCS)',
    })).toBe(3);

    expect(countApplicationsToReview(applications, {
      role: 'department_chair',
      department: 'School of Business and Governance (SBG)',
    })).toBe(1);

    expect(countApplicationsToReview(applications, {
      role: 'department_chair',
      department: 'Unassigned Department',
    })).toBe(0);
  });

  it('tolerates malformed collections', () => {
    expect(countApplicationsToReview(undefined, { role: 'student', studentId: 'student-1' })).toBe(0);
    expect(countApplicationsToReview(null, { role: 'admissions_office' })).toBe(0);
  });
});

// getNextApplicationStatuses is the single source of stage authority: the role
// maps in constants.js are what App.jsx's changeApplicationStatus guard reads.
describe('department chair transition map', () => {
  it('lets a Chair flag live applications for central validation', () => {
    expect(getNextApplicationStatuses('Submitted', 'department_chair')).toEqual(['For Verification']);
    expect(getNextApplicationStatuses('Under Review', 'department_chair')).toEqual(['For Verification']);
  });

  it('lets a Chair endorse only an application sent to endorsement', () => {
    expect(getNextApplicationStatuses('For Verification', 'department_chair')).toEqual([]);
    expect(getNextApplicationStatuses('For Endorsement', 'department_chair')).toEqual(['Endorsed']);
    expect(getNextApplicationStatuses('Endorsed', 'department_chair')).toEqual([]);
    expect(getNextApplicationStatuses('Approved', 'department_chair')).toEqual([]);
  });
});

describe('transition map completeness', () => {
  const roles = ['student', 'admissions_office', 'department_chair'];

  // Stored statuses stay as the database records them; the surfaces show the
  // Standard Procedure phase instead (`Endorsed` reads "Endorsement").
  it('shows the endorsement phase for the stored Endorsed status', () => {
    expect(getApplicationStatusLabel('Endorsed')).toBe('Endorsement');
  });

  it('keeps every other status label identical to the stored value', () => {
    applicationStatuses
      .filter((status) => status !== 'Endorsed')
      .forEach((status) => expect(getApplicationStatusLabel(status)).toBe(status));
  });

  it('labels the Admissions Office hand-off as sending the application to endorsement', () => {
    expect(getStageActionLabel('For Endorsement', 'admissions_office')).toBe('Send to endorsement');
    expect(getStageActionLabel('Endorsed', 'department_chair')).toBe('Endorse');
  });

  it('returns only known statuses for every role and status pair', () => {
    applicationStatuses.forEach((status) => {
      roles.forEach((role) => {
        const next = getNextApplicationStatuses(status, role);
        expect(Array.isArray(next)).toBe(true);
        next.forEach((target) => expect(applicationStatuses).toContain(target));
      });
    });
  });

  it('labels every permitted transition for the review action bar', () => {
    applicationStatuses.forEach((status) => {
      roles.forEach((role) => {
        getNextApplicationStatuses(status, role).forEach((target) => {
          const label = getStageActionLabel(target, role);
          // A real verb, not the raw status falling through.
          expect(label).toBeTruthy();
          expect(label).not.toBe(target);
        });
      });
    });
    expect(getStageActionLabel('For Verification', 'department_chair')).toBe('Flag for central validation');
    expect(getStageActionLabel('For Verification', 'admissions_office')).toBe('Continue to verification');
    expect(getStageActionLabel('Interview', 'admissions_office')).toBe('Schedule interview');
  });

  it('gives every status a student-facing next step', () => {
    applicationStatuses.forEach((status) => {
      expect(getApplicationStatusGuidance(status)).toBeTruthy();
    });
    expect(getApplicationStatusGuidance('For Verification')).toContain('verification');
    expect(getApplicationStatusGuidance('For Verification')).toContain('replacement');
  });

  it('never lets a role advance out of a terminal status', () => {
    roles.forEach((role) => {
      expect(getNextApplicationStatuses('Released', role)).toEqual([]);
      expect(getNextApplicationStatuses('Rejected', role)).toEqual([]);
    });
  });
});

