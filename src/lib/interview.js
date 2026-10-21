// SOP step 5 interview helpers. The definitions live in the shared Edge Function
// module so the app, the notification emails, and the tests cannot disagree on
// the schedule format, the panel rule (SOP 5a), or the Recommend gate.
import { buildInterviewIcs } from '../../supabase/functions/_shared/interview.js';

export * from '../../supabase/functions/_shared/interview.js';

// Saves the interview as an .ics file in the browser, for the student and for
// faculty guests when the Google Calendar integration is not configured.
export const downloadInterviewIcs = ({ interview, scholarshipTitle = '', applicationId = '' }) => {
  const ics = buildInterviewIcs({ interview, scholarshipTitle, uid: `${applicationId}-${interview?.revision || 1}` });
  if (!ics || typeof document === 'undefined') return;
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'scholarship-interview.ics';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
