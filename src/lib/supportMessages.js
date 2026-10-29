export const SUPPORT_MESSAGE_MAX_LENGTH = 2000;
export const SUPPORT_OPEN_POLL_MS = 15000;

export const isSupportInboxChannel = (env = import.meta.env) => (
  String(env?.VITE_SUPPORT_CHANNEL || 'inbox').trim().toLowerCase() !== 'tawk'
);

export const isTawkSupportChannel = (env = import.meta.env) => (
  String(env?.VITE_SUPPORT_CHANNEL || 'inbox').trim().toLowerCase() === 'tawk'
);

export const sortSupportThreads = (threads = []) => [...threads].sort((a, b) => {
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

export const describeSupportSender = (message, studentName = '') => {
  if (message?.senderRole === 'student') return studentName || 'You';
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
});

export const normalizeSupportMessageBody = (value) => String(value || '').trim().slice(0, SUPPORT_MESSAGE_MAX_LENGTH);