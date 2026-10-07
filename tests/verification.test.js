import { describe, expect, it } from 'vitest';
import {
  deriveAttributeStatus,
  deriveAttributeVerifications,
  getAttributeProofDocuments,
  getAttributeVerificationTone,
} from '../src/lib/verification';
import { VERIFIABLE_ATTRIBUTE_KEYS } from '../src/lib/profile';
import { normalizeDocument } from '../src/lib/demoState';

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
  });
});

describe('getAttributeVerificationTone', () => {
  it('maps each state to a shared StatusBadge tone', () => {
    expect(getAttributeVerificationTone('Verified')).toBe('success');
    expect(getAttributeVerificationTone('Rejected')).toBe('danger');
    expect(getAttributeVerificationTone('Pending')).toBe('warning');
    expect(getAttributeVerificationTone('Unverified')).toBe('neutral');
  });
});

describe('normalizeDocument', () => {
  it('defaults a missing linkedAttributes list to empty so old sessions load', () => {
    expect(normalizeDocument({ id: 'a' }).linkedAttributes).toEqual([]);
    expect(normalizeDocument({ id: 'b', linkedAttributes: ['qpi'] }).linkedAttributes).toEqual(['qpi']);
  });
});
