import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ApplicationReviewModal from '../src/components/ApplicationReviewModal';

const application = (overrides = {}) => ({
  id: 'app-1',
  status: 'Recommended',
  studentName: 'Ada Cruz',
  scholarshipTitle: 'Grant-in-Aid (GIA)',
  scholarshipId: 'scholarship-1',
  studentProgram: 'BS Computer Engineering',
  studentDepartment: 'School of Engineering and Architecture (SEA)',
  statement: 'Statement.',
  attachedDocuments: ['doc-1'],
  timeline: [],
  statusLog: [],
  ...overrides,
});

const scholarship = { id: 'scholarship-1', title: 'Grant-in-Aid (GIA)', ruleFamily: 'general-pool', isActive: true, isMatchable: true };
const documents = [{ id: 'doc-1', verificationStatus: 'Verified' }];

const workspace = ({ isApprover = false, grantAmounts = [] } = {}) => ({
  viewerId: 'staff-1',
  staffDirectory: [],
  locations: [],
  panelists: [],
  notes: [],
  applications: [],
  calendarConfigured: false,
  stageContextFor: () => ({ isPanelist: false, isApprover }),
  grantAmounts,
  onSaveGrantAmount: () => ({ ok: true }),
});

const render = (props) => renderToStaticMarkup(
  <ApplicationReviewModal
    scholarship={scholarship}
    documents={documents}
    onClose={() => undefined}
    onStatusChange={() => ({ ok: true })}
    {...props}
  />,
);

const hasTab = (html) => html.includes('id="review-tab-grant"');
const record = { applicationId: 'app-1', coveragePercent: 50, amountPerSemester: 10000, note: '', setByRole: 'dean', updatedAt: '2026-11-03T00:00:00Z' };

describe('Grant amount tab', () => {
  it('appears from Recommended on for the office and the approving level', () => {
    expect(hasTab(render({ application: application(), role: 'admissions_office', interviewWorkspace: workspace() }))).toBe(true);
    expect(hasTab(render({ application: application({ status: 'Approved' }), role: 'admissions_admin', interviewWorkspace: workspace() }))).toBe(true);
    expect(hasTab(render({ application: application({ status: 'Released' }), role: 'dean', interviewWorkspace: workspace({ isApprover: true }) }))).toBe(true);
  });

  it('is hidden before Recommended, after a rejection, and from other reviewers', () => {
    expect(hasTab(render({ application: application({ status: 'Interview' }), role: 'admissions_admin', interviewWorkspace: workspace() }))).toBe(false);
    expect(hasTab(render({ application: application({ status: 'Rejected' }), role: 'admissions_admin', interviewWorkspace: workspace() }))).toBe(false);
    expect(hasTab(render({ application: application(), role: 'interviewer', interviewWorkspace: workspace() }))).toBe(false);
    expect(hasTab(render({ application: application(), role: 'department_chair', interviewWorkspace: workspace({ isApprover: false }) }))).toBe(false);
  });

  it('flags the tab as To set for an approver with nothing recorded, and not once it is set', () => {
    expect(render({ application: application(), role: 'dean', interviewWorkspace: workspace({ isApprover: true }) })).toContain('To set');
    expect(render({ application: application(), role: 'dean', interviewWorkspace: workspace({ isApprover: true, grantAmounts: [record] }) })).not.toContain('To set');
    expect(render({ application: application(), role: 'admissions_office', interviewWorkspace: workspace() })).not.toContain('To set');
  });

  it('lets the Admin edit at Recommended and Approved but not Staff or a released case', () => {
    const form = (props) => render(props).includes('Save grant amount');
    expect(form({ application: application(), role: 'admissions_admin', interviewWorkspace: workspace(), initialTab: 'grant' })).toBe(true);
    expect(form({ application: application({ status: 'Approved' }), role: 'admissions_admin', interviewWorkspace: workspace(), initialTab: 'grant' })).toBe(true);
    expect(form({ application: application({ status: 'Released' }), role: 'admissions_admin', interviewWorkspace: workspace(), initialTab: 'grant' })).toBe(false);
    expect(form({ application: application(), role: 'admissions_office', interviewWorkspace: workspace(), initialTab: 'grant' })).toBe(false);
  });
});
