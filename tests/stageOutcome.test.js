import { describe, expect, it } from 'vitest';
import { describeStageOutcome } from '../src/lib/stageOutcome';

const application = {
  id: 'app-1',
  studentName: 'Juan Dela Cruz',
  scholarshipTitle: 'Grant-in-Aid (GIA)',
  studentSchool: 'School of Engineering and Architecture',
  status: 'Interview',
};

describe('describeStageOutcome', () => {
  it('names the stage, the holder, and the next step for each destination', () => {
    const verification = describeStageOutcome({ application, fromStatus: 'Submitted', toStatus: 'For Verification', totalFiles: 6 });
    expect(verification.title).toBe('Continued to verification');
    expect(verification.fromLabel).toBe('Submitted');
    expect(verification.toLabel).toBe('For Verification');
    expect(verification.next).toContain('6 attached files');
    expect(verification.goTab).toBe('documents');

    const forwarded = describeStageOutcome({ application, fromStatus: 'For Verification', toStatus: 'Endorsed' });
    expect(forwarded.toLabel).toBe('For Interview');
    expect(forwarded.holder).toContain('School of Engineering and Architecture');
    expect(forwarded.goTab).toBe('interview');

    const approved = describeStageOutcome({ application, fromStatus: 'Recommended', toStatus: 'Approved' });
    expect(approved.tone).toBe('success');
    expect(approved.holder).toContain('final check');
    expect(approved.goTab).toBeNull();
  });

  it('offers no Documents tab when nothing is attached', () => {
    const outcome = describeStageOutcome({ application, fromStatus: 'Submitted', toStatus: 'For Verification', totalFiles: 0 });
    expect(outcome.goTab).toBeNull();
    expect(outcome.next).toContain('No files are attached');
  });

  it("names the school's approving level for a recommendation", () => {
    expect(describeStageOutcome({ application, toStatus: 'Recommended', approverRole: 'dean' }).holder)
      .toBe("With the school's Dean.");
    expect(describeStageOutcome({ application, toStatus: 'Recommended', approverRole: 'assistant_dean' }).holder)
      .toBe("With the school's Assistant Dean.");
    expect(describeStageOutcome({ application, toStatus: 'Recommended' }).holder)
      .toBe("With the school's approving level.");
  });

  it('reads the interview time from the scheduled record', () => {
    const outcome = describeStageOutcome({
      application: { ...application, interview: { startsAt: '2026-11-10T01:00:00.000Z', durationMinutes: 30 } },
      fromStatus: 'Endorsed',
      toStatus: 'Interview',
    });
    expect(outcome.next).toContain('Nov 10, 2026');
    expect(outcome.next).toContain('9:00 AM');
  });

  it('carries a calendar warning through', () => {
    const outcome = describeStageOutcome({ application, toStatus: 'Recommended', warning: '  The calendar event could not be removed.  ' });
    expect(outcome.warning).toBe('The calendar event could not be removed.');
  });

  it('never carries a rejection reason', () => {
    const outcome = describeStageOutcome({ application, fromStatus: 'Recommended', toStatus: 'Rejected', reason: 'Income above the ceiling' });
    expect(JSON.stringify(outcome)).not.toContain('Income above the ceiling');
    expect(outcome.holder).toContain('internal notes');
    expect(outcome.next).toContain('general notice');
  });

  it('returns null for a status it does not describe', () => {
    expect(describeStageOutcome({ application, toStatus: 'Draft' })).toBeNull();
    expect(describeStageOutcome({ application, toStatus: 'Under Review' })).toBeNull();
  });
});
