import { describe, expect, it } from 'vitest';
import { ADMISSIONS_HEAD_DECISION_STATUSES, AUTOMATIC_STAGE_STATUSES, applicationStatuses, countApplicationsToReview, getApplicationStatusGuidance, getApplicationStatusLabel, getNextApplicationStatuses, getStageActionLabel } from '../src/lib/constants';

const application = (overrides = {}) => ({
  id: overrides.id || 'app-1',
  studentId: overrides.studentId || 'student-1',
  studentDepartment: overrides.studentDepartment || 'College of Computer Studies (CCS)',
  status: overrides.status || 'Submitted',
  ...overrides,
});

describe('role-aware application stage actions', () => {
  it('gives the endorsement decision to the Admissions Office Head, never the Department Chair', () => {
    // SOP step 4 is a central decision: Staff hand the case off and the Head
    // records the endorsement. The Chair has read-only department visibility.
    expect(getNextApplicationStatuses('For Endorsement', 'admissions_head')).toEqual(['Endorsed', 'Rejected']);
    expect(getNextApplicationStatuses('For Endorsement', 'admissions_office')).toEqual([]);
    expect(getNextApplicationStatuses('For Endorsement', 'department_chair')).toEqual([]);
    expect(getNextApplicationStatuses('Endorsed', 'department_chair')).toEqual([]);
    expect(getNextApplicationStatuses('Interview', 'department_chair')).toEqual([]);
  });

  it('reserves preparation actions for Admissions Office Staff', () => {
    expect(getNextApplicationStatuses('For Verification', 'admissions_office')).toEqual(['For Endorsement', 'Rejected']);
    // The Staff lane stops at the hand-off on purpose: only the Head endorses.
    expect(getNextApplicationStatuses('For Endorsement', 'admissions_office')).toEqual([]);
    // scheduleInterview and recordDeliberation in App.jsx pass through this map.
    expect(getNextApplicationStatuses('Endorsed', 'admissions_office')).toEqual(['Interview', 'Rejected']);
    expect(getNextApplicationStatuses('Interview', 'admissions_office')).toEqual(['Recommended', 'Rejected']);
    // Approval and release are the Head's decisions.
    expect(getNextApplicationStatuses('Recommended', 'admissions_office')).toEqual([]);
    expect(getNextApplicationStatuses('Approved', 'admissions_office')).toEqual([]);
  });

  it('gives the Admissions Office Head the full pipeline plus approval and release', () => {
    expect(getNextApplicationStatuses('Submitted', 'admissions_head')).toEqual(['Under Review', 'For Verification', 'Rejected']);
    expect(getNextApplicationStatuses('For Verification', 'admissions_head')).toEqual(['For Endorsement', 'Rejected']);
    expect(getNextApplicationStatuses('For Endorsement', 'admissions_head')).toEqual(['Endorsed', 'Rejected']);
    expect(getNextApplicationStatuses('Endorsed', 'admissions_head')).toEqual(['Interview', 'Rejected']);
    expect(getNextApplicationStatuses('Interview', 'admissions_head')).toEqual(['Recommended', 'Rejected']);
    expect(getNextApplicationStatuses('Recommended', 'admissions_head')).toEqual(['Approved', 'Rejected']);
    expect(getNextApplicationStatuses('Approved', 'admissions_head')).toEqual(['Released']);
    expect(getNextApplicationStatuses('Released', 'admissions_head')).toEqual([]);
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
    application({ id: 'a-recommended', studentId: 'student-1', status: 'Recommended' }),
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
    // so Draft, Submitted, Under Review, For Endorsement, Recommended, and
    // Released count.
    expect(countApplicationsToReview(applications, { role: 'student', studentId: 'student-1' })).toBe(6);
    expect(countApplicationsToReview(applications, { role: 'student', studentId: 'student-2' })).toBe(1);
  });

  it('counts only Staff-actionable applications for Admissions Office Staff', () => {
    // Recommended has moved to the Head's lane, so Staff see Submitted, Under
    // Review, and the two For Endorsement cases.
    expect(countApplicationsToReview(applications, { role: 'admissions_office' })).toBe(4);
  });

  it('counts the officer cases plus the unclaimed intake pool when the roster is supplied', () => {
    const caseOfficers = [
      { id: 'co-1', applicationId: 'a-review', officerId: 'officer-a', leftAt: null },
      { id: 'co-2', applicationId: 'a-verify', officerId: 'officer-b', leftAt: null },
      // A left row never counts; the case it covered is unclaimed again.
      { id: 'co-3', applicationId: 'a-submitted', officerId: 'officer-a', leftAt: '2026-10-05T00:00:00.000Z' },
    ];

    // officer-a: its own case (a-review) plus the unclaimed Submitted case and the
    // uncounted For Endorsement case nobody holds.
    expect(countApplicationsToReview(applications, {
      role: 'admissions_office',
      caseOfficers,
      userId: 'officer-a',
    })).toBe(3);

    // officer-b: its own case plus the two unclaimed ones.
    expect(countApplicationsToReview(applications, {
      role: 'admissions_office',
      caseOfficers,
      userId: 'officer-b',
    })).toBe(3);

    // Without a userId the roster cannot scope anything, so the office-wide count
    // is unchanged.
    expect(countApplicationsToReview(applications, { role: 'admissions_office', caseOfficers })).toBe(4);
  });

  it('counts the endorsement, approval, and release decisions for the Admissions Office Head', () => {
    // The Head owns SOP step 4 as well as approval and release, so a case waiting
    // on the endorsement decision is part of the Head's review count.
    expect(ADMISSIONS_HEAD_DECISION_STATUSES).toEqual(['For Endorsement', 'Recommended', 'Approved']);
    const expected = applications.filter((entry) => ADMISSIONS_HEAD_DECISION_STATUSES.includes(entry.status)).length;
    expect(countApplicationsToReview(applications, { role: 'admissions_head' })).toBe(expected);
    expect(countApplicationsToReview(applications, { role: 'admissions_head' })).toBe(4);
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

  it('counts the department cases a Chair can read once documents are under verification', () => {
    // The Chair has no stage action, so the count is what the department has in
    // flight with the Admissions Office, including files under verification.
    const withVerification = [
      ...applications,
      application({ id: 'a-docverify', studentId: 'student-3', status: 'For Verification' }),
    ];
    expect(countApplicationsToReview(withVerification, {
      role: 'department_chair',
      department: 'College of Computer Studies (CCS)',
    })).toBe(4);
  });

  it('tolerates malformed collections', () => {
    expect(countApplicationsToReview(undefined, { role: 'student', studentId: 'student-1' })).toBe(0);
    expect(countApplicationsToReview(null, { role: 'admissions_office' })).toBe(0);
  });
});

// getNextApplicationStatuses is the single source of stage authority: the role
// maps in constants.js are what App.jsx's changeApplicationStatus guard reads.
describe('department chair transition map', () => {
  it('leaves the Chair with no stage move', () => {
    // Endorsement moved to the Office of Admissions & Aid: Staff hand off and the
    // Head endorses. The Chair keeps read-only department visibility and the
    // SOP 5a panel work, neither of which is a status transition.
    ['Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved']
      .forEach((status) => expect(getNextApplicationStatuses(status, 'department_chair')).toEqual([]));
  });
});

describe('transition map completeness', () => {
  const roles = ['student', 'admissions_office', 'admissions_head', 'department_chair'];

  // Stored statuses stay as the database records them; the surfaces show the
  // Standard Procedure phase instead (`Endorsed` reads "Endorsement", and the
  // hand-off stage reads "Awaiting Endorsement" so the pair is not confused).
  it('shows the endorsement phase for the stored Endorsed status', () => {
    expect(getApplicationStatusLabel('Endorsed')).toBe('Endorsement');
    expect(getApplicationStatusLabel('For Endorsement')).toBe('Awaiting Endorsement');
  });

  it('keeps every other status label identical to the stored value', () => {
    applicationStatuses
      .filter((status) => !['Endorsed', 'For Endorsement'].includes(status))
      .forEach((status) => expect(getApplicationStatusLabel(status)).toBe(status));
  });

  it('labels the Admissions Office hand-off as sending the application for endorsement', () => {
    expect(getStageActionLabel('For Endorsement', 'admissions_office')).toBe('Send to endorsement');
    expect(getStageActionLabel('Endorsed', 'admissions_head')).toBe('Endorse');
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
    expect(getStageActionLabel('For Verification', 'department_chair')).toBe('Continue to verification');
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

