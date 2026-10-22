import { useState } from 'react';
import { Button, EmptyState, Panel, StatusBadge } from './ui';
import ReasonModal from './ReasonModal';
import InterviewLocationsModal from './InterviewLocationsModal';
import { fmtDate } from '../lib/formatters';
import {
  DEFAULT_INTERVIEW_INSTRUCTIONS,
  INTERVIEW_DURATIONS,
  INTERVIEW_MODES,
  buildGoogleCalendarTemplateUrl,
  describeInterviewConflict,
  downloadInterviewIcs,
  findInterviewConflicts,
  formatInterviewWhen,
  getEligiblePanelists,
  getInterviewModeLabel,
  getInterviewStateLabel,
  isInterviewOutcomeDue,
  isStructuredInterview,
  isoToManilaInputs,
} from '../lib/interview';

const sectionHeading = 'm-0 text-sm font-bold uppercase tracking-[0.1em] text-app-muted';
const fieldError = 'text-xs text-rose-700 dark:text-rose-200';
const roleLabels = {
  admissions_office: 'Admissions Office Staff',
  admissions_head: 'Admissions Office Head',
  department_chair: 'Department Chair',
};

const stateTone = (state) => ({ scheduled: 'info', completed: 'success', no_show: 'warning', cancelled: 'danger' }[state] || 'neutral');

const fmtWhen = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${fmtDate(value)} · ${date.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}`;
};

const todayManila = () => isoToManilaInputs(new Date().toISOString()).date;

function PanelList({ panel }) {
  if (!panel.length) return <p className="m-0 text-sm text-app-muted">No panel members recorded.</p>;
  return (
    <ul className="m-0 grid gap-1 p-0">
      {panel.map((member) => (
        <li key={member.id || member.profileId || member.guestName} className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-app-text">
          <span className="min-w-0 truncate">{member.name}</span>
          <span className="text-xs text-app-muted">{member.profileId ? 'Department Chair' : `Faculty guest${member.guestEmail ? ` · ${member.guestEmail}` : ''}`}</span>
          {member.isLead ? <StatusBadge tone="info">Lead</StatusBadge> : null}
        </li>
      ))}
    </ul>
  );
}

// The schedule form. The draft lives in ApplicationReviewModal because the
// action bar's "Schedule interview" button confirms it.
function ScheduleForm({ application, draft, onDraftChange, errors, showErrors, workspace, panelNameById, canManageLocations, onManageLocations }) {
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [chairToAdd, setChairToAdd] = useState('');
  const activeLocations = (workspace.locations || []).filter((entry) => entry.isActive);
  const eligible = getEligiblePanelists(workspace.staffDirectory, application);
  const onPanel = new Set(draft.panel.map((member) => member.profileId).filter(Boolean));
  const addable = eligible.filter((entry) => !onPanel.has(entry.userId));
  const conflicts = findInterviewConflicts(draft, {
    applications: workspace.applications,
    panelists: workspace.panelists,
    excludeApplicationId: application.id,
  });
  const show = (field) => (showErrors && errors[field] ? <span className={fieldError} role="alert">{errors[field]}</span> : null);

  const update = (patch) => onDraftChange({ ...draft, ...patch });
  const setMode = (mode) => {
    // Swap the default instructions with the mode unless the reviewer edited them.
    const instructions = Object.values(DEFAULT_INTERVIEW_INSTRUCTIONS).includes(draft.instructions) || !draft.instructions
      ? DEFAULT_INTERVIEW_INSTRUCTIONS[mode]
      : draft.instructions;
    update({ mode, instructions });
  };
  const withLead = (panel) => (panel.length && !panel.some((member) => member.isLead)
    ? panel.map((member, index) => ({ ...member, isLead: index === 0 }))
    : panel);
  const addMember = (member) => update({ panel: withLead([...draft.panel, { ...member, isLead: false }]) });
  const removeMember = (index) => update({ panel: withLead(draft.panel.filter((_, position) => position !== index)) });
  const setLead = (index) => update({ panel: draft.panel.map((member, position) => ({ ...member, isLead: position === index })) });

  return (
    <div className="grid gap-4">
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold text-app-text">Interview mode</legend>
        <div role="radiogroup" aria-label="Interview mode" className="inline-flex w-fit rounded-xl border border-app-border bg-app-surface p-1">
          {INTERVIEW_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={draft.mode === mode.value}
              onClick={() => setMode(mode.value)}
              className={`min-h-10 rounded-lg px-4 text-sm font-semibold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20 ${draft.mode === mode.value ? 'bg-ateneo text-white shadow-sm dark:bg-sky-500' : 'text-app-muted hover:text-app-text'}`}
            >{mode.label}</button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid content-start gap-1 text-sm text-app-text">
          <span className="font-semibold">Date</span>
          <input type="date" min={todayManila()} value={draft.date} onChange={(event) => update({ date: event.target.value })} />
          {show('date')}
        </label>
        <label className="grid content-start gap-1 text-sm text-app-text">
          <span className="font-semibold">Start time</span>
          <input type="time" step="300" value={draft.time} onChange={(event) => update({ time: event.target.value })} />
          {show('time')}
        </label>
        <label className="grid content-start gap-1 text-sm text-app-text">
          <span className="font-semibold">Length</span>
          <select value={draft.durationMinutes} onChange={(event) => update({ durationMinutes: Number(event.target.value) })}>
            {INTERVIEW_DURATIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
          </select>
          {show('durationMinutes')}
        </label>
      </div>
      <p className="-mt-2 m-0 text-xs text-app-muted">Times are in Philippine time (Asia/Manila).</p>

      {draft.mode === 'onsite' ? (
        <div className="grid content-start gap-1 text-sm text-app-text">
          <label htmlFor="interview-location" className="font-semibold">Location</label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="interview-location"
              className="min-w-0 flex-1"
              value={draft.locationId}
              onChange={(event) => update({ locationId: event.target.value })}
              disabled={!activeLocations.length}
            >
              <option value="">{activeLocations.length ? 'Select a location…' : 'No locations available'}</option>
              {activeLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {[location.name, [location.building, location.room].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                </option>
              ))}
            </select>
            {canManageLocations ? <Button type="button" onClick={onManageLocations}>Manage locations…</Button> : null}
          </div>
          {!activeLocations.length ? (
            <span className="text-xs text-app-muted">
              {canManageLocations ? 'Add the first interview location to schedule an on-site interview.' : 'No interview locations yet. Ask the Admissions Office Head to add one.'}
            </span>
          ) : null}
          {show('locationId')}
        </div>
      ) : (
        <label className="grid content-start gap-1 text-sm text-app-text">
          <span className="font-semibold">Meeting link</span>
          <input
            type="url"
            inputMode="url"
            value={draft.meetingUrl}
            onChange={(event) => update({ meetingUrl: event.target.value })}
            placeholder={workspace.calendarConfigured ? 'Leave blank to generate a Google Meet link' : 'https://meet.google.com/…'}
          />
          <span className="text-xs text-app-muted">
            {workspace.calendarConfigured
              ? 'Leave this blank and a Google Meet link and calendar invitation are created when the schedule is saved.'
              : 'Paste a Google Meet, Zoom, or Microsoft Teams link (https://). Automatic Meet links need the Google Calendar integration.'}
          </span>
          {show('meetingUrl')}
        </label>
      )}

      <section className="grid gap-2" aria-labelledby="interview-panel-heading">
        <div className="grid gap-1">
          <h5 id="interview-panel-heading" className="m-0 text-sm font-semibold text-app-text">Interview panel</h5>
          <p className="m-0 text-xs text-app-muted">
            SOP 5a: the panel comes from the school where the applicant’s program belongs — <strong className="text-app-text">{application.studentDepartment || 'school not on file'}</strong>.
          </p>
        </div>
        {draft.panel.length ? (
          <ul className="m-0 grid gap-2 p-0">
            {draft.panel.map((member, index) => (
              <li key={member.profileId || `guest-${index}`} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-app-border bg-app-surface px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-app-text">{member.profileId ? (panelNameById[member.profileId] || 'Department Chair') : member.guestName}</span>
                  <span className="block truncate text-xs text-app-muted">{member.profileId ? 'Department Chair' : `Faculty guest${member.guestEmail ? ` · ${member.guestEmail}` : ''}`}</span>
                </span>
                <label className="inline-flex min-h-10 items-center gap-2 text-xs text-app-muted">
                  <input type="radio" name="interview-lead" checked={member.isLead} onChange={() => setLead(index)} />
                  Lead
                </label>
                <Button type="button" variant="ghost" onClick={() => removeMember(index)} aria-label={`Remove ${member.profileId ? (panelNameById[member.profileId] || 'panel member') : member.guestName}`}>Remove</Button>
              </li>
            ))}
          </ul>
        ) : <p className="m-0 text-sm text-app-muted">No panel members yet.</p>}

        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <select value={chairToAdd} onChange={(event) => setChairToAdd(event.target.value)} disabled={!addable.length} aria-label="Department Chair from the applicant’s school">
            <option value="">{eligible.length ? (addable.length ? 'Add a Department Chair from this school…' : 'Every Chair from this school is on the panel') : 'No Department Chair account for this school'}</option>
            {addable.map((entry) => <option key={entry.userId} value={entry.userId}>{entry.fullName}</option>)}
          </select>
          <Button
            type="button"
            disabled={!chairToAdd}
            onClick={() => { addMember({ profileId: chairToAdd }); setChairToAdd(''); }}
          >Add Chair</Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Faculty guest name" aria-label="Faculty guest name" maxLength={120} />
          <input type="email" value={guestEmail} onChange={(event) => setGuestEmail(event.target.value)} placeholder="Email for the invitation (optional)" aria-label="Faculty guest email" />
          <Button
            type="button"
            disabled={!guestName.trim()}
            onClick={() => { addMember({ guestName: guestName.trim(), guestEmail: guestEmail.trim() }); setGuestName(''); setGuestEmail(''); }}
          >Add guest</Button>
        </div>
        <span className="text-xs text-app-muted">Faculty guests have no ScholarPath account; they receive the calendar invitation by email when the integration is configured, or the .ics file you share.</span>
        {show('panel')}
      </section>

      <label className="grid content-start gap-1 text-sm text-app-text">
        <span className="font-semibold">Instructions for the applicant</span>
        <textarea rows="2" maxLength={500} value={draft.instructions} onChange={(event) => update({ instructions: event.target.value })} />
        <span className="text-xs text-app-muted">The applicant sees these instructions with the schedule. Panel member names are never shown to the applicant.</span>
      </label>

      {conflicts.length ? (
        <div className="grid gap-1 rounded-[14px] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200" role="status">
          <strong>Possible scheduling conflict</strong>
          <ul className="m-0 grid gap-1 pl-4">
            {conflicts.map((conflict) => <li key={`${conflict.applicationId}-${conflict.kind}-${conflict.profileId || ''}`}>{describeInterviewConflict(conflict)}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ScheduleSummary({ application, interview, panel, scholarshipTitle, recorderName }) {
  const templateUrl = buildGoogleCalendarTemplateUrl({ interview, scholarshipTitle });
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={stateTone(interview.state)}>{getInterviewStateLabel(interview.state)}</StatusBadge>
        <StatusBadge tone="neutral">{getInterviewModeLabel(interview.mode)}</StatusBadge>
        {(Number(interview.revision) || 1) > 1 ? <span className="text-xs text-app-muted">Revision {interview.revision}</span> : null}
      </div>
      <dl className="m-0 grid gap-3 sm:grid-cols-2">
        <div className="grid gap-0.5">
          <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">When</dt>
          <dd className="m-0 text-sm text-app-text">{formatInterviewWhen(interview.startsAt, interview.durationMinutes)}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">{interview.mode === 'online' ? 'Meeting link' : 'Location'}</dt>
          <dd className="m-0 min-w-0 break-words text-sm text-app-text">
            {interview.mode === 'online'
              ? (interview.meetingUrl ? <a href={interview.meetingUrl} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">{interview.meetingUrl}</a> : 'Link to follow')
              : (interview.locationLabel || 'Location to be announced')}
          </dd>
        </div>
        <div className="grid gap-0.5 sm:col-span-2">
          <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">Panel · {interview.school || application.studentDepartment || 'Applicant school'}</dt>
          <dd className="m-0"><PanelList panel={panel} /></dd>
        </div>
        {interview.instructions ? (
          <div className="grid gap-0.5 sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">Applicant instructions</dt>
            <dd className="m-0 whitespace-pre-line text-sm text-app-text">{interview.instructions}</dd>
          </div>
        ) : null}
      </dl>
      {interview.outcomeRecordedAt ? (
        <p className="m-0 text-xs text-app-muted">
          Recorded as {getInterviewStateLabel(interview.state).toLowerCase()} by {recorderName || roleLabels[interview.outcomeRecordedRole] || 'the panel'}{interview.outcomeRecordedRole && recorderName ? ` · ${roleLabels[interview.outcomeRecordedRole] || ''}` : ''} · {fmtWhen(interview.outcomeRecordedAt)}
        </p>
      ) : null}
      {interview.state !== 'cancelled' ? (
        <div className="flex flex-wrap gap-2">
          {interview.calendar?.htmlLink ? (
            <a href={interview.calendar.htmlLink} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-xl border border-app-border bg-app-surface px-3 text-sm font-semibold text-app-text">Open calendar event</a>
          ) : templateUrl ? (
            <a href={templateUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-xl border border-app-border bg-app-surface px-3 text-sm font-semibold text-app-text">Add to Google Calendar</a>
          ) : null}
          <Button type="button" onClick={() => downloadInterviewIcs({ interview, scholarshipTitle, applicationId: application.id })}>Download .ics</Button>
        </div>
      ) : null}
    </div>
  );
}

function InterviewNotes({ notes, canAdd, onAddNote }) {
  const [body, setBody] = useState('');
  const [rating, setRating] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (!body.trim()) { setError('Write the evaluation note first.'); return; }
    setBusy(true);
    setError('');
    const result = await onAddNote({ body: body.trim(), rating: rating ? Number(rating) : null });
    setBusy(false);
    if (result?.error) { setError(result.error); return; }
    setBody('');
    setRating('');
  };
  return (
    <div className="grid gap-3">
      <p className="m-0 text-xs text-app-muted">Private — visible to the Admissions Office and the applicant’s Department Chair, never to the student.</p>
      {notes.length ? (
        <ul className="m-0 grid gap-2 p-0">
          {notes.map((note) => (
            <li key={note.id} className="grid gap-1 rounded-[14px] border border-app-border bg-app-surface p-3">
              <span className="text-xs text-app-muted">
                <strong className="text-app-text">{note.authorName || 'Reviewer'}</strong>
                {' · '}{roleLabels[note.authorRole] || 'Staff'}
                {note.rating ? <>{' · '}<span aria-label={`Rating ${note.rating} of 5`}>Rating {note.rating}/5</span></> : null}
                {' · '}{fmtWhen(note.createdAt)}
              </span>
              <p className="m-0 whitespace-pre-line text-sm text-app-text">{note.body}</p>
            </li>
          ))}
        </ul>
      ) : <EmptyState title="No evaluation notes yet" description="The panel records its evaluation here after the interview." />}
      {canAdd ? (
        <form className="grid gap-2" onSubmit={submit}>
          <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <label className="grid content-start gap-1 text-sm text-app-text">
              <span className="font-semibold">Rating</span>
              <select value={rating} onChange={(event) => setRating(event.target.value)}>
                <option value="">Not rated</option>
                {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} of 5</option>)}
              </select>
            </label>
            <label className="grid content-start gap-1 text-sm text-app-text">
              <span className="font-semibold">Evaluation note</span>
              <textarea rows="3" maxLength={2000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Summarize the interview: communication, financial need, commitment, and the panel’s observations." />
            </label>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !body.trim()}>{busy ? 'Saving…' : 'Add note'}</Button>
          </div>
          {error ? <p className="m-0 text-sm text-rose-700 dark:text-rose-200" role="alert">{error}</p> : null}
        </form>
      ) : null}
    </div>
  );
}

function ScheduleHistory({ history, nameById }) {
  if (!history.length) return null;
  return (
    <Panel className="grid gap-2">
      <h4 className={sectionHeading}>Schedule history</h4>
      <ol className="m-0 grid gap-2 p-0">
        {[...history].reverse().map((entry) => (
          <li key={`${entry.revision}-${entry.changedAt}`} className="grid gap-0.5 border-b border-app-border/60 pb-2 last:border-b-0 last:pb-0">
            <span className="text-sm text-app-text">
              {entry.cancelled ? 'Cancelled: ' : 'Replaced: '}
              {getInterviewModeLabel(entry.mode)} · {formatInterviewWhen(entry.startsAt)}
              {entry.mode === 'online' ? '' : entry.locationLabel ? ` · ${entry.locationLabel}` : ''}
            </span>
            <span className="text-xs text-app-muted">
              {entry.reason ? `${entry.reason} · ` : ''}{nameById[entry.changedBy] || 'Admissions Office'} · {fmtWhen(entry.changedAt)}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/**
 * The Interview tab of ApplicationReviewModal (SOP step 5).
 *
 * The Admissions Office coordinates: it fills the schedule (confirmed by the
 * action bar's "Schedule interview"), reschedules, and cancels. SOP 5a draws the
 * panel from the applicant's school, so a Department Chair on the panel records
 * attendance and the private evaluation notes; the Admissions Office may record
 * them on the panel's behalf. A Chair who is not on the panel reads everything.
 */
export default function InterviewPanel({
  application,
  role,
  scholarshipTitle = '',
  workspace,
  draft,
  onDraftChange,
  onResetDraft,
  errors = {},
  showErrors = false,
  onShowErrors,
}) {
  const [editing, setEditing] = useState(false);
  const [reasonFor, setReasonFor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [locationsOpen, setLocationsOpen] = useState(false);

  const isOffice = role === 'admissions_office' || role === 'admissions_head';
  const interview = application.interview || null;
  const structured = isStructuredInterview(interview);
  const panel = (workspace.panelists || []).filter((row) => row.applicationId === application.id && !row.removedAt);
  const notes = (workspace.notes || []).filter((note) => note.applicationId === application.id);
  const isPanelist = role === 'department_chair' && panel.some((row) => row.profileId && row.profileId === workspace.viewerId);
  const nameById = Object.fromEntries((workspace.staffDirectory || []).map((entry) => [entry.userId, entry.fullName]));
  const canCoordinate = isOffice && ['Endorsed', 'Interview'].includes(application.status);
  const canRecordOutcome = application.status === 'Interview' && (isOffice || isPanelist);
  const canAddNotes = ['Interview', 'Recommended'].includes(application.status) && (isOffice || isPanelist);
  const outcomeDue = isInterviewOutcomeDue(interview);
  const showForm = canCoordinate && (application.status === 'Endorsed' || editing);

  const run = async (action, successMessage) => {
    setBusy(true);
    setFeedback(null);
    const result = await action();
    setBusy(false);
    if (result?.error) {
      setFeedback({ tone: 'error', message: result.error });
      if (result.errors) onShowErrors?.();
      return false;
    }
    setFeedback({ tone: 'success', message: successMessage });
    return true;
  };

  const startEditing = () => {
    onResetDraft?.();
    setFeedback(null);
    setEditing(true);
  };

  return (
    <div className="grid gap-4">
      {feedback ? (
        <p
          className={`m-0 rounded-[14px] border px-3 py-2 text-sm ${feedback.tone === 'error' ? 'border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-200' : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'}`}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
        >{feedback.message}</p>
      ) : null}

      {interview && !showForm ? (
        <Panel className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className={sectionHeading}>Interview schedule</h4>
            {canCoordinate && structured ? (
              <div className="flex flex-wrap gap-2">
                {interview.state !== 'completed' ? (
                  <Button type="button" disabled={busy} onClick={startEditing}>{interview.state === 'cancelled' ? 'Schedule again' : 'Reschedule'}</Button>
                ) : null}
                {['scheduled', 'no_show'].includes(interview.state) ? (
                  <Button type="button" variant="danger" disabled={busy} onClick={() => setReasonFor('cancel')}>Cancel interview</Button>
                ) : null}
              </div>
            ) : null}
          </div>
          {structured ? (
            <ScheduleSummary
              application={application}
              interview={interview}
              panel={panel}
              scholarshipTitle={scholarshipTitle}
              recorderName={nameById[interview.outcomeRecordedBy] || ''}
            />
          ) : (
            <p className="m-0 text-sm text-app-muted">
              {[interview.panel, interview.school].filter(Boolean).join(' · ') || 'Interview panel'} · {interview.scheduledAt ? `Scheduled ${fmtDate(interview.scheduledAt)}` : 'Schedule pending'}
              <br />Recorded before structured interview scheduling; no attendance record is required for the recommendation.
            </p>
          )}
        </Panel>
      ) : null}

      {canRecordOutcome && structured && interview.state === 'scheduled' ? (
        <Panel className="grid gap-2">
          <h4 className={sectionHeading}>Interview outcome</h4>
          {outcomeDue ? (
            <>
              <p className="m-0 text-sm text-app-muted">
                {isPanelist ? 'Record whether the applicant attended. ' : 'Record attendance on behalf of the panel. '}
                The recommendation (SOP step 6) stays locked until the applicant is recorded as attended.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="primary" disabled={busy} onClick={() => run(() => workspace.onRecordOutcome(application.id, 'completed'), 'Recorded as attended. The Admissions Office can now record the recommendation.')}>Mark attended</Button>
                <Button type="button" disabled={busy} onClick={() => run(() => workspace.onRecordOutcome(application.id, 'no_show'), 'Recorded as not attended. The Admissions Office can reschedule or reject the application.')}>Mark did not attend</Button>
              </div>
            </>
          ) : (
            <p className="m-0 text-sm text-app-muted">Attendance can be recorded once the interview starts ({formatInterviewWhen(interview.startsAt, interview.durationMinutes)}).</p>
          )}
        </Panel>
      ) : null}

      {!interview && !showForm ? (
        <Panel>
          <p className="m-0 text-sm text-app-muted">
            {application.status === 'Endorsed'
              ? 'The Admissions Office has not scheduled the interview yet. The panel comes from the applicant’s school (SOP 5a).'
              : 'No interview was recorded for this application.'}
          </p>
        </Panel>
      ) : null}

      {showForm ? (
        <Panel className="grid gap-4">
          <div className="grid gap-1">
            <h4 className={sectionHeading}>{application.status === 'Endorsed' ? 'Schedule the interview' : 'New schedule'}</h4>
            <p className="m-0 text-xs text-app-muted">
              {application.status === 'Endorsed'
                ? 'Fill in the schedule, then confirm it with Schedule interview in the action bar below. The applicant and the panel are notified.'
                : 'Save the new schedule with a reason. The applicant and the panel are notified of the change.'}
            </p>
          </div>
          <ScheduleForm
            application={application}
            draft={draft}
            onDraftChange={onDraftChange}
            errors={errors}
            showErrors={showErrors}
            workspace={workspace}
            panelNameById={nameById}
            canManageLocations={Boolean(workspace.onSaveLocation)}
            onManageLocations={() => setLocationsOpen(true)}
          />
          {editing ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" disabled={busy} onClick={() => { setEditing(false); setFeedback(null); }}>Discard changes</Button>
              <Button
                type="button"
                variant="primary"
                disabled={busy}
                onClick={() => {
                  if (Object.keys(errors).length) {
                    onShowErrors?.();
                    setFeedback({ tone: 'error', message: Object.values(errors)[0] });
                    return;
                  }
                  setReasonFor('reschedule');
                }}
              >{busy ? 'Saving…' : 'Save new schedule'}</Button>
            </div>
          ) : null}
        </Panel>
      ) : null}

      {isOffice || role === 'department_chair' ? (
        <Panel className="grid gap-2">
          <h4 className={sectionHeading}>Panel evaluation notes</h4>
          <InterviewNotes
            notes={notes}
            canAdd={canAddNotes && Boolean(interview)}
            onAddNote={(note) => workspace.onAddNote(application.id, note)}
          />
        </Panel>
      ) : null}

      {structured ? <ScheduleHistory history={Array.isArray(interview.history) ? interview.history : []} nameById={nameById} /> : null}

      {reasonFor === 'reschedule' ? (
        <ReasonModal
          title={interview?.state === 'cancelled' ? 'Schedule the interview again' : 'Reschedule interview'}
          label="Reason for the change"
          hint="The applicant and the panel see that the schedule changed; the reason is kept in the schedule history."
          confirmLabel="Save new schedule"
          confirmVariant="primary"
          onConfirm={async (reason) => {
            setReasonFor(null);
            const saved = await run(() => workspace.onReschedule(application.id, draft, reason), 'New schedule saved. The applicant and the panel are notified.');
            if (saved) setEditing(false);
          }}
          onClose={() => setReasonFor(null)}
        />
      ) : null}
      {reasonFor === 'cancel' ? (
        <ReasonModal
          title="Cancel interview"
          label="Reason for cancelling"
          hint="The applicant is told the interview is cancelled. You can schedule it again, or reject the application from the action bar."
          confirmLabel="Cancel interview"
          onConfirm={async (reason) => {
            setReasonFor(null);
            await run(() => workspace.onCancel(application.id, reason), 'Interview cancelled. The applicant and the panel are notified.');
          }}
          onClose={() => setReasonFor(null)}
        />
      ) : null}
      {locationsOpen && workspace.onSaveLocation ? (
        <InterviewLocationsModal
          locations={workspace.locations || []}
          onSave={workspace.onSaveLocation}
          onClose={() => setLocationsOpen(false)}
        />
      ) : null}
    </div>
  );
}
