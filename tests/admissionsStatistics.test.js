import { describe, expect, it } from 'vitest';
import {
  buildOfficeStatistics,
  buildStatisticsSheets,
  filterStatisticsApplications,
  getAcademicYearOptions,
  getApplicantProfileStats,
  getApproverStats,
  getBreakdownByHierarchy,
  getMyInterviewStats,
  getStatisticsScope,
  getDocumentStats,
  getHeadlineStats,
  getPanelRecommendationStats,
  getStageFunnel,
  getStageTurnaround,
  getStatusEntryTimes,
  getSubmissionTrend,
  percentile,
} from '../src/lib/admissionsStatistics';
import { buildProgramScopeIndex } from '../src/lib/reviewScope';

const programIndex = buildProgramScopeIndex([
  { value: 'BS Computer Science', school: 'School of Arts and Sciences', cluster: 'Computer Studies', department: 'Computer Science' },
  { value: 'BS Civil Engineering', school: 'School of Engineering and Architecture', cluster: '', department: 'Civil Engineering' },
]);

const day = (n) => new Date(Date.UTC(2026, 6, 1 + n)).toISOString();

const log = (...steps) => steps.map(([toStatus, n], index) => ({ id: `log-${index}`, toStatus, at: day(n) }));

const application = (overrides = {}) => ({
  id: 'app-1',
  status: 'Submitted',
  studentName: 'Ada Cruz',
  studentProgram: 'BS Computer Science',
  studentSchool: 'School of Arts and Sciences',
  scholarshipId: 'gia',
  scholarshipTitle: 'Grant-in-Aid (GIA)',
  submittedAt: day(0),
  updatedAt: day(0),
  attachedDocuments: [],
  statusLog: [],
  timeline: [],
  ...overrides,
});

describe('admissions statistics', () => {
  const released = application({
    id: 'released',
    status: 'Released',
    statusLog: log(['For Verification', 2], ['Endorsed', 6], ['Interview', 8], ['Recommended', 10], ['Approved', 12], ['Released', 14]),
  });
  const rejected = application({
    id: 'rejected',
    status: 'Rejected',
    studentProgram: 'BS Civil Engineering',
    studentSchool: 'School of Engineering and Architecture',
    statusLog: log(['For Verification', 1], ['Endorsed', 3], ['Interview', 4], ['Recommended', 5], ['Rejected', 9]),
  });
  const open = application({ id: 'open', status: 'For Verification', statusLog: log(['For Verification', 3]) });
  const draft = application({ id: 'draft', status: 'Draft', submittedAt: null });
  const all = [released, rejected, open, draft];

  it('never counts drafts', () => {
    expect(getHeadlineStats(all).submitted).toBe(3);
    expect(filterStatisticsApplications(all, {})).toHaveLength(3);
  });

  it('reads the acceptance rate and decision time from decided cases', () => {
    const headline = getHeadlineStats(all);
    expect(headline.accepted).toBe(1);
    expect(headline.notAccepted).toBe(1);
    expect(headline.acceptanceRate).toBe(0.5);
    expect(headline.open).toBe(1);
    // 12 days (approved) and 9 days (rejected).
    expect(headline.medianDaysToDecision).toBe(10.5);
  });

  it('filters by academic year, scholarship, and school', () => {
    const nextYear = application({ id: 'later', submittedAt: '2027-07-01T00:00:00.000Z' });
    const list = [...all, nextYear];
    expect(getAcademicYearOptions(list, new Date('2026-08-01'))).toEqual(['2027-2028', '2026-2027']);
    expect(filterStatisticsApplications(list, { academicYear: '2026-2027' }).map((entry) => entry.id)).toEqual(['released', 'rejected', 'open']);
    expect(filterStatisticsApplications(list, { school: 'School of Engineering and Architecture' }, programIndex).map((entry) => entry.id)).toEqual(['rejected']);
    expect(filterStatisticsApplications(list, { scholarshipId: 'jubilee' })).toHaveLength(0);
  });

  it('builds the funnel from the status log, falling back to the timeline and the current status', () => {
    const fromTimeline = application({ id: 'timeline', status: 'Rejected', timeline: [{ stage: 'Interview', at: day(4) }] });
    const noHistory = application({ id: 'bare', status: 'Recommended' });
    const funnel = getStageFunnel([released, open, fromTimeline, noHistory]);
    const count = (status) => funnel.find((row) => row.status === status).count;
    expect(count('Submitted')).toBe(4);
    expect(count('Interview')).toBe(3);
    expect(count('Recommended')).toBe(2);
    expect(count('Released')).toBe(1);
    expect(funnel.find((row) => row.status === 'Endorsed').label).toBe('For Interview');
    expect(getStatusEntryTimes(fromTimeline).Interview).toBe(new Date(day(4)).getTime());
  });

  it('measures each step and flags a median over the target', () => {
    const turnaround = Object.fromEntries(getStageTurnaround(all).map((row) => [row.key, row]));
    expect(turnaround.intake.count).toBe(3);
    expect(turnaround.intake.median).toBe(2);
    expect(turnaround.verification.median).toBe(3);
    expect(turnaround.approval.median).toBe(3);
    expect(turnaround.approval.overTarget).toBe(false);
    expect(turnaround.release.count).toBe(1);
    const slow = application({ id: 'slow', status: 'For Verification', statusLog: log(['For Verification', 20]) });
    expect(getStageTurnaround([slow]).find((row) => row.key === 'intake').overTarget).toBe(true);
  });

  it('computes median and percentile by nearest rank', () => {
    expect(percentile([5, 1, 3])).toBe(3);
    expect(percentile([1, 2, 3, 4])).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([])).toBeNull();
  });

  it('fills gaps in the submission trend', () => {
    const list = [
      application({ id: 'a', submittedAt: '2026-07-10T00:00:00.000Z' }),
      application({ id: 'b', submittedAt: '2026-09-02T00:00:00.000Z' }),
    ];
    expect(getSubmissionTrend(list, { bucket: 'month' }).map((row) => row.count)).toEqual([1, 0, 1]);
  });

  it('groups schools and departments through the program taxonomy', () => {
    const rows = getBreakdownByHierarchy(all, programIndex);
    const sas = rows.find((row) => row.label === 'School of Arts and Sciences');
    expect(sas.applied).toBe(2);
    expect(sas.children[0]).toMatchObject({ label: 'Computer Science', applied: 2, accepted: 1, inProgress: 1 });
  });

  it('breaks a Dean down by cluster and a Chairperson by program', () => {
    const byCluster = getBreakdownByHierarchy(all, programIndex, { parent: 'cluster', child: 'department' });
    expect(byCluster.map((row) => row.label).sort()).toEqual(['Computer Studies', 'Direct under the school']);
    const byProgram = getBreakdownByHierarchy(all, programIndex, { parent: 'program', child: null });
    expect(byProgram.every((row) => row.children.length === 0)).toBe(true);
    expect(byProgram[0]).toMatchObject({ applied: 2 });
  });

  it('counts only files attached to submitted applications and groups revert reasons', () => {
    const withFiles = [
      application({ id: 'one', attachedDocuments: ['d1', 'd2', 'd3'] }),
      application({ id: 'draft', status: 'Draft', attachedDocuments: ['d4'] }),
    ];
    const documents = [
      { id: 'd1', documentType: 'Income Proof', verificationStatus: 'Rejected', rejectionReason: 'Blurry or unreadable — page 2 cut off', uploadedAt: day(0), decidedAt: day(2) },
      { id: 'd2', documentType: 'Income Proof', verificationStatus: 'Verified', uploadedAt: day(0), decidedAt: day(4) },
      { id: 'd3', documentType: 'Applicant Photo', verificationStatus: 'Pending' },
      { id: 'd4', documentType: 'Income Proof', verificationStatus: 'Rejected', rejectionReason: 'Blurry or unreadable' },
    ];
    const stats = getDocumentStats(withFiles, documents);
    expect(stats).toMatchObject({ total: 3, pending: 1, verified: 1, reverted: 1, revertRate: 0.5, medianDaysToDecision: 3 });
    expect(stats.reasons).toEqual([{ key: 'Blurry or unreadable', label: 'Blurry or unreadable', count: 1 }]);
    expect(stats.byType[0]).toMatchObject({ label: 'Income Proof', reverted: 1, revertRate: 0.5 });
  });

  it('reads the latest panel recommendation per case', () => {
    const notes = [
      { applicationId: 'released', recommendationLevel: 'recommended', createdAt: day(9) },
      { applicationId: 'released', recommendationLevel: 'highly_recommended', createdAt: day(10) },
      { applicationId: 'rejected', recommendationLevel: 'not_recommended', createdAt: day(5) },
      { applicationId: 'open', recommendationLevel: null, createdAt: day(5) },
    ];
    const stats = getPanelRecommendationStats(all, notes);
    const level = (value) => stats.levels.find((row) => row.key === value);
    expect(stats.recorded).toBe(2);
    expect(level('highly_recommended')).toMatchObject({ count: 1, accepted: 1 });
    expect(level('recommended').count).toBe(0);
    expect(level('not_recommended')).toMatchObject({ count: 1, notAccepted: 1 });
  });

  it('bands the frozen profile snapshot', () => {
    const stats = getApplicantProfileStats([
      application({ profileSnapshot: { academic: { credential: 'qpi', value: '3.2' }, householdIncome: { value: 180000 }, yearStandingLabel: 'Incoming 2nd year' } }),
      application({ id: 'two', profileSnapshot: { academic: { credential: 'hsAverage', value: 96 }, householdIncome: { value: null } } }),
      application({ id: 'three', profileSnapshot: { academic: { credential: 'qpi', value: 2.9 }, eligibility: { isTransferee: 'Yes' } } }),
    ]);
    const count = (rows, label) => rows.find((row) => row.label === label)?.count;
    expect(count(stats.applicantStatus, 'Incoming first year')).toBe(1);
    expect(count(stats.applicantStatus, 'Transferee')).toBe(1);
    expect(count(stats.qpi, '3.00 – 3.49')).toBe(1);
    expect(count(stats.qpi, '2.50 – 2.99')).toBe(1);
    expect(count(stats.shsAverage, '95 – 100')).toBe(1);
    expect(count(stats.householdIncome, '₱150,000 – ₱249,999')).toBe(1);
    expect(count(stats.householdIncome, 'Not recorded')).toBe(2);
  });

  it('decides each role’s scope and sections in one place', () => {
    const admin = getStatisticsScope('admissions_admin');
    expect(admin).toMatchObject({ audience: 'admin', showSchoolFilter: true });
    expect(admin.sections).toEqual({ outcomes: true, recommendations: true, decisions: false, myInterviews: false });

    const staff = getStatisticsScope('admissions_office');
    expect(staff.audience).toBe('staff');
    expect(staff.sections.outcomes).toBe(false);
    expect(staff.sections.recommendations).toBe(false);

    const dean = getStatisticsScope('dean', { reviewSchool: 'School of Arts and Sciences' });
    expect(dean).toMatchObject({ audience: 'reviewer', showSchoolFilter: false, scopeLabel: 'School of Arts and Sciences' });
    expect(dean.breakdown).toMatchObject({ parent: 'cluster', child: 'department' });
    expect(dean.sections.decisions).toBe(true);

    const assistantDean = getStatisticsScope('assistant_dean', { reviewSchool: 'School of Arts and Sciences', reviewCluster: 'Computer Studies' });
    expect(assistantDean.breakdown).toMatchObject({ parent: 'department', child: 'program' });

    const chair = getStatisticsScope('department_chair', { reviewSchool: 'School of Arts and Sciences', reviewDepartment: 'Computer Science' });
    expect(chair.breakdown).toMatchObject({ parent: 'program', child: null });

    const interviewer = getStatisticsScope('interviewer', { reviewSchool: 'School of Arts and Sciences', reviewDepartment: 'Computer Science' });
    expect(interviewer.sections).toMatchObject({ decisions: false, myInterviews: true });
  });

  it('never derives outcomes for a volume-only role', () => {
    const notes = [{ applicationId: 'released', recommendationLevel: 'recommended', createdAt: day(9) }];
    const stats = buildOfficeStatistics({ applications: all, interviewNotes: notes, programIndex, scope: getStatisticsScope('admissions_office') });
    expect(stats.headline).not.toHaveProperty('acceptanceRate');
    expect(stats.headline).toMatchObject({ submitted: 3, closed: 2 });
    expect(stats.recommendations).toBeNull();
    expect(stats.distribution.map((row) => row.status)).not.toContain('Approved');
    expect(stats.distribution.find((row) => row.status === 'Closed').count).toBe(2);
    expect(stats.funnel.map((row) => row.status)).toEqual(['Submitted', 'For Verification', 'Endorsed', 'Interview', 'Recommended', 'Decided']);
    expect(stats.funnel.at(-1).count).toBe(2);
    expect(stats.turnaround.map((row) => row.key)).not.toContain('release');
    expect(stats.byScholarship[0]).toEqual({ key: 'gia', label: 'Grant-in-Aid (GIA)', applied: 3, inProgress: 1 });
    const text = JSON.stringify(buildStatisticsSheets(stats));
    expect(text).not.toMatch(/Accepted|Not accepted|Acceptance rate|Panel recommendations/);
  });

  it('counts only the decisions the reviewer’s level owns', () => {
    const chair = { id: 'chair-1', role: 'department_chair', reviewSchool: 'School of Arts and Sciences', reviewDepartment: 'Computer Science' };
    const awaiting = application({ id: 'awaiting', status: 'Recommended', statusLog: log(['Recommended', 3]) });
    const notes = [{ applicationId: 'released', recommendationLevel: 'highly_recommended', createdAt: day(9) }];
    const stats = getApproverStats([released, rejected, awaiting, open], chair, [], programIndex, notes);
    // `rejected` belongs to Civil Engineering, outside this Chairperson's department.
    expect(stats).toMatchObject({ total: 2, awaiting: 1, approved: 1, notAccepted: 0, medianDaysToDecision: 2 });
    expect(stats.byLevel.find((row) => row.key === 'highly_recommended')).toMatchObject({ count: 1, approved: 1 });
    // A school routed to the Dean leaves the Chairperson nothing to decide.
    const deanLevel = [{ school: 'School of Arts and Sciences', cluster: '', approverRole: 'dean' }];
    expect(getApproverStats([released, awaiting], chair, deanLevel, programIndex).total).toBe(0);
  });

  it('reads the viewer’s own panel work', () => {
    const upcoming = application({
      id: 'upcoming',
      status: 'Interview',
      interview: { version: 2, state: 'scheduled', startsAt: '2026-12-01T01:00:00.000Z', scheduledBy: 'me' },
    });
    const panelists = [
      { applicationId: 'upcoming', profileId: 'me', isLead: true },
      { applicationId: 'released', profileId: 'me', isLead: false },
      { applicationId: 'released', profileId: 'someone-else', isLead: true },
      { applicationId: 'outside', profileId: 'me', isLead: true },
    ];
    const notes = [
      { applicationId: 'released', authorId: 'me', recommendationLevel: 'recommended', createdAt: day(9) },
      { applicationId: 'released', authorId: 'someone-else', recommendationLevel: 'not_recommended', createdAt: day(10) },
    ];
    const stats = getMyInterviewStats([released, upcoming], panelists, notes, 'me', new Date('2026-11-03T00:00:00Z'));
    expect(stats).toMatchObject({ involved: 2, onPanel: 2, leading: 1, scheduledByMe: 1, upcoming: 1, notesRecorded: 1, recommended: 1 });
    expect(stats.levels.find((row) => row.key === 'recommended').count).toBe(1);
  });

  it('exports counts without naming an applicant', () => {
    const stats = buildOfficeStatistics({ applications: all, programIndex });
    const sheets = buildStatisticsSheets(stats, { filters: 'All academic years', now: new Date('2026-11-03T00:00:00Z') });
    expect(sheets.map((sheet) => sheet.name)).toEqual(['Summary', 'By scholarship', 'By school', 'Stage turnaround', 'Documents', 'Panel recommendations']);
    const text = JSON.stringify(sheets);
    expect(text).not.toContain('Ada Cruz');
    expect(text).toContain('Grant-in-Aid (GIA)');
  });
});
