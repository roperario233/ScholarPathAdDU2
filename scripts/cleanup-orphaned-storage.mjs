#!/usr/bin/env node
/**
 * Deletes Storage objects that no database row names.
 *
 *   $env:SUPABASE_SERVICE_ROLE_KEY="..."
 *   npm run cleanup:storage              # dry run: prints the manifest only
 *   npm run cleanup:storage -- --apply   # deletes the orphaned objects
 *
 * `documents.storage_path` and `profiles.avatar_path` are the only handles the
 * app has on a file. When a row is deleted without its object (a refused vault
 * delete, a removed account, a failed `storage.remove`), the bytes stay in the
 * private bucket with nothing pointing at them. This script lists both buckets,
 * subtracts every referenced path, and reports or removes the difference.
 *
 * The service role is required: `documents_storage_owner_access` and
 * `avatars_owner_access` only let a folder's owner delete, and most orphans sit
 * in folders whose account no longer exists, so no signed-in session can ever
 * reclaim them. Set the key in the shell for one run; never in `.env` and never
 * with a `VITE_` prefix (that would inline it into the browser bundle).
 *
 * Deleting an object is irreversible. The dry run prints one line per object
 * with its size, grouped by owner folder, before anything is removed.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');

/**
 * The project URL only identifies the project, so it can fall back to the Vite
 * variable already in `.env`. The service key deliberately has no file
 * fallback: it must be supplied in the shell for a single run.
 */
const projectUrlFromEnvFile = () => {
  try {
    const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:SUPABASE_URL|VITE_SUPABASE_URL)\s*=\s*(.+?)\s*$/);
      if (match) return match[1].replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // no .env: the URL has to come from the shell
  }
  return '';
};

const url = String(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || projectUrlFromEnvFile() || '',
).trim();
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!url) {
  console.error('Missing the project URL. Set SUPABASE_URL, or put VITE_SUPABASE_URL in .env.');
  process.exit(1);
}

if (!serviceKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY.');
  console.error('PowerShell: $env:SUPABASE_SERVICE_ROLE_KEY="..."; npm run cleanup:storage');
  console.error('The browser key cannot do this: the storage policies only let a folder owner delete.');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// bucket -> the table and column that name each live object
const BUCKETS = [
  { id: 'documents', table: 'documents', column: 'storage_path' },
  { id: 'avatars', table: 'profiles', column: 'avatar_path' },
];

const PAGE = 1000;
const BATCH = 100;

/** Every object in a bucket. `list` returns folders as entries with a null id. */
const listObjects = async (bucket, prefix = '') => {
  const found = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: PAGE, offset });
    if (error) throw new Error(`Could not list ${bucket}/${prefix || '/'}: ${error.message}`);
    if (!data?.length) break;

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) found.push(...await listObjects(bucket, path));
      else found.push({ path, size: Number(entry.metadata?.size || 0) });
    }

    if (data.length < PAGE) break;
  }
  return found;
};

/** Every path the database still points at, past the PostgREST row cap. */
const referencedPaths = async (table, column) => {
  const paths = new Set();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .not(column, 'is', null)
      .order(column)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read ${table}.${column}: ${error.message}`);
    if (!data?.length) break;

    for (const row of data) if (row[column]) paths.add(row[column]);
    if (data.length < PAGE) break;
  }
  return paths;
};

const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
};

const removeBatch = async (bucket, paths) => {
  const { data, error } = await supabase.storage.from(bucket).remove(paths);
  if (error) return { removed: [], error: error.message };
  return { removed: (data || []).map((entry) => entry.name), error: null };
};

let totalOrphans = 0;
let totalBytes = 0;
let totalRemoved = 0;
const failures = [];

for (const bucket of BUCKETS) {
  const objects = await listObjects(bucket.id);
  const referenced = await referencedPaths(bucket.table, bucket.column);
  const orphans = objects.filter((object) => !referenced.has(object.path));

  console.log(`\n${bucket.id}: ${objects.length} object(s), ${referenced.size} referenced, ${orphans.length} orphaned`);
  if (!orphans.length) continue;

  const byFolder = new Map();
  for (const orphan of orphans) {
    const folder = orphan.path.split('/')[0] || '(root)';
    const entry = byFolder.get(folder) || { bytes: 0, paths: [] };
    entry.bytes += orphan.size;
    entry.paths.push(orphan);
    byFolder.set(folder, entry);
  }

  const bucketBytes = orphans.reduce((sum, object) => sum + object.size, 0);
  totalOrphans += orphans.length;
  totalBytes += bucketBytes;

  for (const [folder, entry] of byFolder) {
    console.log(`  ${folder}  ${entry.paths.length} object(s)  ${formatBytes(entry.bytes)}`);
    if (!APPLY) {
      for (const orphan of entry.paths) console.log(`    - ${orphan.path}  (${formatBytes(orphan.size)})`);
    }
  }

  if (!APPLY) continue;

  let removedInBucket = 0;
  for (let index = 0; index < orphans.length; index += BATCH) {
    const batch = orphans.slice(index, index + BATCH).map((orphan) => orphan.path);
    const { removed, error } = await removeBatch(bucket.id, batch);
    removedInBucket += removed.length;
    totalRemoved += removed.length;
    if (error) {
      failures.push(`${bucket.id}: ${error}`);
      continue;
    }
    for (const path of batch) {
      if (!removed.includes(path)) failures.push(`${bucket.id}: ${path} was not confirmed removed`);
    }
  }
  console.log(`  removed ${removedInBucket} of ${orphans.length} object(s)`);
}

console.log(`\n${APPLY ? 'Deleted' : 'Would delete'} ${totalOrphans} orphaned object(s), ${formatBytes(totalBytes)}.`);
if (APPLY) {
  console.log(`Confirmed removed: ${totalRemoved}.`);
  if (failures.length) {
    console.error(`\n${failures.length} failure(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  }
} else {
  console.log('Dry run only. Re-run with `npm run cleanup:storage -- --apply` to delete them.');
}
