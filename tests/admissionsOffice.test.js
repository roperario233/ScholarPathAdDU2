import { describe, expect, it } from 'vitest';
import { crc32 } from '../src/lib/xlsxWriter';
import {
  buildAcceptedApplicantsReport,
  buildApplicantSummarySheets,
  buildApplicantSummaryWorkbook,
  getApplicantSummaryFileName,
  filterIntakePool,
  getFinalCheckHints,
  getReleaseGroups,
  getRoutedInterviewers,
  getApprovalQueue,
  getCaseOfficers,
  getCaseOpenedAt,
  getDocumentsAwaitingReview,
  getIntakePool,
  getInternalCatalogEntries,
  getMyReviewQueue,
  getOfficerWorkload,
  getRecentApplicationActivity,
  getReleaseQueue,
  getReviewQueue,
  getReviewStageTab,
  getSubmissionWaitDays,
  getTakenCases,
  getUnclaimedInProgress,
  isCaseOfficer,
  DEFAULT_INTAKE_POOL_FILTERS,
} from '../src/lib/admissionsOffice';
import { academicPrograms } from '../src/lib/academicPrograms';
import { buildProgramScopeIndex } from '../src/lib/reviewScope';

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

describe('getReviewQueue', () => {
  it('keeps every application that still needs an SOP action', () => {
    const queue = getReviewQueue([
      application({ id: 'draft', status: 'Draft' }),
      application({ id: 'submitted', status: 'Submitted' }),
      application({ id: 'review', status: 'Under Review' }),
      application({ id: 'verification', status: 'For Verification' }),
      application({ id: 'for-endorsement', status: 'For Endorsement' }),
      application({ id: 'endorsed', status: 'Endorsed' }),
      application({ id: 'recommended', status: 'Recommended' }),
      application({ id: 'approved', status: 'Approved' }),
      application({ id: 'released', status: 'Released' }),
      application({ id: 'rejected', status: 'Rejected' }),
    ]);

    expect(queue.map((entry) => entry.id)).toEqual(['submitted', 'review', 'verification', 'for-endorsement', 'endorsed']);
  });

  it('tolerates a missing collection', () => {
    expect(getReviewQueue(undefined)).toEqual([]);
    expect(getReviewQueue(null)).toEqual([]);
  });
});

describe('getApprovalQueue', () => {
  it('keeps only the recommendations the Admissions Office Head decides', () => {
    const queue = getApprovalQueue([
      application({ id: 'submitted', status: 'Submitted' }),
      application({ id: 'recommended-a', status: 'Recommended' }),
      application({ id: 'approved', status: 'Approved' }),
      application({ id: 'recommended-b', status: 'Recommended' }),
    ]);

    expect(queue.map((entry) => entry.id)).toEqual(['recommended-a', 'recommended-b']);
  });

  it('tolerates a missing collection', () => {
    expect(getApprovalQueue(undefined)).toEqual([]);
    expect(getApprovalQueue(null)).toEqual([]);
  });
});

describe('getDocumentsAwaitingReview', () => {
  const documents = [
    { id: 'doc-attached-pending', verificationStatus: 'Pending' },
    { id: 'doc-unattached-pending', verificationStatus: 'Pending' },
    { id: 'doc-attached-verified', verificationStatus: 'Verified' },
  ];

  it('counts only Pending files an application actually attaches', () => {
    const result = getDocumentsAwaitingReview(
      [application({ status: 'For Verification', attachedDocuments: ['doc-attached-pending', 'doc-attached-verified'] })],
      documents,
    );

    expect(result.map((entry) => entry.id)).toEqual(['doc-attached-pending']);
  });

  it('waits for the verification stage before counting an application\'s files', () => {
    const attached = ['doc-attached-pending'];

    // Files are only reviewable from the SOP verification stage on, so a
    // Submitted or Under Review application does not put work in the queue yet.
    expect(getDocumentsAwaitingReview([application({ status: 'Submitted', attachedDocuments: attached })], documents)).toEqual([]);
    expect(getDocumentsAwaitingReview([application({ status: 'Under Review', attachedDocuments: attached })], documents)).toEqual([]);
    expect(getDocumentsAwaitingReview(
      [application({ status: 'For Verification', attachedDocuments: attached })],
      documents,
    ).map((entry) => entry.id)).toEqual(['doc-attached-pending']);
  });

  it('ignores applications without an attachment list', () => {
    expect(getDocumentsAwaitingReview([{ id: 'app-x', status: 'Submitted' }], documents)).toEqual([]);
  });
});

describe('getReleaseQueue', () => {
  it('splits approved and released applications', () => {
    const approved = application({ id: 'approved', status: 'Approved' });
    const released = application({ id: 'released', status: 'Released' });

    const { approved: approvedQueue, released: releasedQueue, all } = getReleaseQueue([
      approved,
      released,
      application({ id: 'submitted', status: 'Submitted' }),
    ]);

    expect(approvedQueue).toEqual([approved]);
    expect(releasedQueue).toEqual([released]);
    expect(all.map((entry) => entry.id)).toEqual(['approved', 'released']);
  });
});

describe('getInternalCatalogEntries', () => {
  const entry = (overrides = {}) => ({
    id: 'entry',
    title: 'Grant-in-Aid (GIA)',
    category: 'Internal Endowment',
    isExternal: false,
    ruleFamily: 'general-pool',
    ...overrides,
  });

  it('keeps exactly the three Appendix A tracks', () => {
    const entries = getInternalCatalogEntries([
      entry({ id: 'gia', title: 'Grant-in-Aid (GIA)' }),
      entry({ id: 'jubilee', title: 'Jubilee Scholarship Fund (Valedictorian & Salutatorian)', ruleFamily: 'honors' }),
      // The Student Assistant program is stored under a different category, so a
      // category-based filter used to leave it out of the catalog entirely.
      entry({ id: 'sa', title: 'Student Assistant (SA) Program', category: 'Specialized Service', ruleFamily: 'work-study' }),
    ]);

    expect(entries.map((item) => item.id)).toEqual(['gia', 'jubilee', 'sa']);
  });

  it('leaves a donor endowment out even when it shares an internal rule family', () => {
    const entries = getInternalCatalogEntries([
      entry({ id: 'endowment', title: 'Antonio A. Villanueva Endowment Fund' }),
      entry({ id: 'a1', title: 'A-1 Scholarship Program (Micro-Philanthropy)', ruleFamily: 'excluded' }),
    ]);

    expect(entries).toEqual([]);
  });

  it('leaves external and government-linked programs out', () => {
    const entries = getInternalCatalogEntries([
      entry({ id: 'corporate', title: 'Metrobank Foundation Scholarship Fund', category: 'Corporate & External', isExternal: true }),
      entry({ id: 'government', title: 'CHED-National Scholarship Program', category: 'State-Sponsored', ruleFamily: 'government-linked', isExternal: true }),
    ]);

    expect(entries).toEqual([]);
  });
});

describe('getRecentApplicationActivity', () => {
  it('prefers the append-only status log and labels the reviewer', () => {
    const activity = getRecentApplicationActivity([application({
      statusLog: [{
        id: 'log-1',
        toStatus: 'Under Review',
        reason: 'Documents complete.',
        actorRole: 'admissions_office',
        actorName: 'Ben Reyes',
        at: '2026-10-02T00:00:00.000Z',
      }],
      timeline: [{
        id: 'timeline-1',
        stage: 'Submitted',
        note: 'Submitted by the student.',
        actor: 'Student',
        at: '2026-10-01T00:00:00.000Z',
      }],
    })]);

    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ stage: 'Under Review', note: 'Documents complete.', actor: 'Ben Reyes' });
    expect(activity[0].application.studentName).toBe('Ada Cruz');
  });

  it('falls back to the browser timeline when no log rows exist', () => {
    const activity = getRecentApplicationActivity([application({
      timeline: [{
        id: 'timeline-1',
        stage: 'Submitted',
        note: 'Submitted by the student.',
        actor: 'Student',
        at: '2026-10-01T00:00:00.000Z',
      }],
    })]);

    expect(activity[0]).toMatchObject({ id: 'timeline-1', stage: 'Submitted', actor: 'Student' });
  });

  it('falls back to the current status for an application with no events', () => {
    const activity = getRecentApplicationActivity([application({ status: 'For Verification' })]);

    expect(activity[0]).toMatchObject({
      id: 'current-app-1',
      stage: 'For Verification',
      note: 'Application is currently For Verification.',
      actor: 'Application workspace',
    });
  });

  it('shows the endorsement phase in the fallback note', () => {
    const activity = getRecentApplicationActivity([application({ status: 'Endorsed' })]);

    expect(activity[0]).toMatchObject({
      stage: 'Endorsed',
      note: 'Application is currently For Interview.',
    });
  });

  it('sorts newest first and honours the limit', () => {
    const activity = getRecentApplicationActivity([
      application({ id: 'older', updatedAt: '2026-09-01T00:00:00.000Z' }),
      application({ id: 'newer', updatedAt: '2026-10-05T00:00:00.000Z' }),
      application({ id: 'middle', updatedAt: '2026-09-20T00:00:00.000Z' }),
    ], 2);

    expect(activity.map((event) => event.application.id)).toEqual(['newer', 'middle']);
  });
});

describe('buildAcceptedApplicantsReport', () => {
  it('lists each accepted applicant with its release reference', () => {
    const report = buildAcceptedApplicantsReport([
      application({ status: 'Released', release: { reference: 'OAA-1234ABCD' } }),
      application({ id: 'app-2', status: 'Approved' }),
    ]);
    const lines = report.split('\n');

    expect(lines[0]).toBe('SCHOLARPATH ADDU — ACCEPTED APPLICANTS FOR THE ADMISSIONS OFFICE');
    expect(lines).toContain('Ada Cruz · Grant-in-Aid (GIA) · Released · Reference OAA-1234ABCD');
    expect(lines).toContain('Ada Cruz · Grant-in-Aid (GIA) · Approved · Reference Pending release');
  });
});

// The review modal opens on the stage the application is in, so a reviewer never
// has to hunt for the tab that stage needs.
describe('getReviewStageTab', () => {
  it('maps each stage to the tab that stage works in', () => {
    expect(getReviewStageTab('For Verification')).toBe('documents');
    expect(getReviewStageTab('For Endorsement')).toBe('endorsement');
    expect(getReviewStageTab('Endorsed')).toBe('interview');
    expect(getReviewStageTab('Interview')).toBe('interview');
  });

  it('opens on Overview when the stage has no tab of its own', () => {
    ['Submitted', 'Under Review', 'Recommended', 'Approved', 'Released', 'Rejected', undefined]
      .forEach((status) => expect(getReviewStageTab(status)).toBe('overview'));
  });
});

// --- Case officers: the intake pool and the personal review queue -------------
const TODAY = new Date('2026-10-10T00:00:00.000Z');

const caseOfficer = (overrides = {}) => ({
  id: 'co-1',
  applicationId: 'app-1',
  officerId: 'officer-a',
  officerName: 'Ben Reyes',
  officerRole: 'admissions_office',
  joinedAt: '2026-10-02T00:00:00.000Z',
  leftAt: null,
  ...overrides,
});

const submitted = (id, overrides = {}) => application({
  id,
  status: 'Submitted',
  submittedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

describe('getIntakePool / getMyReviewQueue', () => {
  it('keeps only open applications nobody has opened, oldest first', () => {
    const applications = [
      submitted('b', { submittedAt: '2026-10-05T00:00:00.000Z' }),
      submitted('a'),
      submitted('taken', { submittedAt: '2026-10-03T00:00:00.000Z' }),
      application({ id: 'draft', status: 'Draft' }),
      application({ id: 'released', status: 'Released' }),
    ];
    const roster = [caseOfficer({ applicationId: 'taken' })];

    expect(getIntakePool(applications, roster).map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(getTakenCases(applications, roster).map((entry) => entry.id)).toEqual(['taken']);
  });

  it('keeps an in-progress case with no officer in the pool so it cannot be stranded', () => {
    const applications = [
      application({ id: 'legacy', status: 'For Verification', submittedAt: '2026-09-01T00:00:00.000Z' }),
      submitted('fresh', { submittedAt: '2026-10-08T00:00:00.000Z' }),
    ];

    expect(getIntakePool(applications, []).map((entry) => entry.id)).toEqual(['legacy', 'fresh']);
    expect(getUnclaimedInProgress(applications, []).map((entry) => entry.id)).toEqual(['legacy']);
  });

  it('lists a case in every officer queue that opened it', () => {
    const applications = [submitted('a')];
    const roster = [
      caseOfficer({ id: 'co-a', applicationId: 'a', officerId: 'officer-a' }),
      caseOfficer({ id: 'co-b', applicationId: 'a', officerId: 'officer-b', officerName: 'Mia Santos' }),
    ];

    expect(getMyReviewQueue(applications, roster, 'officer-a').map((entry) => entry.id)).toEqual(['a']);
    expect(getMyReviewQueue(applications, roster, 'officer-b').map((entry) => entry.id)).toEqual(['a']);
    expect(getMyReviewQueue(applications, roster, 'officer-c')).toEqual([]);
    expect(isCaseOfficer(roster, 'a', 'officer-a')).toBe(true);
    expect(isCaseOfficer(roster, 'a', 'officer-c')).toBe(false);
  });

  it('drops a left officer from the queue and returns the case to the pool', () => {
    const applications = [submitted('a')];
    const roster = [caseOfficer({ applicationId: 'a', leftAt: '2026-10-05T00:00:00.000Z', leftReason: 'Left the case.' })];

    expect(getMyReviewQueue(applications, roster, 'officer-a')).toEqual([]);
    expect(getIntakePool(applications, roster).map((entry) => entry.id)).toEqual(['a']);
  });

  it('never lists a case outside the review scope in either queue', () => {
    const applications = [
      application({ id: 'recommended', status: 'Recommended' }),
      application({ id: 'approved', status: 'Approved' }),
      application({ id: 'rejected', status: 'Rejected' }),
    ];
    const roster = applications.map((entry, index) => caseOfficer({ id: `co-${index}`, applicationId: entry.id }));

    expect(getMyReviewQueue(applications, roster, 'officer-a')).toEqual([]);
    expect(getTakenCases(applications, roster)).toEqual([]);
  });

  it('orders the roster oldest join first and reports when a case was opened', () => {
    const roster = [
      caseOfficer({ id: 'co-late', officerId: 'officer-b', officerName: 'Mia Santos', joinedAt: '2026-10-04T00:00:00.000Z' }),
      caseOfficer({ id: 'co-early', joinedAt: '2026-10-02T00:00:00.000Z' }),
    ];

    expect(getCaseOfficers(roster, 'app-1').map((entry) => entry.id)).toEqual(['co-early', 'co-late']);
    expect(getCaseOpenedAt(roster, 'app-1')).toBe('2026-10-02T00:00:00.000Z');
    expect(getCaseOpenedAt([], 'app-1')).toBeNull();
  });

  it('counts each officer open cases for the workload card', () => {
    const applications = [submitted('a'), submitted('b'), application({ id: 'c', status: 'Released' })];
    const roster = [
      caseOfficer({ id: 'co-1', applicationId: 'a', officerId: 'officer-a' }),
      caseOfficer({ id: 'co-2', applicationId: 'b', officerId: 'officer-b', officerName: 'Mia Santos' }),
      caseOfficer({ id: 'co-3', applicationId: 'c', officerId: 'officer-a' }),
    ];

    expect(getOfficerWorkload(applications, roster)).toEqual([
      { officerId: 'officer-a', officerName: 'Ben Reyes', officerRole: 'admissions_office', cases: 1 },
      { officerId: 'officer-b', officerName: 'Mia Santos', officerRole: 'admissions_office', cases: 1 },
    ]);
  });

  it('tolerates missing collections', () => {
    expect(getIntakePool(undefined, undefined)).toEqual([]);
    expect(getTakenCases(null, null)).toEqual([]);
    expect(getMyReviewQueue(null, null)).toEqual([]);
    expect(getCaseOfficers(undefined, 'app-1')).toEqual([]);
  });
});

describe('getSubmissionWaitDays', () => {
  it('measures whole days since submission and never goes negative', () => {
    expect(getSubmissionWaitDays({ submittedAt: '2026-10-08T00:00:00.000Z' }, TODAY)).toBe(2);
    expect(getSubmissionWaitDays({ submittedAt: '2026-10-10T00:00:00.000Z' }, TODAY)).toBe(0);
    expect(getSubmissionWaitDays({ submittedAt: '2026-10-20T00:00:00.000Z' }, TODAY)).toBe(0);
  });

  it('returns null when no date is recorded', () => {
    expect(getSubmissionWaitDays({})).toBeNull();
  });
});


describe('filterIntakePool', () => {
  const applications = [
    application({
      id: 'old',
      status: 'Submitted',
      submittedAt: '2026-10-01T00:00:00.000Z',
      scholarshipId: 'gia',
      scholarshipTitle: 'Grant-in-Aid (GIA)',
      studentProgram: 'BS Computer Science',
      studentSchool: 'School of Arts and Sciences (SAS)',
    }),
    application({
      id: 'new',
      status: 'Submitted',
      submittedAt: '2026-10-09T00:00:00.000Z',
      scholarshipId: 'jubilee',
      scholarshipTitle: 'Jubilee Scholarship Fund',
      studentProgram: 'BS Accountancy',
      studentSchool: 'School of Business and Governance (SBG)',
    }),
    application({
      id: 'taken',
      status: 'For Verification',
      submittedAt: '2026-09-20T00:00:00.000Z',
      scholarshipId: 'gia',
      scholarshipTitle: 'Grant-in-Aid (GIA)',
      studentProgram: 'BS Information Technology',
      studentSchool: 'School of Arts and Sciences (SAS)',
    }),
    application({ id: 'closed', status: 'Approved' }),
  ];
  const roster = [caseOfficer({ applicationId: 'taken' })];

  it('defaults to the unclaimed pool, oldest submission first', () => {
    expect(filterIntakePool(applications, roster, DEFAULT_INTAKE_POOL_FILTERS, TODAY).map((entry) => entry.id))
      .toEqual(['old', 'new']);
  });

  it('shows taken cases through the coverage filter', () => {
    expect(filterIntakePool(applications, roster, { coverage: 'with-officers' }, TODAY).map((entry) => entry.id))
      .toEqual(['taken']);
    expect(filterIntakePool(applications, roster, { coverage: 'all' }, TODAY).map((entry) => entry.id))
      .toEqual(['taken', 'old', 'new']);
  });

  it('narrows by stage, scholarship, school, department, and search text', () => {
    expect(filterIntakePool(applications, roster, { stage: 'Submitted', coverage: 'all' }, TODAY).map((entry) => entry.id))
      .toEqual(['old', 'new']);
    expect(filterIntakePool(applications, roster, { scholarshipId: 'gia', coverage: 'all' }, TODAY).map((entry) => entry.id))
      .toEqual(['taken', 'old']);
    // School is the profile's stored level; department comes from the program.
    expect(filterIntakePool(applications, roster, { school: 'School of Business and Governance (SBG)' }, TODAY).map((entry) => entry.id))
      .toEqual(['new']);
    expect(filterIntakePool(applications, roster, { department: 'Accountancy Department' }, TODAY).map((entry) => entry.id))
      .toEqual(['new']);
    expect(filterIntakePool(applications, roster, { department: 'Computer Science Department' }, TODAY).map((entry) => entry.id))
      .toEqual(['old']);
    expect(filterIntakePool(applications, roster, { query: 'grant-in-aid', coverage: 'all' }, TODAY).map((entry) => entry.id))
      .toEqual(['taken', 'old']);
  });

  it('keeps only cases waiting longer than the threshold', () => {
    expect(filterIntakePool(applications, roster, { waitingOverDays: 7 }, TODAY).map((entry) => entry.id))
      .toEqual(['old']);
  });

  it('sorts newest first when asked', () => {
    expect(filterIntakePool(applications, roster, { sort: 'newest' }, TODAY).map((entry) => entry.id))
      .toEqual(['new', 'old']);
  });

  it('tolerates a filter nothing matches and a missing collection', () => {
    expect(filterIntakePool(applications, roster, { query: 'nothing matches' }, TODAY)).toEqual([]);
    expect(filterIntakePool(undefined, undefined, undefined, TODAY)).toEqual([]);
  });
});



// Consultation 2, #2: the office and finance work in Excel.
const readStoredZip = (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = {};
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const crc = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const data = bytes.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size);
    expect(crc32(data)).toBe(crc);
    files[name] = new TextDecoder().decode(data);
    offset += 30 + nameLength + size;
  }
  return files;
};

describe('applicant summary workbook', () => {
  const NOW = new Date('2026-10-29T07:12:00Z');
  const approved = application({
    id: 'sum-1',
    studentName: 'Cruz, Ada "Ads" <3',
    studentProgram: 'BS Computer Science',
    scholarshipTitle: 'Grant-in-Aid (GIA)',
    status: 'Approved',
    submittedAt: '2026-10-01T02:00:00Z',
    statusLog: [
      { toStatus: 'Recommended', at: '2026-10-20T01:00:00Z' },
      { toStatus: 'Approved', at: '2026-10-25T16:30:00Z' },
    ],
    profileSnapshot: {
      fullName: 'Cruz, Ada "Ads" <3',
      studentNumber: '2024-0001',
      yearStandingLabel: 'Incoming 2nd year',
      academic: { label: 'QPI', value: 3.4 },
      householdIncome: { value: 180000 },
      personal: { email: 'ada@example.com', phone: '09171234567' },
    },
  });
  const rejected = application({ id: 'sum-2', studentName: 'Reyes, Ben', status: 'Rejected', scholarshipTitle: 'Grant-in-Aid (GIA)' });
  const options = {
    scopeOf: () => ({ school: 'School of Arts and Sciences (SAS)', cluster: 'Computer Studies', department: 'Computer Science Department' }),
    recommendationOf: (entry) => (entry.id === 'sum-1' ? { label: 'Highly recommended', authorName: 'Prof. Santos' } : null),
    source: {
      origin: 'Final check and release › Released results',
      contents: 'Every application covered by this release',
      scholarship: 'Grant-in-Aid (GIA)',
      releasedAt: '2026-10-28T03:00:00Z',
      releasedIds: ['sum-2'],
      exportedBy: 'Admissions Office Head',
      now: NOW,
    },
  };

  it('says where the sheet was exported from, what it holds, and when', () => {
    const [applicants] = buildApplicantSummarySheets([approved, rejected], options);
    const text = applicants.rows.flat().map((cell) => (cell && typeof cell === 'object' ? cell.value : cell)).join('|');
    expect(text).toContain('ScholarPath AdDU — Applicant summary');
    expect(text).toContain('Final check and release › Released results');
    expect(text).toContain('Every application covered by this release');
    expect(text).toContain('October 29, 2026');
    expect(text).toContain('by Admissions Office Head');
    expect(text).toContain('2 applicants · 1 accepted · 1 not accepted · 1 released');
  });

  it('lists one row per application with the course, year level, income, result, and dates', () => {
    const [applicants] = buildApplicantSummarySheets([approved, rejected], options);
    const headerIndex = applicants.rows.findIndex((row) => row[0]?.value === 'No.');
    const header = applicants.rows[headerIndex].map((cell) => cell.value);
    const first = Object.fromEntries(header.map((label, index) => [label, applicants.rows[headerIndex + 1][index].value]));
    const second = Object.fromEntries(header.map((label, index) => [label, applicants.rows[headerIndex + 2][index].value]));
    expect(first).toMatchObject({
      'No.': 1,
      Applicant: 'Cruz, Ada "Ads" <3',
      'Student number': '2024-0001',
      Result: 'Approved — awaiting release',
      'Interview recommendation': 'Highly recommended',
      'Recommended by': 'Prof. Santos',
      Cluster: 'Computer Studies',
      'Year level': 'Incoming 2nd year',
      'Academic measure': 'QPI',
      'Academic value': 3.4,
      'Annual household income (PHP)': 180000,
      Email: 'ada@example.com',
    });
    // 2026-10-25T16:30Z is already 26 Oct in Manila (UTC+8).
    expect(first['School decision on'] - first['Recommended on']).toBe(6);
    expect(second.Result).toBe('Not accepted — released');
    // Anything the case has no answer for reads N/A instead of a blank cell.
    expect(second['Student number']).toBe('N/A');
    expect(second['Annual household income (PHP)']).toBe('N/A');
    expect(second['Interview recommendation']).toBe('N/A');
    expect(second['Recommended on']).toBe('N/A');
    expect(first['Release reference']).toBe('N/A');
    expect(second['Released on']).toBeGreaterThan(0);
    expect(applicants.autoFilter).toMatch(/^A\d+:W\d+$/);
  });

  it('writes a valid .xlsx package with escaped text and an About sheet', () => {
    const files = readStoredZip(buildApplicantSummaryWorkbook([approved, rejected], options));
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
      'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
    ]));
    expect(files['xl/workbook.xml']).toContain('name="Applicants"');
    expect(files['xl/workbook.xml']).toContain('name="About"');
    expect(files['xl/worksheets/sheet1.xml']).toContain('Cruz, Ada &quot;Ads&quot; &lt;3');
    expect(files['xl/worksheets/sheet1.xml']).toContain('state="frozen"');
    expect(files['xl/worksheets/sheet2.xml']).toContain('Reasons for a decision are never exported');
  });

  it('tolerates an empty list and names the file for what it holds', () => {
    const [applicants] = buildApplicantSummarySheets(undefined);
    expect(applicants.rows.some((row) => row[0]?.value === 'No.')).toBe(true);
    expect(getApplicantSummaryFileName('School of Arts & Sciences', 'recommendations')).toMatch(/^Applicant_summary_School_of_Arts_Sciences_recommendations_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});

// Consultation 2, #13: the Head's final check before release.
describe('getFinalCheckHints', () => {
  const withParents = (overrides) => application({
    profileSnapshot: { family: { fatherName: 'Jose Cruz', motherName: 'Maria Cruz' } },
    ...overrides,
  });

  it('flags a sibling already on a grant and another open case of the same student', () => {
    const current = withParents({ id: 'current', studentId: 's-1', status: 'Approved' });
    const sibling = withParents({ id: 'sibling', studentId: 's-2', status: 'Released', studentName: 'Ben Cruz' });
    const pending = application({ id: 'pending', studentId: 's-1', status: 'Interview' });
    const unrelated = application({ id: 'unrelated', studentId: 's-3', status: 'Released', profileSnapshot: { family: { fatherName: 'Other Parent' } } });
    const hints = getFinalCheckHints(current, [current, sibling, pending, unrelated]);
    expect(hints.siblingsOnGrant.map((entry) => entry.id)).toEqual(['sibling']);
    expect(hints.pendingCases.map((entry) => entry.id)).toEqual(['pending']);
  });
});

describe('getReleaseGroups', () => {
  it('groups the approved and the unreleased decided cases by scholarship', () => {
    const groups = getReleaseGroups([
      application({ id: 'g-approved', scholarshipId: 'gia', status: 'Approved' }),
      application({ id: 'g-rejected', scholarshipId: 'gia', status: 'Rejected' }),
      application({ id: 'g-released-before', scholarshipId: 'gia', status: 'Rejected' }),
      application({ id: 'g-interview', scholarshipId: 'gia', status: 'Interview' }),
    ], [{ id: 'gia', title: 'Grant-in-Aid (GIA)' }], [{ id: 'r-1', applicationIds: ['g-released-before'] }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('Grant-in-Aid (GIA)');
    expect(groups[0].approved.map((entry) => entry.id)).toEqual(['g-approved']);
    expect(groups[0].decided.map((entry) => entry.id)).toEqual(['g-rejected']);
  });
});

// Consultation 2, #12: applications reach the interviewers of their scope.
describe('getRoutedInterviewers', () => {
  it('routes a case to the interviewers whose scope covers it', () => {
    const index = buildProgramScopeIndex(academicPrograms);
    const staff = [
      { userId: 'ogs', fullName: 'Sir Ogs', role: 'interviewer', reviewSchool: 'School of Arts and Sciences (SAS)', reviewCluster: 'Computer Studies' },
      { userId: 'bio', fullName: 'Bio Interviewer', role: 'interviewer', reviewSchool: 'School of Arts and Sciences (SAS)', reviewCluster: 'Natural Sciences and Mathematics' },
      { userId: 'chair', fullName: 'A Chair', role: 'department_chair', reviewDepartment: 'Computer Science Department' },
    ];
    const routed = getRoutedInterviewers(application({ studentProgram: 'BS Computer Science' }), staff, index);
    expect(routed.map((entry) => entry.userId)).toEqual(['ogs']);
  });
});
