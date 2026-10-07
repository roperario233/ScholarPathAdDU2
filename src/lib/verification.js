import { attributeVerificationStatuses } from './constants';
import { VERIFIABLE_ATTRIBUTE_KEYS, VERIFIABLE_ATTRIBUTE_OPTIONS } from './profile';

// The state of a profile attribute that has no proof document in the vault yet.
export const UNSET_ATTRIBUTE_STATUS = 'Unverified';

// Every vault document that declares itself as proof for the given attribute.
export const getAttributeProofDocuments = (documents = [], key) => (
  (Array.isArray(documents) ? documents : []).filter(
    (doc) => Array.isArray(doc.linkedAttributes) && doc.linkedAttributes.includes(key),
  )
);

// Derives one attribute's verification state from its linked proof documents.
// `Verified` outranks `Rejected`, which outranks `Pending`, so the owner needs
// only one verified file to satisfy an attribute even if an older attempt was
// rejected or a newer one is still awaiting review.
export const deriveAttributeStatus = (documents = [], key) => {
  const proofs = getAttributeProofDocuments(documents, key);
  if (!proofs.length) return UNSET_ATTRIBUTE_STATUS;
  if (proofs.some((doc) => doc.verificationStatus === 'Verified')) return 'Verified';
  if (proofs.some((doc) => doc.verificationStatus === 'Rejected')) return 'Rejected';
  return 'Pending';
};

// Maps every verifiable attribute key to its derived state so the profile
// surfaces render a badge per field without re-deriving the rules themselves.
export const deriveAttributeVerifications = (documents = [], keys = VERIFIABLE_ATTRIBUTE_KEYS) => (
  keys.reduce((accumulator, key) => ({ ...accumulator, [key]: deriveAttributeStatus(documents, key) }), {})
);

export const getAttributeVerificationTone = (status) => {
  if (status === 'Verified') return 'success';
  if (status === 'Rejected') return 'danger';
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
