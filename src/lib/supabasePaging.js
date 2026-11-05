export const SUPABASE_PAGE_SIZE = 500;
export const SUPABASE_IN_BATCH_SIZE = 100;
export const SUPABASE_QUERY_CONCURRENCY = 4;

export const ABORT_ERROR_CODE = 'ABORTED';

const abortedResult = () => ({
  data: null,
  error: { name: 'AbortError', code: ABORT_ERROR_CODE, message: 'The request was cancelled.' },
});

// A cancelled read is not a failure: callers drop the result instead of showing
// an error, and never treat it as "the table is empty".
export const isAbortError = (error) => Boolean(error) && (error.code === ABORT_ERROR_CODE || error.name === 'AbortError');

const withSignal = (query, signal) => (signal && typeof query.abortSignal === 'function' ? query.abortSignal(signal) : query);

// Offset paging. Fine for small, rarely-changing tables; for tables that are
// updated while a hydration runs use fetchKeysetRows, because an offset shifts
// when a row moves between pages and can skip or repeat it.
export const fetchPagedRows = async (createQuery, { pageSize = SUPABASE_PAGE_SIZE, signal } = {}) => {
  const boundedPageSize = Math.max(1, Math.floor(pageSize) || SUPABASE_PAGE_SIZE);
  const rows = [];
  let offset = 0;

  while (true) {
    if (signal?.aborted) return abortedResult();
    const { data, error } = await withSignal(createQuery(), signal).range(offset, offset + boundedPageSize - 1);
    if (error) return { data: null, error };

    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < boundedPageSize) return { data: rows, error: null };
    offset += boundedPageSize;
  }
};

const quoteFilterValue = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// The PostgREST `or` expression that selects the rows after a cursor in a
// (orderColumn, idColumn) ordering. Exported so the tests can pin the grammar.
export const buildKeysetFilter = ({ orderColumn, idColumn = 'id', ascending = false, cursor }) => {
  const operator = ascending ? 'gt' : 'lt';
  const value = quoteFilterValue(cursor.value);
  const id = quoteFilterValue(cursor.id);
  return `${orderColumn}.${operator}.${value},and(${orderColumn}.eq.${value},${idColumn}.${operator}.${id})`;
};

// Keyset ("seek") paging over a stable (orderColumn, idColumn) key: each page
// starts strictly after the last row of the previous one, so a row that changes
// elsewhere in the table while the pages are read can neither be skipped nor
// returned twice, and the cost of a page does not grow with its depth. The
// ordering column must be NOT NULL. `createQuery` returns a fresh builder with
// the select and filters only; ordering, the limit and the cursor are applied
// here.
export const fetchKeysetRows = async (
  createQuery,
  { orderColumn, idColumn = 'id', ascending = false, pageSize = SUPABASE_PAGE_SIZE, signal } = {},
) => {
  if (!orderColumn) throw new Error('fetchKeysetRows needs an orderColumn.');
  const boundedPageSize = Math.max(1, Math.floor(pageSize) || SUPABASE_PAGE_SIZE);
  const rows = [];
  let cursor = null;

  while (true) {
    if (signal?.aborted) return abortedResult();
    let query = createQuery()
      .order(orderColumn, { ascending })
      .order(idColumn, { ascending })
      .limit(boundedPageSize);
    if (cursor) query = query.or(buildKeysetFilter({ orderColumn, idColumn, ascending, cursor }));
    const { data, error } = await withSignal(query, signal);
    if (error) return { data: null, error };

    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < boundedPageSize) return { data: rows, error: null };

    const last = page[page.length - 1];
    if (last?.[orderColumn] == null || last?.[idColumn] == null) {
      return { data: null, error: { code: 'KEYSET_NULL', message: `The ${orderColumn} ordering column returned an empty value.` } };
    }
    cursor = { value: last[orderColumn], id: last[idColumn] };
  }
};

export const fetchRowsInBatches = async (
  ids,
  createQuery,
  {
    batchSize = SUPABASE_IN_BATCH_SIZE,
    concurrency = SUPABASE_QUERY_CONCURRENCY,
    pageSize = SUPABASE_PAGE_SIZE,
    signal,
  } = {},
) => {
  const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))];
  if (!uniqueIds.length) return { data: [], error: null };

  const boundedBatchSize = Math.max(1, Math.floor(batchSize) || SUPABASE_IN_BATCH_SIZE);
  const boundedConcurrency = Math.max(1, Math.floor(concurrency) || SUPABASE_QUERY_CONCURRENCY);
  const batches = [];
  for (let offset = 0; offset < uniqueIds.length; offset += boundedBatchSize) {
    batches.push(uniqueIds.slice(offset, offset + boundedBatchSize));
  }

  const results = new Array(batches.length);
  let nextBatch = 0;
  let failure = null;
  const workers = Array.from({ length: Math.min(boundedConcurrency, batches.length) }, async () => {
    while (!failure && nextBatch < batches.length) {
      const index = nextBatch;
      nextBatch += 1;
      results[index] = await fetchPagedRows(() => createQuery(batches[index]), { pageSize, signal });
      if (results[index].error) failure = results[index].error;
    }
  });
  await Promise.all(workers);

  if (failure) return { data: null, error: failure };
  return { data: results.flatMap((result) => result.data), error: null };
};
