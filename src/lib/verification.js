import { attributeVerificationStatuses } from './constants';
import {
  getCurrentAcademicYear,
  getProvenAttributes,
  getVerifiableAttributeOption,
  isProofRequired,
  normalizeAttestedValue,
  VERIFIABLE_ATTRIBUTE_KEYS,
  VERIFIABLE_ATTRIBUTE_OPTIONS,
} from './profile';

// The state of a profile attribute that has no proof document in the vault yet.
export const UNSET_ATTRIBUTE_STATUS = 'Unverified';
// The state of a profile attribute whose every proof document is outdated: the
// declared value changed after the upload, or an annual proof is from an earlier
// academic year. The student needs to upload a new proof.
export const OUTDATED_ATTRIBUTE_STATUS = 'Outdated';
// The state of a profile attribute whose current answer needs no proof (for
// example IP community "No", or a QPI for an incoming first-year).
export const NOT_NEEDED_ATTRIBUTE_STATUS = 'Not needed';

// The attributes a document proves: the links recorded at upload plus the ones
// its document type proves for the owner's standing (getProvenAttributes), so a
// file uploaded before every path linked attributes still counts as proof.
export const getDocumentLinkedAttributes = (doc, profile = null) => {
  const recorded = Array.isArray(doc?.linkedAttributes) ? doc.linkedAttributes : [];
  return [...new Set([...recorded, ...getProvenAttributes(doc?.documentType, profile)])];
};

// Every vault document that proves the given attribute.
export const getAttributeProofDocuments = (documents = [], key, profile = null) => (
  (Array.isArray(documents) ? documents : []).filter(
    (doc) => getDocumentLinkedAttributes(doc, profile).includes(key),
  )
);

// A local upload date is a bare `YYYY-MM-DD`, which `new Date()` would read as
// UTC midnight; read it as a local date so the June cut-over lands on June 1.
const parseUploadDate = (value) => {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Why a proof document no longer covers an attribute: 'value' when the profile
// value differs from the value the file was uploaded to prove, 'year' when an
// annual proof is from an earlier academic year, or null while it is current.
// A document without a recorded value (uploaded before `attestedValues`
// existed) or without an upload date is treated as current, and the value check
// only runs when the owner's profile is supplied and carries that answer (a
// frozen snapshot from before an answer was recorded leaves it out).
export const getProofStaleReason = (doc, key, { profile = null, now = new Date() } = {}) => {
  const attested = doc?.attestedValues && typeof doc.attestedValues === 'object' ? doc.attestedValues : {};
  if (profile && Object.prototype.hasOwnProperty.call(profile, key)
    && Object.prototype.hasOwnProperty.call(attested, key)
    && normalizeAttestedValue(key, profile[key]) !== attested[key]) {
    return 'value';
  }
  if (getVerifiableAttributeOption(key)?.annual) {
    const uploaded = parseUploadDate(doc?.uploadedAt);
    if (uploaded && getCurrentAcademicYear(uploaded) !== getCurrentAcademicYear(now)) return 'year';
  }
  return null;
};

export const isProofCurrent = (doc, key, options) => getProofStaleReason(doc, key, options) == null;

// The attributes a document no longer proves, each with its stale reason, so
// the Document Vault can flag the file and say why. An attribute whose current
// answer needs no proof is never flagged.
export const getOutdatedProofAttributes = (doc, options = {}) => (
  getDocumentLinkedAttributes(doc, options?.profile || null)
    .filter((key) => !options?.profile || isProofRequired(key, options.profile))
    .map((key) => ({ key, reason: getProofStaleReason(doc, key, options) }))
    .filter((entry) => entry.reason)
);

// Derives one attribute's verification state from its linked proof documents.
// Only current proofs count: when every linked proof is outdated the attribute
// is `Outdated`. Among current proofs `Verified` outranks `Rejected`, which
// outranks `Pending`, so the owner needs only one verified file to satisfy an
// attribute even if an older attempt was rejected or a newer one is still
// awaiting review. `options` carries the owner's `profile` (for the value check
// and the Not needed rule) and `now` (for the academic-year check). With a
// profile, an answer that needs no proof reads `Not needed` whatever the vault
// holds, so changing IP community from Yes to No clears an Outdated warning.
export const deriveAttributeStatus = (documents = [], key, options = {}) => {
  if (options.profile && !isProofRequired(key, options.profile)) return NOT_NEEDED_ATTRIBUTE_STATUS;
  const proofs = getAttributeProofDocuments(documents, key, options.profile || null);
  if (!proofs.length) return UNSET_ATTRIBUTE_STATUS;
  const current = proofs.filter((doc) => isProofCurrent(doc, key, options));
  if (!current.length) return OUTDATED_ATTRIBUTE_STATUS;
  if (current.some((doc) => doc.verificationStatus === 'Verified')) return 'Verified';
  if (current.some((doc) => doc.verificationStatus === 'Rejected')) return 'Rejected';
  return 'Pending';
};

// Maps every verifiable attribute key to its derived state so the profile
// surfaces render a badge per field without re-deriving the rules themselves.
export const deriveAttributeVerifications = (documents = [], keys = VERIFIABLE_ATTRIBUTE_KEYS, options = {}) => (
  keys.reduce((accumulator, key) => ({ ...accumulator, [key]: deriveAttributeStatus(documents, key, options) }), {})
);

// The attributes a pending profile edit would turn Outdated, with the state each
// had before, so My Profile can warn the student before they save. An attribute
// that is already Outdated, or that has no proof, is not listed.
export const getNewlyOutdatedAttributes = (documents = [], profile = {}, patch = {}, { keys = VERIFIABLE_ATTRIBUTE_KEYS, now = new Date() } = {}) => {
  const before = deriveAttributeVerifications(documents, keys, { profile, now });
  const after = deriveAttributeVerifications(documents, keys, { profile: { ...profile, ...patch }, now });
  return keys
    .filter((key) => after[key] === OUTDATED_ATTRIBUTE_STATUS && before[key] !== OUTDATED_ATTRIBUTE_STATUS)
    .map((key) => ({ key, previousStatus: before[key] }));
};

// One alert per Outdated attribute for the notification center. The reason is
// 'value' when any proof attests a different value (the student's own edit),
// otherwise 'year' (a new academic year started). The stable source key carries
// the declared value or the academic year, so the same stale state is announced
// once, while a further edit or the next academic year announces again.
export const getOutdatedAttributeAlerts = (documents = [], profile = {}, { keys = VERIFIABLE_ATTRIBUTE_KEYS, now = new Date() } = {}) => (
  keys
    .filter((key) => deriveAttributeStatus(documents, key, { profile, now }) === OUTDATED_ATTRIBUTE_STATUS)
    .map((key) => {
      const reasons = getAttributeProofDocuments(documents, key, profile).map((doc) => getProofStaleReason(doc, key, { profile, now }));
      const reason = reasons.includes('value') ? 'value' : 'year';
      const fingerprint = reason === 'year'
        ? getCurrentAcademicYear(now)
        : `value-${normalizeAttestedValue(key, profile?.[key]) ?? 'blank'}`;
      return { key, reason, sourceKey: `outdated-proof-${key}-${fingerprint}` };
    })
);

export const getAttributeVerificationTone = (status) => {
  if (status === 'Verified') return 'success';
  if (status === 'Rejected' || status === OUTDATED_ATTRIBUTE_STATUS) return 'danger';
  if (status === 'Pending') return 'warning';
  return 'neutral';
};

export const getAttributeVerificationLabel = (status) => (
  attributeVerificationStatuses.includes(status) ? status : UNSET_ATTRIBUTE_STATUS
);

// Verifiable attributes grouped by the profile section they belong to, so the
// admin review queue and the profile overview can group badges consistently.
export const groupVerifiableAttributes = (options = VERIFIABLE_ATTRIBUTE_OPTIONS) => (
  options.reduce((groups, option) => {
    groups[option.section] = [...(groups[option.section] || []), option];
    return groups;
  }, {})
);
