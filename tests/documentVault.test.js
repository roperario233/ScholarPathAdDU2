import { describe, expect, it } from 'vitest';
import {
  VERIFIABLE_ATTRIBUTE_OPTIONS,
  buildDocumentPickerOptions,
  getAcceptedDocumentTypes,
  getDocumentTitle,
  getPresetDocumentType,
  getProvenAttributes,
} from '../src/lib/profile';
import { documentTypeOptions, generalDocumentTypeOptions } from '../src/lib/constants';
import { buildDocumentStoragePath, isImageFileName, sanitizeStorageFileName } from '../src/lib/documentStorage';

describe('getAcceptedDocumentTypes', () => {
  it('returns the accepted document types for an attribute as value/label options', () => {
    expect(getAcceptedDocumentTypes('citizenship').map((option) => option.value)).toEqual([
      'PSA Birth Certificate',
      'Philippine National ID',
      "Driver's License",
      'Passport',
    ]);
    expect(getAcceptedDocumentTypes('academicStanding').map((option) => option.value)).toEqual(['Grade Report', 'Transcript', 'HS Report Card']);
    expect(getAcceptedDocumentTypes('pwd').map((option) => option.value)).toEqual(['PWD ID', 'Medical Certificate']);
  });

  it('leaves out the types scoped to the other standing', () => {
    expect(getAcceptedDocumentTypes('academicStanding', { yearStanding: '2nd' }).map((option) => option.value)).toEqual(['Grade Report', 'Transcript']);
    expect(getAcceptedDocumentTypes('academicStanding', { yearStanding: 'incoming-1st' }).map((option) => option.value)).toEqual(['HS Report Card']);
    expect(getAcceptedDocumentTypes('qpi', { yearStanding: 'incoming-1st' })).toEqual([]);
    expect(getAcceptedDocumentTypes('hsAverage', { yearStanding: '3rd' })).toEqual([]);
  });

  it('returns an empty list for an unknown attribute', () => {
    expect(getAcceptedDocumentTypes('not-an-attribute')).toEqual([]);
  });

  it('only lists document types that exist in the vault vocabulary', () => {
    const knownValues = new Set(documentTypeOptions.map((option) => option.value));
    VERIFIABLE_ATTRIBUTE_OPTIONS.forEach((option) => {
      expect(option.acceptedDocumentTypes.length).toBeGreaterThan(0);
      option.acceptedDocumentTypes.forEach((value) => expect(knownValues.has(value)).toBe(true));
    });
  });
});

describe('getDocumentTitle', () => {
  it('prefixes the attribute label for an attribute proof', () => {
    expect(getDocumentTitle({ attributeKey: 'citizenship', documentType: 'Passport' })).toBe('Citizenship — Passport');
    expect(getDocumentTitle({ attributeKey: 'academicStanding', documentType: 'Transcript' })).toBe('Academic standing — Transcript');
    expect(getDocumentTitle({ attributeKey: 'completeAddress', documentType: 'Proof of Billing' })).toBe('Complete address — Proof of Billing');
  });

  it('uses the document type label alone for a general document', () => {
    expect(getDocumentTitle({ documentType: 'Income Proof' })).toBe('Income Doc');
    expect(getDocumentTitle({ attributeKey: '', documentType: 'Application Form' })).toBe('Application Form');
    expect(getDocumentTitle({ documentType: 'Applicant Photo' })).toBe('2x2 ID Photo');
    expect(getDocumentTitle({ documentType: 'Photos of Residence' })).toBe('Photos of Residence');
  });
});

describe('document type vocabulary', () => {
  it('keeps the Standard Procedure submission types available for general documents', () => {
    const generalValues = generalDocumentTypeOptions.map((option) => option.value);
    expect(generalValues).toContain('Application Form');
    expect(generalValues).toContain('Good Moral Character');
    // The two camera-capable photo types are general documents, not attribute proofs.
    expect(generalValues).toContain('Applicant Photo');
    expect(generalValues).toContain('Photos of Residence');
    // Attribute-proof-only types are not offered as general documents.
    expect(generalValues).not.toContain('PWD ID');
  });

  it('exposes a master list that includes the attribute-proof types', () => {
    const values = documentTypeOptions.map((option) => option.value);
    expect(values).toContain('PWD ID');
    expect(values).toContain('Certificate of Tribal Membership');
  });
});

describe('getProvenAttributes', () => {
  it('maps each document type to the profile answers it proves for the standing', () => {
    const continuing = { yearStanding: '2nd' };
    const incoming = { yearStanding: 'incoming-1st' };
    expect(getProvenAttributes('Grade Report', continuing)).toEqual(['qpi', 'academicStanding']);
    expect(getProvenAttributes('Transcript', continuing)).toEqual(['qpi', 'academicStanding']);
    expect(getProvenAttributes('Grade Report', incoming)).toEqual([]);
    expect(getProvenAttributes('HS Report Card', incoming)).toEqual(['hsAverage', 'academicStanding']);
    expect(getProvenAttributes('HS Report Card', continuing)).toEqual([]);
    expect(getProvenAttributes('Income Proof', continuing)).toEqual(['householdIncome']);
    expect(getProvenAttributes('Passport', incoming)).toEqual(['citizenship']);
    expect(getProvenAttributes('Certificate of Award')).toEqual(['honorsRank']);
    // A PSA birth certificate proves citizenship and the parents' names.
    expect(getProvenAttributes('PSA Birth Certificate')).toEqual(['citizenship', 'parents']);
    expect(getProvenAttributes('Proof of Billing')).toEqual(['completeAddress', 'residingAddress']);
    // The barangay certificate answers the address and the household list.
    expect(getProvenAttributes('Certificate of Residency')).toEqual(['completeAddress', 'residingAddress', 'householdMembers']);
    // Good Moral certifies conduct, not academic standing.
    expect(getProvenAttributes('Good Moral Character', continuing)).toEqual([]);
    expect(getProvenAttributes('Application Form', continuing)).toEqual([]);
    expect(getProvenAttributes('')).toEqual([]);
  });

  it('accepts every listed type while the standing is unset', () => {
    expect(getProvenAttributes('HS Report Card', {})).toEqual(['hsAverage', 'academicStanding']);
    expect(getProvenAttributes('Grade Report', null)).toEqual(['qpi', 'academicStanding']);
  });
});

describe('buildDocumentPickerOptions', () => {
  const options = buildDocumentPickerOptions();
  const types = options.filter((entry) => !entry.isGroup);
  const groupLabels = options.filter((entry) => entry.isGroup).map((entry) => entry.label);

  it('groups by kind of document, not by profile answer', () => {
    expect(groupLabels).toEqual([
      'Photos',
      'Identity and citizenship',
      'Grades and school records',
      'Income and employment',
      'Address and household',
      'Special circumstances',
      'Application papers',
      'Other documents',
    ]);
    expect(options[0].isGroup).toBe(true);
  });

  it('lists every document type exactly once, valued by the stored type', () => {
    const values = types.map((entry) => entry.value);
    expect(new Set(values).size).toBe(values.length);
    documentTypeOptions.forEach((type) => expect(values).toContain(type.value));
    expect(types.find((entry) => entry.value === 'Passport').label).toBe('Passport');
  });

  it('never leaves a group header without a document under it', () => {
    options.forEach((entry, index) => {
      if (entry.isGroup) expect(options[index + 1]?.isGroup).toBeFalsy();
    });
  });

  it('says which answers a type proves, and nothing for a type that proves none', () => {
    const find = (value, profile) => buildDocumentPickerOptions(profile).find((entry) => entry.value === value);
    expect(find('Grade Report', { yearStanding: '2nd' }).description).toBe('Proves your Annual QPI and Academic standing');
    expect(find('PSA Birth Certificate').description).toBe("Proves your Citizenship and Parents' names");
    expect(find('Passport').description).toBe('Proves your Citizenship');
    expect(find('Application Form').description).toBeUndefined();
  });

  it('follows the standing', () => {
    const continuing = buildDocumentPickerOptions({ yearStanding: '2nd' });
    expect(continuing.find((entry) => entry.value === 'HS Report Card').description).toBeUndefined();
    const incoming = buildDocumentPickerOptions({ yearStanding: 'incoming-1st' });
    // A grade report proves nothing for an incoming first-year and is not a
    // general document either, so it is not offered.
    expect(incoming.some((entry) => entry.value === 'Grade Report')).toBe(false);
    expect(incoming.find((entry) => entry.value === 'HS Report Card').description).toBe('Proves your Senior high school general average and Academic standing');
  });

  it('offers the address and family proofs', () => {
    expect(getAcceptedDocumentTypes('completeAddress').map((option) => option.value)).toEqual(['Proof of Billing', 'Certificate of Residency']);
    expect(getAcceptedDocumentTypes('parents').map((option) => option.value)).toEqual(['PSA Birth Certificate']);
    expect(getAcceptedDocumentTypes('householdMembers').map((option) => option.value)).toEqual(['Certificate of Residency']);
    expect(types.find((entry) => entry.value === 'Certificate of Residency').description)
      .toBe("Proves your Complete address, Residing address, and Siblings and household members");
  });
});

describe('getPresetDocumentType', () => {
  it('opens an attribute on the first type it accepts for the standing', () => {
    expect(getPresetDocumentType('citizenship')).toBe('PSA Birth Certificate');
    expect(getPresetDocumentType('academicStanding', { yearStanding: 'incoming-1st' })).toBe('HS Report Card');
    expect(getPresetDocumentType('qpi', { yearStanding: 'incoming-1st' })).toBe('');
    expect(getPresetDocumentType('not-an-attribute')).toBe('');
  });
});

describe('sanitizeStorageFileName', () => {
  it('replaces characters that are unsafe in a storage key', () => {
    expect(sanitizeStorageFileName('My Transcript (2026).pdf')).toBe('My_Transcript_2026_.pdf');
    expect(sanitizeStorageFileName('a b')).toBe('a_b');
  });

  it('falls back to a placeholder when nothing usable remains', () => {
    expect(sanitizeStorageFileName('')).toBe('document');
    expect(sanitizeStorageFileName('...')).toBe('document');
  });
});

describe('buildDocumentStoragePath', () => {
  it('keys the object under the owner and document id', () => {
    expect(buildDocumentStoragePath({ ownerId: 'u1', documentId: 'd1', fileName: 'passport.pdf' })).toBe('u1/d1/passport.pdf');
    expect(buildDocumentStoragePath({ ownerId: 'u1', documentId: 'd1', fileName: 'My Passport!.PDF' })).toBe('u1/d1/My_Passport_.PDF');
  });
});

describe('isImageFileName', () => {
  it('recognizes image extensions only', () => {
    expect(isImageFileName('scan.JPG')).toBe(true);
    expect(isImageFileName('photo.png')).toBe(true);
    expect(isImageFileName('transcript.pdf')).toBe(false);
  });
});
