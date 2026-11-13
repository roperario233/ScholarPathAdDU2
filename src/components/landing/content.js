import { academicPrograms } from '../../lib/academicPrograms';
import { getApplicationStatusLabel, getDocumentStatusLabel, sopStages } from '../../lib/constants';
import { APPLICATION_FORM_SECTIONS } from '../../lib/profile';
import { SCHOLARSHIP_GUIDES } from '../../lib/scholarshipGuide';

// Everything the landing page says is either read from the app's own modules
// (the grant guides, the SOP stages, the schools, the Application Form parts) or
// written here once. Nothing on the page is a statistic, a testimonial, or a
// claim the app does not back.

// Count-up figures: real facts only.
export const LANDING_FACTS = [
  { value: SCHOLARSHIP_GUIDES.length, label: 'AdDU grants', detail: 'GIA, WSP and Jubilee' },
  { value: new Set(academicPrograms.map((program) => program.school).filter(Boolean)).size, label: 'schools', detail: 'every undergraduate program' },
  { value: sopStages.length, label: 'tracked stages', detail: 'from Submitted to Released' },
];

// The SOP stage track as the app labels it (`Endorsed` reads "For Interview").
export const STAGE_LABELS = sopStages.map((stage) => getApplicationStatusLabel(stage));

export const FORM_PARTS = APPLICATION_FORM_SECTIONS.map((section) => section.label);

export const DOCUMENT_STATES = {
  Pending: getDocumentStatusLabel('Pending'),
  Verified: getDocumentStatusLabel('Verified'),
  Rejected: getDocumentStatusLabel('Rejected'),
};

export const NAV_LINKS = [
  { id: 'grants', label: 'Grants' },
  { id: 'journey', label: 'How it works' },
  { id: 'try', label: 'Try it' },
  { id: 'features', label: 'Features' },
  { id: 'faq', label: 'FAQ' },
];

export const JOURNEY_STEPS = [
  {
    id: 'check',
    kicker: 'Smart Eligibility Checker',
    title: 'Check your eligibility',
    body: 'Every grant shows a verdict and one row per criterion: your answer, what the track needs, and what to update. An incoming first-year is matched on the senior high school general average; a current student on the QPI.',
  },
  {
    id: 'form',
    kicker: 'Application Form',
    title: 'Complete your Application Form once',
    body: 'FORM 230-SCH lives in the app as six numbered parts. You answer it once, and each application freezes a copy of it at submission.',
  },
  {
    id: 'vault',
    kicker: 'Document Vault',
    title: 'Upload once. Reuse everywhere.',
    body: 'A file you upload to the Document Vault can be attached to every application that needs it. The Admissions Office verifies it, or reverts it with a note on what to correct.',
  },
  {
    id: 'track',
    kicker: 'Application tracking',
    title: 'Submit and track your application',
    body: `Follow your application through ${sopStages.length} stages, from Submitted to Released, with a dated history of each step.`,
  },
  {
    id: 'notify',
    kicker: 'Notification center',
    title: 'Get notified your way',
    body: 'Status changes and deadline reminders arrive in the in-app Notification center, and by email or SMS when you turn those channels on in Settings.',
  },
];

export const AUDIENCES = [
  {
    id: 'incoming',
    title: 'Incoming first-years',
    body: 'Matched on your senior high school general average. Rank up to three program choices and keep your strand and school on file.',
  },
  {
    id: 'current',
    title: 'Current Ateneo students',
    body: 'Matched on your QPI, with your AdDU student number on file. A grade report from an earlier academic year is flagged as outdated, so you know when to upload a new one.',
  },
  {
    id: 'transferee',
    title: 'Transferees',
    body: 'Record the college you last attended. Your record belongs to that institution, so you are never asked for an AdDU student number.',
  },
];

export const OFFICE_ROLES = [
  {
    id: 'office',
    title: 'Admissions Office',
    body: 'Verifies each Document Vault file, forwards a verified case to its interviewers, makes the final check, and releases each scholarship’s results.',
  },
  {
    id: 'interviewers',
    title: 'Interviewers',
    body: 'Faculty from the school your program belongs to. They schedule your interview and record the panel’s recommendation.',
  },
  {
    id: 'ladder',
    title: 'Dean, Assistant Dean, Chairperson',
    body: 'The academic reviewers, each scoped to a school, cluster, or department. The level set for your school makes the decision.',
  },
];

export const HONESTY_POINTS = {
  is: [
    { title: 'Discovery, matching, upload and tracking', body: 'One place for the three AdDU grants, from the first check to a recorded result.' },
    { title: 'Personal accounts welcome', body: 'Sign in with any Google account or email address. No AdDU email is needed.' },
    { title: 'A prototype for Ateneo de Davao University', body: 'A research prototype built with the University’s Admissions Office process in mind.' },
  ],
  isNot: [
    { title: 'Not a payment system', body: 'ScholarPath never disburses funds. A grant amount it shows is a recorded figure, not a payment.' },
    { title: 'Not connected to the registrar', body: 'Your QPI is self-reported and backed by the Document Vault proof the Admissions Office verifies.' },
    { title: 'Not an outside portal', body: 'External scholarship organizations get no administrative access.' },
  ],
};

export const FAQS = [
  {
    id: 'email',
    question: 'Do I need an AdDU email?',
    answer: 'No. You can sign in with a personal Google account or create an account with any email address. Incoming first-years and transferees often do not have an AdDU address yet.',
  },
  {
    id: 'payout',
    question: 'Does this pay out the scholarship?',
    answer: 'No. ScholarPath covers discovery, eligibility matching, document upload, and application tracking. It does not disburse money. When a grant amount appears on an accepted application, it is the figure the University recorded, not a payment.',
  },
  {
    id: 'registrar',
    question: 'Is my QPI verified against the registrar?',
    answer: 'No. ScholarPath has no registrar integration. Your QPI and household income are self-reported. To submit an application you attach current proof from your Document Vault, and the Admissions Office verifies those files.',
  },
  {
    id: 'documents',
    question: 'Who sees my documents?',
    answer: 'Your files sit in private storage and open only through short-lived links. The Admissions Office reads them to verify your application. The academic reviewers and interviewers for your program’s school can read the files of applicants in their scope. Your household finances are shared only with the Admissions Office, and your profile photo is never shared.',
  },
  {
    id: 'reverted',
    question: 'What if a document is reverted?',
    answer: 'The Admissions Office reverts a file for resubmission with a note on what to correct. While your application is Submitted, Under Review, or For Verification, you replace the file from the application’s details: choose another file from your vault or upload a correction. The replacement goes back to Pending for review.',
  },
  {
    id: 'staff',
    question: 'How do staff and reviewers get an account?',
    answer: 'By invitation only. The Admissions Office Admin invites each staff member, interviewer, and academic reviewer. There is no staff sign-up, and a student account is never converted to a staff one.',
  },
];

// ─── The "Try it" illustration ─────────────────────────────────────────────
// A toy, self-contained checker. Its thresholds belong to a made-up "sample
// track" and are not read from, or written to, the live catalog. It mirrors the
// real Smart Eligibility Checker's shape only: the academic measure follows the
// standing, an answered failure is decisive, and a specific exclusion (the
// prepaid tuition plan, which really does exclude AdDU-administered aid)
// overrides every other match.
export const SAMPLE_TRACK = {
  name: 'Sample track',
  qpiFloor: 2.75,
  shsFloor: 88,
  incomeBands: [
    { value: 'band-1', label: 'Up to ₱300,000 a year', passes: true },
    { value: 'band-2', label: '₱300,001 to ₱600,000', passes: false },
    { value: 'band-3', label: 'Above ₱600,000', passes: false },
  ],
  programs: [
    { value: 'AB Psychology', open: true },
    { value: 'BS Accountancy', open: true },
    { value: 'BS Computer Science', open: true },
    { value: 'BS Civil Engineering', open: false },
  ],
};

export const STANDING_OPTIONS = [
  { value: 'incoming', label: 'Incoming first-year' },
  { value: 'continuing', label: 'Current or transferee' },
];

export const createIllustrationAnswers = () => ({
  standing: '',
  academic: null,
  income: '',
  program: '',
  prepaidPlan: false,
});

export const getAcademicScale = (standing) => (standing === 'incoming'
  ? { label: 'Senior high school general average', short: 'SHS average', min: 60, max: 100, step: 1, floor: SAMPLE_TRACK.shsFloor, start: 86, format: (value) => String(Math.round(value)) }
  : { label: 'QPI', short: 'QPI', min: 0, max: 4, step: 0.05, floor: SAMPLE_TRACK.qpiFloor, start: 2.6, format: (value) => Number(value).toFixed(2) });

// Returns { verdict: 'eligible' | 'ineligible' | 'incomplete', rows }.
export const evaluateIllustration = (answers = createIllustrationAnswers()) => {
  const scale = getAcademicScale(answers.standing);
  const band = SAMPLE_TRACK.incomeBands.find((entry) => entry.value === answers.income);
  const program = SAMPLE_TRACK.programs.find((entry) => entry.value === answers.program);
  const academicAnswered = Boolean(answers.standing) && answers.academic !== null && answers.academic !== '';

  const rows = [
    {
      id: 'standing',
      label: 'Year standing',
      answer: STANDING_OPTIONS.find((entry) => entry.value === answers.standing)?.label || 'Not answered',
      needs: 'Decides which academic measure is read',
      state: answers.standing ? 'pass' : 'missing',
    },
    {
      id: 'academic',
      label: answers.standing ? scale.label : 'Academic measure',
      answer: academicAnswered ? scale.format(answers.academic) : 'Not answered',
      needs: answers.standing ? `${scale.short} ${scale.format(scale.floor)} or higher` : 'Answer your year standing first',
      state: !academicAnswered ? 'missing' : Number(answers.academic) >= scale.floor ? 'pass' : 'fail',
    },
    {
      id: 'income',
      label: 'Household income',
      answer: band?.label || 'Not answered',
      needs: `At or below ${SAMPLE_TRACK.incomeBands[0].label.replace('Up to ', '').replace(' a year', '')}`,
      state: !band ? 'missing' : band.passes ? 'pass' : 'fail',
    },
    {
      id: 'program',
      label: 'Degree program',
      answer: program?.value || 'Not answered',
      needs: 'A program open to the sample track',
      state: !program ? 'missing' : program.open ? 'pass' : 'fail',
    },
    {
      id: 'exclusion',
      label: 'Exclusion Flag Hierarchy',
      answer: answers.prepaidPlan ? 'On a prepaid tuition plan' : 'No exclusion declared',
      needs: 'No specific exclusion applies',
      state: answers.prepaidPlan ? 'fail' : 'pass',
    },
  ];

  const verdict = answers.prepaidPlan || rows.some((row) => row.state === 'fail')
    ? 'ineligible'
    : rows.some((row) => row.state === 'missing') ? 'incomplete' : 'eligible';

  return { verdict, rows, overriddenByExclusion: Boolean(answers.prepaidPlan) };
};

export const VERDICT_COPY = {
  eligible: { title: 'You qualify', detail: 'Every sample criterion is met.' },
  ineligible: { title: 'Not eligible yet', detail: 'At least one answer does not meet the sample track.' },
  incomplete: { title: 'Answers needed', detail: 'Answer each question to see a verdict.' },
};
