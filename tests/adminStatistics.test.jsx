import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AdminStatistics from '../src/pages/admin/AdminStatistics';
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

  it('shows an empty state when nothing was submitted', () => {
    const markup = renderToStaticMarkup(<AdminStatistics applications={[{ id: 'd', status: 'Draft' }]} />);
    expect(markup).toContain('No submitted applications in this view');
  });
});
