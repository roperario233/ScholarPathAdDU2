import { describe, expect, it } from 'vitest';
import { buildKeysetFilter, fetchKeysetRows, fetchPagedRows, fetchRowsInBatches, isAbortError } from '../src/lib/supabasePaging';

describe('fetchPagedRows', () => {
  it('reads every bounded page without relying on the API row cap', async () => {
    const rows = Array.from({ length: 1201 }, (_, id) => ({ id }));
    const offsets = [];
    const result = await fetchPagedRows(() => ({
      range: async (from, to) => {
        offsets.push([from, to]);
        return { data: rows.slice(from, to + 1), error: null };
      },
    }), { pageSize: 500 });

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1201);
    expect(result.data[0].id).toBe(0);
    expect(result.data.at(-1).id).toBe(1200);
    expect(offsets).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });

  it('returns the first query error rather than treating a failed page as empty', async () => {
    const failure = { message: 'page unavailable' };
    let calls = 0;
    const result = await fetchPagedRows(() => ({
      range: async () => {
        calls += 1;
        return calls === 1
          ? { data: [{ id: 1 }, { id: 2 }], error: null }
          : { data: null, error: failure };
      },
    }), { pageSize: 2 });

    expect(result).toEqual({ data: null, error: failure });
    expect(calls).toBe(2);
  });
});

describe('fetchRowsInBatches', () => {
  it('deduplicates IDs, bounds each filter, and retains every returned row', async () => {
    const ids = Array.from({ length: 245 }, (_, id) => `id-${id}`).concat('id-0');
    const seenBatchSizes = [];
    const result = await fetchRowsInBatches(ids, (batch) => ({
      range: async () => {
        seenBatchSizes.push(batch.length);
        return { data: batch.map((id) => ({ id })), error: null };
      },
    }), { batchSize: 100 });

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(245);
    expect(new Set(result.data.map((row) => row.id)).size).toBe(245);
    expect(seenBatchSizes.sort((a, b) => a - b)).toEqual([45, 100, 100]);
  });

  it('keeps concurrent batch requests bounded', async () => {
    let active = 0;
    let maximumActive = 0;
    const ids = Array.from({ length: 12 }, (_, id) => `id-${id}`);
    const result = await fetchRowsInBatches(ids, () => ({
      range: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return { data: [], error: null };
      },
    }), { batchSize: 1, concurrency: 3 });

    expect(result).toEqual({ data: [], error: null });
    expect(maximumActive).toBe(3);
  });

  it('does not issue a request for an empty ID list', async () => {
    const result = await fetchRowsInBatches([], () => {
      throw new Error('should not create a query');
    });

    expect(result).toEqual({ data: [], error: null });
  });
});

// A query-builder double that honours order/limit/or the way PostgREST does for
// the (column, id) seek filter, so the pagination contract is exercised for real.
const createKeysetTable = (rows, { onPage } = {}) => {
  const table = { rows };
  const from = () => {
    const state = { orders: [], limit: Infinity, cursor: null, signal: null };
    const builder = {
      order: (column, { ascending }) => { state.orders.push([column, ascending]); return builder; },
      limit: (count) => { state.limit = count; return builder; },
      or: (expression) => {
        const match = expression.match(/^(\w+)\.(gt|lt)\."([^"]*)",and\(\w+\.eq\."[^"]*",(\w+)\.(?:gt|lt)\."([^"]*)"\)$/);
        if (!match) throw new Error(`Unsupported keyset filter: ${expression}`);
        state.cursor = { column: match[1], operator: match[2], value: match[3], idColumn: match[4], id: match[5] };
        return builder;
      },
      abortSignal: (signal) => { state.signal = signal; return builder; },
      then: (resolve) => {
        const [[orderColumn, ascending], [idColumn]] = state.orders;
        const direction = ascending ? 1 : -1;
        const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
        let result = [...table.rows].sort((left, right) => direction * (compare(left[orderColumn], right[orderColumn]) || compare(left[idColumn], right[idColumn])));
        if (state.cursor) {
          result = result.filter((row) => {
            const byOrder = direction * compare(row[orderColumn], state.cursor.value);
            return byOrder > 0 || (byOrder === 0 && direction * compare(row[idColumn], state.cursor.id) > 0);
          });
        }
        const page = result.slice(0, state.limit);
        onPage?.(page, table);
        resolve({ data: page, error: null });
      },
    };
    return builder;
  };
  return { table, from };
};

describe('fetchKeysetRows', () => {
  const makeRows = (count, tieEvery = 1) => Array.from({ length: count }, (_, index) => ({
    id: `id-${String(index).padStart(5, '0')}`,
    updated_at: `2026-11-05T00:00:${String(Math.floor(index / tieEvery) % 60).padStart(2, '0')}.000000+00:00`,
  }));

  it('returns every row exactly once, including rows that tie on the ordering column across a page boundary', async () => {
    const rows = makeRows(1203, 7);
    const { from } = createKeysetTable(rows);
    const result = await fetchKeysetRows(() => from(), { orderColumn: 'updated_at', ascending: false, pageSize: 500 });

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1203);
    expect(new Set(result.data.map((row) => row.id)).size).toBe(1203);
  });

  it('does not skip or repeat a row that moves while the pages are being read', async () => {
    const rows = makeRows(1000);
    const moving = rows[10];
    let pages = 0;
    const { from } = createKeysetTable(rows, {
      onPage: (_page, table) => {
        pages += 1;
        // After the first page is served, the newest-so-far row is updated and
        // jumps to the top of a descending ordering. An offset reader would shift
        // every later page by one and drop a row; a keyset reader is unaffected.
        if (pages === 1) moving.updated_at = '2026-11-05T23:59:59.000000+00:00';
        return table;
      },
    });
    const result = await fetchKeysetRows(() => from(), { orderColumn: 'updated_at', ascending: false, pageSize: 300 });

    const ids = result.data.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    const missing = rows.filter((row) => row !== moving && !ids.includes(row.id));
    expect(missing).toEqual([]);
  });

  it('supports ascending order and surfaces a failed page instead of an empty result', async () => {
    const rows = makeRows(25);
    const { from } = createKeysetTable(rows);
    const ascending = await fetchKeysetRows(() => from(), { orderColumn: 'updated_at', ascending: true, pageSize: 10 });
    expect(ascending.data.map((row) => row.id)).toEqual([...rows].sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id)).map((row) => row.id));

    let calls = 0;
    const failing = await fetchKeysetRows(() => {
      const builder = from();
      const originalThen = builder.then;
      builder.then = (resolve) => {
        calls += 1;
        if (calls === 2) return resolve({ data: null, error: { message: 'page unavailable' } });
        return originalThen(resolve);
      };
      return builder;
    }, { orderColumn: 'updated_at', pageSize: 10 });
    expect(failing).toEqual({ data: null, error: { message: 'page unavailable' } });
  });

  it('stops before the next page when the signal is cancelled and reports it as a cancellation', async () => {
    const controller = new AbortController();
    let pages = 0;
    const { from } = createKeysetTable(makeRows(100), { onPage: () => { pages += 1; controller.abort(); } });
    const result = await fetchKeysetRows(() => from(), { orderColumn: 'updated_at', pageSize: 10, signal: controller.signal });

    expect(pages).toBe(1);
    expect(result.data).toBeNull();
    expect(isAbortError(result.error)).toBe(true);
  });

  it('quotes cursor values in the PostgREST filter', () => {
    expect(buildKeysetFilter({ orderColumn: 'updated_at', cursor: { value: '2026-11-05T00:00:00+00:00', id: 'abc' } }))
      .toBe('updated_at.lt."2026-11-05T00:00:00+00:00",and(updated_at.eq."2026-11-05T00:00:00+00:00",id.lt."abc")');
    expect(buildKeysetFilter({ orderColumn: 'created_at', ascending: true, cursor: { value: 'a"b', id: '1' } }))
      .toContain('created_at.gt."a\\"b"');
  });

  it('requires an ordering column', async () => {
    await expect(fetchKeysetRows(() => ({}), {})).rejects.toThrow('orderColumn');
  });
});

describe('fetchPagedRows cancellation', () => {
  it('does not issue a query for an already-cancelled signal', async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const result = await fetchPagedRows(() => { called = true; return { range: async () => ({ data: [], error: null }) }; }, { signal: controller.signal });
    expect(called).toBe(false);
    expect(isAbortError(result.error)).toBe(true);
  });
});
