import { describe, expect, it } from 'vitest';
import {
  buildSupportThreadSummary,
  countUnreadSupportMessages,
  describeSupportSender,
  getSupportUnreadTotal,
  isSupportInboxChannel,
  isTawkSupportChannel,
  normalizeSupportMessageBody,
  sortSupportThreads,
  SUPPORT_MESSAGE_MAX_LENGTH,
  SUPPORT_PRESENCE_WINDOW_MS,
  getSupportAvailabilityLabel,
  isAdmissionsOfficeOnline,
  mergeSupportInboxState,
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

  it('prioritizes unanswered live-agent requests without mutating threads', () => {
    const threads = [
      { id: 'ordinary', lastMessageAt: '2026-10-27T12:00:00Z', lastMessageBy: 'student' },
      { id: 'escalated', lastMessageAt: '2026-10-29T12:00:00Z', lastMessageBy: 'student', escalatedAt: '2026-10-29T12:00:00Z' },
    ];
    expect(sortSupportThreads(threads).map((thread) => thread.id)).toEqual(['escalated', 'ordinary']);
    expect(threads[0].id).toBe('ordinary');
  });

  it('uses the persisted unread count and otherwise derives it from the reader timestamp', () => {
    const messages = [
      { senderRole: 'student', createdAt: '2026-10-29T10:00:00Z' },
      { senderRole: 'admissions_admin', createdAt: '2026-10-29T11:00:00Z' },
      { senderRole: 'admissions_office', createdAt: '2026-10-29T12:00:00Z' },
    ];
    expect(countUnreadSupportMessages({ studentUnreadCount: 2 }, messages, 'student')).toBe(2);
    expect(countUnreadSupportMessages({ studentLastReadAt: '2026-10-29T10:30:00Z' }, messages, 'student')).toBe(2);
    expect(countUnreadSupportMessages({ officeLastReadAt: '2026-10-29T09:30:00Z' }, messages, 'office')).toBe(1);
  });

  it('totals unread messages for either side, with a timestamp fallback when counts are absent', () => {
    const threads = [
      { id: 'one', studentUnreadCount: 2, officeUnreadCount: 1 },
      { id: 'two', officeLastReadAt: '2026-10-29T10:30:00Z' },
    ];
    const messages = [
      { threadId: 'two', senderRole: 'student', createdAt: '2026-10-29T10:00:00Z' },
      { threadId: 'two', senderRole: 'student', createdAt: '2026-10-29T11:00:00Z' },
    ];

    expect(getSupportUnreadTotal(threads, 'student')).toBe(2);
    expect(getSupportUnreadTotal(threads, 'office', messages)).toBe(2);
  });

  it('builds a small office-facing student summary and labels messages by office lane', () => {
    expect(buildSupportThreadSummary({ id: 'thread-1', studentId: 'student-1', status: 'Open' }, {
      fullName: 'A Student', degreeProgram: 'BS Biology', department: 'SON',
    })).toMatchObject({
      studentName: 'A Student', studentProgram: 'BS Biology', studentSchool: 'SON', status: 'Open',
    });
    expect(describeSupportSender({ senderRole: 'admissions_admin' })).toBe('Admissions Office Admin');
    expect(describeSupportSender({ senderRole: 'admissions_office' })).toBe('Admissions Office Staff');
    expect(describeSupportSender({ senderRole: 'assistant' })).toBe('ScholarPath Assistant');
  });

  it('trims messages and caps their size at the shared database limit', () => {
    expect(normalizeSupportMessageBody('  hello  ')).toBe('hello');
    expect(normalizeSupportMessageBody('   ')).toBe('');
    expect(normalizeSupportMessageBody('x'.repeat(SUPPORT_MESSAGE_MAX_LENGTH + 10))).toHaveLength(SUPPORT_MESSAGE_MAX_LENGTH);
  });

  it('derives the office availability copy from its online and office-hour state', () => {
    expect(getSupportAvailabilityLabel({ online: true, officeHoursOpen: true })).toBe('Admissions Office is online');
    expect(getSupportAvailabilityLabel({ online: false, officeHoursOpen: true })).toBe('Admissions Office is currently unavailable');
    expect(getSupportAvailabilityLabel({ online: false, officeHoursOpen: false })).toContain('Monday–Friday');
    const nowMs = Date.parse('2026-10-29T12:00:00Z');
    expect(isAdmissionsOfficeOnline({ lastSeenAt: new Date(nowMs - SUPPORT_PRESENCE_WINDOW_MS).toISOString(), nowMs })).toBe(true);
    expect(isAdmissionsOfficeOnline({ lastSeenAt: new Date(nowMs - SUPPORT_PRESENCE_WINDOW_MS - 1).toISOString(), nowMs })).toBe(false);
  });

  it('refreshes inbox data without dropping assistant readiness or availability', () => {
    const previous = {
      assistantReady: true,
      availability: { online: true, officeHoursOpen: true },
      messages: [{ id: 'old' }],
    };
    expect(mergeSupportInboxState(previous, {
      threads: [{ id: 'thread' }],
      messages: [{ id: 'new' }],
      students: { student: { fullName: 'Student' } },
      selectedThreadId: 'thread',
      ready: true,
    })).toMatchObject({
      assistantReady: true,
      availability: { online: true, officeHoursOpen: true },
      messages: [{ id: 'new' }],
      loading: false,
    });
  });
});