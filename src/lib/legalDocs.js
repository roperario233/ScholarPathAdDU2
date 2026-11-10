// The privacy, storage, and terms copy shown by the legal pages, the first-visit
// notice, and the account consent card.
//
// Everything here is prototype wording written for a capstone study, in the spirit
// of the University's Data Privacy Act of 2012 (RA 10173) obligations. It is NOT a
// verbatim copy of any official AdDU notice and is not a legal instrument: it needs
// review by the University Data Protection Officer before it is used outside a
// demonstration. Keep it that way in any edit.
//
// The copy is data, never JSX, so the pages, the tabs, the anchors, the tests, and
// the recorded consent version all read one source and cannot disagree.

import { ADMISSIONS_OFFICE_ROLES } from './constants';
import { INTERVIEWER_ROLE, LADDER_ROLES, REVIEW_ROLE_LABELS, REVIEWER_ROLES } from './reviewScope';

// Bumping this re-prompts every device for its notice choice and records a new
// consent version on each account (record_privacy_consent). It is also the value
// stored in the database, so it stays free text there: no migration is needed when
// the copy changes.
export const PRIVACY_NOTICE_VERSION = '2026-11-1';
export const PRIVACY_NOTICE_EFFECTIVE = '5 November 2026';

export const LEGAL_DOCUMENT_KEYS = ['privacy', 'storage', 'terms'];

const ROLE_LABELS = {
  student: 'Student',
  admissions_office: 'Admissions Office Staff',
  admissions_admin: 'Admissions Office Admin',
  ...REVIEW_ROLE_LABELS,
};

// The role matrix the privacy policy prints. It is derived from the same role
// constants the row-level policies are written against, so a new role cannot be
// added to the system and silently missing from the policy.
export const PRIVACY_MATRIX_ROLES = ['student', ...ADMISSIONS_OFFICE_ROLES, ...REVIEWER_ROLES];

export const DATA_READERS = PRIVACY_MATRIX_ROLES.map((role) => {
  if (role === 'student') {
    return {
      role,
      label: ROLE_LABELS[role],
      sees: [
        'Your own profile and Application Form answers',
        'Your own Document Vault files',
        'Your own applications, timeline, and status history',
        'Your own notifications, reminders, and support conversation',
      ],
      withheld: ['Any other applicant’s information', 'Internal staff notes, panel notes, and rejection reasons'],
    };
  }

  if (role === 'admissions_office') {
    return {
      role,
      label: ROLE_LABELS[role],
      sees: [
        'The office intake pool of open applications',
        'Document Vault files, read-only',
        'The interview and office calendar',
        'Support conversations, to reply',
        'Application volume statistics',
      ],
      withheld: ['Acceptance rates and accepted or not-accepted counts', 'Panel recommendation levels', 'Waitlist positions'],
    };
  }

  if (role === 'admissions_admin') {
    return {
      role,
      label: ROLE_LABELS[role],
      sees: [
        'Every application in the office pipeline',
        'Document Vault decisions (verify or revert)',
        'The final check, results release, and waitlist order',
        'Household finances, for the financial evaluation',
        'Recorded grant amounts',
      ],
      withheld: ['Nothing beyond the internal notes the office itself records'],
    };
  }

  if (role === INTERVIEWER_ROLE) {
    return {
      role,
      label: ROLE_LABELS[role],
      sees: [
        'Applications from the school, cluster, or department the account holds',
        'The interview schedule and panel for those cases',
        'Their own evaluation notes',
      ],
      withheld: ['Applications outside the assigned level', 'Household finances', 'Waitlist positions'],
    };
  }

  // The ladder: Dean (school), Assistant Dean (cluster), Chairperson (department).
  return {
    role,
    label: ROLE_LABELS[role],
    sees: [
      'Applications from the level the account holds',
      'The interview schedule and panel for those cases',
      'Document verification states, read-only',
      'Panel evaluation notes for those cases',
    ],
    withheld: ['Applications outside the assigned level', 'Household finances', 'Waitlist positions', 'Results release'],
  };
});

const getReader = (role) => DATA_READERS.find((entry) => entry.role === role);

// The ladder's row names its three levels so one row reads for all of them.
export const LADDER_ROW_LABEL = LADDER_ROLES.map((role) => REVIEW_ROLE_LABELS[role]).join(' · ');

const STORAGE_TABLE = {
  columns: ['Name', 'What it is for', 'How long it stays'],
  rows: [
    [
      'scholarpath-addu-state',
      'The working record for the signed-in account: profile answers, applications, the documents list, notifications, reminders, and your notice choice. It belongs to one owner id and is replaced at sign-out.',
      'Until you sign out or clear your browser storage',
    ],
    [
      'scholarpath-addu-session-activity',
      'The shared clock for the idle and total session limits, so several tabs agree and a reload does not extend a session.',
      'The session limits (15 minutes idle, 12 hours total by default)',
    ],
    [
      'Supabase sign-in entry (starts with sb-)',
      'The access and refresh token that keep you signed in. It is written by the Supabase client, not by ScholarPath.',
      'Until you sign out or the token is revoked',
    ],
  ],
};

const PRIVACY = {
  key: 'privacy',
  title: 'Privacy Policy',
  summary: 'What ScholarPath AdDU collects, who can read it, and the rights you keep under the Data Privacy Act of 2012.',
  updated: PRIVACY_NOTICE_EFFECTIVE,
  sections: [
    {
      id: 'controller',
      heading: 'Who is responsible for your information',
      paragraphs: [
        'ScholarPath AdDU is operated by the Office of Admission and Aid of Ateneo de Davao University (the Office) to support scholarship discovery, application, and tracking. The Office decides how the information in the system is used and is the personal information controller for it.',
        'This page explains that in plain language. It is prototype wording written for a capstone study, not the University’s official privacy notice. Questions about the University’s data protection practice belong with its Data Protection Officer.',
      ],
    },
    {
      id: 'what-we-collect',
      heading: 'What the system collects',
      paragraphs: ['ScholarPath collects only what a scholarship application needs. In practice that is:'],
      list: [
        'Account details: your name, email address, role, and mobile number.',
        'Your Application Form answers (FORM 230-SCH): personal information, address, family details, academic profile, household finances, and eligibility background, including the exclusion flags the scholarship rules ask about.',
        'Document Vault files you upload, such as your applicant photo, photos of residence, proof of income, and certificates. Each file is stored with the answers it proves.',
        'Applications you start or submit, their statement, the profile snapshot frozen at submission, and the stage history recorded for them.',
        'Interview records for your own case: the schedule you are told about, and, for staff, the panel and its private notes.',
        'Notification preferences, delivery records, your calendar reminders, and any messages you send through Support.',
      ],
    },
    {
      id: 'why',
      heading: 'Why it is collected',
      paragraphs: ['Your information is used to:'],
      list: [
        'Match you against the scholarship criteria through the Smart Eligibility Checker.',
        'Evaluate your application, verify your documents, and coordinate your interview.',
        'Track the application through the stages and tell you each time it moves.',
        'Send the deadline reminders and status notices you ask for.',
        'Keep the scholarship records the University is required to hold.',
      ],
    },
    {
      id: 'basis',
      heading: 'The basis under the Data Privacy Act of 2012 (RA 10173)',
      paragraphs: [
        'The Office relies on your consent, given when you create an account and when you certify an application, and on the University’s legitimate interest in administering financial aid.',
        'Some of the answers the scholarships ask for are sensitive personal information under RA 10173: household income and expenses, the employment of your parents, membership in an indigenous community, and disability status. They are collected only because the scholarship rules ask for them, they are used only for that evaluation, and they are not shared outside the roles listed below.',
      ],
    },
    {
      id: 'where',
      heading: 'Where your information is stored',
      paragraphs: [
        'Application and profile data is stored in the University’s Supabase project (PostgreSQL). Uploaded files live in private storage buckets and are never public: every view is a signed link that expires shortly after it is created.',
        'Your browser also holds the working storage described in the cookie and storage notice. A profile photo is personal to you and is not shared with any staff role.',
      ],
    },
    {
      id: 'who-reads',
      heading: 'Who can read your information',
      paragraphs: [
        'Access is enforced by the database itself, not only by the screen you are looking at. Each role can read only what its work needs:',
        'Anything the office records as internal stays internal. Rejection reasons, endorsement notes, panel recommendations, and waitlist positions are never shown to an applicant. A student reads their own result, and once a scholarship’s results are released, the recorded grant amount for their own offer.',
      ],
      table: { key: 'readers' },
    },
    {
      id: 'verification',
      heading: 'What is self-reported and what is verified',
      paragraphs: [
        'Your QPI or senior high school general average, your household income, your citizenship, and your eligibility background are self-reported. They are not pulled from the Registrar, and there is no registrar integration: the system cannot and does not claim that any academic figure is Registrar-verified.',
        'The Admissions Office may check a self-reported answer against the document you attach for it, and a verified document marks that answer as verified. Submitting an application requires a current proof attached for each answer the application relies on.',
        'A submitted application is read against the profile snapshot frozen at the moment you submitted it, so a later edit of your profile never changes what your reviewers were shown.',
      ],
    },
    {
      id: 'retention',
      heading: 'How long it is kept',
      paragraphs: [
        'Scholarship records are kept for as long as the University’s records policy requires, because a grant decision must remain auditable. Support conversations and application history are kept while the account is active and for the same records period.',
        'A deactivated account keeps its scholarship record but loses all access. Browser storage on your own device is cleared when you sign out, except the non-identifying preferences listed in the storage notice.',
      ],
    },
    {
      id: 'rights',
      heading: 'Your rights',
      paragraphs: [
        'Under RA 10173 you have the right to be informed, to object, to access your information, to have an error corrected, to have data erased or blocked, to damages, and to complain to the National Privacy Commission.',
        'Most of these rights you can exercise in the app: My Profile lets you see and correct your answers, the Document Vault lets you remove a file no submitted application relies on, and Settings controls the notification channels. For anything else, contact the Office of Admission and Aid or the University Data Protection Officer. If a request is not resolved, you may raise it with the National Privacy Commission.',
      ],
    },
    {
      id: 'limits',
      heading: 'What the system does not do',
      paragraphs: ['ScholarPath is a prototype for discovery, matching, upload, and tracking. It does not release money, it does not decide awards on its own, and it does not give external scholarship organizations access to your record.'],
      list: [
        'It records no disbursement. A recorded grant amount is a figure on a record, not a payment.',
        'It makes no automated award decision. Every stage move is made by a named staff or reviewer account and recorded.',
        'It has no Registrar integration, so no academic figure is verified by that office.',
        'It carries no advertising, and your information is never sold or shared with a third party for marketing.',
      ],
    },
  ],
};


const STORAGE = {
  key: 'storage',
  title: 'Cookie and storage notice',
  summary: 'ScholarPath AdDU sets no advertising or analytics cookies. This is the complete list of browser storage it uses, plus the one optional third-party service.',
  updated: PRIVACY_NOTICE_EFFECTIVE,
  sections: [
    {
      id: 'in-short',
      heading: 'In short',
      paragraphs: [],
      list: [
        'ScholarPath AdDU sets no advertising cookie, no analytics cookie, and no tracking pixel.',
        'It uses a small amount of first-party browser storage so you stay signed in and the app keeps your place. That storage is required for the site to work, so it does not need your permission.',
        'One optional third-party service can set cookies: the tawk.to live chat. It stays off unless the build is configured for it and you enable it in this notice.',
      ],
    },
    {
      id: 'necessary',
      heading: 'Storage that is required',
      paragraphs: ['These entries are written by the site itself, or by the Supabase client for sign-in. None of them follows you across other sites, and none is read by anyone but this app in this browser.'],
      table: STORAGE_TABLE,
    },
    {
      id: 'none',
      heading: 'Advertising, analytics, and trackers',
      paragraphs: [
        'There are none. The prototype loads no Google Analytics, no advertising pixel, no session-recording script, and no social media embed. No third-party script runs on any page except the optional live chat described next.',
      ],
    },
    {
      id: 'optional',
      heading: 'The optional live chat (tawk.to)',
      paragraphs: [
        'When a deployment is configured to use tawk.to for live chat instead of the in-app Support inbox, that widget is third-party code: it can set cookies and read your device and browser details, and it identifies the chat with the name and email on your profile while you are signed in.',
        'It does not load until you allow it in this notice. You can withdraw the choice at any time in Settings, which removes the widget; clearing your browser storage has the same effect.',
        'When the deployment uses the in-app Support inbox, which is the default, no third-party widget runs at all and there is nothing to opt into.',
      ],
    },
    {
      id: 'choice',
      heading: 'Your choice',
      paragraphs: [
        'The first-visit notice offers three answers: accept everything, keep only what is required, or choose each optional category yourself. Declining everything never blocks the app, because the required storage is what keeps you signed in.',
        'Your answer is stored on this device with the version of this notice. When the notice changes, you are asked again. Because the answer is a preference and not identity, it is kept after you sign out so the same browser is not asked on every visit.',
      ],
    },
    {
      id: 'clearing',
      heading: 'How to clear it',
      paragraphs: [
        'Settings, then Privacy and data, then Ask me about storage again forgets the answer this browser gave, so the notice is shown once more. Your browser’s own site-data controls remove everything else, including the sign-in token, and will sign you out.',
        'Clearing your browser storage on a shared or laboratory computer is worth doing: it is what guarantees the next person at that keyboard starts from an empty session.',
      ],
    },
  ],
};


const TERMS = {
  key: 'terms',
  title: 'Terms of Use',
  summary: 'The rules for using ScholarPath AdDU, including what the prototype does and does not promise.',
  updated: PRIVACY_NOTICE_EFFECTIVE,
  sections: [
    {
      id: 'about',
      heading: 'About these terms',
      paragraphs: [
        'ScholarPath AdDU is a research prototype built for a capstone study at Ateneo de Davao University. By creating an account or using the system you accept these terms. If you do not accept them, do not create an account.',
        'The prototype is evaluated for usability and software quality, so its screens and workflow may change while the study runs.',
      ],
    },
    {
      id: 'who-may-use',
      heading: 'Who may use it',
      paragraphs: [
        'Students and applicants of the University may create a student account. Staff and reviewer accounts are created only by the Admissions Office Admin: they are not self-registered, and signing up with an invited address does not give that address a staff role until the invitation is claimed by a confirmed account.',
        'One account belongs to one person. Do not share your password and do not use another person’s account.',
      ],
    },
    {
      id: 'accurate-information',
      heading: 'Give accurate information',
      paragraphs: [
        'Everything you submit must be true, complete, and correct, and it must be your own. A false statement may cancel your application or your grant.',
        'The answers the Smart Eligibility Checker uses (QPI or senior high school average, household income, degree program, year standing, and the exclusion flags) are self-reported. Submitting an application is a certification that they are accurate, not a verification by the University.',
      ],
    },
    {
      id: 'documents',
      heading: 'Documents you upload',
      paragraphs: [
        'Upload only documents about you or your household that a scholarship actually asks for, and do not upload another person’s identity document.',
        'Some pages of FORM 230-SCH cannot be filled in here. The Punong Barangay’s certification of your residence photos and your parents’ signatures on the affidavit are handled on paper: you print the sheet, have it signed, and upload the signed page.',
        'A file that is reverted for resubmission tells you what to correct. You may replace it from your application only until the case moves past the verification stage.',
      ],
    },
    {
      id: 'confidentiality',
      heading: 'Results are confidential',
      paragraphs: [
        'The result of an evaluation and the minutes of the deliberations are confidential. Do not publish or share them, and do not ask a staff or reviewer account to disclose another applicant’s result.',
        'A result is shown to you only after the scholarship’s results are released. Until then an application under deliberation reads as such, and that is deliberate rather than a fault.',
      ],
    },
    {
      id: 'no-award-decision',
      heading: 'What the system decides, and what it does not',
      paragraphs: [
        'ScholarPath stores, routes, and reports. It does not award a scholarship by itself and it does not disburse money. Every stage move is made by a named staff or reviewer account, recorded with the date, and auditable.',
        'A recorded grant amount describes coverage for a released result. It is a record, not a payment, and it does not create an obligation to disburse.',
        'The University’s scholarship guidelines and the decision of the University Scholarship Committee govern any grant. These terms do not change them.',
      ],
    },
    {
      id: 'availability',
      heading: 'Availability and accounts',
      paragraphs: [
        'The prototype is provided as it is, for the study that built it. It may be unavailable while it is updated, and data may be reset between evaluation rounds.',
        'Staff accounts can be deactivated by the Admissions Office Admin. A deactivated account keeps its scholarship record and loses all access.',
      ],
    },
    {
      id: 'changes',
      heading: 'Changes to these terms',
      paragraphs: [
        'These terms and the privacy notice carry a version. When they change, the version changes, the notice is shown again on your device, and your consent is recorded again against the new version before you continue.',
      ],
    },
    {
      id: 'contact',
      heading: 'Questions',
      paragraphs: [
        'Questions about a scholarship application go to the Office of Admission and Aid. Questions about how your information is handled may also go to the University Data Protection Officer.',
      ],
    },
  ],
};


export const LEGAL_DOCUMENTS = { privacy: PRIVACY, storage: STORAGE, terms: TERMS };

export const getLegalDocument = (key) => LEGAL_DOCUMENTS[key] || PRIVACY;
export const getLegalDocumentTitle = (key) => getLegalDocument(key).title;

// The short labels for the quiet footer rows (sidebar, mobile drawer, login screen),
// where the full titles do not fit on one line beside each other.
export const LEGAL_DOCUMENT_SHORT_LABELS = { privacy: 'Privacy', storage: 'Cookies', terms: 'Terms' };

// The one-line summaries the entry points and the consent card print.
export const getLegalDocumentSummaries = () => LEGAL_DOCUMENT_KEYS.map((key) => ({
  key,
  title: LEGAL_DOCUMENTS[key].title,
  summary: LEGAL_DOCUMENTS[key].summary,
}));

// The privacy page prints one row per office lane and student, then a single row
// for the reviewer ladder and the interviewer, which share the same scope rule.
export const getPrivacyReaderRows = () => [
  ...DATA_READERS
    .filter((entry) => entry.role === 'student' || ADMISSIONS_OFFICE_ROLES.includes(entry.role))
    .map((entry) => [entry.label, entry.sees.join('; '), entry.withheld.join('; ')]),
  getReviewerReaderRow(),
];

export const getReviewerReaderRow = () => {
  const interviewer = getReader(INTERVIEWER_ROLE);
  const ladder = getReader(LADDER_ROLES[0]) || interviewer;
  return [
    `${LADDER_ROW_LABEL} · ${REVIEW_ROLE_LABELS[INTERVIEWER_ROLE]}`,
    ladder.sees.join('; '),
    ladder.withheld.join('; '),
  ];
};

