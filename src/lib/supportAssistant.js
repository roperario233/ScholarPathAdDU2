import { getApplicationStatusGuidance } from './constants';
import { getScholarshipGuideCards } from './scholarshipGuide';
import { ADMISSIONS_OFFICE_HOURS, normalizeSupportMessageBody } from './supportMessages';

const SENSITIVE_TERMS = /\b(appeal|why (?:was|were) i rejected|why did you reject|why (?:was|were) my (?:application|document|file) rejected|rejection reason|reason (?:for|why) (?:my )?(?:application )?rejection|why was (?:my )?application not accepted|deliberation reason|financial hardship|emergency|another student|someone else's|other applicant)\b/i;
const VERDICT_TERMS = /\b(am i eligible|do i qualify|will i get|will i receive|will i be approved|guarantee(d)?)\b/i;

export const SUPPORT_QUICK_REPLIES = [
  'Scholarship deadlines',
  'What documents do I need?',
  'Where is my application now?',
];

export const classifySupportIntent = (value = '') => {
  const text = String(value).trim().toLowerCase();
  if (/\b(live agent|live chat|human|real person|(?:talk|speak) (?:to|with) (?:someone|a person|(?:(?:the|an?|our) )?(?:admissions office|office|staff|agent))|connect me (?:to|with) (?:someone|a person|(?:(?:the|an?|our) )?(?:admissions office|office|staff|agent)))\b/.test(text)) return 'live-agent';
  if (SENSITIVE_TERMS.test(text)) return 'sensitive';
  if (/\b(?:admissions )?office hours?\b|\bwhen (?:is|are) (?:the )?(?:admissions )?office open\b|\bwhen are you open\b|\boffice availability\b/.test(text)) return 'office-hours';
  if (/\b(deadlines?|when.*apply|application period|due dates?)\b/.test(text)) return 'deadlines';
  if (/\b(reverted|rejected documents?|documents?.*(?:rejected|reverted)|replace.*(?:file|document))\b/.test(text)) return 'reverted-document';
  if (/\b(status|progress|where.*application|applications?.*(?:now|status))\b/.test(text)) return 'application-status';
  if (/\b(documents?|requirements?|uploads?|vaults?|paperwork|proofs?|certificates?)\b/.test(text)) return 'documents';
  if (/\b(?:what|which|tell me about|list|available|offer(?:ed)?)\b.*\b(?:scholarships?|grants?|wsp|gia|jubilee)\b|\b(?:scholarships?|grants?|wsp|gia|jubilee)\b.*\b(?:available|offer(?:ed)?|list|about|programs?)\b/.test(text)) return 'scholarships';
  if (/\b(am i eligible|do i qualify|will i get|will i receive|will i be approved|guarantee(?:d)?|eligibility verdict|check my eligibility)\b/i.test(text)) return 'eligibility';
  if (/\b(interviews?|schedules?|meetings?)\b/.test(text)) return 'interview';
  if (/\b(profiles?|application forms?|form 230|edit my answer)\b/.test(text)) return 'application-form';
  if (/\b(password|sign in|login|accounts?)\b/.test(text)) return 'account';
  if (/^(?:hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you|thank you so much|that(?:'s| is) helpful)[!. ,]*$/i.test(text)) return 'greeting';
  if (/\b(scholarships?|grants?|wsp|gia|jubilee)\b/.test(text)) return 'scholarships';
  return 'other';
};

const dateLabel = (value) => {
  if (!value || Number.isNaN(Date.parse(value))) return 'No deadline is currently listed';
  return new Date(value).toLocaleDateString('en-PH', { dateStyle: 'long', timeZone: 'Asia/Manila' });
};

export const buildAssistantKnowledge = ({ scholarships = [], applications = [], documents = [], profile = {} } = {}) => {
  const tracks = getScholarshipGuideCards(scholarships, profile).map((guide) => ({
    name: guide.name,
    title: guide.catalogTitle,
    deadline: guide.scholarship?.deadline || guide.scholarship?.application_deadline || '',
    requirements: guide.requirements.map((requirement) => requirement.label),
    summary: guide.summary,
  }));
  const documentById = new Map(documents.map((document) => [document.id, document]));
  return {
    tracks,
    applications: applications.map((application) => ({
      title: application.scholarshipTitle || application.scholarshipName || 'Scholarship application',
      status: application.status,
      guidance: getApplicationStatusGuidance(application.status),
      interview: application.interview || null,
      documents: (application.attachedDocuments || []).map((entry) => {
        const item = typeof entry === 'string' ? documentById.get(entry) || {} : entry;
        return {
          title: item.title || item.document?.title || item.name || 'Document',
          verificationStatus: item.verificationStatus || item.document?.verificationStatus || item.document?.verification_status,
        };
      }),
    })),
  };
};

export const replyFor = ({ message, context = {} } = {}) => {
  const text = normalizeSupportMessageBody(message);
  const intent = classifySupportIntent(text);
  if (!text) return { kind: 'clarify', intent, body: 'What would you like help with?', quickReplies: SUPPORT_QUICK_REPLIES };
  if (intent === 'live-agent' || intent === 'sensitive') {
    return { kind: 'escalate', intent, body: 'I’ll connect this conversation to the Admissions Office so a staff member can help you directly.', quickReplies: [] };
  }
  if (VERDICT_TERMS.test(text) || intent === 'eligibility') {
    return {
      kind: 'answer', intent,
      body: 'I can explain the published requirements, but I cannot decide eligibility or predict an award. Open the Smart Eligibility Checker in Scholarship Explorer for a match based on your answers; the Admissions Office makes the official decisions.',
      quickReplies: ['Open Scholarship Explorer', 'Talk to a live agent'],
    };
  }

  const knowledge = buildAssistantKnowledge(context);
  if (intent === 'greeting') {
    return { kind: 'answer', intent, body: /\b(thanks|thank you|helpful)\b/i.test(text) ? 'You’re welcome. I can help with scholarship information, deadlines, documents, and your application status.' : 'Hello! I can help with scholarship information, deadlines, required documents, and your application status.', quickReplies: SUPPORT_QUICK_REPLIES };
  }
  if (intent === 'office-hours') {
    const availability = context.availability;
    const status = availability
      ? availability.online
        ? 'The Admissions Office is currently online.'
        : availability.officeHoursOpen
          ? 'The Admissions Office is within its usual office hours but is not currently showing as online.'
          : 'The Admissions Office is currently outside its usual office hours.'
      : 'I cannot check live office availability right now.';
    return { kind: 'answer', intent, body: `${status} Usual office hours are ${ADMISSIONS_OFFICE_HOURS}. You can leave a message here at any time.`, quickReplies: ['Talk to a live agent'] };
  }
  if (intent === 'scholarships') {
    const details = knowledge.tracks.map((track) => `${track.name}: ${track.summary}${track.deadline ? ` Application deadline: ${dateLabel(track.deadline)}.` : ''}`).join(' ');
    return { kind: 'answer', intent, body: details ? `${details} Check Scholarship Explorer for current catalog details and requirements.` : 'The AdDU scholarship catalog has not loaded yet. Open Scholarship Explorer to see the current listings.', quickReplies: ['Scholarship deadlines', 'What documents do I need?', 'Open Scholarship Explorer'] };
  }
  if (intent === 'deadlines') {
    const details = knowledge.tracks.map((track) => `${track.name}: ${dateLabel(track.deadline)}.`).join(' ');
    return { kind: 'answer', intent, body: `${details || 'The scholarship catalog has not loaded yet.'} Dates can change; check the live catalog in Scholarship Explorer.`, quickReplies: SUPPORT_QUICK_REPLIES };
  }
  if (intent === 'documents') {
    const tracks = knowledge.tracks.filter((track) => track.requirements.length);
    if (!tracks.length) return { kind: 'answer', intent, body: 'Open the Document Vault to review your files. The requirements for each AdDU scholarship appear in Scholarship Explorer and in the application workspace once you start a draft.' , quickReplies: SUPPORT_QUICK_REPLIES };
    const details = tracks.map((track) => `${track.name}: ${track.requirements.join(', ')}.`).join(' ');
    return { kind: 'answer', intent, body: `${details} Your application workspace shows the requirements that apply to your standing.`, quickReplies: SUPPORT_QUICK_REPLIES };
  }
  if (intent === 'reverted-document') {
    const reverted = knowledge.applications.flatMap((application) => application.documents
      .filter((document) => document.verificationStatus === 'Rejected')
      .map((document) => ({ ...document, applicationTitle: application.title })));
    const detail = reverted.length
      ? ` Your application shows ${reverted.map((document) => `${document.title} for ${document.applicationTitle}`).join('; ')}.`
      : '';
    return { kind: 'answer', intent, body: `A reverted file needs a corrected replacement. Open the affected application’s details and use Replace document while the application is still before endorsement; otherwise contact the Admissions Office.${detail}`, quickReplies: ['Talk to a live agent'] };
  }
  if (intent === 'application-status') {
    if (!knowledge.applications.length) return { kind: 'answer', intent, body: 'I do not see a submitted application in your workspace. Drafts and submitted applications are listed on Applications.', quickReplies: ['Open Applications', 'Talk to a live agent'] };
    const details = knowledge.applications.map((application) => `${application.title}: ${application.status}${application.guidance ? ` — ${application.guidance}` : ''}`).join(' ');
    return { kind: 'answer', intent, body: details, quickReplies: ['Open Applications', 'Talk to a live agent'] };
  }
  if (intent === 'interview') {
    const scheduled = knowledge.applications.filter((application) => application.interview?.startsAt);
    const detail = scheduled.length
      ? ` Your scheduled interviews: ${scheduled.map((application) => `${application.title} on ${new Date(application.interview.startsAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })}`).join('; ')}.`
      : ' I do not see a scheduled interview in your application records yet.';
    return { kind: 'answer', intent, body: `Interview details are shown in Applications when scheduled.${detail}`, quickReplies: ['Open Applications', 'Talk to a live agent'] };
  }
  if (intent === 'application-form') {
    return { kind: 'answer', intent, body: 'Your Application Form is available from My Profile. Complete the required answers there; each application workspace will show its required documents and submission steps.', quickReplies: ['Open Application Form', 'Talk to a live agent'] };
  }
  if (intent === 'account') {
    return { kind: 'answer', intent, body: 'For sign-in or password help, use the account recovery options on the sign-in screen. If you still cannot access your account, I can connect you to the Admissions Office.', quickReplies: ['Talk to a live agent'] };
  }
  return { kind: 'clarify', intent, body: 'I’m not sure I understood. Choose one of these topics or ask to talk with an Admissions Office staff member.', quickReplies: SUPPORT_QUICK_REPLIES };
};

export const shouldAssistantReply = ({ thread, messages = [], replyingToId = '', assistantEnabled = true } = {}) => {
  if (!assistantEnabled || thread?.assistantEnabled === false) return false;
  if (thread?.escalatedAt) return false;
  if (thread?.lastMessageBy === 'admissions_office' || thread?.lastMessageBy === 'admissions_head') return false;
  if (messages.some((message) => ['admissions_office', 'admissions_head'].includes(message.senderRole))) return false;
  if (!replyingToId) return true;
  return !messages.some((message) => message.senderRole === 'assistant' && message.replyingToId === replyingToId);
};