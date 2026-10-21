import { describe, expect, it } from 'vitest';
import {
  deriveAttributeStatus,
  deriveAttributeVerifications,
  getAttributeProofDocuments,
  getAttributeVerificationTone,
  getDocumentLinkedAttributes,
  getNewlyOutdatedAttributes,
  getOutdatedAttributeAlerts,
  getOutdatedProofAttributes,
  getProofStaleReason,
} from '../src/lib/verification';
import { VERIFIABLE_ATTRIBUTE_KEYS } from '../src/lib/profile';
import { normalizeDocument } from '../src/lib/appState';

const doc = (overrides) => ({ id: 'doc-x', linkedAttributes: [], verificationStatus: 'Pending', ...overrides });

describe('getAttributeProofDocuments', () => {
  it('returns only the documents that declare the attribute as proof', () => {
    const documents = [
      doc({ id: 'a', linkedAttributes: ['qpi'] }),
      doc({ id: 'b', linkedAttributes: ['householdIncome'] }),
      doc({ id: 'c', linkedAttributes: ['qpi', 'householdIncome'] }),
    ];
    expect(getAttributeProofDocuments(documents, 'qpi').map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(getAttributeProofDocuments(documents, 'citizenship')).toEqual([]);
  });

  it('tolerates documents that predate the linkedAttributes field', () => {
    expect(getAttributeProofDocuments([{ id: 'a' }, doc({ id: 'b', linkedAttributes: ['qpi'] })], 'qpi').map((entry) => entry.id)).toEqual(['b']);
    expect(getAttributeProofDocuments(undefined, 'qpi')).toEqual([]);
  });
});

describe('deriveAttributeStatus', () => {
  it('is Unverified when no proof document is linked', () => {
    expect(deriveAttributeStatus([], 'qpi')).toBe('Unverified');
    expect(deriveAttributeStatus([doc({ linkedAttributes: ['householdIncome'] })], 'qpi')).toBe('Unverified');
  });

  it('is Pending while every linked proof is still awaiting review', () => {
    expect(deriveAttributeStatus([doc({ linkedAttributes: ['qpi'], verificationStatus: 'Pending' })], 'qpi')).toBe('Pending');
  });

  it('is Rejected when a proof was rejected and none is verified', () => {
    expect(deriveAttributeStatus([doc({ linkedAttributes: ['qpi'], verificationStatus: 'Rejected' })], 'qpi')).toBe('Rejected');
    expect(deriveAttributeStatus([
      doc({ id: 'a', linkedAttributes: ['qpi'], verificationStatus: 'Rejected' }),
      doc({ id: 'b', linkedAttributes: ['qpi'], verificationStatus: 'Pending' }),
    ], 'qpi')).toBe('Rejected');
  });

  it('lets a single verified proof outrank a rejected or pending one', () => {
    expect(deriveAttributeStatus([
      doc({ id: 'a', linkedAttributes: ['qpi'], verificationStatus: 'Rejected' }),
      doc({ id: 'b', linkedAttributes: ['qpi'], verificationStatus: 'Verified' }),
    ], 'qpi')).toBe('Verified');
  });
});

describe('deriveAttributeVerifications', () => {
  it('maps every verifiable attribute to its derived state', () => {
    const documents = [
      doc({ linkedAttributes: ['qpi'], verificationStatus: 'Verified' }),
      doc({ linkedAttributes: ['householdIncome'], verificationStatus: 'Pending' }),
      doc({ linkedAttributes: ['academicStanding'], verificationStatus: 'Rejected' }),
    ];
    const verifications = deriveAttributeVerifications(documents);
    expect(Object.keys(verifications)).toEqual(VERIFIABLE_ATTRIBUTE_KEYS);
    expect(verifications).toMatchObject({ qpi: 'Verified', householdIncome: 'Pending', academicStanding: 'Rejected', hsAverage: 'Unverified' });
    // The self-reported citizenship, IP community, PWD, and employment answers
    // are verifiable too, so they appear with an Unverified default.
    expect(verifications).toMatchObject({ citizenship: 'Unverified', ipCommunity: 'Unverified', pwd: 'Unverified', employed: 'Unverified' });
  });
});

describe('getAttributeVerificationTone', () => {
  it('maps each state to a shared StatusBadge tone', () => {
    expect(getAttributeVerificationTone('Verified')).toBe('success');
    expect(getAttributeVerificationTone('Rejected')).toBe('danger');
    expect(getAttributeVerificationTone('Pending')).toBe('warning');
    expect(getAttributeVerificationTone('Unverified')).toBe('neutral');
    expect(getAttributeVerificationTone('Outdated')).toBe('danger');
  });
});

describe('outdated proofs', () => {
  const now = new Date(2026, 9, 12);
  const qpiProof = (overrides) => doc({ linkedAttributes: ['qpi'], attestedValues: { qpi: 3.2 }, uploadedAt: '2026-08-01', ...overrides });

  it('marks a verified proof Outdated once the declared value changes, and restores it when changed back', () => {
    const documents = [qpiProof({ verificationStatus: 'Verified' })];
    expect(deriveAttributeStatus(documents, 'qpi', { profile: { qpi: 3.8 }, now })).toBe('Outdated');
    expect(deriveAttributeStatus(documents, 'qpi', { profile: { qpi: '3.20' }, now })).toBe('Verified');
  });

  it('marks a pending proof Outdated when the value changes before review', () => {
    expect(deriveAttributeStatus([qpiProof()], 'qpi', { profile: { qpi: 3.5 }, now })).toBe('Outdated');
  });

  it('counts only current proofs, so a newer pending proof outranks an outdated verified one', () => {
    const documents = [
      qpiProof({ id: 'old', verificationStatus: 'Verified' }),
      qpiProof({ id: 'new', attestedValues: { qpi: 3.8 }, verificationStatus: 'Pending' }),
    ];
    expect(deriveAttributeStatus(documents, 'qpi', { profile: { qpi: 3.8 }, now })).toBe('Pending');
  });

  it('expires annual proofs at the June academic-year cut-over but not other attributes', () => {
    const qpi = qpiProof({ verificationStatus: 'Verified', uploadedAt: '2026-05-31' });
    const citizenship = doc({ linkedAttributes: ['citizenship'], attestedValues: { citizenship: 'Filipino' }, verificationStatus: 'Verified', uploadedAt: '2025-01-10' });
    const profile = { qpi: 3.2, citizenship: 'Filipino' };
    expect(deriveAttributeStatus([qpi], 'qpi', { profile, now: new Date(2026, 4, 31) })).toBe('Verified');
    expect(deriveAttributeStatus([qpi], 'qpi', { profile, now: new Date(2026, 5, 1) })).toBe('Outdated');
    expect(getProofStaleReason(qpi, 'qpi', { profile, now: new Date(2026, 5, 1) })).toBe('year');
    expect(deriveAttributeStatus([citizenship], 'citizenship', { profile, now })).toBe('Verified');
  });

  it('treats a legacy proof with no attested value as current', () => {
    const legacy = doc({ linkedAttributes: ['citizenship'], verificationStatus: 'Verified' });
    expect(deriveAttributeStatus([legacy], 'citizenship', { profile: { citizenship: 'Dual citizen' }, now })).toBe('Verified');
  });

  it('skips the value check when no profile is supplied', () => {
    expect(deriveAttributeStatus([qpiProof({ verificationStatus: 'Verified' })], 'qpi', { now })).toBe('Verified');
  });

  it('lists the stale attributes of a document with their reason', () => {
    const proof = qpiProof({ linkedAttributes: ['qpi', 'citizenship'], attestedValues: { qpi: 3.2, citizenship: 'Filipino' } });
    expect(getOutdatedProofAttributes(proof, { profile: { qpi: 3.5, citizenship: 'Filipino' }, now })).toEqual([{ key: 'qpi', reason: 'value' }]);
    expect(getOutdatedProofAttributes(doc({}), { now })).toEqual([]);
  });

  it('previews which attributes a profile edit would turn Outdated', () => {
    const documents = [
      qpiProof({ verificationStatus: 'Verified' }),
      doc({ id: 'cit', linkedAttributes: ['citizenship'], attestedValues: { citizenship: 'Filipino' }, verificationStatus: 'Pending' }),
    ];
    const profile = { qpi: 3.2, citizenship: 'Filipino' };
    expect(getNewlyOutdatedAttributes(documents, profile, { qpi: '3.80' }, { now })).toEqual([{ key: 'qpi', previousStatus: 'Verified' }]);
    expect(getNewlyOutdatedAttributes(documents, profile, { qpi: '3.20', citizenship: 'Dual citizen' }, { now })).toEqual([{ key: 'citizenship', previousStatus: 'Pending' }]);
    // An attribute with no proof, or one already Outdated, is not a new warning.
    expect(getNewlyOutdatedAttributes(documents, profile, { householdIncome: '100000' }, { now })).toEqual([]);
    expect(getNewlyOutdatedAttributes(documents, { ...profile, qpi: 3.8 }, { qpi: 3.9 }, { now })).toEqual([]);
  });

  it('builds one alert per Outdated attribute with a stable source key', () => {
    const documents = [qpiProof({ verificationStatus: 'Verified' })];
    expect(getOutdatedAttributeAlerts(documents, { qpi: 3.2 }, { now })).toEqual([]);
    expect(getOutdatedAttributeAlerts(documents, { qpi: 3.8 }, { now })).toEqual([{ key: 'qpi', reason: 'value', sourceKey: 'outdated-proof-qpi-value-3.8' }]);
    expect(getOutdatedAttributeAlerts(documents, { qpi: 3.2 }, { now: new Date(2027, 5, 1) })).toEqual([{ key: 'qpi', reason: 'year', sourceKey: 'outdated-proof-qpi-2027-2028' }]);
  });

  it('passes the options through deriveAttributeVerifications', () => {
    const verifications = deriveAttributeVerifications([qpiProof({ verificationStatus: 'Verified' })], VERIFIABLE_ATTRIBUTE_KEYS, { profile: { qpi: 3.9 }, now });
    expect(verifications.qpi).toBe('Outdated');
    expect(verifications.householdIncome).toBe('Unverified');
  });
});

describe('normalizeDocument', () => {
  it('defaults a missing linkedAttributes list to empty so old sessions load', () => {
    expect(normalizeDocument({ id: 'a' }).linkedAttributes).toEqual([]);
    expect(normalizeDocument({ id: 'b', linkedAttributes: ['qpi'] }).linkedAttributes).toEqual(['qpi']);
  });
});

describe('type-derived proof links', () => {
  it('counts a file as proof of what its type proves, even without a recorded link', () => {
    const transcript = doc({ id: 't', documentType: 'Transcript', verificationStatus: 'Verified' });
    expect(getDocumentLinkedAttributes(transcript, { yearStanding: '2nd' })).toEqual(['qpi', 'academicStanding']);
    expect(deriveAttributeStatus([transcript], 'qpi', { profile: { yearStanding: '2nd', qpi: 3.1 } })).toBe('Verified');
  });

  it('keeps a recorded link and follows the standing', () => {
    const card = doc({ id: 'c', documentType: 'HS Report Card', linkedAttributes: ['hsAverage'] });
    expect(getDocumentLinkedAttributes(card, { yearStanding: 'incoming-1st' })).toEqual(['hsAverage', 'academicStanding']);
    expect(getDocumentLinkedAttributes(card, { yearStanding: '2nd' })).toEqual(['hsAverage']);
  });
});

describe('Not needed', () => {
  it('reads Not needed when the answer claims nothing, whatever the vault holds', () => {
    const pwdProof = doc({ documentType: 'PWD ID', linkedAttributes: ['pwd'], attestedValues: { pwd: 'Yes' }, verificationStatus: 'Verified' });
    expect(deriveAttributeStatus([pwdProof], 'pwd', { profile: { pwd: 'No' } })).toBe('Not needed');
    expect(deriveAttributeStatus([pwdProof], 'pwd', { profile: { pwd: 'Yes' } })).toBe('Verified');
    expect(deriveAttributeStatus([], 'ipCommunity', { profile: { ipCommunity: 'No' } })).toBe('Not needed');
    expect(deriveAttributeStatus([], 'qpi', { profile: { yearStanding: 'incoming-1st' } })).toBe('Not needed');
    expect(getAttributeVerificationTone('Not needed')).toBe('neutral');
  });

  it('never flags a proof Outdated once its answer needs no proof', () => {
    const pwdProof = doc({ documentType: 'PWD ID', linkedAttributes: ['pwd'], attestedValues: { pwd: 'Yes' } });
    expect(getOutdatedProofAttributes(pwdProof, { profile: { pwd: 'No' } })).toEqual([]);
    expect(getOutdatedAttributeAlerts([pwdProof], { pwd: 'No' })).toEqual([]);
  });

  it('skips the value check for an answer the profile does not carry', () => {
    const proof = doc({ linkedAttributes: ['academicStanding'], attestedValues: { academicStanding: 'good' } });
    expect(getProofStaleReason(proof, 'academicStanding', { profile: { yearStanding: '2nd' } })).toBeNull();
    expect(getProofStaleReason(proof, 'academicStanding', { profile: { academicStanding: 'probation' } })).toBe('value');
  });
});
