/* global __ENV, __ITER */
import http from 'k6/http';
import { check, sleep } from 'k6';
import execution from 'k6/execution';

const forbiddenLiveProjectRef = 'xzptlibbavjswlbgjckx';
const projectUrl = __ENV.SUPABASE_URL || '';
const projectRef = projectUrl ? new URL(projectUrl).hostname.split('.')[0] : '';
const expectedProjectRef = __ENV.K6_STAGING_PROJECT_REF || '';
const anonKey = __ENV.SUPABASE_ANON_KEY || '';
const studentTokens = (__ENV.K6_STUDENT_TOKENS || '').split(',').map((token) => token.trim()).filter(Boolean);
const officeTokens = (__ENV.K6_OFFICE_TOKENS || '').split(',').map((token) => token.trim()).filter(Boolean);
const reviewerTokens = (__ENV.K6_REVIEWER_TOKENS || '').split(',').map((token) => token.trim()).filter(Boolean);
const officeAuditToken = __ENV.K6_OFFICE_AUDIT_TOKEN || '';
const releaseWritesEnabled = __ENV.K6_ENABLE_STAGING_WRITES === '1';
const releaseAdminToken = __ENV.K6_RELEASE_ADMIN_TOKEN || '';
const releaseRequestId = __ENV.K6_RELEASE_REQUEST_ID || '';
const releaseScholarshipId = __ENV.K6_RELEASE_SCHOLARSHIP_ID || '';
const releaseConfirmBy = __ENV.K6_RELEASE_CONFIRM_BY || '';
const maximumVus = 151;
const studentStages = [
  { duration: '1m', target: 15 },
  { duration: '1m', target: 15 },
  { duration: '1m', target: 30 },
  { duration: '1m', target: 30 },
  { duration: '1m', target: 75 },
  { duration: '1m', target: 75 },
  { duration: '1m', target: 112 },
  { duration: '3m', target: 112 },
  { duration: '1m', target: 0 },
];
const officeStages = [5, 5, 10, 10, 15, 15, 20, 20, 0].map((target, index) => ({ duration: studentStages[index].duration, target }));
const reviewerStages = [5, 5, 10, 10, 10, 10, 18, 18, 0].map((target, index) => ({ duration: studentStages[index].duration, target }));

if (__ENV.K6_TARGET_ENV !== 'staging') throw new Error('This load test only runs when K6_TARGET_ENV=staging.');
if (!projectUrl || !expectedProjectRef || projectRef !== expectedProjectRef) {
  throw new Error('SUPABASE_URL must match K6_STAGING_PROJECT_REF exactly.');
}
if (projectRef === forbiddenLiveProjectRef) throw new Error('Refusing to load-test the configured live project.');
if (!anonKey) throw new Error('Set SUPABASE_ANON_KEY for the staging Data API.');
if ([studentTokens, officeTokens, reviewerTokens].some((tokens) => tokens.length < maximumVus)) {
  throw new Error('Provide 151 unique JWTs for each role; VU IDs are global across k6 scenarios.');
}
if (!officeAuditToken || officeTokens.includes(officeAuditToken)) throw new Error('Provide a separate K6_OFFICE_AUDIT_TOKEN for full pagination audits.');
const allReadTokens = [...studentTokens, ...officeTokens, ...reviewerTokens, officeAuditToken];
if (new Set(allReadTokens).size !== allReadTokens.length) throw new Error('Every staging read/audit JWT must be unique.');
if (releaseWritesEnabled) {
  if (!releaseAdminToken || !releaseRequestId || !releaseScholarshipId || !releaseConfirmBy) {
    throw new Error('A staging batch-release test needs an Admin JWT, fresh request ID, scholarship ID, and confirm-by date.');
  }
  if (__ENV.K6_WRITE_CONFIRM !== `release:${projectRef}:${releaseRequestId}`) {
    throw new Error('K6_WRITE_CONFIRM must exactly match release:<staging-ref>:<request-id> before the destructive staging-only release replay scenario runs.');
  }
  if (allReadTokens.includes(releaseAdminToken)) throw new Error('Use a separate staging Admin JWT for the release replay scenario.');
}

export const options = {
  scenarios: {
    student_reads: { executor: 'ramping-vus', startVUs: 0, stages: studentStages, exec: 'studentReads', gracefulRampDown: '30s' },
    office_reads: {
      executor: 'ramping-vus', startVUs: 0,
      stages: officeStages,
      exec: 'officeReads', gracefulRampDown: '30s',
    },
    reviewer_reads: {
      executor: 'ramping-vus', startVUs: 0,
      stages: reviewerStages,
      exec: 'reviewerReads', gracefulRampDown: '30s',
    },
    office_pagination_audit: {
      executor: 'constant-vus',
      vus: 1,
      duration: '11m',
      exec: 'officePaginationAudit',
    },
    ...(releaseWritesEnabled ? {
      idempotent_release_replay: {
        executor: 'constant-vus',
        vus: 20,
        duration: '30s',
        exec: 'releaseBatchReplay',
      },
    } : {}),
  },
  thresholds: {
    http_req_failed: ['rate<0.005'],
    http_req_duration: ['p(95)<1000', 'p(99)<3000'],
  },
};

const headersFor = (token, extra = {}) => ({
  apikey: anonKey,
  Authorization: `Bearer ${token}`,
  'Accept-Profile': 'public',
  'Content-Profile': 'public',
  ...extra,
});

const tokenForCurrentVu = (tokens, role) => {
  const index = execution.vu.idInTest - 1;
  if (index < 0 || index >= tokens.length) {
    throw new Error(`Provide at least ${index + 1} unique ${role} JWTs for the current ramp stage.`);
  }
  return tokens[index];
};

const dataApi = (table, query) => `${projectUrl}/rest/v1/${table}?${query}`;
const appPageQuery = (offset, ascending = false) => {
  const query = new URLSearchParams({
    select: 'id,status,student_id,scholarship_id,submitted_at,updated_at',
    order: ascending ? 'submitted_at.asc,id.asc' : 'updated_at.desc,id.desc',
    limit: '50',
    offset: String(offset),
  });
  return query.toString();
};

const appParams = (offset, token, role) => ({
  headers: headersFor(token, { Range: `${offset}-${offset + 49}`, 'Range-Unit': 'items' }),
  tags: { role, surface: 'application-page' },
});

const checkRowsResponse = (response, role, surface) => check(response, {
  [`${role} ${surface} page status`]: (res) => res.status === 200 || res.status === 206,
  [`${role} ${surface} payload is JSON`]: (res) => Boolean(res.headers['Content-Type']?.includes('application/json')),
});

const auditPages = (token, role, ascending = false) => {
  const seen = new Set();
  let totalRows = 0;
  let exhausted = false;
  for (let page = 0; page < 100; page += 1) {
    const offset = page * 50;
    const response = http.get(dataApi('applications', appPageQuery(offset, ascending)), appParams(offset, token, role, ascending));
    if (!checkRowsResponse(response, role, 'pagination audit')) return;
    const rows = response.json();
    totalRows += rows.length;
    rows.forEach((row) => seen.add(row.id));
    if (rows.length < 50) {
      exhausted = true;
      break;
    }
  }
  const expected = Number(__ENV.K6_EXPECTED_APPLICATIONS || 0);
  check(seen, {
    [`${role} pagination has no duplicate IDs and reaches a short final page`]: (ids) => ids.size === totalRows && exhausted,
    ...(role === 'office' && expected ? { 'office can traverse expected application count': (ids) => ids.size >= expected } : {}),
  });
};

const readApplicationPage = (token, role, iteration, ascending = false) => {
  const offset = (iteration % 20) * 50;
  const response = http.get(dataApi('applications', appPageQuery(offset, ascending)), appParams(offset, token, role));
  checkRowsResponse(response, role, 'application');
  if (response.status !== 200 && response.status !== 206) return [];
  const rows = response.json();
  return rows;
};

export function studentReads() {
  const token = tokenForCurrentVu(studentTokens, 'student');
  const apps = readApplicationPage(token, 'student', __ITER);
  const docsQuery = new URLSearchParams({ select: 'id,verification_status,uploaded_at,updated_at', order: 'uploaded_at.desc,id.desc', limit: '50', offset: String((__ITER % 10) * 50) });
  const docs = http.get(dataApi('documents', docsQuery.toString()), {
    headers: headersFor(token, { Range: `${(__ITER % 10) * 50}-${((__ITER % 10) * 50) + 49}`, 'Range-Unit': 'items' }),
    tags: { role: 'student', surface: 'document-page' },
  });
  checkRowsResponse(docs, 'student', 'document');
  if (apps.length && __ITER % 4 === 0) {
    const historyQuery = new URLSearchParams({ select: 'id,application_id,to_status,created_at', application_id: `eq.${apps[0].id}`, order: 'created_at.asc,id.asc', limit: '50' });
    checkRowsResponse(http.get(dataApi('application_status_log', historyQuery.toString()), {
      headers: headersFor(token), tags: { role: 'student', surface: 'status-history' },
    }), 'student', 'status history');
  }
  sleep(10);
}

export function officeReads() {
  const token = tokenForCurrentVu(officeTokens, 'office');
  const apps = readApplicationPage(token, 'office', __ITER, true);
  const docsQuery = new URLSearchParams({ select: 'id,verification_status,uploaded_at,updated_at', order: 'uploaded_at.desc,id.desc', limit: '50', offset: String((__ITER % 10) * 50) });
  const docs = http.get(dataApi('documents', docsQuery.toString()), {
    headers: headersFor(token, { Range: `${(__ITER % 10) * 50}-${((__ITER % 10) * 50) + 49}`, 'Range-Unit': 'items' }),
    tags: { role: 'office', surface: 'document-page' },
  });
  checkRowsResponse(docs, 'office', 'document');
  if (apps.length && __ITER % 4 === 0) {
    const linkedQuery = new URLSearchParams({ select: 'application_id,document_id', application_id: `in.(${apps.slice(0, 25).map((row) => row.id).join(',')})` });
    const response = http.get(dataApi('application_documents', linkedQuery.toString()), {
      headers: headersFor(token), tags: { role: 'office', surface: 'visible-document-links' },
    });
    check(response, { 'office bounded link request succeeds': (res) => res.status === 200 || res.status === 206 });
  }
  sleep(10);
}

export function reviewerReads() {
  const token = tokenForCurrentVu(reviewerTokens, 'reviewer');
  const apps = readApplicationPage(token, 'reviewer', __ITER, true);
  if (apps.length && __ITER % 4 === 0) {
    const linksQuery = new URLSearchParams({ select: 'application_id,document_id', application_id: `in.(${apps.slice(0, 25).map((row) => row.id).join(',')})` });
    const response = http.get(dataApi('application_documents', linksQuery.toString()), {
      headers: headersFor(token), tags: { role: 'reviewer', surface: 'visible-document-links' },
    });
    check(response, { 'reviewer scoped link request succeeds': (res) => res.status === 200 || res.status === 206 });
  }
  sleep(10);
}

export function officePaginationAudit() {
  auditPages(officeAuditToken, 'office', true);
  sleep(60);
}

// Optional and destructive only within the explicitly confirmed staging
// scholarship. All iterations share one idempotency key to exercise safe replay.
export function releaseBatchReplay() {
  const response = http.post(`${projectUrl}/rest/v1/rpc/release_scholarship_results`, JSON.stringify({
    p_scholarship_id: releaseScholarshipId,
    p_confirm_by: releaseConfirmBy,
    p_request_id: releaseRequestId,
  }), {
    headers: headersFor(releaseAdminToken, { 'Content-Type': 'application/json' }),
    tags: { role: 'office', surface: 'batch-release-replay' },
  });
  check(response, {
    'idempotent batch release returns success': (res) => res.status === 200 && Boolean(res.json('release')?.id),
  });
  sleep(1);
}
