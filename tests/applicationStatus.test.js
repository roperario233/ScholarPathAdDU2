import { describe, expect, it } from 'vitest';
import { ADMISSIONS_HEAD_DECISION_STATUSES, AUTOMATIC_STAGE_STATUSES, STUDENT_DELIBERATION_STATUS, applicationStatuses, countApplicationsToReview, getApplicationStatusGuidance, getApplicationStatusLabel, getNextApplicationStatuses, getStageActionLabel, getStudentFacingStatus, maskApplicationForStudent, sopStageIndex, sopStages } from '../src/lib/constants';
import { academicPrograms } from '../src/lib/academicPrograms';

const application = (overrides = {}) => ({
  id: overrides.id || 'app-1',
  studentId: overrides.studentId || 'student-1',
  studentDepartment: overrides.studentDepartment || 'School of Arts and Sciences (SAS)',
  studentSchool: overrides.studentSchool || 'School of Arts and Sciences (SAS)',
  status: overrides.status || 'Submitted',
  ...overrides,
});

// Consultation 2 (Oct 27): the Head verifies and forwards, an interviewer (or a
// ladder account in scope) schedules and recommends, the school's approving level
// approves, and the Head does the final check and releases. Staff only read.
describe('role-aware application stage actions', () => {
  it('leaves Admissions Office Staff with a read-only view', () => {
    applicationStatuses.forEach((status) => {
      expect(getNextApplicationStatuses(status, 'admissions_office')).toEqual([]);
    });
  });

  it('lets the Head verify, forward straight to interview, override, and close the final check', () => {
    expect(getNextApplicationStatuses('Submitted', 'admissions_head')).toEqual(['Under Review', 'For Verification', 'Rejected']);
    // The separate endorsement hand-off is retired: the verified case goes
    // straight to the interviewers of its scope.
    expect(getNextApplicationStatuses('For Verification', 'admissions_head')).toEqual(['Endorsed', 'Rejected']);
    // A legacy row still waiting at For Endorsement can leave the stage.
    expect(getNextApplicationStatuses('For Endorsement', 'admissions_head')).toEqual(['Endorsed', 'Rejected']);
    expect(getNextApplicationStatuses('Endorsed', 'admissions_head')).toEqual(['Interview', 'Rejected']);
    expect(getNextApplicationStatuses('Interview', 'admissions_head')).toEqual(['Recommended', 'Rejected']);
    expect(getNextApplicationStatuses('Recommended', 'admissions_head')).toEqual(['Approved', 'Rejected']);
    // The final check may still end the application before release.
    expect(getNextApplicationStatuses('Approved', 'admissions_head')).toEqual(['Released', 'Rejected']);
    expect(getNextApplicationStatuses('Released', 'admissions_head')).toEqual([]);
  });

  it('lets an interviewer schedule, and recommend only from the panel, but never reject or approve', () => {
    expect(getNextApplicationStatuses('Endorsed', 'interviewer')).toEqual(['Interview']);
    expect(getNextApplicationStatuses('Interview', 'interviewer')).toEqual([]);
    expect(getNextApplicationStatuses('Interview', 'interviewer', { isPanelist: true })).toEqual(['Recommended']);
    expect(getNextApplicationStatuses('Recommended', 'interviewer', { isPanelist: true, isApprover: true })).toEqual([]);
    expect(getNextApplicationStatuses('For Verification', 'interviewer')).toEqual([]);
  });

  it('lets a ladder account run the interview itself and approve only as the configured level', () => {
    ['department_chair', 'assistant_dean', 'dean'].forEach((role) => {
      expect(getNextApplicationStatuses('Endorsed', role)).toEqual(['Interview']);
      expect(getNextApplicationStatuses('Interview', role, { isPanelist: true })).toEqual(['Recommended']);
      expect(getNextApplicationStatuses('Recommended', role)).toEqual([]);
      expect(getNextApplicationStatuses('Recommended', role, { isApprover: true })).toEqual(['Approved', 'Rejected']);
      // Verification and release stay with the Head.
      expect(getNextApplicationStatuses('For Verification', role, { isApprover: true })).toEqual([]);
      expect(getNextApplicationStatuses('Approved', role, { isApprover: true })).toEqual([]);
    });
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
    // that write did not land. Only the Head opens a case into review now.
    expect(getNextApplicationStatuses('Submitted', 'admissions_head')).toEqual(['Under Review', 'For Verification', 'Rejected']);
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
      studentSchool: 'School of Business and Governance (SBG)',
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

  it('counts the verification queue, legacy endorsements, and the final check for the Head', () => {
    // The Head verifies every file and does the final check before release; a
    // recommendation now waits on the school's approver instead.
    expect(ADMISSIONS_HEAD_DECISION_STATUSES).toEqual(['Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Approved']);
    const expected = applications.filter((entry) => ADMISSIONS_HEAD_DECISION_STATUSES.includes(entry.status)).length;
    expect(countApplicationsToReview(applications, { role: 'admissions_head' })).toBe(expected);
    expect(countApplicationsToReview(applications, { role: 'admissions_head' })).toBe(5);
  });

  it('counts the in-scope interview work and decisions for a Chairperson', () => {
    const work = [
      application({ id: 'w-endorsed', status: 'Endorsed' }),
      application({ id: 'w-interview', status: 'Interview' }),
      application({ id: 'w-recommended', status: 'Recommended' }),
      application({ id: 'w-submitted', status: 'Submitted' }),
      application({ id: 'w-other', studentSchool: 'School of Business and Governance (SBG)', studentDepartment: 'School of Business and Governance (SBG)', status: 'Interview' }),
    ];
    // An unscoped Chairperson keeps the legacy school-wide read.
    expect(countApplicationsToReview(work, {
      role: 'department_chair',
      department: 'School of Arts and Sciences (SAS)',
    })).toBe(3);
    expect(countApplicationsToReview(work, {
      role: 'department_chair',
      department: 'Unassigned Department',
    })).toBe(0);
  });

  it('counts only the interview work for an interviewer', () => {
    const work = [
      application({ id: 'i-cs-endorsed', studentProgram: 'BS Computer Science', status: 'Endorsed' }),
      application({ id: 'i-cs-recommended', studentProgram: 'BS Computer Science', status: 'Recommended' }),
      application({ id: 'i-bio-endorsed', studentProgram: 'BS Biology Major in General Biology', status: 'Endorsed' }),
    ];
    expect(countApplicationsToReview(work, {
      role: 'interviewer',
      reviewScope: { role: 'interviewer', reviewSchool: 'School of Arts and Sciences (SAS)', reviewCluster: 'Computer Studies' },
      programs: academicPrograms,
    })).toBe(1);
  });

  it('scopes a Chairperson to one department and an Assistant Dean to a cluster', () => {
    const ladder = [
      application({ id: 'l-cs', studentProgram: 'BS Computer Science', studentDepartment: 'Computer Science Department', studentSchool: 'School of Arts and Sciences (SAS)', status: 'Endorsed' }),
      application({ id: 'l-bio', studentProgram: 'BS Biology Major in General Biology', studentDepartment: 'Biology Department', studentSchool: 'School of Arts and Sciences (SAS)', status: 'Endorsed' }),
    ];
    const chair = { role: 'department_chair', reviewDepartment: 'Computer Science Department' };
    expect(countApplicationsToReview(ladder, { role: chair.role, reviewScope: chair, programs: academicPrograms })).toBe(1);

    // The Assistant Dean of the cluster sees its own cluster's cases only.
    expect(countApplicationsToReview(ladder, {
      role: 'assistant_dean',
      reviewScope: { role: 'assistant_dean', reviewSchool: 'School of Arts and Sciences (SAS)', reviewCluster: 'Computer Studies' },
      programs: academicPrograms,
    })).toBe(1);

    expect(countApplicationsToReview(ladder, {
      role: 'assistant_dean',
      reviewScope: { role: 'assistant_dean', reviewSchool: 'School of Arts and Sciences (SAS)', reviewCluster: 'Natural Sciences and Mathematics' },
      programs: academicPrograms,
    })).toBe(1);

    // A Dean of the school sees both.
    expect(countApplicationsToReview(ladder, {
      role: 'dean',
      reviewScope: { role: 'dean', reviewSchool: 'School of Arts and Sciences (SAS)' },
      programs: academicPrograms,
    })).toBe(2);

    // A Dean of another school sees neither.
    expect(countApplicationsToReview(ladder, {
      role: 'dean',
      reviewScope: { role: 'dean', reviewSchool: 'School of Nursing (SON)' },
      programs: academicPrograms,
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
  it('gives the Chair no move before the interview or after the approval', () => {
    ['Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Approved']
      .forEach((status) => expect(getNextApplicationStatuses(status, 'department_chair', { isPanelist: true, isApprover: true })).toEqual([]));
  });
});

// Results are released per scholarship (Consultation 2, #8 and #13): until then a
// student reads "Under deliberation" instead of the outcome.
describe('student-facing results hold', () => {
  const releases = [{ id: 'r-1', applicationIds: ['released-reject'] }];

  it('holds Approved and an unreleased Rejected as Under deliberation', () => {
    expect(getStudentFacingStatus({ id: 'a', status: 'Approved' }, releases)).toBe(STUDENT_DELIBERATION_STATUS);
    expect(getStudentFacingStatus({ id: 'held-reject', status: 'Rejected' }, releases)).toBe(STUDENT_DELIBERATION_STATUS);
    expect(getStudentFacingStatus({ id: 'released-reject', status: 'Rejected' }, releases)).toBe('Rejected');
    expect(getStudentFacingStatus({ id: 'b', status: 'Released' }, releases)).toBe('Released');
    expect(getStudentFacingStatus({ id: 'c', status: 'Interview' }, [])).toBe('Interview');
  });

  it('drops the held outcome from the timeline and status log', () => {
    const masked = maskApplicationForStudent({
      id: 'held-reject',
      status: 'Rejected',
      timeline: [{ stage: 'Interview' }, { stage: 'Rejected', note: 'Application not accepted.' }],
      statusLog: [{ toStatus: 'Recommended' }, { toStatus: 'Rejected' }],
    }, releases);
    expect(masked.status).toBe(STUDENT_DELIBERATION_STATUS);
    expect(masked.timeline.map((entry) => entry.stage)).toEqual(['Interview']);
    expect(masked.statusLog.map((entry) => entry.toStatus)).toEqual(['Recommended']);
    expect(getApplicationStatusGuidance(STUDENT_DELIBERATION_STATUS)).toContain('same time');
  });

  it('passes a released result through unchanged', () => {
    const released = { id: 'released-reject', status: 'Rejected', timeline: [] };
    expect(maskApplicationForStudent(released, releases)).toBe(released);
  });
});

describe('transition map completeness', () => {
  const roles = ['student', 'admissions_office', 'admissions_head', 'department_chair', 'interviewer'];

  // Stored statuses stay as the database records them; the surfaces show the
  // stage instead (`Endorsed` is where the verified case waits for its interview,
  // and a legacy hand-off still reads "Awaiting Endorsement").
  it('shows the interview stage for the stored Endorsed status', () => {
    expect(getApplicationStatusLabel('Endorsed')).toBe('For Interview');
    expect(getApplicationStatusLabel('For Endorsement')).toBe('Awaiting Endorsement');
  });

  it('drops the retired hand-off from the stage track but places a legacy row at verification', () => {
    expect(sopStages).not.toContain('For Endorsement');
    expect(sopStageIndex('For Endorsement')).toBe(sopStageIndex('For Verification'));
  });

  it('keeps every other status label identical to the stored value', () => {
    applicationStatuses
      .filter((status) => !['Endorsed', 'For Endorsement'].includes(status))
      .forEach((status) => expect(getApplicationStatusLabel(status)).toBe(status));
  });

  it('labels the Head forwarding a verified case to interview', () => {
    expect(getStageActionLabel('Endorsed', 'admissions_head')).toBe('Forward to interview');
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
    expect(getStageActionLabel('Interview', 'interviewer')).toBe('Schedule interview');
    expect(getStageActionLabel('Interview', 'admissions_head')).toBe('Schedule as Head (override)');
    expect(getStageActionLabel('Recommended', 'admissions_head')).toBe('Recommend as Head (override)');
    expect(getStageActionLabel('Approved', 'admissions_head')).toBe('Approve as Head (override)');
    // Only the Head's own moves keep the plain verb: release is the Head's job.
    expect(getStageActionLabel('Released', 'admissions_head')).toBe('Release results');
    expect(getStageActionLabel('Approved', 'department_chair')).toBe('Approve');
    expect(getStageActionLabel('Recommended', 'interviewer')).toBe('Recommend for approval');
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

