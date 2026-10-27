import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusHistoryList } from '../src/components/ApplicationParts';
import ApplicationReviewModal from '../src/components/ApplicationReviewModal';
import { APPLICATION_REJECTION_NOTICE, getApplicationStatusGuidance } from '../src/lib/constants';
import { describeApplicationStatusUpdate } from '../supabase/functions/_shared/email.js';
import { renderApplicationStatusSms } from '../supabase/functions/_shared/sms.js';

// Consultation 2, request #8: a rejection is a general notice. The reason a
// reviewer records is filed in the staff-only internal notes
// (application_review_comments) and must never reach the student's history or
// the delivered messages. FORM 230-SCH affidavit clause 6 is the office's basis:
// the results and the minutes of the deliberations are confidential.

const rejectedLog = (reason = 'Household income exceeds the ceiling.') => ([{
  id: 'log-1',
  applicationId: 'app-1',
  fromStatus: 'Under Review',
  toStatus: 'Rejected',
  actorRole: 'admissions_office',
  reason,
  at: '2026-10-20',
}]);

const continuedLog = () => ([{
  id: 'log-2',
  applicationId: 'app-1',
  fromStatus: 'Submitted',
  toStatus: 'For Verification',
  actorRole: 'admissions_office',
  reason: 'Continued to document verification.',
  at: '2026-10-19',
}]);

describe('application rejection notice', () => {
  it('is the one sentence a student is told', () => {
    expect(APPLICATION_REJECTION_NOTICE).toBe('Application not accepted.');
    expect(getApplicationStatusGuidance('Rejected')).toBe(
      'The application was not accepted. No further action is needed for this application period.',
    );
  });

  it('replaces the recorded reason in the student status history', () => {
    const html = renderToStaticMarkup(<StatusHistoryList statusLog={rejectedLog()} />);
    expect(html).toContain(APPLICATION_REJECTION_NOTICE);
    expect(html).not.toContain('Household income exceeds the ceiling.');
  });

  it('masks a reason recorded before the rule in the legacy timeline too', () => {
    const html = renderToStaticMarkup(
      <StatusHistoryList
        timeline={[{ id: 't-1', stage: 'Rejected', note: 'Low QPI for this grant.', actor: 'Admissions Office Staff', at: '2026-10-20' }]}
      />,
    );
    expect(html).toContain(APPLICATION_REJECTION_NOTICE);
    expect(html).not.toContain('Low QPI for this grant.');
  });

  it('still shows the reason to a reviewer', () => {
    const html = renderToStaticMarkup(<StatusHistoryList statusLog={rejectedLog()} showActorName />);
    expect(html).toContain('Household income exceeds the ceiling.');
  });

  it('leaves every other status note alone', () => {
    const html = renderToStaticMarkup(<StatusHistoryList statusLog={continuedLog()} />);
    expect(html).toContain('Continued to document verification.');
  });
});

describe('rejection delivery copy', () => {
  it('sends only the general email message', () => {
    const body = describeApplicationStatusUpdate('Rejected', 'the Admissions Office');
    expect(body).toBe('Your application was not accepted. No further action is needed for this application period.');
    expect(body).not.toMatch(/because|reason|QPI|income/i);
  });

  it('sends only the general text message', () => {
    const { message } = renderApplicationStatusSms({ scholarshipTitle: 'Grant-in-Aid', status: 'Rejected' });
    expect(message).toContain('was not accepted');
    expect(message).not.toMatch(/because|reason|QPI|income/i);
  });
});

// The reason is not lost: it stays readable to the office, because
// application_review_comments has no student policy. A case rejected before the
// Endorsement tab unlocks reads it back from the History tab.
describe('the staff-only rejection reason', () => {
  const rejectedApplication = {
    id: 'app-1',
    status: 'Rejected',
    studentName: 'Ada Cruz',
    scholarshipTitle: 'Grant-in-Aid (GIA)',
    scholarshipId: 'scholarship-1',
    studentProgram: 'BS Computer Engineering',
    attachedDocuments: [],
    timeline: [{ id: 't-1', stage: 'Rejected', note: APPLICATION_REJECTION_NOTICE, actor: 'Admissions Office Staff', at: '2026-10-20' }],
    statusLog: [],
  };

  it('is shown to the reviewer in the History tab', () => {
    const html = renderToStaticMarkup(
      <ApplicationReviewModal
        application={rejectedApplication}
        scholarship={{ id: 'scholarship-1', title: 'Grant-in-Aid (GIA)' }}
        documents={[]}
        role="admissions_office"
        initialTab="history"
        reviewComments={[{
          id: 'c-1',
          applicationId: 'app-1',
          authorName: 'Juan Dela Cruz',
          authorRole: 'admissions_office',
          body: 'Rejection reason — Household income exceeds the ceiling.',
          createdAt: '2026-10-20T02:00:00.000Z',
        }]}
        onClose={() => undefined}
        onStatusChange={() => ({ ok: true })}
      />,
    );
    expect(html).toContain('Internal notes');
    expect(html).toContain('Rejection reason — Household income exceeds the ceiling.');
  });

  it('is not repeated once the Endorsement tab owns the thread', () => {
    const html = renderToStaticMarkup(
      <ApplicationReviewModal
        application={{ ...rejectedApplication, status: 'Endorsed' }}
        scholarship={{ id: 'scholarship-1', title: 'Grant-in-Aid (GIA)' }}
        documents={[]}
        role="admissions_office"
        initialTab="history"
        reviewComments={[{
          id: 'c-1',
          applicationId: 'app-1',
          authorName: 'Juan Dela Cruz',
          authorRole: 'admissions_office',
          body: 'Rejection reason — Household income exceeds the ceiling.',
          createdAt: '2026-10-20T02:00:00.000Z',
        }]}
        onClose={() => undefined}
        onStatusChange={() => ({ ok: true })}
      />,
    );
    expect(html).not.toContain('Internal notes');
  });
});
