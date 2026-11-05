import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildXlsx, buildXlsxAsync, crc32, crc32Async } from '../src/lib/xlsxWriter';

const makeSheets = (rowCount) => [
  {
    name: 'Applicants',
    rows: [
      [{ value: 'Applicant', style: 'header' }, { value: 'Score', style: 'header' }],
      ...Array.from({ length: rowCount }, (_, index) => [`Student ${index} & <co>`, { value: index * 1.5, type: 'number' }]),
    ],
    columnWidths: [30, 12],
    freeze: { row: 1 },
    autoFilter: 'A1:B2',
  },
  { name: 'About', rows: [['Column', 'Meaning'], ['Applicant', 'Name']] },
];

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.scheduler;
});

describe('async workbook generation', () => {
  it('produces exactly the bytes of the synchronous builder', async () => {
    const now = new Date('2026-11-06T02:00:00Z');
    const sheets = makeSheets(1200);
    const sync = buildXlsx(sheets, now);
    const chunked = await buildXlsxAsync(sheets, now, { rowSlice: 100, crcSlice: 4096 });

    expect(chunked.length).toBe(sync.length);
    expect(Buffer.compare(Buffer.from(chunked), Buffer.from(sync))).toBe(0);
  });

  it('yields to the event loop while it works, so a large export does not hold the main thread', async () => {
    const yieldSpy = vi.fn(() => Promise.resolve());
    globalThis.scheduler = { yield: yieldSpy };
    await buildXlsxAsync(makeSheets(1200), new Date('2026-11-06T02:00:00Z'), { rowSlice: 100, crcSlice: 4096 });

    // 12+ row slices on the big sheet plus checksum slices of the larger parts.
    expect(yieldSpy.mock.calls.length).toBeGreaterThan(12);
  });

  it('sums a checksum in slices to the same value as the whole-buffer form', async () => {
    const bytes = new Uint8Array(3 * 1024 * 1024 + 17).map((_, index) => (index * 31) % 251);
    expect(await crc32Async(bytes, 64 * 1024)).toBe(crc32(bytes));
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
