import { Button, Panel, StatusBadge } from './ui';
import { buildGoogleCalendarTemplateUrl, describeInterviewForStudent, downloadInterviewIcs, isStructuredInterview } from '../lib/interview';

const stateTone = (state) => ({ scheduled: 'info', completed: 'success', no_show: 'warning', cancelled: 'danger' }[state] || 'info');
const sectionHeading = 'm-0 text-sm font-bold uppercase tracking-[0.1em] text-app-muted';

/**
 * The student's view of the interview (SOP step 5): when, the mode, where or
 * the meeting link, and the instructions, with calendar shortcuts. The panel is
 * described by school only; panel member names and the private evaluation
 * notes are never shown to the student.
 */
export default function StudentInterviewCard({ application, scholarshipTitle = '' }) {
  const interview = application?.interview;
  const view = describeInterviewForStudent(interview);
  if (!view) return null;
  const structured = isStructuredInterview(interview);
  const isActive = structured && interview.state === 'scheduled';
  const templateUrl = isActive ? buildGoogleCalendarTemplateUrl({ interview, scholarshipTitle }) : '';

  return (
    <Panel className="grid gap-3 !border-blue-500/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={sectionHeading}>Interview</h3>
        <div className="flex flex-wrap gap-2">
          {view.rescheduled ? <StatusBadge tone="warning">Rescheduled</StatusBadge> : null}
          <StatusBadge tone={stateTone(view.state)}>{view.stateLabel}</StatusBadge>
        </div>
      </div>
      {structured && interview.state === 'cancelled' ? (
        <p className="m-0 text-sm text-app-text">This interview was cancelled. The Admissions Office will notify you if it is rescheduled.</p>
      ) : null}
      <dl className="m-0 grid gap-3 sm:grid-cols-2">
        <div className="grid gap-0.5">
          <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">When</dt>
          <dd className="m-0 text-sm text-app-text">{view.when}</dd>
        </div>
        {structured ? (
          <div className="grid gap-0.5">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">{view.modeLabel}</dt>
            <dd className="m-0 min-w-0 break-words text-sm text-app-text">{view.where}</dd>
          </div>
        ) : null}
        {view.panel ? (
          <div className="grid gap-0.5 sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">Panel</dt>
            <dd className="m-0 text-sm text-app-text">{view.panel}</dd>
          </div>
        ) : null}
        {view.instructions && isActive ? (
          <div className="grid gap-0.5 sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">What to prepare</dt>
            <dd className="m-0 whitespace-pre-line text-sm text-app-text">{view.instructions}</dd>
          </div>
        ) : null}
      </dl>
      {isActive ? (
        <div className="flex flex-wrap gap-2">
          {view.meetingUrl ? (
            <a href={view.meetingUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-xl bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright px-4 text-sm font-semibold text-white shadow-sm">Join meeting</a>
          ) : null}
          {templateUrl ? (
            <a href={templateUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-xl border border-app-border bg-app-surface px-4 text-sm font-semibold text-app-text">Add to Google Calendar</a>
          ) : null}
          {interview.calendar?.htmlLink ? (
            <a href={interview.calendar.htmlLink} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-xl border border-app-border bg-app-surface px-4 text-sm font-semibold text-app-text">View calendar invitation</a>
          ) : null}
          <Button type="button" onClick={() => downloadInterviewIcs({ interview, scholarshipTitle, applicationId: application.id })}>Download .ics</Button>
        </div>
      ) : null}
    </Panel>
  );
}
