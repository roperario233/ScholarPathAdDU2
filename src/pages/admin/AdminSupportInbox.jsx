import { useMemo, useState } from 'react';
import AdminPageHeader from '../../components/AdminPageHeader';
import SupportConversation from '../../components/SupportConversation';
import { Button, Card, EmptyState, StatusBadge } from '../../components/ui';
import { buildSupportThreadSummary, countUnreadSupportMessages, getSupportAvailabilityLabel, sortSupportThreads } from '../../lib/supportMessages';

const formatThreadTime = (value) => {
  if (!value || Number.isNaN(Date.parse(value))) return 'No messages';
  return new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
};

export default function AdminSupportInbox({
  threads = [],
  messages = [],
  students = {},
  selectedThreadId = '',
  role = 'admissions_office',
  loading = false,
  ready = true,
  availability = {},
  onSelectThread,
  onSend,
  onMarkRead,
  onSetStatus,
}) {
  const [statusError, setStatusError] = useState('');
  const summaries = useMemo(() => sortSupportThreads(threads).map((thread) => {
    const threadMessages = messages.filter((message) => message.threadId === thread.id);
    return buildSupportThreadSummary({
      ...thread,
      unreadCount: countUnreadSupportMessages(thread, threadMessages, 'office'),
    }, students[thread.studentId]);
  }), [threads, messages, students]);
  const selectedThread = summaries.find((thread) => thread.id === selectedThreadId) || summaries[0] || null;
  const selectedMessages = messages.filter((message) => message.threadId === selectedThread?.id);
  const selectedStudent = selectedThread
    ? students[selectedThread.studentId] || summaries.find((thread) => thread.id === selectedThread.id)
    : null;
  const unreadTotal = summaries.reduce((sum, thread) => sum + thread.unreadCount, 0);

  const changeStatus = async () => {
    setStatusError('');
    const result = await onSetStatus?.(selectedThread.id, selectedThread.status === 'Closed' ? 'Open' : 'Closed');
    if (result?.error) setStatusError(result.error.message || 'The thread status could not be updated.');
  };

  const selectThread = (threadId) => {
    onSelectThread?.(threadId);
    onMarkRead?.(threadId);
  };

  return (
    <div className="grid gap-5">
      <AdminPageHeader
        title="Support inbox"
        description="Assistant transcripts and student requests for live-agent help appear here. Both Admissions Office lanes share this inbox."
        badge={`${unreadTotal} unread`}
      />
      {!ready && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-app-text" role="status">
          The support inbox tables are unavailable. Apply migration `20261053000000_add_support_inbox.sql` to enable this workspace.
        </div>
      )}
      <section className="grid min-h-[60vh] gap-4 lg:grid-cols-[minmax(16rem,0.38fr)_minmax(0,1fr)]">
        <Card title="Student conversations" action={<StatusBadge tone={unreadTotal ? 'warning' : 'neutral'}>{summaries.length} total</StatusBadge>} className="min-w-0">
          <div className="grid max-h-[65vh] content-start gap-2 overflow-y-auto pr-1">
            <StatusBadge tone={availability.online ? 'success' : 'neutral'}>{getSupportAvailabilityLabel(availability)}</StatusBadge>
            {summaries.length ? summaries.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => selectThread(thread.id)}
                className={`grid min-w-0 gap-1 rounded-xl border p-3 text-left transition focus:outline-none focus:ring-4 focus:ring-blue-500/20 ${thread.id === selectedThread?.id ? 'border-blue-500/50 bg-blue-500/10' : 'border-app-border bg-app-surface hover:bg-app-card'}`}
              >
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <strong className="min-w-0 truncate text-sm text-app-text">{thread.studentName}</strong>
                  <span className="flex shrink-0 items-center gap-1">
                    {thread.awaitingAgent && <StatusBadge tone="warning">Awaiting live agent</StatusBadge>}
                    {thread.unreadCount > 0 && <StatusBadge tone="warning">{thread.unreadCount} new</StatusBadge>}
                  </span>
                </span>
                <span className="truncate text-xs text-app-muted">{thread.studentProgram || thread.studentSchool || 'Student applicant'}</span>
                <span className="flex items-center justify-between gap-2 text-xs text-app-muted">
                  <span>{thread.lastMessageBy === 'student' ? 'Student waiting' : thread.status}</span>
                  <time dateTime={thread.lastMessageAt || undefined}>{formatThreadTime(thread.lastMessageAt)}</time>
                </span>
              </button>
            )) : <EmptyState title="No student conversations" description="A thread appears when a student sends their first support message." />}
          </div>
        </Card>

        <Card
          title={selectedThread ? selectedStudent?.fullName || 'Student conversation' : 'Conversation'}
          action={selectedThread && <StatusBadge tone={selectedThread.status === 'Open' ? 'success' : 'neutral'}>{selectedThread.status}</StatusBadge>}
          className="grid min-h-0 min-w-0 content-start"
        >
          {selectedThread ? (
            <div className="grid min-h-[55vh] content-start gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-app-border bg-app-surface p-3 text-sm">
                <div className="min-w-0">
                  <p className="m-0 text-app-text">{selectedStudent?.degreeProgram || 'Program not listed'}</p>
                  <p className="m-0 text-xs text-app-muted">{selectedStudent?.department || 'School not listed'}</p>
                </div>
                <Button type="button" variant="secondary" onClick={changeStatus}>
                  {selectedThread.status === 'Closed' ? 'Reopen conversation' : 'Close conversation'}
                </Button>
              </div>
              {selectedThread.escalatedAt && (
                <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-app-text">
                  <strong>{selectedThread.awaitingAgent ? 'Awaiting live agent reply' : 'Live-agent request'}</strong>
                  <p className="mb-0 mt-1 text-xs text-app-muted">The student requested Admissions Office help. Review the assistant transcript and reply directly below.</p>
                </div>
              )}
              {statusError && <p className="m-0 text-sm text-rose-600 dark:text-rose-300" role="alert">{statusError}</p>}
              <SupportConversation
                messages={selectedMessages}
                viewer={role}
                studentName={selectedStudent?.fullName || 'Student'}
                onSend={(body) => onSend?.(selectedThread.id, body)}
                className="min-h-0"
              />
            </div>
          ) : (
            <EmptyState title="Select a conversation" description="Choose a student from the inbox to read and reply." />
          )}
        </Card>
      </section>
      {loading && <p className="m-0 text-center text-xs text-app-muted" role="status">Refreshing inbox…</p>}
    </div>
  );
}