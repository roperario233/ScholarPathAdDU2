import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import ApplicationReviewModal from '../src/components/ApplicationReviewModal';
import RequestDocumentsModal from '../src/components/RequestDocumentsModal';
import DocumentRequestResponder from '../src/components/DocumentRequestResponder';
import { DocumentRequestsContext } from '../src/lib/documentRequestsContext';
import { createFreshState } from '../src/lib/appState';
import { mergeWorkspaceRefresh } from '../src/lib/workspaceRefresh';
import { getDocumentVerificationReadiness, isApplicationVerifiedForEndorsement } from '../src/lib/applicationRequirements';
import {
  canRequestDocuments,
  describeDocumentRequest,
  getOpenDocumentRequests,
  getRequestFulfilmentOptions,
  getRequestUploadTypes,
  getRequestableRequirements,
  isRequestAnswerable,
  suggestRequestLabel,
  validateDocumentRequest,
} from '../src/lib/documentRequests';

// Additional-document requests (20261114000000): the Admin asks the student for
// more files while the application is at document verification. The stage does
// not change; an open request holds the case there.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const migration = read('../supabase/migrations/20261114000000_add_document_requests.sql');
const schema = read('../supabase/schema.sql');

const requirements = [
  { id: 'residence-photos', label: 'Photos of Residence', documentTypes: ['Photos of Residence'] },
  { id: 'income-proof', label: 'Proof of income', documentTypes: ['Income Proof', 'Certificate of Indigency'] },
  { id: 'proof-pwd', label: 'Proof of PWD status', documentTypes: ['PWD ID'], claim: true },
];

const request = (overrides = {}) => ({
  id: 'req-1',
  applicationId: 'app-1',
  kind: 'more_files',
  requirementId: 'residence-photos',
  documentTypes: ['Photos of Residence'],
  label: 'Photos of Residence',
  note: 'Please add two more photos of the front and side of the house.',
  minFiles: 2,
  status: 'Open',
  createdAt: '2026-11-14T01:00:00.000Z',
  ...overrides,
});

const vaultDoc = (id, documentType, verificationStatus = 'Pending', uploadedAt = '2026-11-01') => ({
  id, documentType, verificationStatus, uploadedAt, title: `${documentType} ${id}`,
});

describe('validateDocumentRequest', () => {
  it('builds the RPC payload for more files of a catalog requirement', () => {
    const checked = validateDocumentRequest(
      { kind: 'more_files', requirementId: 'residence-photos', minFiles: '2', label: ' Photos of Residence ', note: '  Two more, please. ' },
      { requirements },
    );
    expect(checked.ok).toBe(true);
    expect(checked.value).toEqual({
      kind: 'more_files',
      requirementId: 'residence-photos',
      documentTypes: ['Photos of Residence'],
      label: 'Photos of Residence',
      note: 'Two more, please.',
      minFiles: 2,
    });
  });

  it('refuses a claim row, an out-of-range count, a missing name and a missing note', () => {
    const claim = validateDocumentRequest({ kind: 'more_files', requirementId: 'proof-pwd', minFiles: 1, label: 'x', note: 'y' }, { requirements });
    expect(claim.errors.requirementId).toBeTruthy();
    const count = validateDocumentRequest({ kind: 'more_files', requirementId: 'residence-photos', minFiles: 11, label: 'x', note: 'y' }, { requirements });
    expect(count.errors.minFiles).toBeTruthy();
    const empty = validateDocumentRequest({ kind: 'free_text', label: ' ', note: '' }, { requirements });
    expect(empty.ok).toBe(false);
    expect(empty.errors.label).toBeTruthy();
    expect(empty.errors.note).toBeTruthy();
  });

  it('asks for one document type for a new document and none for free text', () => {
    expect(validateDocumentRequest({ kind: 'new_document', label: 'Indigency', note: 'n' }, { requirements }).errors.documentType).toBeTruthy();
    const typed = validateDocumentRequest({ kind: 'new_document', documentType: 'Certificate of Indigency', label: 'Indigency', note: 'n' }, { requirements });
    expect(typed.value).toMatchObject({ documentTypes: ['Certificate of Indigency'], minFiles: 1, requirementId: null });
    const free = validateDocumentRequest({ kind: 'free_text', documentType: 'Passport', minFiles: 5, label: 'Roof photo', note: 'A clearer roof photo.' }, { requirements });
    expect(free.value).toMatchObject({ documentTypes: [], minFiles: 1, requirementId: null });
  });

  it('keeps the note and name within the database limits', () => {
    expect(validateDocumentRequest({ kind: 'free_text', label: 'x'.repeat(121), note: 'n' }, { requirements }).errors.label).toBeTruthy();
    expect(validateDocumentRequest({ kind: 'free_text', label: 'x', note: 'n'.repeat(501) }, { requirements }).errors.note).toBeTruthy();
  });

  it('lists only catalog requirements and proposes a name from the choice', () => {
    expect(getRequestableRequirements(requirements).map((entry) => entry.id)).toEqual(['residence-photos', 'income-proof']);
    expect(suggestRequestLabel({ kind: 'more_files', requirementId: 'income-proof' }, { requirements })).toBe('Proof of income');
    expect(suggestRequestLabel({ kind: 'new_document', documentType: 'Passport' })).toBe('Passport');
  });
});

describe('request selectors', () => {
  it('opens a request only at document verification', () => {
    expect(canRequestDocuments('For Verification')).toBe(true);
    ['Submitted', 'Under Review', 'Endorsed', 'Draft'].forEach((status) => expect(canRequestDocuments(status)).toBe(false));
  });

  it('keeps only the open requests of one application, newest first', () => {
    const rows = [
      request({ id: 'a', createdAt: '2026-11-10T00:00:00.000Z' }),
      request({ id: 'b', createdAt: '2026-11-12T00:00:00.000Z' }),
      request({ id: 'c', status: 'Fulfilled' }),
      request({ id: 'd', applicationId: 'app-2' }),
    ];
    expect(getOpenDocumentRequests(rows, 'app-1').map((entry) => entry.id)).toEqual(['b', 'a']);
  });

  it('offers the student their own unattached, non-reverted files of an accepted type', () => {
    const documents = [
      vaultDoc('photo-new', 'Photos of Residence', 'Pending', '2026-11-05'),
      vaultDoc('photo-old', 'Photos of Residence', 'Verified', '2026-10-01'),
      vaultDoc('photo-bad', 'Photos of Residence', 'Rejected'),
      vaultDoc('photo-attached', 'Photos of Residence'),
      vaultDoc('passport', 'Passport'),
    ];
    const options = getRequestFulfilmentOptions({ application: { attachedDocuments: ['photo-attached'] }, request: request(), documents });
    expect(options.map((entry) => entry.id)).toEqual(['photo-new', 'photo-old']);
  });

  it('accepts any vault file for a request described in words', () => {
    const documents = [vaultDoc('passport', 'Passport'), vaultDoc('bad', 'Passport', 'Rejected')];
    const free = request({ kind: 'free_text', documentTypes: [], minFiles: 1 });
    expect(getRequestFulfilmentOptions({ application: { attachedDocuments: [] }, request: free, documents }).map((entry) => entry.id)).toEqual(['passport']);
    expect(getRequestUploadTypes(free)).toEqual(['Supporting Document']);
  });

  it('answers a request only once the minimum count is chosen', () => {
    expect(isRequestAnswerable(request(), 1)).toBe(false);
    expect(isRequestAnswerable(request(), 2)).toBe(true);
    expect(isRequestAnswerable(request({ status: 'Fulfilled' }), 5)).toBe(false);
    expect(describeDocumentRequest(request())).toMatchObject({ summary: 'Add 2 more files', title: 'Photos of Residence' });
  });
});

describe('the verification gate', () => {
  const application = { id: 'app-1', attachedDocuments: ['doc-1'] };
  const documents = [vaultDoc('doc-1', 'Income Proof', 'Verified')];

  it('is held by an open request even when every attached file is Verified', () => {
    expect(isApplicationVerifiedForEndorsement(application, documents, [])).toBe(true);
    expect(isApplicationVerifiedForEndorsement(application, documents, [request()])).toBe(false);
    expect(getDocumentVerificationReadiness(application, documents, [request()])).toMatchObject({ openRequests: 1, outstanding: 0, ready: false });
  });

  it('is released by an answered or cancelled request, and ignores another application', () => {
    expect(isApplicationVerifiedForEndorsement(application, documents, [request({ status: 'Fulfilled' })])).toBe(true);
    expect(isApplicationVerifiedForEndorsement(application, documents, [request({ status: 'Cancelled' })])).toBe(true);
    expect(isApplicationVerifiedForEndorsement(application, documents, [request({ applicationId: 'app-2' })])).toBe(true);
  });

  it('keeps existing callers working with no request list', () => {
    expect(getDocumentVerificationReadiness(application, documents)).toMatchObject({ openRequests: 0, ready: true });
  });
});

describe('workspace state', () => {
  it('starts empty and clears with the rest of the session', () => {
    const fresh = createFreshState();
    expect(fresh.documentRequests).toEqual([]);
    expect(fresh.documentRequestsReady).toBe(true);
  });

  it('merges changed requests by id on a delta refresh', () => {
    const previous = { ...createFreshState(), ownerId: 'user-1', viewerRole: 'admissions_admin', documentRequests: [request({ id: 'a' }), request({ id: 'b' })] };
    const refreshed = mergeWorkspaceRefresh(previous, {
      success: true,
      refreshMode: 'delta',
      documentRequests: [request({ id: 'b', status: 'Fulfilled' }), request({ id: 'c' })],
    }, 'user-1');
    expect(refreshed.documentRequests.map((entry) => [entry.id, entry.status]).sort()).toEqual([['a', 'Open'], ['b', 'Fulfilled'], ['c', 'Open']]);
  });
});

describe('migration', () => {
  it('lets only the Admin raise or cancel and only the owning student answer', () => {
    expect(migration).toMatch(/request_application_documents[\s\S]*?is_admissions_admin\(\)/);
    expect(migration).toMatch(/cancel_document_request[\s\S]*?is_admissions_admin\(\)/);
    expect(migration).toMatch(/fulfill_document_request[\s\S]*?v_app\.student_id is distinct from v_actor/);
    ['request_application_documents(uuid, text, text, text[], text, text, integer)', 'cancel_document_request(uuid, text)', 'fulfill_document_request(uuid, uuid[])'].forEach((signature) => {
      expect(migration).toContain(`revoke all on function public.${signature} from public, anon;`);
      expect(migration).toContain(`grant execute on function public.${signature} to authenticated;`);
    });
  });

  it('has no client write policy and holds the case while a request is open', () => {
    expect(migration).toContain('alter table public.application_document_requests enable row level security;');
    // Policies are read-only: every write goes through a security definer function.
    expect(migration.match(/create policy[^;]*;/gi).every((policy) => /for select/i.test(policy))).toBe(true);
    expect(migration).toMatch(/r\.status = 'Open'[\s\S]*?raise exception/);
    expect(migration).toContain("application is at document verification");
  });

  it('is mirrored in the reference schema', () => {
    expect(schema).toContain('create table if not exists public.application_document_requests');
    expect(schema).toContain('create or replace function public.fulfill_document_request(');
  });
});

const reviewApplication = {
  id: 'app-1',
  status: 'For Verification',
  studentName: 'Ada Cruz',
  scholarshipTitle: 'Grant-in-Aid (GIA)',
  scholarshipId: 'scholarship-1',
  studentProgram: 'BS Computer Science',
  studentDepartment: 'School of Arts and Sciences',
  studentQpi: 3.4,
  studentHouseholdIncome: 120000,
  statement: 'I am applying for financial assistance.',
  certifiedAt: '2026-10-01T00:00:00.000Z',
  attachedDocuments: ['doc-1'],
  timeline: [],
  statusLog: [],
};
const reviewScholarship = { id: 'scholarship-1', title: 'Grant-in-Aid (GIA)', ruleFamily: 'general-pool', minimumQpi: 2.5, maximumIncome: 250000, isActive: true, isMatchable: true };
const reviewDocuments = [{ id: 'doc-1', title: 'Income', documentType: 'Income Proof', verificationStatus: 'Verified', uploadedAt: '2026-10-01', ownerId: 'student-1' }];

const renderReview = (contextValue, role = 'admissions_admin') => renderToStaticMarkup(
  <DocumentRequestsContext.Provider value={contextValue}>
    <ApplicationReviewModal
      application={reviewApplication}
      scholarship={reviewScholarship}
      documents={reviewDocuments}
      role={role}
      initialTab="documents"
      onClose={() => {}}
      onChangeDocument={() => ({ ok: true })}
    />
  </DocumentRequestsContext.Provider>,
);

describe('ApplicationReviewModal documents tab', () => {
  it('offers the Admin the request button and lists the open request with its note', () => {
    const html = renderReview({ requests: [request()], ready: true, onRequest: () => ({ ok: true }), onCancel: () => ({ ok: true }) });
    expect(html).toContain('Request more documents');
    expect(html).toContain('Requested from the student');
    expect(html).toContain('Please add two more photos of the front and side of the house.');
    expect(html).toContain('Waiting for the student');
    expect(html).toContain('Cancel request');
    // The open request holds the case, and the tab says so.
    expect(html).toContain('1 requested');
    expect(html).toContain('Forward to interview');
    expect(html).toMatch(/disabled=""[^>]*title="1 document request is still waiting for the student"/);
  });

  it('shows no request controls to Staff, and none while the migration is pending', () => {
    const staff = renderReview({ requests: [request()], ready: true, onRequest: () => ({ ok: true }), onCancel: () => ({ ok: true }) }, 'admissions_office');
    expect(staff).not.toContain('Request more documents');
    expect(staff).not.toContain('Cancel request');
    const pending = renderReview({ requests: [], ready: false, onRequest: () => ({ ok: true }), onCancel: null });
    expect(pending).not.toContain('Request more documents');
  });

  it('does not hold the case once the request is answered', () => {
    const html = renderReview({ requests: [request({ status: 'Fulfilled' })], ready: true, onRequest: () => ({ ok: true }), onCancel: null });
    expect(html).toContain('Provided');
    expect(html).not.toContain('is still waiting for the student');
  });
});

describe('request dialogs', () => {
  it('tells the Admin the note is read by the student and the stage stays put', () => {
    const html = renderToStaticMarkup(<RequestDocumentsModal requirements={requirements} onConfirm={() => ({ ok: true })} onClose={() => {}} />);
    expect(html).toContain('Request additional documents');
    expect(html).toContain('The student reads this note');
    expect(html).toContain('stays at document verification');
    expect(html).toContain('Required document');
    expect(html).toContain('How many more');
    expect(html).toContain('Send request');
    // A claim row cannot be asked for as "more files".
    expect(html).not.toContain('Proof of PWD status');
  });

  it('presets the requirement and its name when opened from a requirement row', () => {
    const html = renderToStaticMarkup(
      <RequestDocumentsModal requirements={requirements} initialKind="more_files" initialRequirementId="residence-photos" onConfirm={() => ({ ok: true })} onClose={() => {}} />,
    );
    expect(html).toMatch(/<option value="residence-photos" selected/);
    expect(html).toContain('value="Photos of Residence"');
  });

  it('shows the student the note, the count still needed, and a disabled send until it is met', () => {
    const html = renderToStaticMarkup(
      <DocumentRequestResponder request={request()} candidates={[vaultDoc('photo-1', 'Photos of Residence')]} onFulfill={() => ({ ok: true })} />,
    );
    expect(html).toContain('From the Admissions Office: ');
    expect(html).toContain('Please add two more photos');
    expect(html).toContain('Add 2 more files');
    expect(html).toContain('0 of 2 files chosen. Add 2 more to send.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send to the Admissions Office/);
    expect(html).toContain('Take photo');
  });
});
