// Additional-document requests (20261114000000_add_document_requests.sql).
//
// While an application is at document verification the Admissions Office Admin may
// ask the student for more files for a catalog requirement (a second set of
// residence photos), for one document the catalog did not require, or for
// something described in words. The application does not change stage: an Open
// request holds it at verification (the database repeats that in
// enforce_document_verification_before_progress), and the student answers it from
// the application's details. The note is shown to the student, so it never carries
// anything confidential.
//
// Everything here mirrors the RPCs in the migration (request_application_documents,
// fulfill_document_request, cancel_document_request) so the form can say what the
// database would refuse before the round trip.

import { getDocumentTypeLabel } from './constants';
import { countOpenDocumentRequests, getMatchingVaultDocuments } from './applicationRequirements';

export const DOCUMENT_REQUEST_KINDS = [
  { value: 'more_files', label: 'More files for a requirement', description: 'Ask for additional files of a document the scholarship already requires, such as more residence photos.' },
  { value: 'new_document', label: 'A document not yet required', description: 'Ask for one document type the scholarship did not list.' },
  { value: 'free_text', label: 'Something else', description: 'Describe what you need and let the student attach any vault file.' },
];

export const DOCUMENT_REQUEST_STATUS_LABELS = {
  Open: 'Waiting for the student',
  Fulfilled: 'Provided',
  Cancelled: 'Cancelled',
};

export const DOCUMENT_REQUEST_LABEL_MAX = 120;
export const DOCUMENT_REQUEST_NOTE_MAX = 500;
export const DOCUMENT_REQUEST_CANCEL_REASON_MAX = 300;
export const DOCUMENT_REQUEST_MAX_FILES = 10;

// A request can be raised only at document verification (the same stage the
// Documents tab opens and a reverted file can be replaced).
export const canRequestDocuments = (status) => status === 'For Verification';

// The requirements a "more files" request can name: the catalog's own rows. A
// claim row (`claim: true`, e.g. proof of PWD) comes from the student's profile,
// not the scholarship, so the database cannot match it; ask for it as a new
// document instead.
export const getRequestableRequirements = (requirements = []) => (
  requirements.filter((requirement) => !requirement.claim && requirement.documentTypes?.length)
);

export const getDocumentRequestsForApplication = (requests = [], applicationId) => (
  (Array.isArray(requests) ? requests : [])
    .filter((request) => request.applicationId === applicationId)
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')) || String(right.id).localeCompare(String(left.id)))
);

export const getOpenDocumentRequests = (requests = [], applicationId) => (
  getDocumentRequestsForApplication(requests, applicationId).filter((request) => request.status === 'Open')
);

// Validates the Admin's form and returns the payload the RPC takes.
//   draft: { kind, requirementId, documentType, label, note, minFiles }
export const validateDocumentRequest = (draft = {}, { requirements = [] } = {}) => {
  const errors = {};
  const kind = draft.kind;
  const label = String(draft.label ?? '').trim();
  const note = String(draft.note ?? '').trim();
  let requirementId = null;
  let documentTypes = [];
  let minFiles = 1;

  if (!DOCUMENT_REQUEST_KINDS.some((entry) => entry.value === kind)) {
    errors.kind = 'Choose what kind of request this is.';
  }

  if (kind === 'more_files') {
    const requirement = getRequestableRequirements(requirements).find((entry) => entry.id === draft.requirementId);
    if (!requirement) {
      errors.requirementId = 'Choose which required document needs more files.';
    } else {
      requirementId = requirement.id;
      documentTypes = requirement.documentTypes;
    }
    minFiles = Number(draft.minFiles);
    if (!Number.isInteger(minFiles) || minFiles < 1 || minFiles > DOCUMENT_REQUEST_MAX_FILES) {
      errors.minFiles = `Ask for between 1 and ${DOCUMENT_REQUEST_MAX_FILES} additional files.`;
      minFiles = 1;
    }
  } else if (kind === 'new_document') {
    if (!draft.documentType) errors.documentType = 'Choose the document type to request.';
    else documentTypes = [draft.documentType];
  }

  if (!label) errors.label = 'Name what you are asking for.';
  else if (label.length > DOCUMENT_REQUEST_LABEL_MAX) errors.label = `Keep the name to ${DOCUMENT_REQUEST_LABEL_MAX} characters or fewer.`;

  if (!note) errors.note = 'Tell the student what to provide.';
  else if (note.length > DOCUMENT_REQUEST_NOTE_MAX) errors.note = `Keep the note to ${DOCUMENT_REQUEST_NOTE_MAX} characters or fewer.`;

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, errors, value: { kind, requirementId, documentTypes, label, note, minFiles } };
};

// The label the form proposes once the Admin has chosen what to ask for.
export const suggestRequestLabel = (draft = {}, { requirements = [] } = {}) => {
  if (draft.kind === 'more_files') {
    return getRequestableRequirements(requirements).find((entry) => entry.id === draft.requirementId)?.label || '';
  }
  if (draft.kind === 'new_document' && draft.documentType) return getDocumentTypeLabel(draft.documentType);
  return '';
};

// Document types a student's new upload may carry for this request. A request
// described in words takes any vault file, and a new upload becomes a Supporting
// Document.
export const getRequestUploadTypes = (request) => (
  request?.documentTypes?.length ? request.documentTypes : ['Supporting Document']
);

// What the student can attach: their own non-reverted vault files of an accepted
// type that the application does not already use, newest first. Mirrors the checks
// in fulfill_document_request.
export const getRequestFulfilmentOptions = ({ application, request, documents = [] }) => {
  const attachedIds = application?.attachedDocuments || [];
  const typed = request?.documentTypes?.length > 0;
  const pool = typed
    ? getMatchingVaultDocuments({ documentTypes: request.documentTypes }, documents)
    : [...documents].sort((left, right) => String(right.uploadedAt || '').localeCompare(String(left.uploadedAt || '')));
  return pool.filter((doc) => doc.verificationStatus !== 'Rejected' && !attachedIds.includes(doc.id));
};

export const describeDocumentRequest = (request) => {
  if (!request) return { title: '', summary: '', types: '' };
  const types = (request.documentTypes || []).map(getDocumentTypeLabel).join(', ');
  const count = request.minFiles || 1;
  const summary = request.kind === 'more_files'
    ? `Add ${count} more file${count === 1 ? '' : 's'}`
    : request.kind === 'new_document'
      ? 'Add this document'
      : 'Add what is described';
  return { title: request.label, summary, types };
};

// Whether the files the student chose answer the request (the same minimum the
// database enforces).
export const isRequestAnswerable = (request, selectedCount) => (
  Boolean(request) && request.status === 'Open' && selectedCount >= (request.minFiles || 1)
);

export { countOpenDocumentRequests };
