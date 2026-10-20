import { DOCUMENT_REPLACEMENT_STATUSES, generalDocumentTypeOptions, getDocumentTypeLabel, sopStageIndex } from './constants';
import { evaluateApplicationGate, getAcademicRequirement, getDeadlineStatus, isAdduInternalProgram } from './eligibility';
import { fmtCurrency } from './formatters';
import {
  VERIFIABLE_ATTRIBUTE_OPTIONS,
  academicStandingOptions,
  civilStatusOptions,
  deriveYearStanding,
  employmentOptions,
  familyPositionOptions,
  getStandingRequirements,
  getVerifiableAttributeOption,
  honorsRankOptions,
  ipCommunityOptions,
  pwdOptions,
  religionOptions,
  yearStandingOptions,
} from './profile';
import { UNSET_ATTRIBUTE_STATUS } from './verification';

// Application requirements: the documents a scholarship asks for before a
// student may submit, and the readiness check the application workspace, the
// submit handler, and the staff review modal all share.
//
// Each requirement is `{ id, label, documentTypes, standing }`. `documentTypes`
// are Document Vault type values (`documentTypeOptions` in src/lib/constants.js);
// a vault file of any listed type satisfies the item. `standing` scopes an item
// to incoming first-years (`incoming`), enrolled students (`continuing`), or
// everyone (`all`), mirroring getStandingRequirements() in src/lib/profile.js.
//
// The Admissions Office edits these per catalog entry
// (`scholarships.required_documents`); the defaults below come from the Standard
// Procedure for Scholarship Applications, step 2, and are what a catalog entry
// falls back to when it has no list of its own. Keep them identical to the
// backfill in supabase/migrations/20261012000000_add_application_requirements.sql.

export const REQUIREMENT_STANDINGS = [
  { value: 'all', label: 'All applicants' },
  { value: 'incoming', label: 'Incoming 1st year only' },
  { value: 'continuing', label: 'Enrolled students only' },
];

const APPLICATION_FORM = { id: 'application-form', label: 'Application Form', documentTypes: ['Application Form'], standing: 'all' };
const APPLICANT_PHOTO = { id: 'applicant-photo', label: 'Recent 2x2 ID photo of the applicant', documentTypes: ['Applicant Photo'], standing: 'all' };
const RESIDENCE_PHOTOS = { id: 'residence-photos', label: 'Photos of residence', documentTypes: ['Photos of Residence'], standing: 'all' };
const GOOD_MORAL = { id: 'good-moral', label: 'Certificate of Good Moral Character', documentTypes: ['Good Moral Character'], standing: 'all' };
const INCOME_PROOF = { id: 'income-proof', label: 'Financial income documents of parents / legal guardians', documentTypes: ['Income Proof', 'Certificate of Indigency'], standing: 'all' };
const HS_REPORT_CARD = { id: 'hs-report-card', label: 'Senior high school report card', documentTypes: ['HS Report Card'], standing: 'incoming' };
const COLLEGE_GRADES = { id: 'college-grades', label: 'Latest grade report or transcript', documentTypes: ['Grade Report', 'Transcript'], standing: 'continuing' };

// Every in-scope track asks for a recent photo of the applicant and photos of
// their residence. Both are ordinary Document Vault files, so the Admissions
// Office verifies them like any other required submission; a student can take
// them with the camera or upload an existing photo (src/lib/photoGuide.js).
export const DEFAULT_REQUIRED_DOCUMENTS = {
  'general-pool': [
    APPLICATION_FORM,
    APPLICANT_PHOTO,
    { id: 'entrance-exam', label: 'Entrance exam result with ACCEPTED remark', documentTypes: ['Entrance Exam Result'], standing: 'incoming' },
    { ...HS_REPORT_CARD, label: 'Senior high school report card with at least 85% average' },
    COLLEGE_GRADES,
    { id: 'recommendation', label: 'Recommendation from Homeroom Moderator', documentTypes: ['Recommendation Letter'], standing: 'incoming' },
    INCOME_PROOF,
    RESIDENCE_PHOTOS,
    GOOD_MORAL,
  ],
  honors: [
    APPLICATION_FORM,
    APPLICANT_PHOTO,
    { id: 'certificate-of-award', label: 'Certificate of Award as Rank 1 or 2', documentTypes: ['Certificate of Award'], standing: 'all' },
    HS_REPORT_CARD,
    COLLEGE_GRADES,
    RESIDENCE_PHOTOS,
    GOOD_MORAL,
  ],
  'work-study': [
    APPLICATION_FORM,
    APPLICANT_PHOTO,
    INCOME_PROOF,
    HS_REPORT_CARD,
    COLLEGE_GRADES,
    RESIDENCE_PHOTOS,
    GOOD_MORAL,
  ],
};

const RULE_FAMILY_BY_TITLE = [
  [/jubilee/, 'honors'],
  [/student assistant|working scholar/, 'work-study'],
  [/grant[ -]?in[ -]?aid|\bgia\b/, 'general-pool'],
];

const resolveRuleFamily = (scholarship = {}) => {
  if (DEFAULT_REQUIRED_DOCUMENTS[scholarship.ruleFamily]) return scholarship.ruleFamily;
  const title = String(scholarship.title || '').toLowerCase();
  return RULE_FAMILY_BY_TITLE.find(([pattern]) => pattern.test(title))?.[1] || null;
};

// Drops malformed catalog items so a hand-edited row cannot break the workspace.
export const normalizeRequirements = (items) => (
  (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item.label === 'string' && item.label.trim() && Array.isArray(item.documentTypes) && item.documentTypes.length)
    .map((item, index) => ({
      id: String(item.id || `requirement-${index + 1}`),
      label: item.label.trim(),
      documentTypes: item.documentTypes.map(String),
      standing: REQUIREMENT_STANDINGS.some((option) => option.value === item.standing) ? item.standing : 'all',
    }))
);

// The full catalog list for a scholarship, before the standing filter: its own
// list when the Admissions Office set one, otherwise the rule-family default.
export const getCatalogRequirements = (scholarship = {}) => {
  if (!isAdduInternalProgram(scholarship)) return [];
  const own = normalizeRequirements(scholarship.requiredDocuments);
  if (own.length) return own;
  return DEFAULT_REQUIRED_DOCUMENTS[resolveRuleFamily(scholarship)] || [];
};

// The requirements that apply to this student's standing. External and
// government-linked entries are tracked only, so they ask for nothing here.
export const getScholarshipRequirements = (scholarship = {}, profile = {}) => {
  const isIncoming = getStandingRequirements(profile).isIncomingFirstYear;
  return getCatalogRequirements(scholarship).filter((item) => (
    item.standing === 'all' || (item.standing === 'incoming' ? isIncoming : !isIncoming)
  ));
};

export const describeRequirementTypes = (requirement) => (
  requirement.documentTypes.map(getDocumentTypeLabel).join(' or ')
);

// Newest first, so the most recent upload is the default pick for a slot.
const byNewest = (left, right) => String(right.uploadedAt || '').localeCompare(String(left.uploadedAt || ''));

export const getMatchingVaultDocuments = (requirement, documents = []) => (
  documents.filter((doc) => requirement.documentTypes.includes(doc.documentType)).sort(byNewest)
);

// The Rejected files a student can still replace on a submitted application:
// only before endorsement (DOCUMENT_REPLACEMENT_STATUSES), mirroring
// replace_rejected_application_document (20261021000000).
export const getReplaceableRejectedDocuments = (application, documents = []) => (
  DOCUMENT_REPLACEMENT_STATUSES.includes(application?.status)
    ? getLinkedDocuments(application, documents).filter((doc) => doc.verificationStatus === 'Rejected')
    : []
);

// What can stand in for a rejected file: the types of every requirement that
// file satisfies (or its own type for a supporting file), then the student's
// non-rejected vault files of those types that the application does not
// already use. The server accepts the same type or a type sharing a requirement.
export const getReplacementOptions = ({ application, requirements = [], rejectedDocument, documents = [] }) => {
  const types = [...new Set(requirements
    .filter((requirement) => requirement.documentTypes.includes(rejectedDocument.documentType))
    .flatMap((requirement) => requirement.documentTypes))];
  const documentTypes = types.length ? types : [rejectedDocument.documentType];
  const attachedIds = application?.attachedDocuments || [];
  const candidates = getMatchingVaultDocuments({ documentTypes }, documents)
    .filter((doc) => doc.verificationStatus !== 'Rejected' && !attachedIds.includes(doc.id));
  return { documentTypes, candidates };
};

// Vault files to attach when a draft is created: the newest non-rejected file
// for each requirement, so a student who already uploaded a document does not
// attach it again.
export const pickDefaultAttachments = (requirements = [], documents = []) => {
  const picked = new Set();
  requirements.forEach((requirement) => {
    const match = getMatchingVaultDocuments(requirement, documents).find((doc) => doc.verificationStatus !== 'Rejected');
    if (match) picked.add(match.id);
  });
  return [...picked];
};

const requirementState = (attached) => {
  if (!attached.length) return 'missing';
  if (attached.some((doc) => doc.verificationStatus === 'Verified')) return 'verified';
  if (attached.every((doc) => doc.verificationStatus === 'Rejected')) return 'rejected';
  return 'attached';
};

export const REQUIREMENT_STATE_LABELS = {
  missing: { label: 'Not attached', tone: 'neutral' },
  attached: { label: 'Attached · Pending review', tone: 'warning' },
  verified: { label: 'Verified', tone: 'success' },
  rejected: { label: 'Rejected · Replace file', tone: 'danger' },
};

// The same states read against the whole Document Vault rather than one
// application's attachments, for the My Profile document checklist.
export const VAULT_REQUIREMENT_STATE_LABELS = {
  missing: { label: 'Missing', tone: 'neutral' },
  attached: { label: 'Pending', tone: 'warning' },
  verified: { label: 'Verified', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

const isOpenForApplications = (scholarship, today) => (
  isAdduInternalProgram(scholarship)
  && Boolean(scholarship.isActive)
  && getDeadlineStatus(scholarship.deadline, today).label !== 'Closed'
);

// The documents the open AdDU internal scholarships ask of this student's
// standing, so My Profile can show what to keep in the Document Vault before an
// application starts. Requirements that accept the same document types merge
// into one item, because one vault file satisfies all of them; each item names
// the scholarships that ask for it. `ready` counts items with a non-rejected
// file, the same bar getApplicationReadiness() sets for submitting.
export const getDocumentChecklist = ({ scholarships = [], profile = {}, documents = [], today = new Date() } = {}) => {
  const open = scholarships.filter((scholarship) => isOpenForApplications(scholarship, today));
  const byTypes = new Map();
  open.forEach((scholarship) => {
    getScholarshipRequirements(scholarship, profile).forEach((requirement) => {
      const key = [...requirement.documentTypes].sort().join('|');
      const entry = byTypes.get(key) || { ...requirement, key, scholarships: [] };
      if (!entry.scholarships.some((item) => item.id === scholarship.id)) {
        entry.scholarships.push({ id: scholarship.id, title: scholarship.title });
      }
      byTypes.set(key, entry);
    });
  });
  const items = [...byTypes.values()].map((entry) => {
    const files = getMatchingVaultDocuments(entry, documents);
    const notAskedBy = open
      .filter((scholarship) => !entry.scholarships.some((item) => item.id === scholarship.id))
      .map((scholarship) => ({ id: scholarship.id, title: scholarship.title }));
    return { ...entry, notAskedBy, files, state: requirementState(files), askedByAll: notAskedBy.length === 0 };
  });
  return {
    scholarships: open,
    items,
    ready: items.filter((item) => item.state === 'attached' || item.state === 'verified').length,
    total: items.length,
  };
};

// The Document Vault picker entry to preselect when the student uploads a file
// for a requirement: its first type offered as a general document (as the
// application workspace uploads it), otherwise the profile attribute whose proof
// types include it, since the vault only offers proof-only types under an attribute.
export const getRequirementUploadPreset = (requirement) => {
  const types = requirement?.documentTypes || [];
  const general = types.find((type) => generalDocumentTypeOptions.some((option) => option.value === type));
  if (general) return { attribute: '', documentType: general };
  for (const type of types) {
    const attribute = VERIFIABLE_ATTRIBUTE_OPTIONS.find((option) => option.acceptedDocumentTypes.includes(type));
    if (attribute) return { attribute: attribute.key, documentType: type };
  }
  return { attribute: '', documentType: '' };
};

// Everything the workspace, the submit handler, and the reviewers need to know
// about whether an application can be submitted. A Pending file is enough to
// submit; verification happens later at the For Verification stage.
export const getApplicationReadiness = ({ application = {}, scholarship, documents = [], profile = {}, certified = false, today = new Date() } = {}) => {
  const isInternal = Boolean(scholarship) && isAdduInternalProgram(scholarship);
  const attachedIds = new Set(application.attachedDocuments || []);
  const attachedDocuments = documents.filter((doc) => attachedIds.has(doc.id));
  const requirements = isInternal
    ? getScholarshipRequirements(scholarship, profile).map((requirement) => {
        const attached = attachedDocuments.filter((doc) => requirement.documentTypes.includes(doc.documentType));
        return { ...requirement, attached, state: requirementState(attached) };
      })
    : [];

  if (!isInternal) {
    return { route: 'external', requirements, supportingDocuments: [], attachedCount: 0, requiredCount: 0, blockers: [], ready: false };
  }
  // Optional files the student attached beyond the requirements for their
  // standing. They travel with the application but never gate submitting.
  const supportingDocuments = attachedDocuments.filter((doc) => (
    !requirements.some((requirement) => requirement.documentTypes.includes(doc.documentType))
  ));

  const blockers = [];
  const missing = requirements.filter((item) => item.state === 'missing');
  const rejected = requirements.filter((item) => item.state === 'rejected');
  if (missing.length) blockers.push(`Attach ${missing.length === 1 ? 'the required document' : `${missing.length} required documents`}: ${missing.map((item) => item.label).join('; ')}.`);
  if (rejected.length) blockers.push(`Replace the rejected file for: ${rejected.map((item) => item.label).join('; ')}.`);
  if (!String(application.statement || '').trim()) blockers.push('Write your application statement.');
  if (!certified) blockers.push('Certify that your information and documents are true and complete.');
  if (getDeadlineStatus(scholarship.deadline, today).label === 'Closed' || scholarship.isActive === false) {
    blockers.push('This scholarship is no longer accepting applications.');
  }
  const gate = evaluateApplicationGate(profile, scholarship);
  if (!gate.allowed) blockers.push(...gate.reasons.map((reason) => `Eligibility: ${reason}`));

  const attachedCount = requirements.filter((item) => item.state !== 'missing').length;
  return {
    route: 'internal',
    requirements,
    supportingDocuments,
    attachedCount,
    requiredCount: requirements.length,
    blockers,
    ready: blockers.length === 0,
  };
};

// SOP stages that may only be entered once every attached Document Vault file is
// Verified. Manuscript Section 3.3.3: an application linked to a Pending or
// Rejected document cannot proceed to interview or subcommittee evaluation, so
// the endorsement and every later stage are blocked. Rejection is always allowed.
export const ENDORSEMENT_BLOCKED_STATUSES = ['For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released'];

// Document Vault review starts at the SOP document-verification stage. Before
// that the reviewer is still deciding whether to continue the application, so
// its attached files stay out of reach. `ApplicationReviewModal` keeps the
// Documents tab locked until this is true, and `getDocumentsAwaitingReview()`
// (src/lib/admissionsOffice.js) counts only the files this unlocks so the
// Admissions Office metrics never promise work the stage does not allow.
export const areDocumentsReviewable = (status) => {
  const current = sopStageIndex(status);
  const from = sopStageIndex('For Verification');
  return current != null && from != null && current >= from;
};

// A terminal Rejected application has left the SOP pipeline, but its attached
// files stay inspectable so the recorded decision can be read back. The review
// surface gates on this; the verification queue and its metrics use
// `areDocumentsReviewable` alone, since no document decision is pending there.
export const areApplicationDocumentsVisible = (status) => (
  status === 'Rejected' || areDocumentsReviewable(status)
);

// The vault files attached to an application, resolved against the loaded
// documents. Attached ids whose document is not loaded are skipped.
export const getLinkedDocuments = (application, documents = []) => (
  (application?.attachedDocuments || [])
    .map((id) => (Array.isArray(documents) ? documents : []).find((doc) => doc.id === id))
    .filter(Boolean)
);

// The single readiness check behind the document-verification gate: every
// attached file must be Verified. The reviewer UI reads this to disable forward
// actions, and `tests/applicationRequirements.test.js` pins the behavior; the
// database repeats the rule in a trigger so a direct write cannot bypass it.
export const getDocumentVerificationReadiness = (application, documents = []) => {
  const linked = getLinkedDocuments(application, documents);
  const outstanding = linked.filter((doc) => doc.verificationStatus !== 'Verified').length;
  return {
    total: linked.length,
    verified: linked.length - outstanding,
    outstanding,
    ready: outstanding === 0,
  };
};

export const isApplicationVerifiedForEndorsement = (application, documents = []) => (
  getDocumentVerificationReadiness(application, documents).ready
);

// The actor label for an `application_status_log` row (RQ2). Staff see the
// reviewer's name when the loaded profiles directory resolves it; everyone else
// sees the recorded role, with "System" for an automated move. The role is
// humanized (the log stores `admissions_office`, `department_chair`, `student`,
// or `system`). Kept here (not in a component) so it is unit-testable.
const ACTOR_ROLE_LABELS = {
  admissions_office: 'Admissions Office Staff',
  admissions_head: 'Admissions Office Head',
  department_chair: 'Department Chair',
  student: 'Student',
  system: 'System',
};

export const describeStatusActor = (event, showName = false) => {
  if (!event) return 'Recorded automatically';
  const name = showName ? event.actorName : null;
  const roleLabel = ACTOR_ROLE_LABELS[event.actorRole]
    || String(event.actorRole || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
  return name || roleLabel || 'System';
};

// Version 2 adds the eligibility answers, background, personal, address, and
// family groups to the original nine fields. A snapshot without a version was
// submitted before those groups were recorded.
export const PROFILE_SNAPSHOT_VERSION = 2;

const asText = (value) => (value == null ? '' : String(value).trim());
const asNumberOrNull = (value) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

// The self-reported profile values sent with a submission, frozen on the
// application so the student and the reviewers see what was declared at submit
// time. Values are self-reported; the badges reflect Document Vault proof only.
// The default scholarship statement (`essay`) is left out because the
// application stores its own statement.
export const buildProfileSnapshot = (profile = {}, attributeVerifications = {}, capturedAt = new Date().toISOString()) => {
  const academic = getAcademicRequirement(profile);
  const yearStanding = deriveYearStanding(profile);
  const { isIncomingFirstYear } = getStandingRequirements(profile);
  const status = (key) => attributeVerifications[key] || UNSET_ATTRIBUTE_STATUS;
  const proven = (key) => ({ value: asText(profile[key]), verification: status(key) });
  const family = profile.familyDetails && typeof profile.familyDetails === 'object' ? profile.familyDetails : {};
  return {
    version: PROFILE_SNAPSHOT_VERSION,
    capturedAt,
    fullName: profile.fullName || '',
    studentNumber: profile.studentNumber || '',
    degreeProgram: profile.degreeProgram || '',
    department: profile.department || '',
    yearStanding,
    yearStandingLabel: yearStandingOptions.find((option) => option.value === yearStanding)?.label || '',
    academic: {
      credential: academic.credential,
      label: academic.label,
      value: academic.value,
      verification: status(academic.credential),
    },
    householdIncome: { value: profile.householdIncome === '' || profile.householdIncome == null ? null : Number(profile.householdIncome), verification: status('householdIncome') },
    citizenship: { value: profile.citizenship || '', verification: status('citizenship') },
    // The answers the application gate and the Exclusion Flag Hierarchy read.
    eligibility: {
      academicStanding: proven('academicStanding'),
      honorsRank: proven('honorsRank'),
      graduatingClassSize: asNumberOrNull(profile.graduatingClassSize),
      isOnPrepaidPlan: Boolean(profile.isOnPrepaidPlan),
      hasSiblingOnAid: Boolean(profile.hasSiblingOnAid),
      hasOtherActiveScholarship: Boolean(profile.hasOtherActiveScholarship),
      ...(isIncomingFirstYear ? {
        hsStrand: asText(profile.hsStrand),
        programChoices: [asText(profile.programChoice2), asText(profile.programChoice3)],
      } : {}),
    },
    background: {
      ipCommunity: proven('ipCommunity'),
      pwd: proven('pwd'),
      employed: proven('employed'),
    },
    personal: {
      civilStatus: asText(profile.civilStatus),
      religion: asText(profile.religion),
    },
    address: {
      completeAddress: asText(profile.completeAddress),
      residingAddress: asText(profile.sameAsCompleteAddress ? profile.completeAddress : profile.residingAddress),
      country: asText(profile.country),
    },
    family: {
      fatherName: asText(family.fatherName),
      fatherOccupation: asText(family.fatherOccupation),
      fatherDeceased: Boolean(family.fatherDeceased),
      motherName: asText(family.motherName),
      motherOccupation: asText(family.motherOccupation),
      motherDeceased: Boolean(family.motherDeceased),
      familyPosition: asText(family.familyPosition),
      numberOfSiblings: asNumberOrNull(family.numberOfSiblings),
    },
  };
};

// The academic figure a staff queue row shows. An incoming first-year was
// matched on the senior high school general average frozen at submit, so it
// shows that instead of an empty QPI; everyone else keeps the current QPI.
export const describeApplicantAcademic = (application = {}) => {
  const academic = application.profileSnapshot?.academic;
  if (academic?.credential === 'hsAverage') return `SHS average ${academic.value ?? '—'}`;
  return `QPI ${application.studentQpi ?? '—'}`;
};

const optionLabel = (options, value) => options.find((option) => option.value === (value || ''))?.label || value || '';
const yesNo = (value) => (value ? 'Yes' : 'No');
const attributeLabel = (key) => getVerifiableAttributeOption(key)?.label || key;
const formatParent = (name, occupation, deceased) => [name, occupation, deceased ? 'Deceased' : ''].filter(Boolean).join(' · ');

// The snapshot as labelled, display-ready rows, grouped the way My Profile
// groups them. The application workspace, the student's application view, the
// staff review modal, and the exported report all read this one list, so the
// student and the reviewers see the same values. `legacy` marks a snapshot
// submitted before the extended groups were recorded.
export const getProfileSnapshotSections = (snapshot) => {
  if (!snapshot) return { legacy: false, sections: [] };
  const row = (label, value, verification) => ({ label, value: value == null ? '' : String(value), ...(verification ? { verification } : {}) });
  const academic = snapshot.academic || {};
  const academicValue = academic.value == null ? '' : (academic.credential === 'qpi' ? Number(academic.value).toFixed(2) : String(academic.value));
  const sections = [{
    key: 'application',
    title: 'Needed to apply',
    rows: [
      row('Name', snapshot.fullName),
      ...(snapshot.studentNumber ? [row('Student number', snapshot.studentNumber)] : []),
      row('Program', snapshot.degreeProgram),
      row('Year standing', snapshot.yearStandingLabel),
      row(academic.label || 'Academic record', academicValue, academic.verification),
      row('Household income', snapshot.householdIncome?.value == null ? '' : fmtCurrency(snapshot.householdIncome.value), snapshot.householdIncome?.verification),
      row('Citizenship', snapshot.citizenship?.value, snapshot.citizenship?.verification),
    ],
  }];
  if (!snapshot.version) return { legacy: true, sections };

  const eligibility = snapshot.eligibility || {};
  const background = snapshot.background || {};
  const personal = snapshot.personal || {};
  const address = snapshot.address || {};
  const family = snapshot.family || {};
  const proven = (key, entry, options) => row(attributeLabel(key), optionLabel(options, entry?.value), entry?.verification);
  sections.push(
    {
      key: 'eligibility',
      title: 'Eligibility answers',
      rows: [
        proven('academicStanding', eligibility.academicStanding, academicStandingOptions),
        ...(Object.prototype.hasOwnProperty.call(eligibility, 'hsStrand') ? [row('Senior high school strand', eligibility.hsStrand)] : []),
        ...(Array.isArray(eligibility.programChoices) ? [
          row('2nd choice program', eligibility.programChoices[0]),
          row('3rd choice program', eligibility.programChoices[1]),
        ] : []),
        proven('honorsRank', eligibility.honorsRank, honorsRankOptions),
        row('Graduating class size', eligibility.graduatingClassSize),
        row('Prepaid tuition plan', yesNo(eligibility.isOnPrepaidPlan)),
        row('Sibling on AdDU financial aid', yesNo(eligibility.hasSiblingOnAid)),
        row('Another active scholarship', yesNo(eligibility.hasOtherActiveScholarship)),
      ],
    },
    {
      key: 'background',
      title: 'Background',
      rows: [
        proven('ipCommunity', background.ipCommunity, ipCommunityOptions),
        proven('pwd', background.pwd, pwdOptions),
        proven('employed', background.employed, employmentOptions),
      ],
    },
    {
      key: 'personal',
      title: 'Personal and address',
      rows: [
        row('Civil status', optionLabel(civilStatusOptions, personal.civilStatus)),
        row('Religion', optionLabel(religionOptions, personal.religion)),
        row('Complete address', address.completeAddress),
        row('Residing address', address.residingAddress),
        row('Country', address.country),
      ],
    },
    {
      key: 'family',
      title: 'Family',
      rows: [
        row('Father', formatParent(family.fatherName, family.fatherOccupation, family.fatherDeceased)),
        row('Mother', formatParent(family.motherName, family.motherOccupation, family.motherDeceased)),
        row('Family position', optionLabel(familyPositionOptions, family.familyPosition)),
        row('Number of siblings', family.numberOfSiblings),
      ],
    },
  );
  return { legacy: false, sections };
};
