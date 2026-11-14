import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ReleasedResultsModal from '../src/components/ReleasedResultsModal';
import AdminResultsRelease from '../src/pages/admin/AdminResultsRelease';

const entry = (id, status, name) => ({ id, status, studentName: name, studentProgram: 'BS Information Technology' });
const text = (markup) => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

const baseProps = {
  title: 'Grant-in-Aid (GIA)',
  kindLabel: 'Accepted and waitlisted released',
  releasedAtLabel: 'Nov 14, 2026',
  getResult: (item) => ({ label: item.status === 'Released' ? 'Accepted' : item.status, tone: 'success' }),
  onOpenCase: () => {},
  onExport: () => {},
  onClose: () => {},
};

describe('Released results dialog', () => {
  it('lists the covered applications with a search, a result filter, and a count per group', () => {
    const covered = [entry('a', 'Released', 'Arvin, Kath'), entry('b', 'Released', 'Miral, Pette'), entry('c', 'Waitlisted', 'Santos, Ana')];
    const markup = renderToStaticMarkup(<ReleasedResultsModal {...baseProps} coveredCount={3} covered={covered} />);
    const copy = text(markup);
    ['Grant-in-Aid (GIA) released results', '3 applications covered', 'Arvin, Kath', 'Santos, Ana', 'View case'].forEach((part) => expect(copy).toContain(part));
    expect(markup).toContain('type="search"');
    expect(markup).toContain('aria-label="Search the applications covered by this release"');
    // Groups nobody fell into are left out; the others carry their count.
    expect(copy).toContain('All 3 Accepted 2 Waitlisted 1');
    expect(copy).not.toContain('Declined');
    expect(copy).toContain('3 applications');
  });

  it('shows the first 50 and offers the rest, so a large release never dumps onto the screen', () => {
    const covered = Array.from({ length: 120 }, (_, index) => entry(`r${index}`, 'Released', `Student ${String(index).padStart(3, '0')}`));
    const markup = renderToStaticMarkup(<ReleasedResultsModal {...baseProps} coveredCount={120} covered={covered} />);
    const copy = text(markup);
    expect(markup.match(/View case/g)).toHaveLength(50);
    expect(copy).toContain('showing the first 50');
    expect(copy).toContain('Show 50 more');
    expect(copy).toContain('Student 049');
    expect(copy).not.toContain('Student 050');
  });

  it('says so when the covered applications are not loaded in the session', () => {
    const copy = text(renderToStaticMarkup(<ReleasedResultsModal {...baseProps} coveredCount={4} covered={[]} />));
    expect(copy).toContain('The covered applications are not loaded in this session.');
    expect(copy).not.toContain('View case');
  });
});

describe('Released results on the release page', () => {
  it('shows one pressable card per release and keeps the applicants off the page', () => {
    const applications = [
      { id: 'r1', status: 'Released', studentName: 'Cruz, Juan', studentId: 's1', scholarshipId: 'gia', scholarshipTitle: 'Grant-in-Aid (GIA)', studentProgram: 'BS Information Systems', timeline: [], statusLog: [] },
      { id: 'r2', status: 'Released', studentName: 'Reyes, Maria', studentId: 's2', scholarshipId: 'gia', scholarshipTitle: 'Grant-in-Aid (GIA)', studentProgram: 'BS Information Systems', timeline: [], statusLog: [] },
    ];
    const resultsReleases = [{
      id: 'rel1', scholarshipId: 'gia', kind: 'offers', applicationIds: ['r1', 'r2'], applicantCount: 2, acceptedCount: 2,
      releasedAt: '2026-11-14T02:00:00Z', releasedBy: 'admin-1',
    }];
    const markup = renderToStaticMarkup(
      <AdminResultsRelease
        applications={applications}
        scholarships={[{ id: 'gia', title: 'Grant-in-Aid (GIA)' }]}
        resultsReleases={resultsReleases}
        interviewWorkspace={{ grantAmounts: [], notes: [], approvalLevels: [] }}
      />,
    );
    const copy = text(markup);
    expect(copy).toContain('Released results');
    expect(copy).toContain('Accepted and waitlisted released');
    expect(copy).toContain('2 applicants');
    expect(copy).toContain('View 2 applications');
    expect(markup).toContain('aria-haspopup="dialog"');
    // The list is in the dialog, which is closed until a card is pressed.
    expect(copy).not.toContain('Cruz, Juan');
    expect(markup).not.toContain('Search the applications covered by this release');
  });
});
