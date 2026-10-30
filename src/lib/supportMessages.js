export const SUPPORT_MESSAGE_MAX_LENGTH = 2000;
export const SUPPORT_OPEN_POLL_MS = 15000;
export const SUPPORT_BACKGROUND_POLL_MS = 60000;
export const SUPPORT_PRESENCE_WINDOW_MS = 5 * 60 * 1000;
export const ADMISSIONS_OFFICE_HOURS = 'Monday–Friday, 8:00 a.m.–5:00 p.m. (Philippine time)';

export const mergeSupportInboxState = (previous = {}, result = {}) => ({
  ...previous,
  threads: result.threads || [],
  messages: result.messages ?? previous.messages ?? [],
  students: result.students || previous.students || {},
  selectedThreadId: result.selectedThreadId || '',
  ready: result.ready,
  loading: false,
});

export const isSupportInboxChannel = (env = import.meta.env) => (
  String(env?.VITE_SUPPORT_CHANNEL || 'inbox').trim().toLowerCase() !== 'tawk'
);

export const isTawkSupportChannel = (env = import.meta.env) => (
  String(env?.VITE_SUPPORT_CHANNEL || 'inbox').trim().toLowerCase() === 'tawk'
);

export const sortSupportThreads = (threads = []) => [...threads].sort((a, b) => {
  const aEscalated = Boolean(a.escalatedAt && !['admissions_office', 'admissions_head'].includes(a.lastMessageBy));
  const bEscalated = Boolean(b.escalatedAt && !['admissions_office', 'admissions_head'].includes(b.lastMessageBy));
  if (aEscalated !== bEscalated) return aEscalated ? -1 : 1;
  const aTime = Date.parse(a.lastMessageAt || a.createdAt || 0) || 0;
  const bTime = Date.parse(b.lastMessageAt || b.createdAt || 0) || 0;
  return aTime - bTime;
});

export const countUnreadSupportMessages = (thread, messages = [], viewer = 'student') => {
  if (!thread) return 0;
  const persistedCount = viewer === 'student' ? thread.studentUnreadCount : thread.officeUnreadCount;
  if (persistedCount !== undefined && persistedCount !== null) return Number(persistedCount) || 0;
  const readAt = viewer === 'student' ? thread.studentLastReadAt : thread.officeLastReadAt;
  const isStudent = viewer === 'student';
  return messages.filter((message) => (
    (isStudent ? message.senderRole !== 'student' : message.senderRole === 'student')
    && (!readAt || Date.parse(message.createdAt) > Date.parse(readAt))
  )).length;
};

export const getSupportUnreadTotal = (threads = [], viewer = 'student', messages = []) => (
  threads.reduce((total, thread) => {
    const threadMessages = (messages || []).filter((message) => message.threadId === thread.id);
    return total + countUnreadSupportMessages(thread, threadMessages, viewer);
  }, 0)
);

export const describeSupportSender = (message, studentName = '') => {
  if (message?.senderRole === 'student') return studentName || 'You';
  if (message?.senderRole === 'assistant') return 'ScholarPath Assistant';
  if (message?.senderRole === 'admissions_head') return 'Admissions Office Head';
  if (message?.senderRole === 'admissions_office') return 'Admissions Office Staff';
  return 'Support';
};

export const buildSupportThreadSummary = (thread, student = {}) => ({
  id: thread.id,
  studentId: thread.studentId,
  studentName: student.fullName || 'Student',
  studentProgram: student.degreeProgram || '',
  studentSchool: student.department || '',
  status: thread.status || 'Open',
  lastMessageAt: thread.lastMessageAt || thread.createdAt || null,
  lastMessageBy: thread.lastMessageBy || '',
  unreadCount: Number(thread.unreadCount || 0),
  escalatedAt: thread.escalatedAt || null,
  awaitingAgent: Boolean(thread.escalatedAt && !['admissions_office', 'admissions_head'].includes(thread.lastMessageBy)),
});

export const normalizeSupportMessageBody = (value) => String(value || '').trim().slice(0, SUPPORT_MESSAGE_MAX_LENGTH);

export const isAdmissionsOfficeOnline = ({ online = false, lastSeenAt = null, nowMs = Date.now() } = {}) => {
  if (typeof online === 'boolean' && online) return true;
  const lastSeen = Date.parse(lastSeenAt || '');
  return Number.isFinite(lastSeen) && nowMs >= lastSeen && nowMs - lastSeen <= SUPPORT_PRESENCE_WINDOW_MS;
};

export const getSupportAvailabilityLabel = ({ online = false, officeHoursOpen = false, agentAvailable = online } = {}) => {
  if (agentAvailable) return 'Admissions Office is online';
  return officeHoursOpen
    ? 'Admissions Office is currently unavailable'
    : `Admissions Office is away · ${ADMISSIONS_OFFICE_HOURS}`;
};