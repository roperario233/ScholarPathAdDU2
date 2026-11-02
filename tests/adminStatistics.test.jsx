import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AdminStatistics from '../src/pages/admin/AdminStatistics';
import ReviewerStatisticsView from '../src/pages/ReviewerStatisticsView';
import { getCurrentAcademicYear } from '../src/lib/profile';

const now = new Date().toISOString();

describe('AdminStatistics page', () => {
  it('renders the office figures without naming an applicant', () => {
    const markup = renderToStaticMarkup(
      <AdminStatistics
        applications={[
          { id: 'a', status: 'Released', studentName: 'Ada Cruz', scholarshipId: 'gia', scholarshipTitle: 'Grant-in-Aid (GIA)', submittedAt: now, statusLog: [], attachedDocuments: [] },
          { id: 'b', status: 'Rejected', studentName: 'Ben Reyes', scholarshipId: 'gia', scholarshipTitle: 'Grant-in-Aid (GIA)', submittedAt: now, statusLog: [], attachedDocuments: [] },
        ]}
      />,
    );
    expect(markup).toContain('Office statistics');
    expect(markup).toContain('50% of decided cases');
    expect(markup).toContain('Application pipeline');
    expect(markup).toContain(`Academic year ${getCurrentAcademicYear()}`);
    expect(markup).not.toContain('Ada Cruz');
    expect(markup).not.toContain('Ben Reyes');
  });

  it('shows Admissions Office Staff volume only', () => {
    const markup = renderToStaticMarkup(
      <AdminStatistics
        role="admissions_office"
        applications={[
          { id: 'a', status: 'Released', scholarshipId: 'gia', scholarshipTitle: 'Grant-in-Aid (GIA)', submittedAt: now, statusLog: [], attachedDocuments: [] },
          { id: 'b', status: 'Rejected', scholarshipId: 'gia', scholarshipTitle: 'Grant-in-Aid (GIA)', submittedAt: now, statusLog: [], attachedDocuments: [] },
        ]}
      />,
    );
    expect(markup).toContain('Office statistics');
    expect(markup).toContain('Closed');
    expect(markup).not.toMatch(/Acceptance rate|Not accepted|Panel recommendations|accepted</);
  });

  it('shows a reviewer its fixed scope instead of a school filter', () => {
    const markup = renderToStaticMarkup(
      <ReviewerStatisticsView
        profile={{ id: 'chair-1', role: 'department_chair', reviewSchool: 'School of Arts and Sciences', reviewDepartment: 'Computer Science Department' }}
        queue={[{ id: 'a', status: 'Recommended', studentProgram: 'BS Computer Science', scholarshipId: 'gia', scholarshipTitle: 'Grant-in-Aid (GIA)', submittedAt: now, statusLog: [], attachedDocuments: [] }]}
      />,
    );
    expect(markup).toContain('Chairperson statistics');
    expect(markup).toContain('Your scope');
    expect(markup).toContain('Computer Science Department statistics');
    expect(markup).not.toContain('All schools');
    expect(markup).toContain('Awaiting your decision');
    expect(markup).toContain('By program');
  });

  it('shows an empty state when nothing was submitted', () => {
    const markup = renderToStaticMarkup(<AdminStatistics applications={[{ id: 'd', status: 'Draft' }]} />);
    expect(markup).toContain('No submitted applications in this view');
  });
});
