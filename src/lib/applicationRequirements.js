import { generalDocumentTypeOptions, getDocumentTypeLabel } from './constants';
import { evaluateApplicationGate, getAcademicRequirement, getDeadlineStatus, isInternalScholarship } from './eligibility';
import { VERIFIABLE_ATTRIBUTE_OPTIONS, deriveYearStanding, getStandingRequirements, yearStandingOptions } from './profile';
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
const GOOD_MORAL = { id: 'good-moral', label: 'Certificate of Good Moral Character', documentTypes: ['Good Moral Character'], standing: 'all' };
const INCOME_PROOF = { id: 'income-proof', label: 'Financial income documents of parents / legal guardians', documentTypes: ['Income Proof', 'Certificate of Indigency'], standing: 'all' };
const HS_REPORT_CARD = { id: 'hs-report-card', label: 'Senior high school report card', documentTypes: ['HS Report Card'], standing: 'incoming' };
const COLLEGE_GRADES = { id: 'college-grades', label: 'Latest grade report or transcript', documentTypes: ['Grade Report', 'Transcript'], standing: 'continuing' };

export const DEFAULT_REQUIRED_DOCUMENTS = {
  'general-pool': [
    APPLICATION_FORM,
    { id: 'entrance-exam', label: 'Entrance exam result with ACCEPTED remark', documentTypes: ['Entrance Exam Result'], standing: 'incoming' },
    { ...HS_REPORT_CARD, label: 'Senior high school report card with at least 85% average' },
    COLLEGE_GRADES,
    { id: 'recommendation', label: 'Recommendation from Homeroom Moderator', documentTypes: ['Recommendation Letter'], standing: 'incoming' },
    INCOME_PROOF,
    { id: 'residence-photos', label: 'Photos of residence', documentTypes: ['Photos of Residence'], standing: 'all' },
    GOOD_MORAL,
  ],
  honors: [
    APPLICATION_FORM,
    { id: 'certificate-of-award', label: 'Certificate of Award as Rank 1 or 2', documentTypes: ['Certificate of Award'], standing: 'all' },
    HS_REPORT_CARD,
    COLLEGE_GRADES,
    GOOD_MORAL,
  ],
  'work-study': [
    APPLICATION_FORM,
    INCOME_PROOF,
    HS_REPORT_CARD,
    COLLEGE_GRADES,
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
  if (!isInternalScholarship(scholarship)) return [];
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
  isInternalScholarship(scholarship)
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
  const isInternal = Boolean(scholarship) && isInternalScholarship(scholarship);
  const attachedIds = new Set(application.attachedDocuments || []);
  const attachedDocuments = documents.filter((doc) => attachedIds.has(doc.id));
  const requirements = isInternal
    ? getScholarshipRequirements(scholarship, profile).map((requirement) => {
        const attached = attachedDocuments.filter((doc) => requirement.documentTypes.includes(doc.documentType));
        return { ...requirement, attached, state: requirementState(attached) };
      })
    : [];

  if (!isInternal) {
    return { route: 'external', requirements, attachedCount: 0, requiredCount: 0, blockers: [], ready: false };
  }

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
    attachedCount,
    requiredCount: requirements.length,
    blockers,
    ready: blockers.length === 0,
  };
};

// The self-reported profile values sent with a submission, frozen on the
// application so reviewers see what the student declared at submit time. Values
// are self-reported; the badges reflect Document Vault proof only.
export const buildProfileSnapshot = (profile = {}, attributeVerifications = {}, capturedAt = new Date().toISOString()) => {
  const academic = getAcademicRequirement(profile);
  const yearStanding = deriveYearStanding(profile);
  const status = (key) => attributeVerifications[key] || UNSET_ATTRIBUTE_STATUS;
  return {
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
  };
};
