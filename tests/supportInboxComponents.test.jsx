import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AdminSupportInbox from '../src/pages/admin/AdminSupportInbox';
import StudentSupportChat from '../src/components/StudentSupportChat';
import { SidebarNav } from '../src/components/SidebarParts';

describe('support inbox surfaces', () => {
  it('renders the Admissions Office inbox, applicant context, and reply action', () => {
    const html = renderToStaticMarkup(
      <AdminSupportInbox
        threads={[{
          id: 'thread-1', studentId: 'student-1', status: 'Open',
          lastMessageAt: '2026-10-29T12:00:00Z', lastMessageBy: 'student', officeUnreadCount: 1,
        }]}
        messages={[{
          id: 'message-1', threadId: 'thread-1', senderRole: 'student', body: 'I need help with my application.',
          createdAt: '2026-10-29T12:00:00Z',
        }]}
        students={{ 'student-1': { fullName: 'A Student', degreeProgram: 'BS Biology', department: 'SON' } }}
        selectedThreadId="thread-1"
        onSend={vi.fn()}
      />,
    );
    expect(html).toContain('Support inbox');
    expect(html).toContain('A Student');
    expect(html).toContain('I need help with my application.');
    expect(html).toContain('Reply to student');
  });

  it('provides an icon-only student chat launcher with a red unread badge', () => {
    const html = renderToStaticMarkup(<StudentSupportChat ready unreadCount={3} onSend={vi.fn()} />);
    expect(html).toContain('aria-label="Chat with the Admissions Office"');
    expect(html).toContain('title="Chat with the Admissions Office"');
    expect(html).toContain('fixed bottom-4 left-4');
    expect(html).toContain('bg-rose-500');
    expect(html).toContain('>3</span>');
    expect(html).not.toContain('<span>Admissions Office</span>');
  });

  it('shows a compact dismissible chat pop-up only when requested', () => {
    const visibleHint = renderToStaticMarkup(
      <StudentSupportChat showHint ready onSend={vi.fn()} onDismissHint={vi.fn()} />,
    );
    const hiddenHint = renderToStaticMarkup(<StudentSupportChat ready onSend={vi.fn()} />);

    expect(visibleHint).toContain('Ask the ScholarPath Assistant');
    expect(visibleHint).toContain('fixed bottom-24 left-4');
    expect(visibleHint).toContain('>Got it</button>');
    expect(visibleHint).not.toContain('modal-overlay');
    expect(hiddenHint).not.toContain('Ask the ScholarPath Assistant');
  });

  it('offers the assistant, availability, and a live-agent handoff to students', () => {
    const html = renderToStaticMarkup(
      <StudentSupportChat
        ready
        assistantEnabled
        assistantReady
        initialOpen
        availability={{ online: false, officeHoursOpen: false }}
        onSend={vi.fn()}
        onRequestLiveAgent={vi.fn()}
      />,
    );
    expect(html).toContain('ScholarPath Assistant');
    expect(html).toContain('Admissions Office is away');
    expect(html).toContain('Talk to a live agent');
    expect(html).toContain('general guidance, not eligibility or award decisions');
  });

  it('keeps the assistant UI during the initial readiness check and falls back only when unavailable', () => {
    const initial = renderToStaticMarkup(
      <StudentSupportChat ready assistantEnabled assistantReady={null} initialOpen onSend={vi.fn()} />,
    );
    const unavailable = renderToStaticMarkup(
      <StudentSupportChat ready assistantEnabled assistantReady={false} initialOpen onSend={vi.fn()} />,
    );
    expect(initial).toContain('ScholarPath Assistant');
    expect(initial).toContain('general guidance, not eligibility or award decisions');
    expect(initial).not.toContain('Automated replies are not available right now');
    expect(unavailable).toContain('Admissions Office</h2>');
    expect(unavailable).toContain('Automated replies are not available right now');
  });

  it('formats bullet replies, folds long answers, and hides earlier exchanges in the student chat', () => {
    const longBody = `Needed for every scholarship\n${Array.from({ length: 9 }, (_, index) => `• Document ${index + 1}`).join('\n')}`;
    const messages = [
      { id: 'q1', senderRole: 'student', body: 'First question', createdAt: '2026-10-29T10:00:00Z' },
      { id: 'a1', senderRole: 'assistant', body: 'First answer', createdAt: '2026-10-29T10:00:05Z' },
      { id: 'q2', senderRole: 'student', body: 'Second question', createdAt: '2026-10-29T10:01:00Z' },
      { id: 'a2', senderRole: 'assistant', body: 'Second answer', createdAt: '2026-10-29T10:01:05Z' },
      { id: 'q3', senderRole: 'student', body: 'What documents do I need?', createdAt: '2026-10-29T10:02:00Z' },
      { id: 'a3', senderRole: 'assistant', body: longBody, createdAt: '2026-10-29T10:02:05Z' },
    ];
    const html = renderToStaticMarkup(
      <StudentSupportChat ready assistantEnabled assistantReady initialOpen messages={messages} onSend={vi.fn()} />,
    );
    expect(html).toContain('Show 2 earlier messages');
    expect(html).not.toContain('First question');
    expect(html).toContain('Second question');
    expect(html).toContain('<li>Document 1</li>');
    expect(html).toContain('Show more');
    expect(html).toContain('Scholarship deadlines');
  });

  it('shows the conversation phase instead of leaving "Live-agent request sent" up', () => {
    const render = (thread) => renderToStaticMarkup(
      <StudentSupportChat ready assistantEnabled assistantReady initialOpen thread={thread} availability={{ online: true }} onSend={vi.fn()} onResolve={vi.fn()} onStartNewTopic={vi.fn()} onRequestLiveAgent={vi.fn()} />,
    );
    const waiting = render({ id: 't', status: 'Open', escalatedAt: '2026-10-29T10:00:00Z', lastMessageBy: 'student' });
    const withOffice = render({ id: 't', status: 'Open', escalatedAt: '2026-10-29T10:00:00Z', lastMessageBy: 'admissions_office' });
    const resolved = render({ id: 't', status: 'Closed', resolvedAt: '2026-10-30T10:00:00Z', lastMessageBy: 'admissions_office' });

    expect(waiting).toContain('Waiting for the Admissions Office');
    expect(waiting).not.toContain('Talk to a live agent');
    expect(withOffice).toContain('Chatting with the Admissions Office');
    expect(withOffice).toContain('Mark as solved');
    expect(resolved).toContain('Resolved');
    expect(resolved).toContain('Start a new question');
    expect(resolved).toContain('ScholarPath Assistant');
    for (const html of [waiting, withOffice, resolved]) expect(html).not.toContain('Live-agent request sent');
  });

  it('shows a live-agent escalation in the office inbox and prioritizes its badge', () => {
    const html = renderToStaticMarkup(
      <AdminSupportInbox
        threads={[{
          id: 'thread-1', studentId: 'student-1', status: 'Open', lastMessageBy: 'student',
          escalatedAt: '2026-10-29T12:00:00Z', lastMessageAt: '2026-10-29T12:00:00Z',
        }]}
        messages={[{ id: 'assistant-1', threadId: 'thread-1', senderRole: 'assistant', body: 'I am connecting you to the Admissions Office.', createdAt: '2026-10-29T11:59:00Z' }]}
        students={{ 'student-1': { fullName: 'A Student', degreeProgram: 'BS Biology', department: 'SON' } }}
        selectedThreadId="thread-1"
        onSend={vi.fn()}
      />,
    );
    expect(html).toContain('Awaiting live agent');
    expect(html).toContain('Awaiting live agent reply');
    expect(html).toContain('ScholarPath Assistant');
  });

  it('renders the office support unread count in shared sidebar navigation', () => {
    const html = renderToStaticMarkup(
      <SidebarNav
        items={[{ view: 'admin-support', label: 'Support inbox', badge: 3 }]}
        activeView="admin"
        onNavigate={vi.fn()}
      />,
    );
    expect(html).toContain('Support inbox');
    expect(html).toContain('3 unread support messages');
    expect(html).toContain('>3</span>');
  });
});
