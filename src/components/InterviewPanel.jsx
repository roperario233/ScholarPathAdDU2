import { useState } from 'react';
import { CalendarDays, Check, Copy, ExternalLink, Info, MapPin, UserPlus, Users, Video } from 'lucide-react';
import { Button, EmptyState, ModalShell, Panel, StatusBadge } from './ui';
import ReasonModal from './ReasonModal';
import InterviewLocationsModal from './InterviewLocationsModal';
import { fmtDate } from '../lib/formatters';
import { getStandingRequirements } from '../lib/profile';
import { REVIEW_ROLE_LABELS, buildProgramScopeIndex, getApplicationScope, getReviewScopeLabel, isReviewerRole } from '../lib/reviewScope';
import { getInterviewSchedulers } from '../lib/admissionsOffice';
import { getStageActionLabel } from '../lib/constants';
import AdminOverrideNotice from './AdminOverrideNotice';
import {
  DEFAULT_INTERVIEW_INSTRUCTIONS,
  INTERVIEW_DURATIONS,
  INTERVIEW_MODES,
  buildGoogleCalendarTemplateUrl,
  describeInterviewConflict,
  findInterviewConflicts,
  formatInterviewWhen,
  getEligiblePanelists,
  getInterviewModeLabel,
  getInterviewRecommendationLevelLabel,
  getInterviewStateLabel,
  INTERVIEW_RECOMMENDATION_LEVELS,
  isStructuredInterview,
  isoToManilaInputs,
  manilaInputToIso,
  needsInterviewCalendarRepair,
} from '../lib/interview';

const sectionHeading = 'm-0 text-base font-semibold text-app-text';
const fieldError = 'text-sm text-rose-700 dark:text-rose-200';
const fieldLabel = 'text-sm font-semibold text-app-text';
// Date, time and select render at different native heights; one fixed box keeps the row level.
const scheduleControl = 'h-12 min-h-12 rounded-[14px] px-4 py-0 text-base font-normal leading-none';
const fieldHint = 'text-sm text-app-muted';
// The global text controls paint with --surface, the same colour as the panels
// this tab sits them in, behind a faint border, so a field vanished into its
// card. Inside this tab they take the card colour (white in light, deeper navy in
// dark) and a border drawn from the text colour, so each one reads as a box.
const fieldScope = [
  '[&_input:not([type=radio]):not([type=checkbox])]:bg-app-card',
  '[&_select]:bg-app-card',
  '[&_textarea]:bg-app-card',
  '[&_input:not([type=radio]):not([type=checkbox])]:border-[color-mix(in_srgb,var(--text)_30%,transparent)]',
  '[&_select]:border-[color-mix(in_srgb,var(--text)_30%,transparent)]',
  '[&_textarea]:border-[color-mix(in_srgb,var(--text)_30%,transparent)]',
].join(' ');
const roleLabels = {
  admissions_office: 'Admissions Office Staff',
  admissions_admin: 'Admissions Office Admin',
  dean: 'Dean',
  assistant_dean: 'Assistant Dean',
  department_chair: 'Department Chair',
  interviewer: 'Interviewer',
};

const stateTone = (state) => ({ scheduled: 'info', completed: 'success', no_show: 'warning', cancelled: 'danger' }[state] || 'neutral');

const fmtWhen = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${fmtDate(value)} · ${date.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}`;
};

const todayManila = () => isoToManilaInputs(new Date().toISOString()).date;

const recommendationTone = {
  highly_recommended: 'success',
  recommended: 'success',
  recommended_with_reservation: 'warning',
  not_recommended: 'danger',
  deferred: 'neutral',
};
const recommendationAccent = {
  highly_recommended: 'border-l-emerald-400',
  recommended: 'border-l-emerald-400',
  recommended_with_reservation: 'border-l-amber-400',
  not_recommended: 'border-l-rose-400',
  deferred: 'border-l-slate-400',
};

const initialsOf = (name) => String(name || '')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0].toUpperCase())
  .join('') || '?';

function Avatar({ name }) {
  return (
    <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-500/15 text-xs font-bold text-app-text">
      {initialsOf(name)}
    </span>
  );
}

// One numbered step of the schedule form. Numbering the steps gives the long form
// a visible order instead of a wall of equal-weight fields.
function FormStep({ number, id, title, description, children }) {
  return (
    <section className="grid gap-3 border-t border-app-border pt-5 first:border-t-0 first:pt-0" aria-labelledby={id}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ateneo text-sm font-bold text-white">{number}</span>
        <div className="grid min-w-0 gap-0.5">
          <h5 id={id} className="m-0 text-base font-semibold text-app-text">{title}</h5>
          {description ? <p className="m-0 text-sm text-app-muted">{description}</p> : null}
        </div>
      </div>
      <div className="grid gap-3 sm:pl-10">{children}</div>
    </section>
  );
}

// A reviewer in scope who is not on the panel can add themselves (join_interview_panel).
// The two tabs word it for what the reviewer is doing there: the Interview tab is
// about the schedule and who sits on it, the Evaluation tab about being able to
// write. Joining never changes the schedule, so neither the applicant nor the rest
// of the panel is told.
const JOIN_PANEL_COPY = {
  interview: {
    title: 'You are not on this panel',
    body: 'Join to add your own evaluation and recommendation. The schedule stays the same and no one is notified.',
    action: 'Join panel',
  },
  evaluation: {
    title: 'You can read the evaluations, but not add one',
    body: 'Join the panel to record your own evaluation and recommendation. Evaluations stay private to staff.',
    action: 'Join panel to add an evaluation',
  },
};

function JoinPanelCallout({ variant = 'interview', busy = false, onJoin }) {
  const copy = JOIN_PANEL_COPY[variant] || JOIN_PANEL_COPY.interview;
  return (
    <div
      role="group"
      aria-label="Join the interview panel"
      className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-l-4 border-app-border border-l-ateneo bg-app-card p-3"
    >
      <div className="grid min-w-0 flex-1 gap-1 sm:min-w-[16rem]">
        <p className="m-0 flex items-center gap-2 text-sm font-semibold text-app-text">
          <UserPlus size={16} aria-hidden="true" />
          {copy.title}
        </p>
        <p className="m-0 text-sm text-app-muted">{copy.body}</p>
      </div>
      <Button type="button" variant="primary" disabled={busy} onClick={onJoin}>{busy ? 'Joining…' : copy.action}</Button>
    </div>
  );
}

// Taking the seat back is quiet and reversible while the interview is scheduled, so
// the dialog is a plain confirmation with no reason to record.
function LeavePanelModal({ busy = false, onConfirm, onClose }) {
  return (
    <ModalShell title="Leave this panel?" onClose={busy ? undefined : onClose} className="w-[min(480px,100%)]">
      <div className="grid gap-4">
        <p className="m-0 text-sm text-app-muted">
          You will no longer be able to add an evaluation or record the recommendation. You can join again while the interview is scheduled.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border pt-3">
          <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" variant="danger" disabled={busy} onClick={() => onConfirm?.()}>{busy ? 'Leaving…' : 'Leave panel'}</Button>
        </div>
      </div>
    </ModalShell>
  );
}

function PanelList({ panel, roleById = {}, viewerId = '' }) {
  if (!panel.length) return <p className="m-0 text-sm text-app-muted">No panel members recorded.</p>;
  return (
    <ul className="m-0 grid gap-2 p-0 sm:grid-cols-2">
      {panel.map((member) => (
        <li key={member.id || member.profileId || member.guestName} className="flex min-w-0 items-center gap-3 rounded-xl border border-app-border bg-app-card px-3 py-2">
          <Avatar name={member.name} />
          <span className="grid min-w-0 flex-1">
            <span className="truncate text-sm font-semibold text-app-text">{member.name}</span>
            <span className="truncate text-sm text-app-muted">
              {member.profileId
                ? (roleLabels[roleById[member.profileId]] || 'Panel member')
                : `Faculty guest${member.guestEmail ? ` · ${member.guestEmail}` : ''}`}
            </span>
          </span>
          {viewerId && member.profileId === viewerId ? <StatusBadge tone="neutral">You</StatusBadge> : null}
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
  // SOP 5a: the panel is drawn from the applicant's school, so every reviewer level
  // whose scope covers the applicant qualifies — Chairperson of its department first,
  // then the Assistant Dean of its cluster, the Dean of its school, and finally the
  // Admissions Office lanes, which coordinate the interview.
  const applicantScope = getApplicationScope(application, buildProgramScopeIndex(workspace.academicPrograms));
  const eligible = getEligiblePanelists(workspace.staffDirectory, application, applicantScope);
  const onPanel = new Set(draft.panel.map((member) => member.profileId).filter(Boolean));
  const addable = eligible.filter((entry) => !onPanel.has(entry.userId));
  // "Add myself" shows only while the signed-in account is itself an eligible,
  // not-yet-listed panelist (the Admin always is; a reviewer only within scope).
  const canAddSelf = Boolean(workspace.viewerId) && addable.some((entry) => entry.userId === workspace.viewerId);
  // The Chair picker and the added-member rows name each reviewer's scope, so the
  // reviewer can see which level of the school the panel is drawn from (SOP 5a).
  const departmentById = Object.fromEntries(
    (workspace.staffDirectory || []).map((entry) => [entry.userId, getReviewScopeLabel(entry) || entry.department || '']),
  );
  const roleById = Object.fromEntries(
    (workspace.staffDirectory || []).map((entry) => [entry.userId, entry.role || '']),
  );
  // SOP 5a draws the panel from the school the applicant's program belongs to. An
  // incoming first-year is not enrolled yet, so that school is the one that offers
  // their first program choice; an application without a frozen snapshot keeps the
  // neutral wording.
  const applicantSchool = applicantScope.school || application.studentSchool || '';
  const isIncomingApplicant = getStandingRequirements(application.profileSnapshot || {}).isIncomingFirstYear;
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
  // The meeting field is a choice now that the integration can create the link:
  // "auto" leaves it blank so Google creates the conference, "paste" records a
  // link the office already has. Whichever is unavailable says why, instead of the
  // schedule failing at save time.
  const [meetingChoice, setMeetingChoice] = useState(() => (String(draft.meetingUrl || '').trim() ? 'paste' : 'auto'));
  const autoMeetingAvailable = Boolean(workspace.calendarConfigured);
  const effectiveMeetingChoice = autoMeetingAvailable ? meetingChoice : 'paste';
  const chooseMeeting = (next) => {
    setMeetingChoice(next);
    if (next === 'auto') update({ meetingUrl: '' });
  };

  const previewIso = manilaInputToIso(draft.date, draft.time);

  return (
    <div className="grid gap-5">
      <FormStep number={1} id="interview-step-when" title="Date and time" description="Times are in Philippine time (Asia/Manila).">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid content-start gap-1 text-app-text">
            <span className={fieldLabel}>Date</span>
            <input type="date" className={scheduleControl} min={todayManila()} value={draft.date} onChange={(event) => update({ date: event.target.value })} />
            {show('date')}
          </label>
          <label className="grid content-start gap-1 text-app-text">
            <span className={fieldLabel}>Start time</span>
            <input type="time" step="300" className={scheduleControl} value={draft.time} onChange={(event) => update({ time: event.target.value })} />
            {show('time')}
          </label>
          <label className="grid content-start gap-1 text-app-text">
            <span className={fieldLabel}>Length</span>
            <select className={scheduleControl} value={draft.durationMinutes} onChange={(event) => update({ durationMinutes: Number(event.target.value) })}>
              {INTERVIEW_DURATIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
            </select>
            {show('durationMinutes')}
          </label>
        </div>
        {previewIso ? (
          <p className="m-0 flex items-center gap-2 rounded-xl bg-blue-500/10 px-3 py-2 text-sm font-semibold text-app-text" role="status">
            <CalendarDays size={16} aria-hidden="true" className="shrink-0" />
            {formatInterviewWhen(previewIso, draft.durationMinutes)}
          </p>
        ) : null}
      </FormStep>

      <FormStep number={2} id="interview-step-where" title="Format and place" description="Choose how the applicant joins.">
        <fieldset className="grid gap-2">
          <legend className="sr-only">Interview mode</legend>
          <div role="radiogroup" aria-label="Interview mode" className="grid grid-cols-2 gap-1 rounded-xl border border-app-border bg-app-card p-1">
            {INTERVIEW_MODES.map((mode) => {
              const selected = draft.mode === mode.value;
              return (
                <button
                  key={mode.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setMode(mode.value)}
                  className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20 ${selected
                    ? 'bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright text-white shadow-sm'
                    : 'text-app-muted hover:bg-blue-500/10 hover:text-app-text'}`}
                >
                  {selected ? <Check size={16} aria-hidden="true" /> : null}
                  {mode.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        {draft.mode === 'onsite' ? (
          <div className="grid content-start gap-3 text-app-text">
            <div className="grid gap-1">
              <label htmlFor="interview-location" className={fieldLabel}>Saved location</label>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  id="interview-location"
                  className="min-w-0 flex-1"
                  value={draft.locationId}
                  onChange={(event) => update({ locationId: event.target.value, locationLabel: '' })}
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
                <span className={fieldHint}>
                  {canManageLocations ? 'Add the first location to schedule an on-site interview.' : 'No locations yet. Ask the Admissions Office Admin to add one.'}
                </span>
              ) : null}
            </div>
            <label className="grid content-start gap-1">
              <span className={fieldLabel}>Or type the location</span>
              <input
                value={draft.locationLabel}
                onChange={(event) => update({ locationLabel: event.target.value, locationId: '' })}
                placeholder="e.g. Finster Hall, F213"
              />
              <span className={fieldHint}>Use this when the room is not in the saved list.</span>
            </label>
            {show('locationId')}
            <span className={fieldHint}>On-site interviews have no Meet link. Switching mode replaces the calendar event.</span>
          </div>
        ) : (
          <div className="grid gap-3">
            <fieldset className="grid gap-2">
              <legend className={`mb-1 ${fieldLabel}`}>Meeting link</legend>
              <div role="radiogroup" aria-label="Meeting link source" className="grid gap-2 sm:grid-cols-2">
                {[
                  {
                    value: 'auto',
                    title: 'Generate a Google Meet link',
                    hint: 'Created with the calendar invitation',
                    disabled: !autoMeetingAvailable,
                    icon: <path d="M15 10l4.55-2.28A1 1 0 0121 8.62v6.76a1 1 0 01-1.45.9L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />,
                  },
                  {
                    value: 'paste',
                    title: 'Use an existing link',
                    hint: 'Paste a Meet, Zoom, or Teams link',
                    disabled: false,
                    icon: <path d="M10 13a5 5 0 007.07 0l3-3a5 5 0 00-7.07-7.07l-1.5 1.5M14 11a5 5 0 00-7.07 0l-3 3a5 5 0 007.07 7.07l1.5-1.5" />,
                  },
                ].map((option) => {
                  const selected = effectiveMeetingChoice === option.value;
                  return (
                    <label
                      key={option.value}
                      className={`relative flex items-start gap-3 rounded-xl border p-3 transition focus-within:ring-4 focus-within:ring-blue-500/20 ${option.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${selected ? 'border-ateneo bg-blue-500/10 shadow-sm' : 'border-app-border bg-app-card hover:border-ateneo/50'}`}
                    >
                      <input
                        type="radio"
                        name="interview-meeting-source"
                        className="sr-only"
                        checked={selected}
                        disabled={option.disabled}
                        onChange={() => chooseMeeting(option.value)}
                      />
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${selected ? 'bg-ateneo text-white' : 'bg-app-surface text-app-muted'}`}>
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{option.icon}</svg>
                      </span>
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="text-sm font-semibold text-app-text">{option.title}</span>
                        <span className="text-sm text-app-muted">{option.hint}</span>
                      </span>
                      <span aria-hidden="true" className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${selected ? 'border-ateneo bg-ateneo' : 'border-app-border'}`}>
                        {selected ? <span className="h-2 w-2 rounded-full bg-white" /> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
              <span className={fieldHint}>
                {autoMeetingAvailable
                  ? `A Meet link and calendar invitation are created when you save${workspace.calendarSummary ? ` on ${workspace.calendarSummary}` : ''}.`
                  : workspace.calendarReauthRequired
                    ? 'Calendar access expired. Paste a link instead.'
                    : 'Paste a Google Meet, Zoom, or Teams link.'}
              </span>
            </fieldset>
            {effectiveMeetingChoice === 'auto' ? null : (
              <label className="grid content-start gap-1 text-app-text">
                <span className={fieldLabel}>Meeting link</span>
                <input
                  type="url"
                  inputMode="url"
                  value={draft.meetingUrl}
                  onChange={(event) => update({ meetingUrl: event.target.value })}
                  placeholder="https://meet.google.com/..."
                />
                <span className={fieldHint}>Added to the calendar invitation.</span>
                {show('meetingUrl')}
              </label>
            )}
          </div>
        )}
      </FormStep>

      <FormStep
        number={3}
        id="interview-panel-heading"
        title="Interview panel"
        description={applicantSchool
          ? (
            <>
              Applicants are interviewed by a panel from {isIncomingApplicant ? 'the school that offers their first program choice' : 'the school that offers their program'} — <strong className="text-app-text">{applicantSchool}</strong>. Admissions Office members can join any panel, and any member can be the lead.
            </>
          )
          : 'No school is on file for this applicant yet, so only Admissions Office members can be added to the panel.'}
      >
        {draft.panel.length ? (
          <ul className="m-0 grid gap-2 p-0">
            {draft.panel.map((member, index) => {
              const memberName = member.profileId ? (panelNameById[member.profileId] || 'Department Chair') : member.guestName;
              return (
                <li key={member.profileId || `guest-${index}`} className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-app-border bg-app-card px-3 py-2">
                  <Avatar name={memberName} />
                  <span className="min-w-0 flex-1 basis-40">
                    <span className="block truncate text-sm font-semibold text-app-text">{memberName}</span>
                    <span className="block truncate text-sm text-app-muted">
                      {member.profileId
                        ? [roleLabels[roleById[member.profileId]] || 'Panel member', departmentById[member.profileId]].filter(Boolean).join(' · ')
                        : `Faculty guest${member.guestEmail ? ` · ${member.guestEmail}` : ''}`}
                    </span>
                  </span>
                  <label className="relative inline-flex min-h-10 cursor-pointer items-center">
                    <input type="radio" name="interview-lead" className="peer sr-only" checked={member.isLead} onChange={() => setLead(index)} />
                    <span className="rounded-full border border-app-border px-3 py-1 text-sm font-semibold text-app-muted transition hover:border-ateneo/50 peer-checked:border-ateneo peer-checked:bg-ateneo peer-checked:text-white peer-focus-visible:ring-4 peer-focus-visible:ring-blue-500/20">
                      {member.isLead ? 'Lead' : 'Make lead'}
                    </span>
                  </label>
                  <Button type="button" variant="ghost" onClick={() => removeMember(index)} aria-label={`Remove ${memberName || 'panel member'}`}>Remove</Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="m-0 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm font-semibold text-amber-700 dark:text-amber-200" role="status">
            No panel members yet. Add at least one to schedule the interview.
          </p>
        )}

        <div className="grid gap-1">
          <span className={fieldLabel}>Add a panel member</span>
          <div className={`grid gap-2 ${canAddSelf ? 'sm:grid-cols-[minmax(0,1fr)_auto_auto]' : 'sm:grid-cols-[minmax(0,1fr)_auto]'}`}>
            <select value={chairToAdd} onChange={(event) => setChairToAdd(event.target.value)} disabled={!addable.length} aria-label="Panel member">
              <option value="">{eligible.length ? (addable.length ? 'Select a panel member…' : 'Everyone eligible is already on the panel') : 'No panel accounts available'}</option>
              {addable.map((entry) => (
                <option key={entry.userId} value={entry.userId}>
                  {[entry.fullName, isReviewerRole(entry.role) ? (getReviewScopeLabel(entry) || entry.department) : roleLabels[entry.role]].filter(Boolean).join(' · ')}
                </option>
              ))}
            </select>
            <Button
              type="button"
              disabled={!chairToAdd}
              onClick={() => { addMember({ profileId: chairToAdd }); setChairToAdd(''); }}
            >Add member</Button>
            {canAddSelf ? (
              <Button type="button" onClick={() => { addMember({ profileId: workspace.viewerId }); setChairToAdd(''); }}>Add myself</Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-2 rounded-xl border border-dashed border-app-border p-3">
          <span className={fieldLabel}>Add a faculty guest</span>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <label className="grid content-start gap-1">
              <span className="text-sm text-app-muted">Name</span>
              <input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Faculty guest name" aria-label="Faculty guest name" maxLength={120} />
            </label>
            <label className="grid content-start gap-1">
              <span className="text-sm text-app-muted">Email (optional)</span>
              <input type="email" value={guestEmail} onChange={(event) => setGuestEmail(event.target.value)} placeholder="Email for the invitation" aria-label="Faculty guest email" />
            </label>
            <Button
              type="button"
              disabled={!guestName.trim()}
              onClick={() => { addMember({ guestName: guestName.trim(), guestEmail: guestEmail.trim() }); setGuestName(''); setGuestEmail(''); }}
            >Add guest</Button>
          </div>
          <span className={fieldHint}>Guests receive the invitation by email.</span>
        </div>
        {show('panel')}
      </FormStep>

      <FormStep number={4} id="interview-step-message" title="Message to the applicant">
        <label className="grid content-start gap-1 text-app-text">
          <span className={fieldLabel}>Instructions for the applicant</span>
          <textarea rows="3" maxLength={500} value={draft.instructions} onChange={(event) => update({ instructions: event.target.value })} />
          <span className={fieldHint}>The applicant sees this with the schedule. Panel names stay hidden.</span>
        </label>
      </FormStep>

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

// A small icon-only copy control. Two variants: one sits inside the meeting-link
// field, the other beside a location.
function CopyIconButton({ value, label }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard access can be blocked; the value stays selectable.
        }
      }}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-app-muted transition hover:bg-blue-500/10 hover:text-app-text focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20${label === 'Copy meeting link' ? ' absolute right-1' : ''}`}
    >
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
    </button>
  );
}

const CopyMeetingLinkButton = ({ value }) => <CopyIconButton value={value} label="Copy meeting link" />;
const CopyLocationButton = ({ value }) => <CopyIconButton value={value} label="Copy location" />;

function ScheduleSummary({ application, interview, panel, scholarshipTitle, roleById = {}, viewerId = '', panelFooter = null, panelAction = null }) {
  const templateUrl = buildGoogleCalendarTemplateUrl({ interview, scholarshipTitle });
  // What the provider actually holds for this interview. `removedAt` is null on a
  // cancelled interview whose Google event could not be deleted, which is exactly
  // the state the repair action exists for.
  const calendar = interview.calendar || null;
  const calendarLive = Boolean(calendar?.eventId) && interview.state !== 'cancelled';
  const removalPending = interview.state === 'cancelled' && Boolean(calendar?.eventId) && !calendar?.removedAt;
  const calendarRemoved = interview.state === 'cancelled' && Boolean(calendar?.removedAt);
  const linkMissing = interview.state === 'scheduled' && interview.mode === 'online' && !interview.meetingUrl;
  // "Mon, Nov 9, 2026 · 9:00 AM – 9:30 AM (Philippine time)": the date leads, the
  // time range follows on its own line so neither has to be hunted for.
  const [whenDate, ...whenRest] = formatInterviewWhen(interview.startsAt, interview.durationMinutes).split(' · ');
  const whenTime = whenRest.join(' · ');
  const cancelled = interview.state === 'cancelled';
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={stateTone(interview.state)}>{getInterviewStateLabel(interview.state)}</StatusBadge>
        <StatusBadge tone="neutral">{getInterviewModeLabel(interview.mode)}</StatusBadge>
        {calendarLive ? <StatusBadge tone="success">In Google Calendar</StatusBadge> : null}
        {removalPending ? <StatusBadge tone="warning">Calendar event still live</StatusBadge> : null}
        {calendarRemoved ? <StatusBadge tone="neutral">Calendar event removed</StatusBadge> : null}
        {linkMissing ? <StatusBadge tone="warning">No meeting link</StatusBadge> : null}
        {(Number(interview.revision) || 1) > 1 ? <span className="text-sm text-app-muted">Revision {interview.revision}</span> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid content-start gap-1 rounded-xl border border-app-border bg-app-card p-4">
          <p className="m-0 flex items-center gap-2 text-sm font-semibold text-app-muted">
            <CalendarDays size={16} aria-hidden="true" />
            When
          </p>
          <p className={`m-0 text-lg font-semibold leading-snug text-app-text ${cancelled ? 'line-through decoration-app-muted' : ''}`}>{whenDate}</p>
          {whenTime ? <p className={`m-0 text-sm text-app-text ${cancelled ? 'line-through decoration-app-muted' : ''}`}>{whenTime}</p> : null}
        </div>

        <div className="grid min-w-0 content-start gap-1 rounded-xl border border-app-border bg-app-card p-4">
          <p className="m-0 flex items-center gap-2 text-sm font-semibold text-app-muted">
            {interview.mode === 'online' ? <Video size={16} aria-hidden="true" /> : <MapPin size={16} aria-hidden="true" />}
            {interview.mode === 'online' ? 'Meeting link' : 'Location'}
          </p>
          {interview.mode === 'online' ? (
            interview.meetingUrl ? (
              <div className="grid gap-2">
                <span className="relative flex min-w-0 items-center">
                  <input
                    readOnly
                    value={interview.meetingUrl}
                    aria-label="Meeting link"
                    className="min-w-0 flex-1 pr-11"
                    onFocus={(event) => event.target.select()}
                  />
                  <CopyMeetingLinkButton value={interview.meetingUrl} />
                </span>
                <a
                  href={interview.meetingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-10 w-fit items-center gap-1.5 rounded-xl border border-app-border bg-app-surface px-3 text-sm font-semibold text-app-text"
                >
                  <ExternalLink size={16} aria-hidden="true" />
                  Open link
                </a>
              </div>
            ) : (
              <p className="m-0 text-sm text-app-muted">No link yet. Repair the calendar event to create one.</p>
            )
          ) : (
            <span className="flex min-w-0 items-start gap-2">
              <span className="min-w-0 flex-1 text-base font-semibold text-app-text [overflow-wrap:anywhere]">{interview.locationLabel || 'Location to be announced'}</span>
              {interview.locationLabel ? <CopyLocationButton value={interview.locationLabel} /> : null}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 flex items-center gap-2 text-sm font-semibold text-app-muted">
            <Users size={16} aria-hidden="true" />
            Panel · {interview.school || application?.studentSchool || 'Applicant school'}
          </p>
          {panelAction}
        </div>
        <PanelList panel={panel} roleById={roleById} viewerId={viewerId} />
        {panelFooter}
      </div>

      {interview.instructions ? (
        <div className="grid gap-1">
          <p className="m-0 text-sm font-semibold text-app-muted">Applicant instructions</p>
          <p className="m-0 whitespace-pre-line rounded-xl border-l-4 border-ateneo/60 bg-app-card px-3 py-2 text-sm text-app-text">{interview.instructions}</p>
        </div>
      ) : null}

      {interview.state !== 'cancelled' && (interview.calendar?.htmlLink || templateUrl) ? (
        <div className="flex flex-wrap gap-2">
          <a
            href={interview.calendar?.htmlLink || templateUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 items-center rounded-xl border border-app-border bg-app-surface px-3 text-sm font-semibold text-app-text"
          >
            {interview.calendar?.htmlLink ? 'Open calendar event' : 'Add to Google Calendar'}
          </a>
        </div>
      ) : null}
    </div>
  );
}

// `joinSlot` takes the place of the note form for a reviewer who could join the
// panel; `readOnlyNote` explains the absent form to one who cannot (the interview
// is no longer scheduled), so the missing form never reads as a fault.
function InterviewNotes({ notes, canAdd, onAddNote, joinSlot = null, readOnlyNote = '' }) {
  const [body, setBody] = useState('');
  const [recommendationLevel, setRecommendationLevel] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (!body.trim()) { setError('Write the evaluation first.'); return; }
    setBusy(true);
    setError('');
    // The level is the panel's recommendation; the note may record observations
    // without one, so it stays optional.
    const result = await onAddNote({ body: body.trim(), recommendationLevel: recommendationLevel || null });
    setBusy(false);
    if (result?.error) { setError(result.error); return; }
    setBody('');
    setRecommendationLevel('');
  };
  return (
    <div className="grid gap-4">
      {notes.length ? (
        <ul className="m-0 grid gap-3 p-0">
          {notes.map((note) => {
            const levelLabel = getInterviewRecommendationLevelLabel(note.recommendationLevel);
            return (
              <li
                key={note.id}
                className={`grid gap-2 rounded-xl border border-l-4 border-app-border bg-app-card p-3 ${recommendationAccent[note.recommendationLevel] || 'border-l-app-border'}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="grid min-w-0 gap-0.5">
                    <strong className="text-sm text-app-text">{note.authorName || 'Reviewer'}</strong>
                    <span className="text-sm text-app-muted">
                      {roleLabels[note.authorRole] || 'Staff'}
                      {' · '}{fmtWhen(note.createdAt)}
                    </span>
                  </div>
                  {levelLabel ? <StatusBadge tone={recommendationTone[note.recommendationLevel] || 'info'}>{levelLabel}</StatusBadge> : null}
                  {/* A note recorded before recommendation levels existed keeps its score. */}
                  {!levelLabel && note.rating ? <span className="text-sm text-app-muted" aria-label={`Rating ${note.rating} of 5`}>Rating {note.rating}/5 (earlier record)</span> : null}
                </div>
                <p className="m-0 whitespace-pre-line text-sm leading-relaxed text-app-text">{note.body}</p>
              </li>
            );
          })}
        </ul>
      ) : <EmptyState title="No evaluations yet" description="The panel records its evaluation here after the interview." />}
      {canAdd ? (
        <form className="grid gap-4 border-t border-app-border pt-4" onSubmit={submit}>
          <h5 className="m-0 text-base font-semibold text-app-text">Add an evaluation</h5>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold text-app-text">Recommendation</legend>
            <div role="radiogroup" aria-label="Recommendation" className="flex flex-wrap gap-2">
              {INTERVIEW_RECOMMENDATION_LEVELS.map((level) => {
                const selected = recommendationLevel === level.value;
                return (
                  <button
                    key={level.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    // Selecting the chosen level again clears it, so a note can
                    // still record observations without a recommendation.
                    onClick={() => setRecommendationLevel(selected ? '' : level.value)}
                    className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20 ${selected
                      ? 'border-ateneo bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright text-white shadow-sm'
                      : 'border-app-border bg-app-card text-app-text hover:border-ateneo/50'}`}
                  >
                    {selected ? <Check size={14} aria-hidden="true" /> : null}
                    {level.label}
                  </button>
                );
              })}
            </div>
            <span className={fieldHint}>The panel&rsquo;s overall view of the applicant. Select it again to clear.</span>
          </fieldset>
          <label className="grid content-start gap-1 text-app-text">
            <span className={fieldLabel}>Evaluation summary</span>
            <textarea rows="4" maxLength={2000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Summarize the interview: communication, financial need, commitment, and the panel’s observations." />
            <span className={`text-right ${fieldHint}`}>{body.length}/2000</span>
          </label>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={busy || !body.trim()}>{busy ? 'Saving…' : 'Add evaluation'}</Button>
          </div>
          {error ? <p className="m-0 text-sm text-rose-700 dark:text-rose-200" role="alert">{error}</p> : null}
        </form>
      ) : (joinSlot || (readOnlyNote ? <p className="m-0 text-sm text-app-muted">{readOnlyNote}</p> : null))}
    </div>
  );
}

function ScheduleHistory({ history, nameById }) {
  if (!history.length) return null;
  return (
    <Panel className="grid gap-3">
      <h4 className={sectionHeading}>Schedule history</h4>
      <ol className="m-0 grid gap-3 p-0">
        {[...history].reverse().map((entry) => (
          <li key={`${entry.revision}-${entry.changedAt}`} className="grid gap-0.5 border-l-2 border-app-border pl-3">
            <span className="text-sm font-semibold text-app-text">
              {entry.cancelled ? 'Cancelled: ' : 'Replaced: '}
              {getInterviewModeLabel(entry.mode)} · {formatInterviewWhen(entry.startsAt)}
              {entry.mode === 'online' ? '' : entry.locationLabel ? ` · ${entry.locationLabel}` : ''}
            </span>
            <span className="text-sm text-app-muted">
              {entry.reason ? `${entry.reason} · ` : ''}{nameById[entry.changedBy] || 'Admissions Office'} · {fmtWhen(entry.changedAt)}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

// Consultation 2: the interviewers of the applicant's school and cluster schedule
// the interview. The Admin keeps an override, so the tab says plainly that using
// it is stepping in, and names who is expected to do it.
function ScheduleOverrideNotice({ application, workspace }) {
  const schedulers = getInterviewSchedulers(
    application,
    workspace.staffDirectory || [],
    buildProgramScopeIndex(workspace.academicPrograms || []),
  );
  return (
    <AdminOverrideNotice>
      {schedulers.length
        ? `The school's interviewers schedule this: ${schedulers.map((person) => `${person.fullName || REVIEW_ROLE_LABELS[person.role]}, ${REVIEW_ROLE_LABELS[person.role]}`).join('; ')}.`
        : 'No interviewer covers this school or cluster yet. Add one on Accounts, or step in here.'}
    </AdminOverrideNotice>
  );
}

/**
 * The Interview tab of ApplicationReviewModal (SOP step 5).
 *
 * The Admissions Office coordinates: it fills the schedule (confirmed by the
 * action bar's "Schedule interview"), reschedules, and cancels. SOP 5a draws the
 * panel from the applicant's school, so a Department Chair on the panel reads the
 * schedule and records the private evaluation notes; the Admissions Office may
 * record them on the panel's behalf. A Chair who is not on the panel reads
 * everything.
 */
export default function InterviewPanel({
  view = 'interview',
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
  const [leaveOpen, setLeaveOpen] = useState(false);

  // Consultation 2: the interviewer schedules its own interviews, and a
  // Chairperson, Assistant Dean, or Dean whose scope covers the applicant may run
  // the interview itself. The Admin keeps the office override; Staff only read.
  const isAdmin = role === 'admissions_admin';
  const mayCoordinate = workspace.canCoordinate ? Boolean(workspace.canCoordinate(application)) : isAdmin;
  const interview = application.interview || null;
  const structured = isStructuredInterview(interview);
  const panel = (workspace.panelists || []).filter((row) => row.applicationId === application.id && !row.removedAt);
  const notes = (workspace.notes || []).filter((note) => note.applicationId === application.id);
  const isPanelist = isReviewerRole(role) && panel.some((row) => row.profileId && row.profileId === workspace.viewerId);
  const nameById = Object.fromEntries((workspace.staffDirectory || []).map((entry) => [entry.userId, entry.fullName]));
  const roleById = Object.fromEntries((workspace.staffDirectory || []).map((entry) => [entry.userId, entry.role || '']));
  const canCoordinate = mayCoordinate && ['Endorsed', 'Interview'].includes(application.status);
  // Notes stay open after the approval and release: the case file keeps growing
  // (follow-ups, final-check remarks) and the database has no stage gate on them.
  const canAddNotes = ['Interview', 'Recommended', 'Approved', 'Released'].includes(application.status) && (isAdmin || isPanelist);
  // Repair is a recovery action, so it only appears when Google and the record
  // actually disagree: a cancelled interview whose event survived, a scheduled
  // interview with no event, or an online interview whose event has no link. The
  // predicate lives beside the record helpers so the workspace pages agree.
  const needsCalendarRepair = needsInterviewCalendarRepair(interview);
  // Repair is not a scheduling action: a cancelled interview whose Google event
  // survived the waiver must still be cleanable after the application moved on to
  // the recommendation, where scheduling itself is no longer offered.
  const canRepairCalendar = mayCoordinate && needsCalendarRepair
    && Boolean(workspace.calendarConfigured) && Boolean(workspace.onRepairCalendar);
  const showForm = canCoordinate && (application.status === 'Endorsed' || editing);
  // An in-scope reviewer left off the panel may add themselves while the interview is
  // scheduled (App.jsx joinInterviewPanel answers canJoinPanel). `mayCoordinate` is
  // the same scope check, so a reviewer who cannot join still learns why the note
  // form is missing, and one outside the scope sees nothing about it.
  const canJoinPanel = Boolean(workspace.onJoinPanel) && Boolean(workspace.canJoinPanel?.(application));
  const readOnlyEvaluationNote = isReviewerRole(role) && mayCoordinate && !isPanelist && !canJoinPanel && Boolean(interview)
    ? 'You are not on this panel, so these evaluations are read-only for you.'
    : '';

  const joinPanel = async () => {
    setBusy(true);
    setFeedback(null);
    const result = await workspace.onJoinPanel(application.id);
    setBusy(false);
    setFeedback(result?.error
      ? { tone: 'error', message: result.error }
      : { tone: 'success', message: 'You joined the panel. You can now record your evaluation and recommendation.' });
  };

  // The way back out: shown to a panelist who may still leave (App.jsx answers
  // canLeavePanel: not the lead, no note recorded, case still at Interview).
  const canLeavePanel = Boolean(workspace.onLeavePanel) && Boolean(workspace.canLeavePanel?.(application));
  const leavePanel = async () => {
    setBusy(true);
    setFeedback(null);
    const result = await workspace.onLeavePanel(application.id);
    setBusy(false);
    setLeaveOpen(false);
    setFeedback(result?.error
      ? { tone: 'error', message: result.error }
      : { tone: 'success', message: 'You left the panel.' });
  };

  const feedbackLine = feedback ? (
    <p
      className={`m-0 rounded-[14px] border px-3 py-2 text-sm ${feedback.tone === 'error' ? 'border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-200' : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'}`}
      role={feedback.tone === 'error' ? 'alert' : 'status'}
    >{feedback.message}</p>
  ) : null;

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
    // A cancellation still succeeds when the Google event could not be removed;
    // the warning has to reach the reviewer instead of reading as a clean save.
    setFeedback(result?.warning
      ? { tone: 'error', message: `${successMessage} ${result.warning}` }
      : { tone: 'success', message: successMessage });
    return true;
  };

  const startEditing = () => {
    onResetDraft?.();
    setFeedback(null);
    setEditing(true);
  };

  // The panel's evaluation notes and recommendation level have their own tab, so
  // this component renders either the schedule or the evaluation, never both.
  if (view === 'evaluation') {
    return (
      <div className={`grid gap-4 ${fieldScope}`}>
        <Panel className="grid gap-3">
          <div className="grid gap-0.5">
            <h4 className={sectionHeading}>Panel evaluation</h4>
            <p className="m-0 text-sm text-app-muted">Private to staff. Applicants never see the panel evaluation or recommendation.</p>
          </div>
          {feedbackLine}
          <InterviewNotes
            notes={notes}
            canAdd={canAddNotes && Boolean(interview)}
            onAddNote={(note) => workspace.onAddNote(application.id, note)}
            joinSlot={canJoinPanel ? <JoinPanelCallout variant="evaluation" busy={busy} onJoin={joinPanel} /> : null}
            readOnlyNote={readOnlyEvaluationNote}
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className={`grid gap-4 ${fieldScope}`}>
      {isAdmin && canCoordinate ? <ScheduleOverrideNotice application={application} workspace={workspace} /> : null}
      {feedbackLine}

      {interview && !showForm ? (
        <Panel className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className={sectionHeading}>Interview schedule</h4>
            {structured && (canCoordinate || canRepairCalendar) ? (
              <div className="flex flex-wrap gap-2">
                {canCoordinate && interview.state !== 'completed' ? (
                  <Button type="button" disabled={busy} onClick={startEditing}>{interview.state === 'cancelled' ? 'Schedule again' : 'Reschedule'}</Button>
                ) : null}
                {canCoordinate && ['scheduled', 'no_show'].includes(interview.state) ? (
                  <Button type="button" variant="danger" disabled={busy} onClick={() => setReasonFor('cancel')}>Cancel interview</Button>
                ) : null}
                {canRepairCalendar ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setFeedback(null);
                      const result = await workspace.onRepairCalendar(application.id);
                      setBusy(false);
                      setFeedback(result?.error
                        ? { tone: 'error', message: result.error }
                        : { tone: 'success', message: result?.message || 'The calendar event was repaired.' });
                    }}
                  >Repair calendar event</Button>
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
              roleById={roleById}
              viewerId={workspace.viewerId}
              panelFooter={canJoinPanel ? <JoinPanelCallout variant="interview" busy={busy} onJoin={joinPanel} /> : null}
              panelAction={canLeavePanel ? <Button type="button" variant="ghost" disabled={busy} onClick={() => setLeaveOpen(true)}>Leave panel</Button> : null}
            />
          ) : (
            <p className="m-0 text-sm text-app-muted">
              {[interview.panel, interview.school].filter(Boolean).join(' · ') || 'Interview panel'} · {interview.scheduledAt ? `Scheduled ${fmtDate(interview.scheduledAt)}` : 'Schedule pending'}
            </p>
          )}
        </Panel>
      ) : null}

      {!interview && !showForm ? (
        <Panel className="flex items-start gap-3">
          <Info size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-app-muted" />
          <p className="m-0 text-sm text-app-text">
            {application.status === 'Endorsed'
              ? 'Not scheduled yet. An interviewer from the applicant\'s school schedules it.'
              : 'No interview was recorded for this application.'}
          </p>
        </Panel>
      ) : null}

      {showForm ? (
        <Panel className="grid gap-4">
          <div className="grid gap-1">
            <h4 className={sectionHeading}>{application.status === 'Endorsed' ? 'Schedule the interview' : 'New schedule'}</h4>
            <p className="m-0 text-sm text-app-muted">
              {application.status === 'Endorsed'
                ? `Confirm with ${getStageActionLabel('Interview', role)} in the action bar. Applicant and panel are notified.`
                : 'Saving a new schedule notifies the applicant and panel.'}
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

      {structured ? <ScheduleHistory history={Array.isArray(interview.history) ? interview.history : []} nameById={nameById} /> : null}

      {reasonFor === 'reschedule' ? (
        <ReasonModal
          title={interview?.state === 'cancelled' ? 'Schedule the interview again' : 'Reschedule interview'}
          label="Reason for the change"
          hint="The applicant and panel see the change. The reason is kept in the schedule history."
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
          hint="The applicant is told the interview is cancelled. You can schedule again or reject the application."
          confirmLabel="Cancel interview"
          onConfirm={async (reason) => {
            setReasonFor(null);
            await run(() => workspace.onCancel(application.id, reason), 'Interview cancelled. The applicant and the panel are notified.');
          }}
          onClose={() => setReasonFor(null)}
        />
      ) : null}
      {leaveOpen && canLeavePanel ? (
        <LeavePanelModal busy={busy} onConfirm={leavePanel} onClose={() => setLeaveOpen(false)} />
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
