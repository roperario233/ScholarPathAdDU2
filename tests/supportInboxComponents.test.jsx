import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AdminSupportInbox from '../src/pages/admin/AdminSupportInbox';
import StudentSupportChat from '../src/components/StudentSupportChat';

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

  it('provides the student-side Admissions Office launcher and chat entry point', () => {
    const html = renderToStaticMarkup(<StudentSupportChat ready onSend={vi.fn()} />);
    expect(html).toContain('Chat with the Admissions Office');
    expect(html).toContain('Admissions Office');
  });
});