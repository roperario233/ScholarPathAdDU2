import { describe, expect, it } from 'vitest';
import {
  buildSupportThreadSummary,
  countUnreadSupportMessages,
  describeSupportSender,
  isSupportInboxChannel,
  isTawkSupportChannel,
  normalizeSupportMessageBody,
  sortSupportThreads,
  SUPPORT_MESSAGE_MAX_LENGTH,
} from '../src/lib/supportMessages';

describe('support inbox derivations', () => {
  it('defaults to the in-app inbox and lets tawk.to be selected explicitly', () => {
    expect(isSupportInboxChannel({})).toBe(true);
    expect(isSupportInboxChannel({ VITE_SUPPORT_CHANNEL: 'tawk' })).toBe(false);
    expect(isTawkSupportChannel({ VITE_SUPPORT_CHANNEL: ' TAWK ' })).toBe(true);
    expect(isTawkSupportChannel({ VITE_SUPPORT_CHANNEL: 'inbox' })).toBe(false);
  });

  it('sorts oldest conversation activity first without mutating the input', () => {
    const threads = [
      { id: 'new', lastMessageAt: '2026-10-29T12:00:00Z' },
      { id: 'old', lastMessageAt: '2026-10-28T12:00:00Z' },
      { id: 'empty', createdAt: '2026-10-27T12:00:00Z' },
    ];
    expect(sortSupportThreads(threads).map((thread) => thread.id)).toEqual(['empty', 'old', 'new']);
    expect(threads[0].id).toBe('new');
  });

  it('uses the persisted unread count and otherwise derives it from the reader timestamp', () => {
    const messages = [
      { senderRole: 'student', createdAt: '2026-10-29T10:00:00Z' },
      { senderRole: 'admissions_head', createdAt: '2026-10-29T11:00:00Z' },
      { senderRole: 'admissions_office', createdAt: '2026-10-29T12:00:00Z' },
    ];
    expect(countUnreadSupportMessages({ studentUnreadCount: 2 }, messages, 'student')).toBe(2);
    expect(countUnreadSupportMessages({ studentLastReadAt: '2026-10-29T10:30:00Z' }, messages, 'student')).toBe(2);
    expect(countUnreadSupportMessages({ officeLastReadAt: '2026-10-29T09:30:00Z' }, messages, 'office')).toBe(1);
  });

  it('builds a small office-facing student summary and labels messages by office lane', () => {
    expect(buildSupportThreadSummary({ id: 'thread-1', studentId: 'student-1', status: 'Open' }, {
      fullName: 'A Student', degreeProgram: 'BS Biology', department: 'SON',
    })).toMatchObject({
      studentName: 'A Student', studentProgram: 'BS Biology', studentSchool: 'SON', status: 'Open',
    });
    expect(describeSupportSender({ senderRole: 'admissions_head' })).toBe('Admissions Office Head');
    expect(describeSupportSender({ senderRole: 'admissions_office' })).toBe('Admissions Office Staff');
  });

  it('trims messages and caps their size at the shared database limit', () => {
    expect(normalizeSupportMessageBody('  hello  ')).toBe('hello');
    expect(normalizeSupportMessageBody('   ')).toBe('');
    expect(normalizeSupportMessageBody('x'.repeat(SUPPORT_MESSAGE_MAX_LENGTH + 10))).toHaveLength(SUPPORT_MESSAGE_MAX_LENGTH);
  });
});