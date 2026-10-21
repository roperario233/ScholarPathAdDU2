import { sanitizeStorageFileName } from './documentStorage';

// Profile photos live in their own private Supabase Storage bucket. Unlike a
// Document Vault file, an avatar is a single object per user keyed by their
// user id (`<ownerId>/<timestamp>-<file>`), so replacing it never needs a
// document row. The bucket and its owner-only policies come from
// supabase/migrations/20261026000000_add_profile_avatar.sql.
export const AVATAR_BUCKET = 'avatars';
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp';
export const AVATAR_ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const buildAvatarStoragePath = ({ ownerId = '', fileName = 'avatar.jpg', at = Date.now() } = {}) =>
  `${ownerId}/${at}-${sanitizeStorageFileName(fileName)}`;
