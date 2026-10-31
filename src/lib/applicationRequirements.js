import { DOCUMENT_REPLACEMENT_STATUSES, generalDocumentTypeOptions, getDocumentTypeLabel, sopStageIndex } from './constants';
import { evaluateApplicationGate, getAcademicRequirement, getDeadlineStatus, isAdduInternalProgram } from './eligibility';
import { fmtCurrency, fmtDate } from './formatters';
import { getFinancialAnswersMissing } from './financialDetails';
import {
  VERIFIABLE_ATTRIBUTE_KEYS,
  academicStandingOptions,
  civilStatusOptions,
  composeFullName,
  deriveYearStanding,
  employmentOptions,
  familyPositionOptions,
  grantLevelOptions,
  grantStatusOptions,
  grantTypeOptions,
  housingTypeOptions,
  sexAtBirthOptions,
  siblingStatusOptions,
  getApplicantStatusLabel,
  getApplicationProfileGate,
  getAttributeValue,
  getClaimedAttributes,
  getProvenAttributes,
  getShsFinancialAid,
  getStandingRequirements,
  getVerifiableAttributeOption,
  getYearStandingLabel,
  honorsRankOptions,
  ipCommunityOptions,
  isProofRequired,
  isTransfereeProfile,
  pwdOptions,
  religionOptions,
} from './profile';
import {
  UNSET_ATTRIBUTE_STATUS,
  deriveAttributeVerifications,
  getDocumentLinkedAttributes,
  getProofStaleReason,
} from './verification';

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

// The application itself is filled in the system (profile, financial situation,
// statement). Two pages cannot be captured there and stay on paper: the Punong
// Barangay certifies the residence photos and the applicant and parents sign the
// affidavit of agreement. Both are printed from the application (Print
// application form), signed, and uploaded. Mirrors 20261036000000.
const BARANGAY_CERTIFICATION = { id: 'barangay-residence-certification', label: 'Barangay certification of residence (signed by the Punong Barangay)', documentTypes: ['Barangay Residence Certification'], standing: 'all' };
const SIGNED_AFFIDAVIT = { id: 'signed-affidavit', label: 'Signed affidavit of agreement (applicant and parents)', documentTypes: ['Signed Affidavit of Agreement'], standing: 'all' };
const APPLICANT_PHOTO = { id: 'applicant-photo', label: 'Recent 2x2 ID photo of the applicant', documentTypes: ['Applicant Photo'], standing: 'all' };
const RESIDENCE_PHOTOS = { id: 'residence-photos', label: 'Photos of residence', documentTypes: ['Photos of Residence'], standing: 'all' };
const GOOD_MORAL = { id: 'good-moral', label: 'Certificate of Good Moral Character', documentTypes: ['Good Moral Character'], standing: 'all' };
const INCOME_PROOF = { id: 'income-proof', label: 'Financial income documents of parents / legal guardians', documentTypes: ['Income Proof', 'Certificate of Indigency'], standing: 'all' };
const HS_REPORT_CARD = { id: 'hs-report-card', label: 'Senior high school report card', documentTypes: ['HS Report Card'], standing: 'incoming' };
const COLLEGE_GRADES = { id: 'college-grades', label: 'Latest grade report or transcript', documentTypes: ['Grade Report', 'Transcript'], standing: 'continuing' };
// Every program's eligibility checks Filipino citizenship (the universal gate in
// src/lib/eligibility.js), so every in-scope track asks for proof of it.
const CITIZENSHIP_PROOF = { id: 'citizenship-proof', label: 'Proof of Filipino citizenship', documentTypes: ['PSA Birth Certificate', 'Philippine National ID', "Driver's License", 'Passport'], standing: 'all' };
// The address and family answers are verified like the academic and background
// ones (VERIFIABLE_ATTRIBUTE_OPTIONS in src/lib/profile.js), so every in-scope
// track asks for their proof. One barangay certificate of residency answers both
// rows, and a PSA birth certificate answers the family row and the citizenship
// row at once, so a student uploads at most two files for the four answers.
const ADDRESS_PROOF = { id: 'address-proof', label: 'Proof of address (utility bill or barangay certificate of residency)', documentTypes: ['Proof of Billing', 'Certificate of Residency'], standing: 'all' };
const FAMILY_PROOF = { id: 'family-proof', label: 'Proof of family details (PSA birth certificate or barangay certificate of residency)', documentTypes: ['PSA Birth Certificate', 'Certificate of Residency'], standing: 'all' };

// Every in-scope track asks for a recent photo of the applicant and photos of
// their residence. Both are ordinary Document Vault files, so the Admissions
// Office verifies them like any other required submission; a student can take
// them with the camera or upload an existing photo (src/lib/photoGuide.js).
// Proof of citizenship is backfilled by
// 20261028000000_require_current_attribute_proofs.sql.
export const DEFAULT_REQUIRED_DOCUMENTS = {
  'general-pool': [
    APPLICANT_PHOTO,
    CITIZENSHIP_PROOF,
    ADDRESS_PROOF,
    FAMILY_PROOF,
    { id: 'entrance-exam', label: 'Entrance exam result with ACCEPTED remark', documentTypes: ['Entrance Exam Result'], standing: 'incoming' },
    { ...HS_REPORT_CARD, label: 'Senior high school report card with at least 85% average' },
    COLLEGE_GRADES,
    { id: 'recommendation', label: 'Recommendation from Homeroom Moderator', documentTypes: ['Recommendation Letter'], standing: 'incoming' },
    INCOME_PROOF,
    RESIDENCE_PHOTOS,
    GOOD_MORAL,
    BARANGAY_CERTIFICATION,
    SIGNED_AFFIDAVIT,
  ],
  honors: [
    APPLICANT_PHOTO,
    CITIZENSHIP_PROOF,
    ADDRESS_PROOF,
    FAMILY_PROOF,
    { id: 'certificate-of-award', label: 'Certificate of Award as Rank 1 or 2', documentTypes: ['Certificate of Award'], standing: 'all' },
    HS_REPORT_CARD,
    COLLEGE_GRADES,
    RESIDENCE_PHOTOS,
    GOOD_MORAL,
    BARANGAY_CERTIFICATION,
    SIGNED_AFFIDAVIT,
  ],
  'work-study': [
    APPLICANT_PHOTO,
    CITIZENSHIP_PROOF,
    ADDRESS_PROOF,
    FAMILY_PROOF,
    INCOME_PROOF,
    HS_REPORT_CARD,
    COLLEGE_GRADES,
    RESIDENCE_PHOTOS,
    GOOD_MORAL,
    BARANGAY_CERTIFICATION,
    SIGNED_AFFIDAVIT,
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

// The profile answers a requirement proves for this student: every attribute
// its accepted types prove (getProvenAttributes) whose current answer needs
// proof. A file attached for the requirement must be a current proof of each.
export const getRequirementProvenAttributes = (documentTypes = [], profile = {}) => (
  [...new Set(documentTypes.flatMap((type) => getProvenAttributes(type, profile)))]
    .filter((key) => isProofRequired(key, profile))
);

// One requirement row per claim the student's answers make (IP community "Yes",
// PWD "Yes", employed, honors) that no catalog requirement already proves, so a
// claim shared in the profile snapshot always travels with its proof. Answering
// "No" removes the row.
export const getClaimProofRequirements = (profile = {}, covered = []) => (
  getClaimedAttributes(profile)
    .filter((key) => !covered.includes(key))
    .map((key) => {
      const option = getVerifiableAttributeOption(key);
      return {
        id: `proof-${key}`,
        label: option.claimLabel,
        documentTypes: [...option.acceptedDocumentTypes],
        standing: 'all',
        claim: true,
        note: `Required because of your ${option.label} answer in your Application Form. Change the answer there if it does not apply.`,
        proves: [key],
      };
    })
);

// The requirements that apply to this student's standing, each with the
// profile answers it proves, followed by the claim rows. An unset standing
// lists only the items every applicant needs; the readiness check asks the
// student to set it before anything is submitted. External and
// government-linked entries are tracked only, so they ask for nothing here.
export const getScholarshipRequirements = (scholarship = {}, profile = {}) => {
  const catalog = getCatalogRequirements(scholarship);
  if (!catalog.length) return [];
  const standing = getStandingRequirements(profile);
  const isIncoming = standing.isIncomingFirstYear;
  const items = catalog
    .filter((item) => (
      item.standing === 'all'
      || (standing.yearStanding && (item.standing === 'incoming' ? isIncoming : !isIncoming))
    ))
    .map((item) => ({ ...item, proves: getRequirementProvenAttributes(item.documentTypes, profile) }));
  const covered = items.flatMap((item) => item.proves);
  return [...items, ...getClaimProofRequirements(profile, covered)];
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

// Vault files to attach when a draft is created: for each requirement, the
// newest non-rejected file that is still a current proof of the answers it
// proves (else the newest non-rejected file, which the workspace then flags as
// outdated), so a student who already uploaded a document does not attach it
// again.
export const pickDefaultAttachments = (requirements = [], documents = [], { profile = null, today = new Date() } = {}) => {
  const picked = new Set();
  requirements.forEach((requirement) => {
    const candidates = getMatchingVaultDocuments(requirement, documents).filter((doc) => doc.verificationStatus !== 'Rejected');
    const match = candidates.find((doc) => !getStaleProofKeys(doc, requirement.proves || [], { profile, now: today }).length) || candidates[0];
    if (match) picked.add(match.id);
  });
  return [...picked];
};

// The answers in `proves` that a file no longer proves, each with its stale
// reason: the declared value changed after upload or, for an annual attribute,
// the file is from an earlier academic year.
const getStaleProofKeys = (doc, proves = [], { profile = null, now = new Date() } = {}) => (
  getDocumentLinkedAttributes(doc, profile)
    .filter((key) => proves.includes(key))
    .map((key) => ({ key, reason: getProofStaleReason(doc, key, { profile, now }) }))
    .filter((entry) => entry.reason)
);

const requirementState = (attached, { proves = [], profile = null, now = new Date() } = {}) => {
  if (!attached.length) return 'missing';
  const usable = attached.filter((doc) => doc.verificationStatus !== 'Rejected');
  if (!usable.length) return 'rejected';
  const current = usable.filter((doc) => !getStaleProofKeys(doc, proves, { profile, now }).length);
  if (!current.length) return 'outdated';
  if (current.some((doc) => doc.verificationStatus === 'Verified')) return 'verified';
  return 'attached';
};

export const REQUIREMENT_STATE_LABELS = {
  missing: { label: 'Not attached', tone: 'neutral' },
  attached: { label: 'Attached · Pending review', tone: 'warning' },
  verified: { label: 'Verified', tone: 'success' },
  rejected: { label: 'Reverted · Upload a replacement', tone: 'danger' },
  outdated: { label: 'Outdated · Upload a current proof', tone: 'danger' },
};

// The same states read against the whole Document Vault rather than one
// application's attachments, for the My Profile document checklist. The stored
// document decision is `Rejected`; the label says what the student has to do.
export const VAULT_REQUIREMENT_STATE_LABELS = {
  missing: { label: 'Missing', tone: 'neutral' },
  attached: { label: 'Pending', tone: 'warning' },
  verified: { label: 'Verified', tone: 'success' },
  rejected: { label: 'Reverted · Upload a replacement', tone: 'danger' },
  outdated: { label: 'Outdated', tone: 'danger' },
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
    return { ...entry, notAskedBy, files, state: requirementState(files, { proves: entry.proves, profile, now: today }), askedByAll: notAskedBy.length === 0 };
  });
  return {
    scholarships: open,
    items,
    ready: items.filter((item) => item.state === 'attached' || item.state === 'verified').length,
    total: items.length,
  };
};

// The Document Vault picker entry to preselect when the student uploads a file
// for a requirement: its first type the vault offers for this standing, under the
// attribute it proves (a proving type is listed only under its attribute), or as
// a general document when it proves nothing.
export const getRequirementUploadPreset = (requirement, profile = null) => {
  const types = requirement?.documentTypes || [];
  for (const type of types) {
    const attribute = getProvenAttributes(type, profile)[0];
    if (attribute) return { attribute, documentType: type };
    if (generalDocumentTypeOptions.some((option) => option.value === type)) return { attribute: '', documentType: type };
  }
  return { attribute: '', documentType: '' };
};

// The profile values frozen in a submitted application's snapshot, shaped like a
// profile so the proof checks can read them. Only the answers the snapshot
// recorded are present, so an older snapshot never reads a missing answer as a
// change.
export const snapshotToProfile = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const profile = { yearStanding: snapshot.yearStanding || '' };
  const academic = snapshot.academic || {};
  if (academic.credential) profile[academic.credential] = academic.value ?? '';
  if (snapshot.householdIncome) profile.householdIncome = snapshot.householdIncome.value ?? '';
  if (snapshot.citizenship) profile.citizenship = snapshot.citizenship.value || '';
  // The frozen address and family answers, so the address and family proofs are
  // judged against what the application declared. The snapshot stores the residing
  // address already resolved (the same-as toggle applied), so it is restored with
  // the toggle off to keep getAttributeValue() reading that stored value.
  const address = snapshot.address || {};
  if (address.completeAddress != null) profile.completeAddress = address.completeAddress;
  if (address.residingAddress != null) {
    profile.residingAddress = address.residingAddress;
    profile.sameAsCompleteAddress = false;
  }
  if (snapshot.family) profile.familyDetails = snapshot.family;
  const proven = { ...(snapshot.eligibility || {}), ...(snapshot.background || {}) };
  ['academicStanding', 'honorsRank', 'ipCommunity', 'pwd', 'employed'].forEach((key) => {
    if (proven[key] && typeof proven[key] === 'object') profile[key] = proven[key].value || '';
  });
  return profile;
};

// The profile and the date a submitted application's proofs are judged
// against: the frozen snapshot at the moment of submission, so a later profile
// edit or a new academic year never flags a file the student can no longer
// change. A draft (or a submission without a snapshot) uses the live profile.
const getProofContext = (application = {}, profile = {}, today = new Date()) => {
  const isDraft = !application.status || application.status === 'Draft';
  const frozen = isDraft ? null : snapshotToProfile(application.profileSnapshot);
  if (!frozen) return { profile, now: today, frozen: false };
  const submittedAt = application.certifiedAt || application.profileSnapshot?.capturedAt || application.submittedAt;
  const now = submittedAt && !Number.isNaN(new Date(submittedAt).getTime()) ? new Date(submittedAt) : today;
  return { profile: frozen, now, frozen: true };
};

// The stale reason for one proof on one application, judged the same way the
// readiness check judges it (getProofContext): a submitted application is read
// against its frozen snapshot, a draft against the live profile.
export const getApplicationProofStaleReason = (doc, key, application = {}, profile = {}, today = new Date()) => {
  const context = getProofContext(application, profile, today);
  return getProofStaleReason(doc, key, { profile: context.profile, now: context.now });
};

// The attribute badges for an application, derived only from the files it
// attaches, so the snapshot never shows Verified on the strength of a vault
// file the reviewers do not receive.
export const getApplicationAttributeVerifications = (application, documents = [], profile = {}) => (
  deriveAttributeVerifications(getLinkedDocuments(application, documents), VERIFIABLE_ATTRIBUTE_KEYS, { profile })
);

// The same badges, read at the moment the reviewer looks at the case. A verified
// file must not keep reading Unverified on the Overview just because the badge was
// frozen before the Admissions Office recorded the decision, so this derivation
// reads the attached files' current verification status. The frozen snapshot stays
// the record of what the student saw at submission (Profile snapshot tab and the
// exports); it cannot report a decision made afterwards. Files are still limited to
// the ones the application attaches, and getProofContext keeps the frozen values and
// the submission date as the comparison point, so a later profile edit or a new
// academic year never turns an attached proof Outdated on a case the student can no
// longer change. A submitted case without a snapshot, or a draft, uses `profile`.
export const getApplicationLiveAttributeVerifications = (application, documents = [], { profile = {}, today = new Date() } = {}) => {
  const context = getProofContext(application, profile, today);
  return deriveAttributeVerifications(getLinkedDocuments(application, documents), VERIFIABLE_ATTRIBUTE_KEYS, {
    profile: context.profile,
    now: context.now,
  });
};

// The snapshot with each badge replaced by its live value, for the staff review
// surface. A badge frozen at submit reads Pending forever, because the Admissions
// Office decides the files afterwards; the values stay the frozen ones. An answer
// the live derivation has no entry for keeps its frozen badge.
export const applyLiveVerificationsToSnapshot = (snapshot, live) => {
  if (!snapshot || !live) return snapshot;
  const swap = (entry, key) => (entry && live[key] ? { ...entry, verification: live[key] } : entry);
  const swapMap = (map) => (map ? Object.fromEntries(Object.entries(map).map(([key, badge]) => [key, live[key] || badge])) : map);
  const { academic, householdIncome, citizenship, eligibility, background, address, family } = snapshot;
  return {
    ...snapshot,
    ...(academic ? { academic: swap(academic, academic.credential) } : {}),
    ...(householdIncome ? { householdIncome: swap(householdIncome, 'householdIncome') } : {}),
    ...(citizenship ? { citizenship: swap(citizenship, 'citizenship') } : {}),
    ...(eligibility ? { eligibility: { ...eligibility, academicStanding: swap(eligibility.academicStanding, 'academicStanding'), honorsRank: swap(eligibility.honorsRank, 'honorsRank') } } : {}),
    ...(background ? { background: { ...background, ipCommunity: swap(background.ipCommunity, 'ipCommunity'), pwd: swap(background.pwd, 'pwd'), employed: swap(background.employed, 'employed') } } : {}),
    ...(address ? { address: { ...address, ...(address.verification ? { verification: swapMap(address.verification) } : {}) } } : {}),
    ...(family ? { family: { ...family, ...(family.verification ? { verification: swapMap(family.verification) } : {}) } } : {}),
  };
};

// A declared or attested answer, phrased for the student and the reviewers.
const PROOF_VALUE_OPTIONS = {
  academicStanding: () => academicStandingOptions,
  employed: () => employmentOptions,
  honorsRank: () => honorsRankOptions,
  ipCommunity: () => ipCommunityOptions,
  pwd: () => pwdOptions,
};
export const formatProofValue = (key, value) => {
  if (value == null || value === '') return 'blank';
  if (key === 'householdIncome') return fmtCurrency(Number(value));
  if (key === 'qpi') return Number(value).toFixed(2);
  const options = PROOF_VALUE_OPTIONS[key]?.();
  return options ? optionLabel(options, value) : String(value);
};

const hasOwnKey = (source, key) => Boolean(source) && typeof source === 'object' && Object.prototype.hasOwnProperty.call(source, key);

// The declared value of one answer in a reference profile, read the way the
// attribute is resolved (a nested family answer, or the toggle-driven residing
// address). `has` separates "not recorded" from "recorded as blank", so a frozen
// snapshot from before an answer was captured is never reported as a mismatch.
const readDeclaredValue = (key, reference) => {
  const option = getVerifiableAttributeOption(key);
  if (option?.value) {
    const value = getAttributeValue(key, reference);
    return { has: value !== undefined && value !== null, value: value ?? null };
  }
  const has = hasOwnKey(reference, key);
  return { has, value: has ? reference[key] : null };
};

// What one attached file proves, for the reviewer pane and the verification
// dialog: each answer with the value the file was uploaded to prove and the
// value the application declared (the frozen snapshot, or the owner's current
// QPI and income for a submission without one), and whether they disagree. A
// staff member verifying the file is confirming those values, so a mismatch is
// shown before the decision is recorded.
export const getDocumentProofReview = (doc, application = {}, { owner = null, today = new Date() } = {}) => {
  const context = getProofContext(application || {}, {}, today);
  const frozen = context.frozen ? context.profile : null;
  const fallback = {};
  const qpi = owner?.qpi ?? application?.studentQpi;
  const income = owner?.householdIncome ?? application?.studentHouseholdIncome;
  if (qpi != null && qpi !== '') fallback.qpi = qpi;
  if (income != null && income !== '') fallback.householdIncome = income;
  const reference = { ...fallback, ...(frozen || {}) };
  return getDocumentLinkedAttributes(doc, frozen).map((key) => {
    const hasAttested = hasOwnKey(doc?.attestedValues, key);
    const declared = readDeclaredValue(key, reference);
    const fromSnapshot = Boolean(frozen) && (hasOwnKey(frozen, key) || Boolean(getVerifiableAttributeOption(key)?.value));
    return {
      key,
      label: getVerifiableAttributeOption(key)?.label || key,
      hasAttested,
      attested: hasAttested ? doc.attestedValues[key] : null,
      hasDeclared: declared.has,
      declared: declared.value,
      source: fromSnapshot ? 'snapshot' : declared.has ? 'profile' : null,
      staleReason: getProofStaleReason(doc, key, { profile: reference, now: context.now }),
    };
  });
};

// A declared value inside one sentence: an address can run to hundreds of
// characters, so the blocker keeps to one readable line.
const shortProofValue = (text) => {
  const value = String(text ?? '');
  return value.length > 80 ? `${value.slice(0, 77)}…` : value;
};

// Why an outdated requirement's attached file no longer counts, phrased for the
// student with the value their profile now holds.
const describeOutdatedRequirement = (requirement, { profile, now }) => {
  const stale = requirement.attached
    .filter((doc) => doc.verificationStatus !== 'Rejected')
    .flatMap((doc) => getStaleProofKeys(doc, requirement.proves, { profile, now }))[0];
  if (!stale) return `Upload a current proof for: ${requirement.label}.`;
  const label = getVerifiableAttributeOption(stale.key)?.label || stale.key;
  return stale.reason === 'year'
    ? `Upload a current proof for ${requirement.label}: the attached file is from an earlier academic year.`
    : `Upload a current proof for ${requirement.label}: your ${label} in your Application Form is now ${shortProofValue(formatProofValue(stale.key, getAttributeValue(stale.key, profile)))}, which the attached file was not uploaded to prove.`;
};

// Everything the workspace, the submit handler, and the reviewers need to know
// about whether an application can be submitted. A Pending file is enough to
// submit; verification happens later at the For Verification stage. A file that
// proves a profile answer must be a current proof of it (not Outdated), and the
// profile must be complete. A submitted application is read against its frozen
// snapshot (getProofContext), so the reviewers see the standing and values that
// were declared.
export const getApplicationReadiness = ({ application = {}, scholarship, documents = [], profile = {}, financialAnswers, certified = false, today = new Date() } = {}) => {
  const isInternal = Boolean(scholarship) && isAdduInternalProgram(scholarship);
  const attachedIds = new Set(application.attachedDocuments || []);
  const attachedDocuments = documents.filter((doc) => attachedIds.has(doc.id));
  const proofContext = getProofContext(application, profile, today);
  const requirementProfile = proofContext.frozen ? proofContext.profile : profile;
  const requirements = isInternal
    ? getScholarshipRequirements(scholarship, requirementProfile).map((requirement) => {
        const attached = attachedDocuments.filter((doc) => requirement.documentTypes.includes(doc.documentType));
        return { ...requirement, attached, state: requirementState(attached, { proves: requirement.proves, profile: proofContext.profile, now: proofContext.now }) };
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
  if (!getStandingRequirements(requirementProfile).yearStanding) {
    blockers.push('Set your year standing in your Application Form so the documents for your standing can be listed.');
  }
  const profileGate = getApplicationProfileGate(profile, { verb: 'submitting' });
  if (!proofContext.frozen && !profileGate.allowed) blockers.push(...profileGate.reasons);
  const missing = requirements.filter((item) => item.state === 'missing');
  const rejected = requirements.filter((item) => item.state === 'rejected');
  const outdated = requirements.filter((item) => item.state === 'outdated');
  if (missing.length) blockers.push(`Attach ${missing.length === 1 ? 'the required document' : `${missing.length} required documents`}: ${missing.map((item) => item.label).join('; ')}.`);
  if (rejected.length) blockers.push(`Upload a replacement for the reverted file: ${rejected.map((item) => item.label).join('; ')}.`);
  outdated.forEach((item) => blockers.push(describeOutdatedRequirement(item, proofContext)));
  // FORM 230-SCH time-sensitive answers (office-only). A submitted application
  // already froze them, so only a Draft is held to the step.
  if (!proofContext.frozen) {
    const financialMissing = getFinancialAnswersMissing(financialAnswers);
    if (financialMissing.length) blockers.push(`Complete the financial situation step: ${financialMissing.join('; ')}.`);
  }
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
export const ENDORSEMENT_STAGE_STATUSES = ['For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released'];
export const ENDORSEMENT_BLOCKED_STATUSES = ENDORSEMENT_STAGE_STATUSES;

// SOP step 4 (endorsement) starts when the Admissions Office Staff hand the case
// to the Admin for the endorsement decision. Until `For Endorsement` the stage has
// not begun, so the review surface keeps its Endorsement tab hidden instead of
// restating the action bar; the tab stays readable through the later stages.
export const areEndorsementRecordsVisible = (status) => ENDORSEMENT_STAGE_STATUSES.includes(status);

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

// The applicant's 2x2 ID photo is a Document Vault requirement on every in-scope
// track, and the profile snapshot view leads with it so a reviewer can put a face
// to the application at a glance. It is read from the file the application
// currently attaches rather than a copy frozen into the snapshot JSON, so a
// replacement before endorsement shows the newer photo. A rejected file is
// returned only when it is all the application has, so the badge explains why
// the photo cannot be accepted.
export const getApplicantPhotoDocument = (application, documents = []) => {
  const photos = getLinkedDocuments(application, documents)
    .filter((doc) => doc.documentType === 'Applicant Photo')
    .sort(byNewest);
  return photos.find((doc) => doc.verificationStatus !== 'Rejected') || photos[0] || null;
};

// The photos of the residence the application attaches, oldest first so the
// printout reads in the order the student took them. Reverted files are left out.
export const getResidencePhotoDocuments = (application, documents = []) => (
  getLinkedDocuments(application, documents)
    .filter((doc) => doc.documentType === 'Photos of Residence' && doc.verificationStatus !== 'Rejected')
    .sort((left, right) => -byNewest(left, right))
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
  admissions_admin: 'Admissions Office Admin',
  dean: 'Dean',
  assistant_dean: 'Assistant Dean',
  department_chair: 'Department Chair',
  interviewer: 'Interviewer',
  student: 'Student',
  system: 'System',
};

export const getActorRoleLabel = (role) => ACTOR_ROLE_LABELS[role]
  || String(role || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());

export const describeStatusActor = (event, showName = false) => {
  if (!event) return 'Recorded automatically';
  const name = showName ? event.actorName : null;
  return name || getActorRoleLabel(event.actorRole) || 'System';
};


// The current Document Vault review decision, phrased once so the reviewer pane,
// the Department Chair's read-only pane, the student's Document Vault card, and
// the student's application details cannot describe the same decision
// differently. The date and the reviewing account are stamped by the database
// trigger (20261027000000_add_document_decision_actor.sql), never sent by the
// client. Staff see the reviewer's name when the directory resolves it; a
// student sees the role only, exactly like describeStatusActor. A file decided
// before that migration keeps its status and reads as recorded without reviewer
// details rather than implying a date.
export const describeDocumentDecision = (doc, { showName = false } = {}) => {
  if (!doc) return 'No review decision recorded.';
  const status = doc.verificationStatus;
  if (!status || status === 'Pending') return 'Awaiting review — no decision recorded yet.';
  const verb = status === 'Rejected' ? 'Reverted for resubmission' : 'Verified';
  if (!doc.decidedAt && !doc.reviewedBy && !doc.reviewedByRole) {
    return `${verb} · recorded before reviewer details were kept.`;
  }
  const roleLabel = getActorRoleLabel(doc.reviewedByRole) || 'Admissions Office';
  const actor = showName && doc.reviewedByName ? `${doc.reviewedByName} · ${roleLabel}` : roleLabel;
  return doc.decidedAt ? `${verb} by ${actor} · ${fmtDate(doc.decidedAt)}` : `${verb} by ${actor}`;
};

// Version 2 adds the eligibility answers, background, personal, address, and
// family groups to the original nine fields. Version 3 adds the FORM 230-SCH
// details that are safe for the Department Chair too (birthdate, sex, pronouns,
// housing, education, awards, parents' ages, siblings, household members, IP
// group, previous grants, community service). Version 4 adds the printed name
// parts (Last, First, Middle), the Applicant Status answer (transferee), the
// senior high school graduate count, and the senior high school financial aid
// rows. The financial details are never part of this JSON: they live in the
// office-only application_financial_details table. A snapshot without a version
// was submitted before those groups were recorded.
export const PROFILE_SNAPSHOT_VERSION = 4;

const asText = (value) => (value == null ? '' : String(value).trim());
const asNumberOrNull = (value) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

// The self-reported profile values sent with a submission, frozen on the
// application so the student and the reviewers see what was declared at submit
// time. Values are self-reported; the badges reflect Document Vault proof only.
// The default statement/essay (`essay`) is left out because the
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
    yearStandingLabel: getYearStandingLabel(yearStanding),
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
      // FORM 230-SCH Applicant Status. An incoming first-year is already known
      // from the year standing; this answer separates a transferee.
      isTransferee: asText(profile.isTransferee),
      // The strand and the ranked choices are shown for an incoming first-year
      // and for any other student who recorded them.
      ...(isIncomingFirstYear || profile.hsStrand ? { hsStrand: asText(profile.hsStrand) } : {}),
      ...(isIncomingFirstYear || profile.programChoice2 || profile.programChoice3
        ? { programChoices: [asText(profile.programChoice2), asText(profile.programChoice3)] }
        : {}),
    },
    background: {
      ipCommunity: proven('ipCommunity'),
      pwd: proven('pwd'),
      employed: proven('employed'),
      ipGroupName: profile.ipCommunity === 'Yes' ? asText(profile.ipGroupName) : '',
    },
    personal: {
      // FORM 230-SCH prints the name as Last, First, Middle. The parts are kept
      // beside the composed `fullName` so a snapshot renders the printed form and
      // an older profile that never split its name still shows the full name.
      firstName: asText(profile.firstName),
      middleName: asText(profile.middleName),
      lastName: asText(profile.lastName),
      civilStatus: asText(profile.civilStatus),
      religion: asText(profile.religion),
      // The name given when the religion answer is "Other", frozen beside the
      // answer it completes (see `housingOther` in the address group below). The
      // row renders the two joined, so an older snapshot without the key is
      // unaffected.
      religionOther: profile.religion === 'Other' ? asText(profile.religionOther) : '',
      birthdate: asText(profile.birthdate),
      sexAtBirth: asText(profile.sexAtBirth),
      pronouns: asText(profile.pronouns),
      // FORM 230-SCH asks for an email address and a contact number; both are frozen
      // with the snapshot so the printed sheet carries what the student submitted.
      email: asText(profile.email),
      phone: asText(profile.phone),
    },
    address: {
      completeAddress: asText(profile.completeAddress),
      residingAddress: asText(profile.sameAsCompleteAddress ? profile.completeAddress : profile.residingAddress),
      country: asText(profile.country),
      housingType: asText(profile.housingType),
      housingOther: profile.housingType === 'Other' ? asText(profile.housingOther) : '',
      // Additive sibling of the values above, so an older reader that expects a
      // plain string keeps working while the reviewers see the address badges.
      verification: {
        completeAddress: status('completeAddress'),
        residingAddress: status('residingAddress'),
      },
    },
    education: {
      schoolLastAttended: {
        name: asText(profile.schoolLastAttended?.name),
        city: asText(profile.schoolLastAttended?.city),
        province: asText(profile.schoolLastAttended?.province),
      },
      awards: asText(profile.awards),
    },
    family: {
      fatherUnknown: Boolean(family.fatherUnknown),
      fatherName: asText(family.fatherName),
      fatherOccupation: asText(family.fatherOccupation),
      fatherDeceased: Boolean(family.fatherDeceased),
      fatherAge: asNumberOrNull(family.fatherAge),
      fatherDateOfDeath: asText(family.fatherDateOfDeath),
      motherUnknown: Boolean(family.motherUnknown),
      motherName: asText(family.motherName),
      motherOccupation: asText(family.motherOccupation),
      motherDeceased: Boolean(family.motherDeceased),
      motherAge: asNumberOrNull(family.motherAge),
      motherDateOfDeath: asText(family.motherDateOfDeath),
      familyPosition: asText(family.familyPosition),
      numberOfSiblings: asNumberOrNull(family.numberOfSiblings),
      siblings: Array.isArray(family.siblings) ? family.siblings.map((entry) => ({ ...entry })) : [],
      householdAdults: Array.isArray(family.householdAdults) ? family.householdAdults.map((entry) => ({ ...entry })) : [],
      // Additive badges for the two family proofs (see the address group above).
      verification: {
        parents: status('parents'),
        householdMembers: status('householdMembers'),
      },
    },
    aid: {
      communityService: asText(profile.communityService),
      previousGrants: Array.isArray(profile.previousGrants) ? profile.previousGrants.map((entry) => ({ ...entry })) : [],
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
// A parent marked unknown / not listed (an additive snapshot flag) reads as such
// instead of a blank row; snapshots frozen before the flag never carry it.
const formatParent = (name, occupation, deceased, unknown = false) => (unknown
  ? 'Unknown / not listed'
  : [name, occupation, deceased ? 'Deceased' : ''].filter(Boolean).join(' · '));
const formatParentAge = (age, deceased, dateOfDeath) => (deceased
  ? (dateOfDeath ? `Died ${fmtDate(dateOfDeath)}` : '')
  : (age == null || age === '' ? '' : `${age} years old`));
const formatPerson = (entry = {}, statusOptions) => [
  entry.name,
  entry.age === '' || entry.age == null ? '' : `${entry.age} yrs`,
  entry.relationship,
  statusOptions ? optionLabel(statusOptions, entry.status) : '',
].filter(Boolean).join(' · ');
const formatGrant = (entry = {}) => [
  entry.name,
  optionLabel(grantTypeOptions, entry.type),
  optionLabel(grantLevelOptions, entry.level),
  optionLabel(grantStatusOptions, entry.status),
  entry.institution,
  Number.isFinite(Number(entry.amount)) && entry.amount !== '' && entry.amount != null
    ? `${fmtCurrency(Number(entry.amount))} a year`
    : '',
].filter(Boolean).join(' · ');

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
  // Version 4 stores the printed name as Last, First, Middle; an older snapshot
  // (or a profile that never split its name) keeps the single full name.
  const printedName = snapshot.version >= 4 ? composeFullName(snapshot.personal) : '';
  const sections = [{
    key: 'application',
    title: 'Needed to apply',
    rows: [
      printedName ? row('Name of applicant (Last, First, Middle)', printedName) : row('Name', snapshot.fullName),
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
        ...(snapshot.version >= 4
          ? [row('Applicant status', getApplicantStatusLabel({ yearStanding: snapshot.yearStanding, isTransferee: eligibility.isTransferee }))]
          : []),
        proven('academicStanding', eligibility.academicStanding, academicStandingOptions),
        ...(Object.prototype.hasOwnProperty.call(eligibility, 'hsStrand') ? [row('Senior high school strand', eligibility.hsStrand)] : []),
        ...(Array.isArray(eligibility.programChoices) ? [
          row('2nd choice program', eligibility.programChoices[0]),
          row('3rd choice program', eligibility.programChoices[1]),
        ] : []),
        proven('honorsRank', eligibility.honorsRank, honorsRankOptions),
        row(snapshot.version >= 4 ? 'Number of graduates of your senior high school' : 'Graduating class size', eligibility.graduatingClassSize),
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
        ...(snapshot.version >= 3 && background.ipGroupName ? [row('Indigenous group', background.ipGroupName)] : []),
      ],
    },
    {
      key: 'personal',
      title: 'Personal and address',
      rows: [
        ...(snapshot.version >= 3 ? [
          row('Birthdate', personal.birthdate ? fmtDate(personal.birthdate) : ''),
          row('Sex assigned at birth', optionLabel(sexAtBirthOptions, personal.sexAtBirth)),
          ...(personal.pronouns ? [row('Preferred pronouns', personal.pronouns)] : []),
        ] : []),
        row('Civil status', optionLabel(civilStatusOptions, personal.civilStatus)),
        row('Religion', [optionLabel(religionOptions, personal.religion), personal.religionOther].filter(Boolean).join(' · ')),
        ...(personal.email ? [row('Email address', personal.email)] : []),
        ...(personal.phone ? [row('Contact number', personal.phone)] : []),
        row('Complete address', address.completeAddress, address.verification?.completeAddress),
        row('Residing address', address.residingAddress, address.verification?.residingAddress),
        ...(snapshot.version >= 3 && address.housingType
          ? [row('Where the student stays while studying', [optionLabel(housingTypeOptions, address.housingType), address.housingOther].filter(Boolean).join(' · '))]
          : []),
        row('Country', address.country),
      ],
    },
    ...(snapshot.version >= 3 ? [{
      key: 'education',
      title: 'Education',
      rows: [
        row(isTransfereeProfile({ isTransferee: eligibility.isTransferee }) ? 'College last attended' : 'School last attended', [snapshot.education?.schoolLastAttended?.name, snapshot.education?.schoolLastAttended?.city, snapshot.education?.schoolLastAttended?.province].filter(Boolean).join(', ')),
        row('Awards received', snapshot.education?.awards),
      ],
    }] : []),
    {
      key: 'family',
      title: 'Family',
      rows: [
        row('Father', formatParent(family.fatherName, family.fatherOccupation, family.fatherDeceased, family.fatherUnknown), family.verification?.parents),
        ...(snapshot.version >= 3 ? [row('Father (age or date of death)', formatParentAge(family.fatherAge, family.fatherDeceased, family.fatherDateOfDeath))] : []),
        row('Mother', formatParent(family.motherName, family.motherOccupation, family.motherDeceased, family.motherUnknown), family.verification?.parents),
        ...(snapshot.version >= 3 ? [row('Mother (age or date of death)', formatParentAge(family.motherAge, family.motherDeceased, family.motherDateOfDeath))] : []),
        row('Family position', optionLabel(familyPositionOptions, family.familyPosition)),
        row('Number of siblings', family.numberOfSiblings, family.verification?.householdMembers),
        ...(snapshot.version >= 3 ? [
          ...(Array.isArray(family.siblings) ? family.siblings : []).map((entry, index) => row(`Sibling ${index + 1}`, formatPerson(entry, siblingStatusOptions))),
          ...(Array.isArray(family.householdAdults) ? family.householdAdults : []).map((entry, index) => row(`Other household member ${index + 1}`, formatPerson(entry))),
        ] : []),
      ],
    },
    ...(snapshot.version >= 3 ? [{
      key: 'aid',
      title: 'Financial aid and service',
      rows: [
        ...(snapshot.version >= 4
          ? [row('Financial aid in senior high school', getShsFinancialAid(snapshot.aid?.previousGrants).map(formatGrant).join(' · ') || 'None listed')]
          : []),
        ...(Array.isArray(snapshot.aid?.previousGrants) && snapshot.aid.previousGrants.length
          ? snapshot.aid.previousGrants.map((entry, index) => row(`Grant ${index + 1}`, formatGrant(entry)))
          : [row('Other grants', 'None listed')]),
        row('Willing to render community service', snapshot.aid?.communityService),
      ],
    }] : []),
  );
  return { legacy: false, sections };
};
