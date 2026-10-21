import { describe, expect, it } from 'vitest';
import {
  VERIFIABLE_ATTRIBUTE_OPTIONS,
  buildDocumentPickerOptions,
  decodeDocumentSelection,
  encodeDocumentSelection,
  getAcceptedDocumentTypes,
  getDocumentSelectionForType,
  getDocumentTitle,
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

describe('encodeDocumentSelection / decodeDocumentSelection', () => {
  it('round-trips an attribute proof', () => {
    expect(decodeDocumentSelection(encodeDocumentSelection('citizenship', 'Passport'))).toEqual({
      attributeKey: 'citizenship',
      documentType: 'Passport',
    });
  });

  it('round-trips a general document with a blank attribute', () => {
    expect(decodeDocumentSelection(encodeDocumentSelection('', 'Application Form'))).toEqual({
      attributeKey: '',
      documentType: 'Application Form',
    });
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
  const groupLabels = options.filter((entry) => entry.isGroup).map((entry) => entry.label);

  it('starts with the General documents group', () => {
    expect(options[0]).toEqual({ value: 'group-general', label: 'General documents', isGroup: true });
  });

  it('lists every verifiable attribute as a group header', () => {
    VERIFIABLE_ATTRIBUTE_OPTIONS.forEach((option) => expect(groupLabels).toContain(option.label));
  });

  it('places each attribute group header immediately before its accepted types', () => {
    VERIFIABLE_ATTRIBUTE_OPTIONS.forEach((option) => {
      const headerIndex = options.findIndex((entry) => entry.isGroup && entry.label === option.label);
      expect(headerIndex).toBeGreaterThan(-1);
      getAcceptedDocumentTypes(option.key).forEach((type, offset) => {
        const entry = options[headerIndex + 1 + offset];
        expect(entry.isGroup).toBeUndefined();
        expect(entry.value).toBe(encodeDocumentSelection(option.key, type.value));
        expect(entry.label.startsWith(type.label)).toBe(true);
      });
    });
  });

  it('says when a type also proves another answer', () => {
    const gradeReport = options.find((entry) => entry.value === encodeDocumentSelection('qpi', 'Grade Report'));
    expect(gradeReport.label).toBe('Grade Report · also proves Academic standing');
    const passport = options.find((entry) => entry.value === encodeDocumentSelection('citizenship', 'Passport'));
    expect(passport.label).toBe('Passport');
  });

  it('lists a proving type only under its attribute, never as a general document', () => {
    generalDocumentTypeOptions.forEach((type) => {
      const general = options.some((entry) => entry.value === encodeDocumentSelection('', type.value));
      expect(general).toBe(getProvenAttributes(type.value).length === 0);
    });
    expect(options.some((entry) => entry.value === encodeDocumentSelection('', 'Transcript'))).toBe(false);
    expect(options.some((entry) => entry.value === encodeDocumentSelection('', 'Application Form'))).toBe(true);
  });

  it('drops attribute groups that do not apply to the standing', () => {
    const continuingLabels = buildDocumentPickerOptions({ yearStanding: '2nd' }).filter((entry) => entry.isGroup).map((entry) => entry.label);
    expect(continuingLabels).not.toContain('Senior high school general average');
    const incomingOptions = buildDocumentPickerOptions({ yearStanding: 'incoming-1st' });
    expect(incomingOptions.filter((entry) => entry.isGroup).map((entry) => entry.label)).not.toContain('Annual QPI');
    // A grade report proves nothing for an incoming first-year, and it is not a
    // general document either, so it is not offered.
    expect(incomingOptions.some((entry) => decodeDocumentSelection(entry.value).documentType === 'Grade Report')).toBe(false);
  });

  it('resolves the picker entry for a type', () => {
    expect(getDocumentSelectionForType('Grade Report', { yearStanding: '2nd' })).toBe(encodeDocumentSelection('qpi', 'Grade Report'));
    expect(getDocumentSelectionForType('Application Form')).toBe(encodeDocumentSelection('', 'Application Form'));
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
