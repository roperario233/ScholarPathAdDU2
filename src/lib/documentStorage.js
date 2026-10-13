// Document Vault storage helpers.
//
// Supabase Storage is the authoritative home for the file bytes (a private
// `documents` bucket); the documents table records the object path in
// storage_path. Objects are keyed by `<ownerId>/<documentId>/<file>` so the
// storage RLS policy can scope a student to their own folder (the first path
// segment is their user id) and a Department Chair to their department's
// students. These helpers are pure so the path/name rules stay testable.
export const DOCUMENT_BUCKET = 'documents';
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png';
export const DOCUMENT_ACCEPTED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

// Storage keys must avoid spaces and special characters; keep a readable tail
// (including the extension) so the stored object still resembles the upload.
export const sanitizeStorageFileName = (fileName = '') => {
  const cleaned = String(fileName).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '');
  return cleaned.slice(-120) || 'document';
};

export const buildDocumentStoragePath = ({ ownerId = '', documentId = '', fileName = '' }) =>
  `${ownerId}/${documentId}/${sanitizeStorageFileName(fileName)}`;

// Images render inline in the preview modal; everything else (PDFs) uses an
// iframe.
export const isImageFileName = (fileName = '') => /\.(png|jpe?g|gif|webp|bmp)$/i.test(fileName);
