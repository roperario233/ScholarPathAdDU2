import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock3, UserCheck, UserX } from 'lucide-react';
import AdminPageHeader, { AdminHeaderTile } from '../../components/AdminPageHeader';
import ReasonModal from '../../components/ReasonModal';
import { StatCard } from '../../components/pageParts';
import { Button, Card, EmptyState, FormField, ModalShell, StatusBadge } from '../../components/ui';
import {
  ACCOUNT_ACTION_LABELS,
  ACCOUNT_STATUS_META,
  EMPTY_INVITATION_DRAFT,
  INTERVIEWER_SCOPE_LEVELS,
  PROVISIONABLE_ROLES,
  buildAccountRows,
  buildInvitationArguments,
  buildScopeArguments,
  describeProvisioningEvent,
  filterAccountRows,
  getAccountActions,
  getDraftFromAccount,
  getHierarchyOptions,
  getProvisionableRole,
  getScopeFields,
  summarizeAccounts,
  validateInvitationDraft,
} from '../../lib/accountProvisioning';
import { academicPrograms as referencePrograms } from '../../lib/academicPrograms';
import { fmtDate as formatDate, plural } from '../../lib/formatters';
import {
  deactivateSupabaseAccount,
  inviteSupabaseAccount,
  loadSupabaseAccounts,
  reactivateSupabaseAccount,
  renewSupabaseAccountInvitation,
  revokeSupabaseAccountInvitation,
  updateSupabaseAccountScope,
} from '../../lib/supabaseData';

const bannerClasses = {
  success: 'feedback-banner feedback-banner--success border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
  error: 'feedback-banner feedback-banner--error border-rose-400/30 bg-rose-500/10 text-rose-200',
  info: 'feedback-banner feedback-banner--info border-sky-400/30 bg-sky-500/10 text-sky-200',
};

// The role picker and the hierarchy fields the chosen role owns. Shared by the
// invitation form and the "Change role or scope" dialog so both ask the same thing.
function RoleScopeFields({ draft, onChange, hierarchy, errors = {}, idPrefix }) {
  const role = getProvisionableRole(draft.role);
  const fields = getScopeFields(draft.role, draft.interviewerLevel);
  const set = (patch) => onChange({ ...draft, ...patch });

  return (
    <>
      <FormField label="Role" error={errors.role} required={!draft.role}>
        <select
          id={`${idPrefix}-role`}
          value={draft.role}
          onChange={(event) => set({ role: event.target.value, school: '', cluster: '', department: '' })}
        >
          <option value="">Choose a role</option>
          {PROVISIONABLE_ROLES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
        </select>
      </FormField>

      {role && (
        <p className="rounded-xl border border-app-border bg-app-surface px-3 py-2 text-xs text-app-muted" data-testid="role-summary">
          {role.summary}
        </p>
      )}

      {draft.role === 'interviewer' && (
        <FormField label="Interviews applicants of">
          <select
            id={`${idPrefix}-level`}
            value={draft.interviewerLevel}
            onChange={(event) => set({ interviewerLevel: event.target.value, cluster: '', department: '' })}
          >
            {INTERVIEWER_SCOPE_LEVELS.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}
          </select>
        </FormField>
      )}

      {fields.includes('school') && (
        <FormField label="School" error={errors.school} required={!draft.school}>
          <select
            id={`${idPrefix}-school`}
            value={draft.school}
            onChange={(event) => set({ school: event.target.value, cluster: '', department: '' })}
          >
            <option value="">Choose a school</option>
            {hierarchy.schools.map((school) => <option key={school} value={school}>{school}</option>)}
          </select>
        </FormField>
      )}

      {fields.includes('cluster') && (
        <FormField label="Cluster" error={errors.cluster} required={!draft.cluster}>
          <select
            id={`${idPrefix}-cluster`}
            value={draft.cluster}
            disabled={!draft.school}
            onChange={(event) => set({ cluster: event.target.value })}
          >
            <option value="">{draft.school ? 'Choose a cluster' : 'Choose a school first'}</option>
            {(hierarchy.clustersBySchool[draft.school] || []).map((cluster) => <option key={cluster} value={cluster}>{cluster}</option>)}
          </select>
        </FormField>
      )}

      {fields.includes('department') && (
        <FormField label="Department" error={errors.department} required={!draft.department}>
          <select
            id={`${idPrefix}-department`}
            value={draft.department}
            disabled={!draft.school}
            onChange={(event) => set({ department: event.target.value })}
          >
            <option value="">{draft.school ? 'Choose a department' : 'Choose a school first'}</option>
            {(hierarchy.departmentsBySchool[draft.school] || []).map((department) => <option key={department} value={department}>{department}</option>)}
          </select>
        </FormField>
      )}
    </>
  );
}

// The invitation form lives in a dialog the Head opens from the page header, so
// the account list stays the first thing on the page.
function InviteAccountDialog({ hierarchy, programs, onInvite, onClose }) {
  const [draft, setDraft] = useState(EMPTY_INVITATION_DRAFT);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const { errors: found, valid } = validateInvitationDraft(draft, programs);
    setErrors(found);
    setSubmitError('');
    if (!valid) return;
    setBusy(true);
    const result = await onInvite(draft);
    setBusy(false);
    if (result?.error) {
      setSubmitError(result.error);
      return;
    }
    onClose();
  };

  const update = (next) => {
    setDraft(next);
    if (Object.keys(errors).length) setErrors({});
  };

  return (
    <ModalShell title="Invite an account" onClose={busy ? undefined : onClose} className="w-[min(720px,100%)]">
      <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
        <p className="m-0 text-xs text-app-muted">Sign-in claims the role: it applies when the person first signs in with the invited address.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Email address" error={errors.email} hint="The address the person will sign in with. A personal Gmail address works." required={!draft.email.trim()}>
            <input
              id="invite-email"
              type="email"
              autoComplete="off"
              value={draft.email}
              onChange={(event) => update({ ...draft, email: event.target.value })}
              placeholder="name@addu.edu.ph"
            />
          </FormField>
          <FormField label="Full name (optional)" hint="Shown on the account until the person edits it in My Profile.">
            <input
              id="invite-name"
              autoComplete="off"
              value={draft.fullName}
              onChange={(event) => update({ ...draft, fullName: event.target.value })}
              placeholder="Last, First Middle"
            />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <RoleScopeFields draft={draft} onChange={update} hierarchy={hierarchy} errors={errors} idPrefix="invite" />
        </div>
        {submitError && <p className="text-sm text-rose-300" role="alert">{submitError}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 min-w-0 flex-1 text-xs text-app-muted">The invitation is open for 30 days. Nothing is emailed: tell the person to sign in with this address.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Send invitation'}</Button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}

function ChangeScopeDialog({ row, hierarchy, programs, onSave, onClose }) {
  const [draft, setDraft] = useState(() => getDraftFromAccount(row.source));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const handleSave = async () => {
    if (busy) return;
    // The email is not edited here, so only the role and scope are checked.
    const { errors: found } = validateInvitationDraft({ ...draft, email: 'account@example.com' }, programs);
    delete found.email;
    setErrors(found);
    setSubmitError('');
    if (Object.keys(found).length) return;
    setBusy(true);
    const result = await onSave(row, draft);
    setBusy(false);
    if (result?.error) setSubmitError(result.error);
  };

  return (
    <ModalShell title="Change role or scope" onClose={onClose} className="w-[min(560px,100%)]">
      <div className="grid gap-4">
        <p className="text-sm text-app-muted">{row.name || row.email} · {row.email}</p>
        <RoleScopeFields draft={draft} onChange={(next) => { setDraft(next); setErrors({}); }} hierarchy={hierarchy} errors={errors} idPrefix="change" />
        {submitError && <p className="text-sm text-rose-300" role="alert">{submitError}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" variant="primary" onClick={handleSave} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </div>
    </ModalShell>
  );
}

function AccountRow({ row, actions, onAction }) {
  const meta = ACCOUNT_STATUS_META[row.status];
  return (
    <li className="grid gap-3 rounded-2xl border border-app-border bg-app-surface p-4 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_auto] sm:items-center" data-account-row={row.kind}>
      <div className="min-w-0">
        <strong className="block text-sm text-app-text [overflow-wrap:anywhere]">{row.name || row.email}</strong>
        {row.name && <span className="block text-xs text-app-muted [overflow-wrap:anywhere]">{row.email}</span>}
      </div>
      <div className="min-w-0">
        <span className="block text-sm font-semibold text-app-text">{row.roleLabel}</span>
        <span className="block text-xs text-app-muted [overflow-wrap:anywhere]">{row.scopeLabel}</span>
        {row.kind === 'invitation' && row.expiresAt && (
          <span className="block text-xs text-app-muted">
            {row.status === 'expired' ? 'Expired' : 'Expires'} {formatDate(row.expiresAt)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
        {actions.map((action) => (
          <Button
            key={action}
            type="button"
            variant={action === 'deactivate' || action === 'revoke' ? 'danger' : 'secondary'}
            className="!min-h-9 !px-3"
            onClick={() => onAction(action, row)}
          >
            {ACCOUNT_ACTION_LABELS[action]}
          </Button>
        ))}
      </div>
    </li>
  );
}

// The presentational page: everything it shows comes from props, so it renders
// without a Supabase session. `AdminAccounts` below loads the data and wires it.
export function AccountsWorkspace({
  profiles = [],
  invitations = [],
  log = [],
  programs = referencePrograms,
  currentUserId = '',
  loading = false,
  missing = false,
  loadError = '',
  feedback = null,
  now = Date.now(),
  onInvite = async () => ({}),
  onChangeScope = async () => ({}),
  onRenew = async () => ({}),
  onRevoke = async () => ({}),
  onDeactivate = async () => ({}),
  onReactivate = async () => ({}),
}) {
  const hierarchy = useMemo(() => getHierarchyOptions(programs), [programs]);
  const rows = useMemo(() => buildAccountRows({ profiles, invitations, now }), [profiles, invitations, now]);
  const summary = useMemo(() => summarizeAccounts(rows), [rows]);
  const [filters, setFilters] = useState({ query: '', role: '', status: '' });
  const [dialog, setDialog] = useState(null);
  const visibleRows = useMemo(() => filterAccountRows(rows, filters), [rows, filters]);
  const closeDialog = () => setDialog(null);

  const handleAction = (action, row) => {
    if (action === 'renew') onRenew(row);
    else if (action === 'reactivate') onReactivate(row);
    else setDialog({ action, row });
  };

  return (
    <div className="grid content-start gap-5">
      <AdminPageHeader
        title="Accounts"
        description="Invite Admissions Office and academic reviewer accounts. The role is assigned when the person signs in with the invited address."
      >
        <AdminHeaderTile
          icon={UserCheck}
          label="Accounts"
          title={plural(summary.active, 'active account')}
          note={summary.expired
            ? `${plural(summary.expired, 'invitation')} expired. Renew or revoke.`
            : `${summary.invited} invited · ${summary.deactivated} deactivated`}
          tone={summary.expired ? 'warning' : 'info'}
        />
      </AdminPageHeader>

      {missing && (
        <div className={`${bannerClasses.error} w-full rounded-xl border px-3 py-3 text-sm`} role="alert">
          Account provisioning is not set up on this Supabase project yet. Apply migration 20261051000000_account_provisioning.sql, then reload this page.
        </div>
      )}
      {loadError && !missing && (
        <div className={`${bannerClasses.error} w-full rounded-xl border px-3 py-3 text-sm`} role="alert">{loadError}</div>
      )}
      {feedback && (
        <div className={`${bannerClasses[feedback.tone] || bannerClasses.info} w-full rounded-xl border px-3 py-3 text-sm`} role="status">{feedback.message}</div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Account totals">
        <StatCard icon={UserCheck} tone="success" label="Active" value={summary.active} note="Can sign in with their role" />
        <StatCard icon={Clock3} tone="info" label="Invited" value={summary.invited} note="Waiting for first sign-in" />
        <StatCard icon={Clock3} tone="warning" label="Expired" value={summary.expired} note="Renew or revoke" />
        <StatCard icon={UserX} tone="neutral" label="Deactivated" value={summary.deactivated} note="Role removed, history kept" />
      </section>

      <Card
        title="Accounts"
        action={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <StatusBadge>{visibleRows.length} shown</StatusBadge>
            <Button type="button" variant="primary" onClick={() => setDialog({ action: 'invite' })}>Invite an account</Button>
          </div>
        )}
      >
        <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <input
            type="search"
            aria-label="Search accounts"
            placeholder="Search name, email, role, or scope"
            value={filters.query}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
          />
          <select aria-label="Filter by role" value={filters.role} onChange={(event) => setFilters({ ...filters, role: event.target.value })}>
            <option value="">All roles</option>
            {PROVISIONABLE_ROLES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
          <select aria-label="Filter by status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="">All statuses</option>
            {Object.entries(ACCOUNT_STATUS_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
          </select>
        </div>

        {loading ? (
          <p className="text-sm text-app-muted" role="status">Loading accounts…</p>
        ) : visibleRows.length ? (
          <ul className="grid gap-3">
            {visibleRows.map((row) => (
              <AccountRow
                key={`${row.kind}-${row.id}`}
                row={row}
                actions={getAccountActions(row, { currentUserId })}
                onAction={handleAction}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            title={rows.length ? 'No accounts match these filters' : 'No staff or reviewer accounts yet'}
            description={rows.length ? 'Clear the search or filters to see every account.' : 'Use Invite an account to add the first one.'}
          />
        )}
      </Card>

      <Card title="Recent account changes" action={<StatusBadge>{log.length} recorded</StatusBadge>}>
        {log.length ? (
          <ul className="grid max-h-[320px] gap-2 overflow-y-auto pr-2">
            {log.map((entry) => (
              <li key={entry.id} className="rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm">
                <span className="text-app-text [overflow-wrap:anywhere]">{describeProvisioningEvent(entry)}</span>
                <span className="block text-xs text-app-muted">
                  {formatDate(entry.createdAt)}{entry.reason ? ` · ${entry.reason}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nothing recorded yet" description="Invitations, role changes, and deactivations appear here." />
        )}
      </Card>

      {dialog?.action === 'invite' && (
        <InviteAccountDialog hierarchy={hierarchy} programs={programs} onInvite={onInvite} onClose={closeDialog} />
      )}
      {dialog?.action === 'change' && (
        <ChangeScopeDialog
          row={dialog.row}
          hierarchy={hierarchy}
          programs={programs}
          onClose={closeDialog}
          onSave={async (row, draft) => {
            const result = await onChangeScope(row, draft);
            if (!result?.error) closeDialog();
            return result;
          }}
        />
      )}
      {dialog?.action === 'revoke' && (
        <ReasonModal
          title="Revoke invitation"
          hint={`Why is the invitation for ${dialog.row.email} being withdrawn?`}
          confirmLabel="Revoke invitation"
          onClose={closeDialog}
          onConfirm={async (reason) => {
            const result = await onRevoke(dialog.row, reason);
            if (!result?.error) closeDialog();
            return result;
          }}
        />
      )}
      {dialog?.action === 'deactivate' && (
        <ReasonModal
          title="Deactivate account"
          hint={`${dialog.row.name || dialog.row.email} will lose their role and be signed out. Their history stays. Why is the account being deactivated?`}
          confirmLabel="Deactivate account"
          onClose={closeDialog}
          onConfirm={async (reason) => {
            const result = await onDeactivate(dialog.row, reason);
            if (!result?.error) closeDialog();
            return result;
          }}
        />
      )}
    </div>
  );
}

const describeAccountError = (error) => {
  const message = error?.message || '';
  if (/function .* does not exist|could not find the function|PGRST202/i.test(message) || error?.code === 'PGRST202') {
    return 'Account provisioning is not set up on this Supabase project yet. Apply migration 20261051000000_account_provisioning.sql.';
  }
  return message || 'That change could not be saved.';
};

export default function AdminAccounts({ academicPrograms = referencePrograms, currentUserId = '' }) {
  const [data, setData] = useState({ profiles: [], invitations: [], log: [] });
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [feedback, setFeedback] = useState(null);

  const reload = useCallback(async () => {
    const result = await loadSupabaseAccounts();
    if (result.success) {
      setData({ profiles: result.profiles, invitations: result.invitations, log: result.log });
      setMissing(false);
      setLoadError('');
    } else {
      setMissing(Boolean(result.missing));
      setLoadError(result.missing ? '' : (result.error?.message || 'Accounts could not be loaded.'));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Runs one write, then refreshes the list and reports the outcome in the banner.
  const perform = useCallback(async (write, successMessage) => {
    setFeedback(null);
    const { error } = await write();
    if (error) {
      const message = describeAccountError(error);
      setFeedback({ tone: 'error', message });
      return { error: message };
    }
    setFeedback({ tone: 'success', message: successMessage });
    await reload();
    return {};
  }, [reload]);

  return (
    <AccountsWorkspace
      profiles={data.profiles}
      invitations={data.invitations}
      log={data.log}
      programs={academicPrograms}
      currentUserId={currentUserId}
      loading={loading}
      missing={missing}
      loadError={loadError}
      feedback={feedback}
      onInvite={(draft) => perform(
        () => inviteSupabaseAccount(buildInvitationArguments(draft)),
        `Invitation recorded for ${draft.email.trim().toLowerCase()}. Ask them to sign in with that address; the role applies on first sign-in.`,
      )}
      onChangeScope={(row, draft) => perform(
        () => updateSupabaseAccountScope(row.id, buildScopeArguments(draft)),
        `${row.name || row.email} was updated. The change applies the next time they load the app.`,
      )}
      onRenew={(row) => perform(() => renewSupabaseAccountInvitation(row.id), `Invitation for ${row.email} renewed for another 30 days.`)}
      onRevoke={(row, reason) => perform(() => revokeSupabaseAccountInvitation(row.id, reason), `Invitation for ${row.email} revoked.`)}
      onDeactivate={(row, reason) => perform(() => deactivateSupabaseAccount(row.id, reason), `${row.name || row.email} was deactivated.`)}
      onReactivate={(row) => perform(() => reactivateSupabaseAccount(row.id), `${row.name || row.email} was reactivated.`)}
    />
  );
}
