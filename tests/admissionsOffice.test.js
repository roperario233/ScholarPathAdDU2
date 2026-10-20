import { describe, expect, it } from 'vitest';
import {
  buildAcceptedApplicantsReport,
  getApprovalQueue,
  getDocumentsAwaitingReview,
  getInternalCatalogEntries,
  getRecentApplicationActivity,
  getReleaseQueue,
  getReviewQueue,
} from '../src/lib/admissionsOffice';

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
  const internal = (overrides = {}) => ({
    id: 'entry',
    title: 'Grant-in-Aid (GIA)',
    category: 'Internal Endowment',
    isExternal: false,
    ruleFamily: 'general-pool',
    ...overrides,
  });

  it('keeps AdDU internal entries for the three supported rule families', () => {
    const entries = getInternalCatalogEntries([
      internal({ id: 'general' }),
      internal({ id: 'honors', ruleFamily: 'honors' }),
      internal({ id: 'work-study', ruleFamily: 'work-study' }),
    ]);

    expect(entries.map((entry) => entry.id)).toEqual(['general', 'honors', 'work-study']);
  });

  it('leaves external, government-linked, and unrelated entries out', () => {
    const entries = getInternalCatalogEntries([
      internal({ id: 'external', isExternal: true }),
      internal({ id: 'government', category: 'Government' }),
      internal({ id: 'donor', ruleFamily: 'donor-endowment' }),
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
      note: 'Application is currently Endorsement.',
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

