import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocumentDecisionRecord, DocumentVerificationItem, ProfileSnapshotList } from '../src/components/ApplicationParts';
import { buildProfileSnapshot } from '../src/lib/applicationRequirements';
import { fmtDate } from '../src/lib/formatters';

const decidedAt = '2026-10-21T03:42:00.000Z';
const on = fmtDate(decidedAt);
const verifiedDoc = {
  id: 'doc-1',
  title: 'Academic standing — Transcript',
  fileName: 'transcript.pdf',
  documentType: 'Transcript',
  verificationStatus: 'Verified',
  rejectionReason: '',
  linkedAttributes: [],
  attestedValues: {},
  decidedAt,
  reviewedBy: 'staff-1',
  reviewedByRole: 'admissions_office',
  reviewedByName: 'Juan Dela Cruz',
};

describe('DocumentDecisionRecord', () => {
  it('shows the reviewer, lane, and date in the staff review pane', () => {
    const html = renderToStaticMarkup(<DocumentDecisionRecord doc={verifiedDoc} />);
    expect(html).toContain(`Verified by Juan Dela Cruz · Admissions Office Staff · ${on}`);
  });

  it('shows the lane and date only on a student surface', () => {
    const html = renderToStaticMarkup(<DocumentDecisionRecord doc={verifiedDoc} showReviewer={false} />);
    expect(html).toContain(`Verified by Admissions Office Staff · ${on}`);
    expect(html).not.toContain('Juan Dela Cruz');
  });

  it('states that a pending file has no decision yet', () => {
    const html = renderToStaticMarkup(<DocumentDecisionRecord doc={{ ...verifiedDoc, verificationStatus: 'Pending', decidedAt: null, reviewedBy: null, reviewedByRole: null, reviewedByName: null }} />);
    expect(html).toContain('Awaiting review');
  });

  it('renders nothing for a pending file on a student surface, where the badge already says so', () => {
    const html = renderToStaticMarkup(
      <DocumentDecisionRecord showReviewer={false} doc={{ ...verifiedDoc, verificationStatus: 'Pending', decidedAt: null, reviewedBy: null, reviewedByRole: null, reviewedByName: null }} />,
    );
    expect(html).toBe('');
  });
});

describe('DocumentVerificationItem actions', () => {
  const application = { status: 'For Verification', studentQpi: 3.2, attachedDocuments: ['doc-1'] };

  it('offers explicit Verify and Reject actions to the Admissions Office', () => {
    const html = renderToStaticMarkup(
      <DocumentVerificationItem doc={{ ...verifiedDoc, verificationStatus: 'Pending', decidedAt: null }} application={application} onChangeDocument={() => {}} />,
    );
    expect(html).toContain('Verify document');
    expect(html).toContain('Reject');
    // No decision exists yet, so there is nothing to reset.
    expect(html).not.toContain('Reset to pending');
  });

  it('lets a decision be reset only before endorsement', () => {
    const atVerification = renderToStaticMarkup(
      <DocumentVerificationItem doc={verifiedDoc} application={application} onChangeDocument={() => {}} />,
    );
    expect(atVerification).toContain('Reset to pending');
    const endorsed = renderToStaticMarkup(
      <DocumentVerificationItem doc={verifiedDoc} application={{ ...application, status: 'Endorsed' }} onChangeDocument={() => {}} />,
    );
    expect(endorsed).not.toContain('Reset to pending');
  });

  it('stays read-only for a Department Chair and still shows the record', () => {
    const html = renderToStaticMarkup(<DocumentVerificationItem doc={verifiedDoc} application={application} />);
    expect(html).not.toContain('Verify document');
    expect(html).not.toContain('Reject');
    expect(html).toContain(`Verified by Juan Dela Cruz · Admissions Office Staff · ${on}`);
  });
});

describe('ProfileSnapshotList 2x2 photo', () => {
  const snapshot = buildProfileSnapshot({
    fullName: 'Ana Reyes',
    degreeProgram: 'BS Information Technology',
    yearStanding: '2nd',
    qpi: 3.2,
    householdIncome: 180000,
    citizenship: 'Filipino',
  });
  const applicantPhoto = {
    id: 'doc-photo',
    title: 'Applicant Photo',
    fileName: 'applicant-photo.jpg',
    documentType: 'Applicant Photo',
    verificationStatus: 'Pending',
    storagePath: 'student-1/doc-photo/applicant-photo.jpg',
  };

  it('leads the snapshot with the applicant and the attached 2x2 photo', () => {
    const html = renderToStaticMarkup(<ProfileSnapshotList snapshot={snapshot} applicantPhoto={applicantPhoto} />);
    expect(html).toContain('Ana Reyes');
    expect(html).toContain('Recent 2x2 ID photo');
    expect(html).toContain('Pending');
  });

  it('says when no 2x2 photo is attached', () => {
    const html = renderToStaticMarkup(<ProfileSnapshotList snapshot={snapshot} />);
    expect(html).toContain('2x2 photo not attached');
  });

  it('carries the recorded rejection reason when the photo was rejected', () => {
    const html = renderToStaticMarkup(
      <ProfileSnapshotList
        snapshot={snapshot}
        applicantPhoto={{ ...applicantPhoto, verificationStatus: 'Rejected', rejectionReason: 'Photo is blurred.' }}
      />,
    );
    expect(html).toContain('Photo is blurred.');
  });

  it('offers the full document when the surface can preview it', () => {
    const html = renderToStaticMarkup(<ProfileSnapshotList snapshot={snapshot} applicantPhoto={applicantPhoto} onPreviewPhoto={() => {}} />);
    expect(html).toContain('aria-label="Open the applicant 2x2 photo"');
  });
});
