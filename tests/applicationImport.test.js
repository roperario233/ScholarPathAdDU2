import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { localFilePath, normalizeStorageName, parseManifest, stableStringify, storagePathFor } from '../scripts/import-applications.mjs';

const importMigration = readFileSync(new URL('../supabase/migrations/20261105000003_application_import_batches.sql', import.meta.url), 'utf8');
const referenceSchema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

let temporaryDirectory = null;

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = null;
});

const makeRecord = () => ({
  sourceId: 'external-case-001',
  application: {
    id: randomUUID(),
    student_id: randomUUID(),
    scholarship_id: randomUUID(),
    submitted_at: '2026-10-30T02:00:00.000Z',
    certified_at: '2026-10-30T02:00:00.000Z',
    statement: 'A statement from the application source.',
    profile_snapshot: { version: 4 },
    financial_snapshot: { father: { annualIncome: 0 } },
    financial_answers: { foodIntakeAdequacy: 'adequate' },
  },
  documents: [{
    id: randomUUID(),
    document_type: 'Grade Report',
    file_name: 'grade-report.pdf',
    file_path: 'files/grade-report.pdf',
    uploaded_at: '2026-10-29T02:00:00.000Z',
    linked_attributes: ['academicStanding'],
    attested_values: { academicStanding: 'continuing' },
  }],
});

describe('application import manifest', () => {
  it('normalizes IDs without storing the source identifier in the import key', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'scholarpath-import-'));
    const manifest = { version: 1, batchId: randomUUID(), records: [makeRecord()] };
    const manifestPath = path.join(temporaryDirectory, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest));
    const parsed = await parseManifest(manifestPath);

    expect(parsed.normalizedRecords).toHaveLength(1);
    expect(parsed.normalizedRecords[0].sourceKey).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.normalizedRecords[0].sourceKey).not.toContain(manifest.records[0].sourceId);
    expect(parsed.normalizedRecords[0].documents[0].storage_path).toBe(
      `${manifest.records[0].application.student_id}/${manifest.records[0].documents[0].id}/grade-report.pdf`,
    );
  });

  it('rejects duplicate source IDs and documents uploaded after submission', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'scholarpath-import-'));
    const first = makeRecord();
    const duplicate = { ...makeRecord(), sourceId: first.sourceId };
    const manifestPath = path.join(temporaryDirectory, 'duplicate.json');
    await writeFile(manifestPath, JSON.stringify({ version: 1, batchId: randomUUID(), records: [first, duplicate] }));
    await expect(parseManifest(manifestPath)).rejects.toThrow('duplicates a sourceId');

    first.documents[0].uploaded_at = '2026-10-31T02:00:00.000Z';
    await writeFile(manifestPath, JSON.stringify({ version: 1, batchId: randomUUID(), records: [first] }));
    await expect(parseManifest(manifestPath)).rejects.toThrow('uploaded by submitted_at');
  });

  it('does not permit local document paths to escape the manifest directory', () => {
    const directory = path.join(os.tmpdir(), 'manifest-root');
    expect(() => localFilePath(directory, '../outside.pdf')).toThrow('stay inside the manifest directory');
  });
});

describe('stable storage keys', () => {
  it('sanitizes names and is independent of object key order', () => {
    const ownerId = randomUUID();
    const documentId = randomUUID();
    expect(normalizeStorageName('../../my grade report.pdf')).toBe('my_grade_report.pdf');
    expect(storagePathFor({ ownerId, documentId, fileName: 'my grade report.pdf' })).toBe(`${ownerId}/${documentId}/my_grade_report.pdf`);
    expect(stableStringify({ z: 1, a: { y: 2, x: 3 } })).toBe(stableStringify({ a: { x: 3, y: 2 }, z: 1 }));
  });
});

describe('application import database contract', () => {
  it('restricts writes to the service role and reuses submission validation', () => {
    expect(importMigration).toMatch(/if auth\.role\(\) is distinct from 'service_role'/i);
    expect(importMigration).toMatch(/public\.missing_application_profile_item\(v_profile\)/i);
    expect(importMigration).toMatch(/public\.financial_answers_complete\(/i);
    expect(importMigration).toMatch(/public\.document_proof_is_current\(/i);
    expect(importMigration).toMatch(/grant execute on function public\.import_submitted_application_batch\([\s\S]*?to service_role/i);
    expect(importMigration).toMatch(/insert into public\.application_status_log[\s\S]*?'system'/i);
    expect(importMigration).not.toMatch(/update public\.applications[\s\S]{0,80}set status = 'Submitted'/i);
  });

  it('keeps the fresh-project schema aligned with the import migration', () => {
    expect(referenceSchema).toContain('public.application_import_batches');
    expect(referenceSchema).toContain('public.application_import_profile_answers');
    expect(referenceSchema).toContain('public.import_submitted_application_batch(');
  });
});

describe('application volume migrations stay executable', () => {
  const migrationNames = [
    '20261105000000_scope_results_release_reads.sql',
    '20261105000003_application_import_batches.sql',
    '20261105000004_batch_results_release.sql',
    '20261105000005_application_stage_counts.sql',
    '20261105000006_notification_outbox.sql',
  ];
  const normalize = (text) => text.replace(/\r\n/g, '\n');
  const definedFunctions = new Set(
    [...referenceSchema.matchAll(/create (?:or replace )?function public\.(\w+)\s*\(/gi)].map((match) => match[1]),
  );

  it('only calls public functions that the reference schema defines', () => {
    migrationNames.forEach((name) => {
      const sql = readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
      // A name after references/on/table/into/from/join/update is a table, not a call.
      const called = [...sql.matchAll(/(?<!(?:references|on|table|exists|into|from|join|update)\s)\bpublic\.(\w+)\s*\(/gi)].map((match) => match[1]);
      called.forEach((fn) => {
        expect(definedFunctions.has(fn), `${name} calls undefined public.${fn}()`).toBe(true);
      });
    });
  });

  it('uses only real Postgres JSON functions in the import RPC', () => {
    expect(importMigration).not.toMatch(/jsonb_object_length/);
    expect(importMigration).toMatch(/array\(select jsonb_array_elements_text\(coalesce\(v_document -> 'linked_attributes'/);
    expect(importMigration).toMatch(/v_covered := '\{\}'::text\[\];/);
  });

  it('keeps the reference schema import block identical to the migration', () => {
    const block = normalize(importMigration).trim();
    expect(normalize(referenceSchema)).toContain(block.slice(block.indexOf('create table if not exists public.application_import_batches')));
  });

  it('keeps a waitlisted applicant from reading the grant amount through the coverage table', () => {
    const migration = normalize(readFileSync(new URL('../supabase/migrations/20261105000000_scope_results_release_reads.sql', import.meta.url), 'utf8'));
    const policy = migration.slice(migration.indexOf('create policy "grant_amounts_student_released_read"'));
    expect(policy).toMatch(/scholarship_offers o where o\.application_id = a\.id/);
    expect(policy).toMatch(/a\.status = 'Released'[\s\S]*can_read_application_result_release\(a\.id\)/);
    const schema = normalize(referenceSchema);
    const last = schema.lastIndexOf('create policy "grant_amounts_student_released_read"');
    expect(schema.slice(last, last + 700)).not.toMatch(/from public\.results_releases/);
  });
});
