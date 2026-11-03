import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import StageOutcomeCard, { StageMoveStrip } from '../src/components/StageOutcomeCard';
import MovedCaseNotice from '../src/components/MovedCaseNotice';
import { describeStageOutcome } from '../src/lib/stageOutcome';

const application = {
  id: 'app-1',
  studentName: 'Juan Dela Cruz',
  scholarshipTitle: 'Grant-in-Aid (GIA)',
  studentSchool: 'School of Engineering and Architecture',
};

describe('StageOutcomeCard', () => {
  it('states the move, who holds the case now, and what is next', () => {
    const outcome = describeStageOutcome({ application, fromStatus: 'Recommended', toStatus: 'Approved' });
    const html = renderToStaticMarkup(<StageOutcomeCard outcome={outcome} onDone={() => undefined} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('Recommended');
    expect(html).toContain('With the Admissions Office Admin for the final check.');
    expect(html).toContain('Final check and release');
    expect(html).toContain('Done');
  });

  it('shows the calendar warning a recommendation returned', () => {
    const outcome = describeStageOutcome({ application, fromStatus: 'Interview', toStatus: 'Recommended', approverRole: 'dean', warning: 'The calendar event is still live.' });
    const html = renderToStaticMarkup(<StageOutcomeCard outcome={outcome} onDone={() => undefined} />);
    expect(html).toContain("With the school&#x27;s Dean.");
    expect(html).toContain('The calendar event is still live.');
  });
});

describe('StageMoveStrip', () => {
  it('explains in one line why the modal moved to the stage tab', () => {
    const outcome = describeStageOutcome({ application, fromStatus: 'Submitted', toStatus: 'For Verification', totalFiles: 3 });
    const html = renderToStaticMarkup(<StageMoveStrip outcome={outcome} onDismiss={() => undefined} />);
    expect(html).toContain('Continued to verification.');
    expect(html).toContain('3 attached files');
    expect(html).toContain('Dismiss stage change message');
    expect(html).not.toContain('Done');
  });
});

describe('MovedCaseNotice', () => {
  it('says where an off-list case went', () => {
    const notice = describeStageOutcome({ application, fromStatus: 'Recommended', toStatus: 'Approved' });
    const html = renderToStaticMarkup(<MovedCaseNotice notice={notice} onDismiss={() => undefined} offListNote="It has left your review queue." />);
    expect(html).toContain('Juan Dela Cruz');
    expect(html).toContain('moved to Approved');
    expect(html).toContain('It has left your review queue.');
  });

  it('renders nothing without a notice', () => {
    expect(renderToStaticMarkup(<MovedCaseNotice notice={null} onDismiss={() => undefined} />)).toBe('');
  });
});
