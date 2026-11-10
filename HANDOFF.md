# Application Volume Readiness — Handoff Document

## Goal
Prepare ScholarPath AdDU for seeding 1,000+ workflow-valid applications and >100 concurrent users. All changes are in the working tree, uncommitted. Plan: `.kilo/plans/1793893980445-application-volume-readiness.md`.

## Validation status (third session)
- `npm test`: 78 files, 1100 tests, all pass
- `npm run build`: success
- `npm run lint`: 0 errors, 22 warnings (all pre-existing React Compiler / hook warnings)
- **No SQL has been executed, no Edge Function deployed, and the app has not been run against a Supabase backend.** There is no local Postgres/Docker and the live project must not be used for experiments. Every migration was reviewed by reading plus static tests (text assertions, "every `public.*` function called exists in `schema.sql`", schema/migration parity). Apply them to a staging project first.

## Migrations in this change set (apply in order, staging first)
`20261105000000` release read scoping · `000001` indexes · `000002` update cursors · `000003` import batches/RPC · `000004` atomic release RPC · `000005` stage counts · `000006` notification outbox. `000006` copies the URL/secret out of the deployed `notify_application_status_change()` (apply after `20261014000003` with real values) and schedules the `run-notification-outbox` pg_cron job.

## What the third session added (the five remaining items)
1. **Paging and lazy details.**
   - `fetchKeysetRows` (stable `(order column, id)` seek, `AbortSignal` support) now reads `applications` and `documents` at hydration, so a row updated mid-hydration is neither skipped nor repeated (tested with ties and a moving row).
   - A staff session defers the three append-only per-case streams (status log, internal comments, interview notes): `loadSupabaseWorkspaceDetails()` reads them right after the first screen with retry, `mergeWorkspaceDetails()` unions them in, and opening any case loads that case immediately (`useEnsureCaseDetails` / `CaseDetailsContext`). Reconciles keep the in-memory logs. Statistics/Dashboard/calendar routes show a "history still loading" note until `workspaceDetailsReady`.
   - **Not done:** per-page server queries behind the list pages. `profile_snapshot` and documents are still hydrated whole because queue rows, proof checks and exports read them (see "Remaining").
2. **Server counts.** `get_application_stage_counts()` (security invoker, RLS decides the scope) is compared with memory after every delta refresh; two consecutive mismatches (a deletion or a missed update) force a full reconcile. **Not done:** the Statistics/Overview figures are still derived in the client; no SQL aggregate replaces `buildOfficeStatistics()`.
3. **Non-blocking export.** `buildXlsxAsync()` (sliced rows and checksums that yield to the event loop; byte-identical to `buildXlsx()`), async downloads, a 5,000-row limit with a clear message, and a busy/error state in `ExportButton`. A Web Worker was not used: slicing needs no bundler change and is testable.
4. **Notification outbox.** Status-change and results-release triggers route through `dispatch_notification()`: all calls are recorded, the first 20 per transaction send at once, the rest wait for a once-a-minute worker (bounded batches, `skip locked`, pg_net response read-back, exponential retry, 4xx final), and a dispatch problem never fails the status write. `notification_delivery_attempts` is an append-only, PII-free history written by the reminder runner and `notify-application-status`. Release letters answer 500 when a recipient's work threw, so the outbox retries (ledger skips finished recipients). **Not done:** `notify-document-verification` and `notify-interview-update` still call pg_net directly (single events, not bulk) and write no attempt rows.
5. **UI polish.** `errorKinds.js` classifies failures (session, permission, rate-limit, conflict, validation, not-found, network, server); `WorkspaceSyncNotice` shows a stale banner with **Retry now** while the last data stays; refresh failures back off and in-flight refreshes abort on sign-out; `describeWriteError()` on submit/release/close/waitlist/document status; loader slices use `settle()`; Intake Pool filtering and the Explorer search are debounced. Release buttons already blocked double clicks (`busyKey`) and use a request UUID.

## Import test findings (fourth session)
- The first run of the 1,500-case import test (`scripts/loadtest-import.mjs`) rejected every case on the General Pool income rule: the throwaway scholarship never set `maximum_income` and the live column carried an old default. Fixed in the fixture (limits are now explicit and read back).
- A database call of 25 cases hit the API statement timeout (SQLSTATE 57014) after 19 successful ones; the importer now sends 10 per call and splits-and-retries on a timeout. A rerun used to refuse its own earlier documents ("document ID already exists"); it now skips cases the ledger already holds.
- Known quirk: `application_import_batches.failed_rows` is cumulative, so a batch that had rejected rows ends `partial` even after a clean retry. Judge a real seed by case and ledger counts, not by that label.

## Earlier fixes (second session, still relevant)
Import RPC (`jsonb_object_length`, `text[]` cast, per-record reset), waitlisted-student grant-amount policy, importer content-hash identity, key-scoped reminder ledger reads, App.jsx lint via `memoizeLast`.

## Remaining work (be honest about these)
1. **Per-page server queries** for the Intake Pool / Review Queue / Department Review / student Applications, and lazy loading of `profile_snapshot` and documents. Blocked by coupling: queue rows read the frozen snapshot (`getProofContext`), document counts feed badges, exports read snapshots. Needs an explicit design (compact list projection + on-demand detail) and a rewrite of those selectors.
2. **SQL aggregates for the Statistics page** (and a compact projection for it). Today it is computed in the browser from the hydrated applications once history has loaded.
3. Route `notify-document-verification` / `notify-interview-update` through the outbox if their volume ever becomes bulk; add attempt rows to them.
4. `auth_rls_initplan` policy rewrites — only after `EXPLAIN` on staging shows repeated evaluation.
5. Interaction tests for `ExportButton` busy state and the debounced inputs (the repo has no DOM testing library; only static markup and pure-logic tests exist).

## Required before any production seed (unchanged gates)
1. Create a staging project/branch from the production schema; apply the seven migrations; run `supabase/application_volume_health.sql`.
2. Smoke-test under RLS as student / Admin / Staff / each reviewer level: release visibility (including a waitlisted student's grant amount), `get_scoped_results_releases()`, `release_scholarship_results()` replays, `get_application_stage_counts()` per role.
3. Outbox: release a 100+ case round on staging; confirm the first 20 go out at once, the rest drain over the following minutes, a forced 500 retries with backoff, and `notification_outbox` ends `sent`.
4. Dry-run, then `--apply`, the importer against staging with 1,000+ generated identities; reconcile counts, status-log rows, attachments, and storage objects.
5. Run the k6 script (ramp 25 → 50 → 100 → 150), capture `EXPLAIN (ANALYZE, BUFFERS)` per role for the real queries, then decide which indexes in `20261105000001` stay.
6. Deployed project (`xzptlibbavjswlbgjckx`) is still at `20261063000000`; redeploy every Edge Function that imports the changed `_shared/` modules (`--no-verify-jwt` for the database/scheduled callers) together with the client build.

## Notes
- `src/components/StatisticsWorkspace.jsx` carries a pre-existing user edit (EmptyState `className`); it was left untouched.
- `.kilo/` is another tool's worktree directory (untracked, excluded from lint and Vitest).
