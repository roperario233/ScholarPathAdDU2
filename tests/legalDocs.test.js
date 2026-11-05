import { describe, expect, it } from 'vitest';
import {
  DATA_READERS,
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_KEYS,
  LEGAL_DOCUMENT_SHORT_LABELS,
  PRIVACY_MATRIX_ROLES,
  PRIVACY_NOTICE_VERSION,
  getLegalDocument,
  getLegalDocumentSummaries,
  getLegalDocumentTitle,
  getPrivacyReaderRows,
  getReviewerReaderRow,
} from '../src/lib/legalDocs';
import { ADMISSIONS_OFFICE_ROLES } from '../src/lib/constants';
import { REVIEWER_ROLES } from '../src/lib/reviewScope';

const PLACEHOLDER_PATTERNS = [/TODO/i, /lorem ipsum/i, /XXXX/, /\[insert/i, /TBD\b/];

const documentText = (doc) => [
  doc.title,
  doc.summary,
  ...doc.sections.flatMap((section) => [
    section.heading,
    ...(section.paragraphs || []),
    ...(section.list || []),
    ...(section.table?.columns || []),
    ...((section.table?.rows || []).flat()),
  ]),
].join('\n');

describe('privacy, storage, and terms copy', () => {
  it('registers exactly the three documents the route renders', () => {
    expect(LEGAL_DOCUMENT_KEYS).toEqual(['privacy', 'storage', 'terms']);
    expect(Object.keys(LEGAL_DOCUMENTS)).toEqual(LEGAL_DOCUMENT_KEYS);
    LEGAL_DOCUMENT_KEYS.forEach((key) => {
      expect(getLegalDocument(key).key).toBe(key);
      expect(getLegalDocumentTitle(key)).toBe(LEGAL_DOCUMENTS[key].title);
      expect(LEGAL_DOCUMENT_SHORT_LABELS[key]).toBeTruthy();
    });
  });

  it('gives every document real, uniquely anchored sections', () => {
    LEGAL_DOCUMENT_KEYS.forEach((key) => {
      const doc = getLegalDocument(key);
      expect(doc.sections.length).toBeGreaterThanOrEqual(3);

      const ids = doc.sections.map((section) => section.id);
      expect(new Set(ids).size).toBe(ids.length);

      doc.sections.forEach((section) => {
        expect(section.heading.length).toBeGreaterThan(3);
        const hasBody = (section.paragraphs || []).some((line) => line.trim().length > 20)
          || (section.list || []).length > 0
          || Boolean(section.table);
        expect(hasBody, `${key} → ${section.id}`).toBe(true);
      });

      PLACEHOLDER_PATTERNS.forEach((pattern) => {
        expect(documentText(doc)).not.toMatch(pattern);
      });
    });
  });

  it('states the Data Privacy Act basis and the cookie position truthfully', () => {
    const privacy = documentText(getLegalDocument('privacy'));
    expect(privacy).toContain('RA 10173');
    expect(privacy).toContain('Data Privacy Act');
    expect(privacy).toContain('Registrar');

    const storage = documentText(getLegalDocument('storage'));
    expect(storage).toMatch(/no advertising/i);
    expect(storage).toMatch(/no Google Analytics/i);
    // The one third party that can set a cookie is named, not hidden.
    expect(storage).toContain('tawk.to');
    expect(storage).toContain('scholarpath-addu-state');
    expect(storage).toContain('scholarpath-addu-session-activity');
  });

  it('never promises a disbursement or an automated award', () => {
    LEGAL_DOCUMENT_KEYS.forEach((key) => {
      const text = documentText(getLegalDocument(key));
      expect(text).not.toMatch(/we will pay|will disburse|guaranteed award/i);
    });
  });

  it('keeps the notice version in a stable, storable shape', () => {
    // The version is free text in the database (1-32 chars), so it must stay short
    // and free of spaces to remain a copyable identifier.
    expect(PRIVACY_NOTICE_VERSION).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/);
  });

  it('covers every role the app can sign in', () => {
    expect(PRIVACY_MATRIX_ROLES).toEqual(['student', ...ADMISSIONS_OFFICE_ROLES, ...REVIEWER_ROLES]);
    expect(DATA_READERS.map((entry) => entry.role)).toEqual(PRIVACY_MATRIX_ROLES);
    DATA_READERS.forEach((entry) => {
      expect(entry.label.length).toBeGreaterThan(2);
      expect(entry.sees.length).toBeGreaterThan(0);
      expect(entry.withheld.length).toBeGreaterThan(0);
    });
  });

  it('prints one row per office lane and a single row for the reviewer ladder', () => {
    const rows = getPrivacyReaderRows();

    expect(rows).toHaveLength(4);
    expect(rows[0][0]).toBe('Student');
    expect(rows[1][0]).toBe('Admissions Office Staff');
    expect(rows[2][0]).toBe('Admissions Office Admin');
    // The ladder row names its three levels plus the interviewer that shares the scope.
    expect(rows[3][0]).toContain('Dean');
    expect(rows[3][0]).toContain('Chairperson');
    expect(rows[3][0]).toContain('Interviewer');
    rows.forEach((row) => expect(row).toHaveLength(3));
    expect(getReviewerReaderRow()[1].length).toBeGreaterThan(10);
  });

  it('summarises each document for the entry points', () => {
    const summaries = getLegalDocumentSummaries();

    expect(summaries.map((entry) => entry.key)).toEqual(LEGAL_DOCUMENT_KEYS);
    summaries.forEach((entry) => {
      expect(entry.title).toBeTruthy();
      expect(entry.summary.length).toBeGreaterThan(20);
    });
  });
});
