import { describe, expect, it } from 'vitest';
import { documentIdConflict, getImportChunkSize, importWithSplitting, isTransientRpcError } from '../scripts/import-applications.mjs';

const noSleep = () => Promise.resolve();
const records = (count) => Array.from({ length: count }, (_, index) => ({ id: `r${index + 1}` }));

// A fake database call: it runs out of time when it is given more than `limit`
// cases, otherwise it imports them all (and rejects the ids in `rejected`).
const fakeRpc = ({ limit = Infinity, rejected = [], calls = [] } = {}) => async (batch, finalize) => {
  calls.push({ ids: batch.map((entry) => entry.id), finalize });
  if (batch.length > limit) return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
  const errors = batch.map((entry, index) => ({ entry, index })).filter(({ entry }) => rejected.includes(entry.id))
    .map(({ index }) => ({ row: index + 1, code: '23514', message: 'rule' }));
  return { data: { imported: batch.length - errors.length, skipped: 0, failed: errors.length, errors }, error: null };
};

describe('transient database errors', () => {
  it.each([
    [{ code: '57014', message: 'canceling statement due to statement timeout' }, true],
    [{ code: '40001', message: 'could not serialize access' }, true],
    [{ message: 'TypeError: fetch failed' }, true],
    [{ message: 'Bad gateway 502' }, true],
    [{ code: '23514', message: 'The QPI does not meet the scholarship requirement.' }, false],
    [{ code: '42501', message: 'Application import requires the service role.' }, false],
    [{ code: '23505', message: 'The batch ID is already associated with a different manifest.' }, false],
    [null, false],
  ])('classifies %j as transient=%s', (error, expected) => {
    expect(isTransientRpcError(error)).toBe(expected);
  });
});

describe('importWithSplitting', () => {
  it('makes one call when the database keeps up', async () => {
    const calls = [];
    const result = await importWithSplitting(fakeRpc({ calls }), records(10), { finalize: true, sleep: noSleep });
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ imported: 10, skipped: 0, failed: 0, calls: 1 });
  });

  it('splits a call that times out until the pieces fit, importing every case exactly once', async () => {
    const calls = [];
    const result = await importWithSplitting(fakeRpc({ limit: 3, calls }), records(25), { finalize: true, sleep: noSleep });
    expect(result.imported).toBe(25);
    const succeeded = calls.filter((call) => call.ids.length <= 3).flatMap((call) => call.ids);
    expect(succeeded.sort()).toEqual(records(25).map((entry) => entry.id).sort());
    expect(new Set(succeeded).size).toBe(25);
  });

  it('passes the finalize flag to the last piece only, so the batch is closed once', async () => {
    const calls = [];
    await importWithSplitting(fakeRpc({ limit: 4, calls }), records(16), { finalize: true, sleep: noSleep });
    const finalizing = calls.filter((call) => call.finalize && call.ids.length <= 4);
    expect(finalizing).toHaveLength(1);
    expect(finalizing[0].ids.at(-1)).toBe('r16');

    const open = [];
    await importWithSplitting(fakeRpc({ limit: 4, calls: open }), records(16), { finalize: false, sleep: noSleep });
    expect(open.some((call) => call.finalize)).toBe(false);
  });

  it('reports a rejected case by its position in the original list, wherever the split put it', async () => {
    const result = await importWithSplitting(fakeRpc({ limit: 2, rejected: ['r1', 'r7', 'r10'] }), records(10), { sleep: noSleep });
    expect(result.errors.map((failure) => failure.row).sort((a, b) => a - b)).toEqual([1, 7, 10]);
    expect(result).toMatchObject({ imported: 7, failed: 3 });
  });

  it('stops at once on a validation error instead of splitting or retrying', async () => {
    const calls = [];
    const rpc = async (batch) => { calls.push(batch.length); return { data: null, error: { code: '42501', message: 'requires the service role' } }; };
    await expect(importWithSplitting(rpc, records(5), { sleep: noSleep })).rejects.toThrow(/safe to rerun/);
    expect(calls).toEqual([5]);
  });

  it('retries a single case that keeps timing out a few times, then gives up with a rerun message', async () => {
    let tries = 0;
    const rpc = async () => { tries += 1; return { data: null, error: { code: '57014', message: 'timeout' } }; };
    await expect(importWithSplitting(rpc, records(1), { sleep: noSleep })).rejects.toThrow(/single case kept timing out/);
    expect(tries).toBe(4);
  });
});

describe('rerunning an import', () => {
  it('lets a case the ledger already holds meet its own earlier documents', () => {
    const document = { id: 'd1', existing: false };
    const existing = { id: 'd1' };
    expect(documentIdConflict({ document, existing, priorImport: { source_key: 'k' } })).toBe(false);
  });

  it('still refuses a document id that belongs to something else', () => {
    expect(documentIdConflict({ document: { id: 'd1', existing: false }, existing: { id: 'd1' }, priorImport: null })).toBe(true);
    expect(documentIdConflict({ document: { id: 'd1', existing: true }, existing: { id: 'd1' }, priorImport: null })).toBe(false);
    expect(documentIdConflict({ document: { id: 'd1', existing: false }, existing: undefined, priorImport: null })).toBe(false);
  });
});

describe('chunk size', () => {
  it('defaults to a size that stays inside a small project\'s statement timeout and never exceeds the function limit', () => {
    expect(getImportChunkSize(undefined)).toBe(10);
    expect(getImportChunkSize('5')).toBe(5);
    expect(getImportChunkSize('500')).toBe(25);
    expect(getImportChunkSize('0')).toBe(10);
    expect(getImportChunkSize('abc')).toBe(10);
  });
});
