import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ApplicationReviewModal from '../src/components/ApplicationReviewModal';
import { academicPrograms } from '../src/lib/academicPrograms';

const SEA = 'School of Engineering and Architecture (SEA)';

const application = (overrides = {}) => ({
  id: 'app-1',
  status: 'Recommended',
  studentName: 'Ada Cruz',
  scholarshipTitle: 'Grant-in-Aid (GIA)',
  scholarshipId: 'scholarship-1',
  studentProgram: 'BS Computer Engineering',
  studentDepartment: SEA,
  studentSchool: SEA,
  statement: 'Statement.',
  attachedDocuments: ['doc-1'],
  timeline: [],
  statusLog: [],
  ...overrides,
});

const scholarship = { id: 'scholarship-1', title: 'Grant-in-Aid (GIA)', ruleFamily: 'general-pool', isActive: true, isMatchable: true };
const documents = [{ id: 'doc-1', verificationStatus: 'Verified' }];

// No approval_levels row for SEA, so the Chairperson is the configured approver.
const workspace = ({ stageContext = {}, approvalLevels = [] } = {}) => ({
  viewerId: 'dean-sea',
  staffDirectory: [],
  locations: [],
  panelists: [],
  notes: [],
  applications: [],
  calendarConfigured: false,
  academicPrograms,
  approvalLevels,
  stageContextFor: () => ({ isPanelist: false, isApprover: false, canOverrideApproval: false, ...stageContext }),
  grantAmounts: [],
  onSaveGrantAmount: () => ({ ok: true }),
});

const render = (props) => renderToStaticMarkup(
  <ApplicationReviewModal
    scholarship={scholarship}
    documents={documents}
    onClose={() => undefined}
    onStatusChange={() => ({ ok: true })}
    application={application()}
    {...props}
  />,
);

const buttonLabels = (html) => [...html.matchAll(/>([^<>]+)<\/button>/g)].map((match) => match[1].trim());

// A Dean can decide a recommendation whose configured approver is a lower level,
// as an override that carries a recorded reason (20261116000000_approval_override).
describe('Approval override in the review modal', () => {
  it('names the configured approver to a reviewer who cannot decide', () => {
    const html = render({ role: 'dean', interviewWorkspace: workspace() });
    expect(html).toContain('The Chairperson decides this recommendation.');
    expect(buttonLabels(html)).not.toContain('Approve');
    expect(html).not.toContain('override');
  });

  it('names the level the Admin configured, not a fixed one', () => {
    const html = render({
      role: 'department_chair',
      interviewWorkspace: workspace({ approvalLevels: [{ school: SEA, cluster: '', approverRole: 'dean' }] }),
    });
    expect(html).toContain('The Dean decides this recommendation.');
  });

  it('offers the Dean the three decisions as labelled overrides', () => {
    const html = render({ role: 'dean', interviewWorkspace: workspace({ stageContext: { canOverrideApproval: true } }) });
    const labels = buttonLabels(html);
    expect(labels).toContain('Approve as Dean (override)');
    expect(labels).toContain('Waitlist as Dean (override)…');
    expect(labels).toContain('Mark not accepted as Dean (override)…');
    // The plain verbs belong to the configured approver.
    expect(labels).not.toContain('Approve');
    expect(labels).not.toContain('Mark not accepted…');
  });

  it('says it is not the intended flow and that a reason is asked for', () => {
    const html = render({ role: 'dean', interviewWorkspace: workspace({ stageContext: { canOverrideApproval: true } }) });
    expect(html).toContain('Dean override — not the intended flow.');
    expect(html).toContain('The Chairperson decides this recommendation. Deciding in their place asks for a reason, kept in the internal notes.');
    // The reason dialog only opens on a press.
    expect(html).not.toContain('Decide in place of the Chairperson');
  });

  it('names an Assistant Dean in its own labels', () => {
    const html = render({ role: 'assistant_dean', interviewWorkspace: workspace({ stageContext: { canOverrideApproval: true } }) });
    expect(buttonLabels(html)).toContain('Approve as Assistant Dean (override)');
    expect(html).toContain('Assistant Dean override — not the intended flow.');
  });

  it('leaves the configured approver with the plain verbs and no override notice', () => {
    const html = render({ role: 'department_chair', interviewWorkspace: workspace({ stageContext: { isApprover: true } }) });
    const labels = buttonLabels(html);
    expect(labels).toContain('Approve');
    expect(labels).toContain('Waitlist…');
    expect(labels).toContain('Mark not accepted…');
    expect(html).not.toContain('override');
  });

  it('only applies at Recommended', () => {
    const html = render({
      role: 'dean',
      application: application({ status: 'Approved' }),
      interviewWorkspace: workspace({ stageContext: { canOverrideApproval: true } }),
    });
    expect(html).not.toContain('(override)');
    expect(html).not.toContain('Dean override');
  });

  it('keeps the Admin on its own override wording', () => {
    const html = render({ role: 'admissions_admin', interviewWorkspace: workspace() });
    expect(buttonLabels(html)).toContain('Approve as Admin (override)');
    expect(html).toContain('Admin override — not the intended flow.');
    expect(html).not.toContain('Dean override');
  });
});
