import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  FIXTURE_REQUIRED_DOCUMENTS,
  IMPORT_EMAIL_DOMAIN,
  IMPORT_SCHOLARSHIP_ROW,
  buildPlaceholderPdf,
  buildRecord,
  buildSnapshot,
  buildStudent,
  evaluateImport,
  importStudentEmail,
} from '../scripts/lib/importFixture.mjs';
import { parseManifest } from '../scripts/import-applications.mjs';
import { buildProfileSnapshot } from '../src/lib/applicationRequirements';
import { getApplicationProfileGate } from '../src/lib/profile';
import { getFinancialAnswersMissing } from '../src/lib/financialDetails';
import { evaluateScholarship } from '../src/lib/eligibility';

const SAMPLE = [1, 2, 3, 7, 14, 19, 25, 100, 777, 1499, 1500];
const NOW = new Date('2026-11-06T03:00:00.000Z');
let directory = null;

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = null;
});

describe('import fixture students', () => {
  it.each(SAMPLE)('student %i satisfies the application form gate and the financial step', (index) => {
    const { profile, financialAnswers } = buildStudent(index);
    expect(getApplicationProfileGate(profile).missing.map((item) => item.label)).toEqual([]);
    expect(getFinancialAnswersMissing(financialAnswers)).toEqual([]);
  });

  it.each(SAMPLE)('student %i has a snapshot identical to the app\'s own builder', (index) => {
    const { profile } = buildStudent(index);
    const capturedAt = '2026-10-20T01:00:00.000Z';
    expect(buildSnapshot(profile, capturedAt)).toEqual(buildProfileSnapshot(profile, {}, capturedAt));
  });

  it('keeps every student inside the General Pool limits the database re-checks', () => {
    for (let index = 1; index <= 1500; index += 1) {
      const { profile } = buildStudent(index);
      expect(profile.qpi).toBeGreaterThanOrEqual(2.5);
      expect(profile.qpi).toBeLessThanOrEqual(4);
      expect(profile.householdIncome).toBeLessThanOrEqual(250000);
      expect(['BS Nursing', 'BS Architecture']).not.toContain(profile.degreeProgram);
      expect(profile.studentNumber).toMatch(/^[0-9]{4,12}$/);
    }
  });

  it('passes the client eligibility rules for the throwaway scholarship', () => {
    const { profile } = buildStudent(5);
    const scholarship = {
      title: IMPORT_SCHOLARSHIP_ROW.title,
      ruleFamily: 'general-pool',
      isActive: true,
      isMatchable: true,
      minimumQpi: null,
      maximumIncome: null,
      eligibleDegrees: [],
    };
    expect(evaluateScholarship(profile, scholarship).eligible).toBe(true);
  });

  it('states the scholarship limits explicitly, above every student the fixture can produce', () => {
    expect(IMPORT_SCHOLARSHIP_ROW.maximum_income).toBe(250000);
    expect(IMPORT_SCHOLARSHIP_ROW.minimum_qpi).toBe(2.5);
    for (let index = 1; index <= 3000; index += 1) {
      const { profile } = buildStudent(index);
      expect(profile.householdIncome).toBeLessThanOrEqual(IMPORT_SCHOLARSHIP_ROW.maximum_income);
      expect(profile.qpi).toBeGreaterThanOrEqual(IMPORT_SCHOLARSHIP_ROW.minimum_qpi);
    }
  });

  it('uses a reserved, undeliverable domain for every account', () => {
    expect(IMPORT_EMAIL_DOMAIN.endsWith('.invalid')).toBe(true);
    expect(importStudentEmail(12)).toBe('loadtest-import-0012@loadtest-import.scholarpath.invalid');
  });
});

describe('import fixture records', () => {
  const makeRecord = (index, overrides = {}) => buildRecord({
    index,
    studentId: randomUUID(),
    scholarshipId: randomUUID(),
    applicationId: randomUUID(),
    gradeReportId: randomUUID(),
    incomeProofId: randomUUID(),
    now: NOW,
    ...overrides,
  });

  it('attaches exactly the documents the throwaway scholarship requires, proving only matching values', () => {
    const record = makeRecord(9);
    const { profile } = buildStudent(9);
    const types = record.documents.map((document) => document.document_type);
    FIXTURE_REQUIRED_DOCUMENTS.forEach((requirement) => {
      expect(requirement.documentTypes.some((type) => types.includes(type))).toBe(true);
    });
    expect(record.documents[0].attested_values).toEqual({ qpi: profile.qpi, academicStanding: 'good' });
    expect(record.documents[1].attested_values).toEqual({ householdIncome: profile.householdIncome });
  });

  it('uploads every document before the submission and in the same academic year', () => {
    for (const index of [1, 24, 25, 26, 750, 1500]) {
      const record = makeRecord(index);
      const submitted = new Date(record.application.submitted_at);
      expect(submitted.getTime()).toBeLessThan(NOW.getTime());
      record.documents.forEach((document) => {
        const uploaded = new Date(document.uploaded_at);
        expect(uploaded.getTime()).toBeLessThanOrEqual(submitted.getTime());
        // The academic year starts in June; both dates must fall in the same one.
        expect(uploaded.getUTCFullYear()).toBe(submitted.getUTCFullYear());
        expect(uploaded.getUTCMonth()).toBeGreaterThanOrEqual(5);
      });
      expect(record.application.certified_at <= record.application.submitted_at).toBe(true);
    }
  });

  it('is accepted by the importer\'s own manifest validation', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'scholarpath-fixture-'));
    const manifest = { version: 1, batchId: randomUUID(), records: [1, 2, 3].map((index) => makeRecord(index)) };
    const manifestPath = path.join(directory, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest));
    const parsed = await parseManifest(manifestPath);
    expect(parsed.normalizedRecords).toHaveLength(3);
    expect(parsed.normalizedRecords[0].documents.map((document) => document.storage_path.split('/').pop()))
      .toEqual(['grade-report.pdf', 'income-proof.pdf']);
  });

  it('writes a placeholder that is a real PDF', () => {
    const pdf = buildPlaceholderPdf('Grade report');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('%%EOF');
    expect(pdf).toContain('LOAD TEST');
  });
});

describe('import reconciliation verdict', () => {
  const clean = (n = 1500) => ({
    expected: n,
    counts: {
      submitted: n, importRecords: n, batchStatus: 'completed', batchFailed: 0, links: n * 2, pendingDocuments: n * 2, decidedDocuments: 0,
      financialSnapshots: n, submittedLogRows: n, systemLogRows: n, notifications: 0, outboxRows: 0, sampledFilesChecked: 40, sampledFilesMissing: 0,
    },
  });

  it('passes a clean 1,500-case import', () => {
    expect(evaluateImport(clean()).passed).toBe(true);
  });

  it.each([
    ['a missing case', { submitted: 1499 }],
    ['a duplicated status-history row', { submittedLogRows: 1501 }],
    ['a log row written by a person instead of the system', { systemLogRows: 1499 }],
    ['an invented document decision', { decidedDocuments: 1 }],
    ['a notification for a historical case', { notifications: 1 }],
    ['a queued notification', { outboxRows: 3 }],
    ['a partial batch', { batchStatus: 'partial', batchFailed: 2 }],
    ['a missing stored file', { sampledFilesMissing: 1 }],
    ['a missing financial snapshot', { financialSnapshots: 1499 }],
  ])('fails on %s', (_name, change) => {
    const run = clean();
    run.counts = { ...run.counts, ...change };
    expect(evaluateImport(run).passed).toBe(false);
  });
});
