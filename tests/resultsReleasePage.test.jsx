import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AdminResultsRelease from '../src/pages/admin/AdminResultsRelease';

const app = (id, status, name, extra = {}) => ({
  id, status, studentName: name, studentId: `s-${id}`, scholarshipId: 'gia', scholarshipTitle: 'Grant-in-Aid (GIA)',
  studentProgram: 'BS Information Technology', submittedAt: '2026-10-01', updatedAt: '2026-11-03', timeline: [], statusLog: [], ...extra,
});

const renderMarkup = (applications, extra = {}) => renderToStaticMarkup(
  <AdminResultsRelease
    applications={applications}
    scholarships={[{ id: 'gia', title: 'Grant-in-Aid (GIA)' }]}
    interviewWorkspace={{ grantAmounts: [{ applicationId: 'a1', amountPerSemester: 213 }], notes: [], approvalLevels: [] }}
    {...extra}
  />,
);

const render = (applications, extra = {}) => renderMarkup(applications, extra)
  .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

const mixed = [
  app('a1', 'Approved', 'Arvin, Kath Karl'),
  app('a2', 'Approved', 'Miral, Pette Samuel'),
  app('w1', 'Waitlisted', 'Micheal, Reeves Myers'),
  app('n1', 'Rejected', 'Santos, Ana', { statusLog: [{ fromStatus: 'Recommended', toStatus: 'Rejected' }] }),
];

describe('Final check and release', () => {
  it('keeps the page to one summary row per scholarship', () => {
    const text = render(mixed);
    expect(text).toContain('Step 1 of 4 · Final check');
    expect(text).toContain('2 accepted');
    expect(text).toContain('1 waitlisted');
    expect(text).toContain('1 not accepted');
    expect(text).toContain('Open results');
    // The card says which round this is and where it stands.
    ['Academic year 2026–2027', 'Applicants', 'Application deadline', 'Final check', '0 of 2 checked', '1 of 2 grant amounts set', 'Confirmations', 'Not released yet']
      .forEach((part) => expect(text).toContain(part));
    expect(text).toContain('Excel export');
    expect(text.match(/Export to Excel/g)).toHaveLength(1); // overall export
    // The applicant rows live in the workspace modal, not on the page.
    expect(text).not.toContain('Santos, Ana');
  });

  it('opens the workspace with one tab per outcome and the accepted list first', () => {
    const text = render(mixed, { initialOpenRoundId: 'gia' });
    const markup = renderMarkup(mixed, { initialOpenRoundId: 'gia' });
    // The tab strip carries each outcome's count.
    expect(text).toContain('Accepted 2 Waitlisted 1 Not accepted 1');
    ['Arvin, Kath Karl', 'Miral, Pette Samuel', 'Student hears:', 'Next step Step 1 of 4 · Final check'].forEach((part) => expect(text).toContain(part));
    expect(text.match(/Mark final check/g)).toHaveLength(2);
    expect(text).not.toContain('Mark final check as done');
    expect(text).toContain('Grant amount not set');
    expect(text).not.toContain('Set the grant amount before the final check.');
    expect(markup.match(/w-\[12\.5rem\] shrink-0/g)).toHaveLength(2); // fixed width with and without the grant hint
    // The header names the round: academic year, deadline, and applicants.
    expect(text).toContain('Academic year 2026–2027 · Application deadline No deadline set · 4 applicants');
    // The other outcomes live on their own tabs, so each list scrolls on its own.
    expect(text).not.toContain('Micheal, Reeves Myers');
    expect(text).not.toContain('Close results…');
    const layoutMarkup = renderMarkup(mixed, { initialOpenRoundId: 'gia' });
    expect(layoutMarkup).toContain('md:grid-cols-[minmax(0,1fr)_17rem]');
    expect(layoutMarkup).toContain('md:border-l');
  });

  it('provides a separately scoped workbook export on every scholarship card', () => {
    const applications = [
      app('a1', 'Approved', 'Arvin, Kath Karl'),
      app('j1', 'Waitlisted', 'Miral, Pette Samuel', { scholarshipId: 'jsf', scholarshipTitle: 'Jubilee Scholarship Fund (JSF)' }),
    ];
    const markup = renderMarkup(applications, {
      scholarships: [
        { id: 'gia', title: 'Grant-in-Aid (GIA)' },
        { id: 'jsf', title: 'Jubilee Scholarship Fund (JSF)' },
      ],
    });
    expect(markup).toContain('aria-label="Export Grant-in-Aid (GIA) results to Excel"');
    expect(markup).toContain('aria-label="Export Jubilee Scholarship Fund (JSF) results to Excel"');
  });

  it('opens on the waitlist when no one is waiting for the final check', () => {
    const text = render([app('w1', 'Waitlisted', 'Micheal, Reeves Myers')], { initialOpenRoundId: 'gia' });
    expect(text).toContain('Micheal, Reeves Myers');
    expect(text).toContain('Not told yet');
  });

  it('offers the close once only Not accepted cases are left', () => {
    const text = render([app('n1', 'Rejected', 'Santos, Ana', { statusLog: [{ fromStatus: 'For Verification', toStatus: 'Rejected' }] })], { initialOpenRoundId: 'gia' });
    expect(text).toContain('Next step Step 4 of 4 · Close results');
    expect(text).toContain('Close results…');
    expect(text).toContain('Santos, Ana');
    expect(text).toContain('closed by the office before the interview');
  });
});
