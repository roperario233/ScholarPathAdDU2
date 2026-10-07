import { describe, expect, it } from 'vitest';
import {
  VERIFIABLE_ATTRIBUTE_OPTIONS,
  buildDocumentPickerOptions,
  decodeDocumentSelection,
  encodeDocumentSelection,
  getAcceptedDocumentTypes,
  getDocumentTitle,
} from '../src/lib/profile';
import { documentTypeOptions, generalDocumentTypeOptions } from '../src/lib/constants';

describe('getAcceptedDocumentTypes', () => {
  it('returns the accepted document types for an attribute as value/label options', () => {
    expect(getAcceptedDocumentTypes('citizenship').map((option) => option.value)).toEqual([
      'PSA Birth Certificate',
      'Philippine National ID',
      "Driver's License",
      'Passport',
    ]);
    expect(getAcceptedDocumentTypes('academicStanding').map((option) => option.value)).toEqual(['Transcript', 'Good Moral Character']);
    expect(getAcceptedDocumentTypes('pwd').map((option) => option.value)).toEqual(['PWD ID', 'Medical Certificate']);
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
    expect(getDocumentTitle({ attributeKey: 'academicStanding', documentType: 'Good Moral Character' })).toBe('Academic standing — Good Moral Certificate');
  });

  it('uses the document type label alone for a general document', () => {
    expect(getDocumentTitle({ documentType: 'Income Proof' })).toBe('Income Doc');
    expect(getDocumentTitle({ attributeKey: '', documentType: 'Application Form' })).toBe('Application Form');
  });
});

describe('document type vocabulary', () => {
  it('keeps the Standard Procedure submission types available for general documents', () => {
    const generalValues = generalDocumentTypeOptions.map((option) => option.value);
    expect(generalValues).toContain('Application Form');
    expect(generalValues).toContain('Good Moral Character');
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
        expect(entry.label).toBe(type.label);
      });
    });
  });

  it('encodes every general document type with a blank attribute', () => {
    generalDocumentTypeOptions.forEach((type) => {
      expect(options.some((entry) => entry.value === encodeDocumentSelection('', type.value))).toBe(true);
    });
  });
});
