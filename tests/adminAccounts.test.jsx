import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountsWorkspace } from '../src/pages/admin/AdminAccounts';

const NOW = new Date('2026-10-29T00:00:00.000Z').getTime();
const SAS = 'School of Arts and Sciences (SAS)';

const profiles = [
  { userId: 'head-1', role: 'admissions_head', fullName: 'Head Reyes', email: 'head@example.com' },
  { userId: 'dean-1', role: 'dean', fullName: 'Dean Cruz', email: 'dean@example.com', reviewSchool: SAS },
  { userId: 'chair-1', role: 'department_chair', fullName: 'Chair Lim', email: 'chair@example.com', department: SAS, reviewDepartment: 'Computer Science Department', deactivatedAt: '2026-10-10T00:00:00.000Z' },
];
const invitations = [
  { id: 'inv-open', email: 'open@example.com', role: 'interviewer', reviewSchool: SAS, reviewCluster: 'Computer Studies', expiresAt: '2026-11-15T00:00:00.000Z' },
  { id: 'inv-old', email: 'old@example.com', role: 'admissions_office', expiresAt: '2026-10-01T00:00:00.000Z' },
];
const log = [
  { id: 'log-1', action: 'invited', targetEmail: 'open@example.com', role: 'interviewer', createdAt: '2026-10-28T00:00:00.000Z' },
];

const render = (props = {}) => renderToStaticMarkup(
  <AccountsWorkspace profiles={profiles} invitations={invitations} log={log} currentUserId="head-1" now={NOW} {...props} />,
);

describe('AccountsWorkspace', () => {
  it('shows the title, the totals, the invitation form, and the account list', () => {
    const html = render();
    expect(html).toContain('Accounts');
    expect(html).toContain('Invite an account');
    expect(html).toContain('Send invitation');
    expect(html).toContain('Dean Cruz');
    expect(html).toContain('open@example.com');
    // Active 2 (Head, Dean) · Invited 1 · Expired 1 · Deactivated 1.
    expect(html).toContain('2 active');
  });

  it('labels each status and offers the matching actions', () => {
    const html = render();
    expect(html).toContain('Invitation expired');
    expect(html).toContain('Deactivated');
    expect(html).toContain('Renew invitation');
    expect(html).toContain('Revoke invitation');
    expect(html).toContain('Change role or scope');
    expect(html).toContain('Reactivate');
  });

  it('never offers the signed-in Head an action on their own row', () => {
    const html = render({ profiles: [profiles[0]], invitations: [] });
    expect(html).toContain('Head Reyes');
    expect(html).not.toContain('>Deactivate</button>');
    expect(html).not.toContain('>Change role or scope</button>');
  });

  it('offers Deactivate and Change on another active account', () => {
    const html = render({ profiles: [profiles[1]], invitations: [] });
    expect(html).toContain('>Deactivate</button>');
    expect(html).toContain('>Change role or scope</button>');
  });

  it('records changes in the log with a readable sentence', () => {
    expect(render()).toContain('Invited open@example.com as Interviewer');
  });

  it('says so when the migration has not been applied', () => {
    const html = render({ profiles: [], invitations: [], log: [], missing: true });
    expect(html).toContain('20261051000000_account_provisioning.sql');
  });

  it('shows an empty state before any account exists', () => {
    const html = render({ profiles: [], invitations: [], log: [] });
    expect(html).toContain('No staff or reviewer accounts yet');
  });

  it('lists the provisionable roles in the form', () => {
    const html = render();
    expect(html).toContain('Admissions Office Staff');
    expect(html).toContain('Admissions Office Head');
    expect(html).toContain('Chairperson');
    expect(html).toContain('Interviewer');
  });
});
