# ScholarPath AdDU

A centralized scholarship discovery, eligibility-matching, document, and application-tracking
system for Ateneo de Davao University (AdDU). ScholarPath AdDU is the working prototype built
for the capstone manuscript and evaluated with ISO/IEC 25010 and a SUS usability study.

- **Client:** React 18 + Vite 5, Tailwind CSS 3, `lucide-react` icons. No UI framework, no
  client-side router (view switching lives in `src/App.jsx`).
- **Backend:** Supabase — Postgres with row-level security, Supabase Auth (Google OAuth plus
  email/password), and two private Storage buckets.
- **Delivery:** Supabase Edge Functions (Deno) for Resend email, iprogSMS text messages, and
  Google Calendar/Meet interview events.

Supabase is required. There is no demo mode, no demo seed data, and no fallback login: without
`VITE_SUPABASE_URL` and a publishable/anon key the app shows a "not configured" message and
cannot sign in.

## Scope

In scope (manuscript chapters 1–3):

- Centralized discovery of AdDU's financial aid pipelines (Grant-in-Aid, Jubilee Scholarship,
  Working Scholar Program) and of external/government entries for reference.
- Smart Eligibility Checker over QPI *or* senior high school general average, household income,
  degree program, year standing, and the Exclusion Flag Hierarchy.
- A reusable Document Vault with verification states, attributed proofs, and multi-application
  reuse.
- The printed **FORM 230-SCH** scholarship application, answering it inside the system.
- Application tracking with an append-only status history, interview scheduling, and results.
- Deadline and status notifications (in-app, email, SMS) driven by server-side Edge Functions.
- An Admissions Office workspace, an academic reviewer ladder, and an in-app Support inbox.

Deliberately out of scope — keep these boundaries when extending the prototype:

- No disbursement or accounting of money. A recorded grant amount is a figure on the
  application, never a transfer.
- No Registrar integration. QPI, income, and the other profile answers are self-reported and
  are only *optionally* verified by the Admissions Office against Document Vault files.
- No direct administrative access for external scholarship organizations.
- No provider-backed generative AI. The ScholarPath Assistant is a deterministic, rule-based
  responder.

## Roles

Seven `profiles.role` values. The role decides the landing route, the sidebar, and every stage
action.

| Role value | Title | Lands on | Authority |
| --- | --- | --- | --- |
| `student` | Student | Dashboard | Applies, uploads, tracks, confirms or declines an offer |
| `admissions_office` | Admissions Office Staff | Admissions Office Dashboard | Read-only office view: intake pool, interviews, calendar, support inbox, volume statistics |
| `admissions_admin` | Admissions Office Admin | Admissions Office Dashboard | Verifies every document, forwards to interview, final check and release, catalog, approval levels, venues, announcements, accounts |
| `interviewer` | Interviewer (faculty) | Review (Interview queue) | One hierarchy level; schedules and runs interviews in scope, records the panel recommendation |
| `department_chair` | Chairperson | Department Review | One academic department; approves when it is the school's configured approving level |
| `assistant_dean` | Assistant Dean | Cluster Review | One cluster; approves when configured |
| `dean` | Dean | School Review | One school; approves when configured |

`src/lib/reviewScope.js` and `public.reviewer_scopes_to_student()` are the two halves of the
reviewer scope rule: the SQL decides which rows a policy returns, the module decides which rows
a page lists. A Chairperson with no assigned department keeps a legacy school-wide read so a
half-provisioned account is never locked out.

## What is implemented

| Area | Where | Notes |
| --- | --- | --- |
| Public landing page | `src/pages/LandingPage.jsx`, `src/components/landing/`, `src/landing.css` | First screen for a signed-out visitor: the three grants, the application path, an illustrative eligibility check, features, FAQ; lazy-loaded, skipped for anyone mid sign-in |
| Student Dashboard | `src/pages/DashboardView.jsx` | The three AdDU grants with explanations, coverage, requirements, and deadlines; one action into Scholarship Explorer |
| Scholarship Explorer | `src/pages/ScholarshipExplorer.jsx` | Dynamic faceted search plus an always-open Smart Eligibility Checker per card |
| Application workspace | `src/components/ApplicationWorkspaceModal.jsx` | Five steps: required documents, Application form, financial situation, statement, review and submit |
| Application tracking | `src/pages/ApplicationsView.jsx` | Filters, detail modal, status history, reverted-file replacement, FORM 230-SCH **Print** sheet |
| Document Vault | `src/pages/DocumentVaultView.jsx` | Upload, search, verification badges, outdated proofs, delete |
| Calendar | `src/pages/CalendarView.jsx` | Scholarship deadlines, exam/interview dates, student reminders |
| Notifications | `src/components/NotificationDropdown.jsx` | In-app center; channel and reminder preferences in Settings |
| Admissions Office workspaces | `src/pages/admin/` | One route per function (see below) |
| Reviewer workspaces | `src/pages/DepartmentReviewView.jsx`, `ReviewerStatisticsView.jsx`, `DepartmentCalendarView.jsx`, `DepartmentInterviewsView.jsx` | Scoped to the account's level |
| Statistics | `src/components/StatisticsWorkspace.jsx` | Office aggregates for both office lanes (Staff: volume only) and scoped aggregates for reviewers |
| Excel export | `src/lib/admissionsOffice.js`, `src/lib/admissionsStatistics.js`, `src/lib/xlsxWriter.js` | Dependency-free `.xlsx` writer; applicant summary and statistics workbooks |
| Support inbox | `src/pages/admin/AdminSupportInbox.jsx`, `src/components/StudentSupportChat.jsx` | Student ↔ Admissions Office thread plus the deterministic assistant |

## Getting started

Requirements: Node 18 or newer, npm, and a Supabase project. The Supabase CLI is optional but
needed for Edge Function deploys and for applying migrations from the command line.

```powershell
npm install
Copy-Item .env.example .env    # then fill in the Supabase values
npm run dev
```

`npm run dev` binds to every network interface on port 5173, so a phone on the same Wi-Fi can
open the printed `Network:` URL.

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on `0.0.0.0:5173` |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serves the built bundle on port 4173 |
| `npm test` | Vitest suite |
| `npm run lint` | ESLint over the repository |
| `npm run google:auth` | Mints the Google Calendar refresh token (see **Google Calendar and Meet**) |
| `npm run cleanup:storage` | Lists (or with `--apply` deletes) Storage objects no row references |
| `npm run applications:import -- --manifest <path>` | Dry-run validates a version-1 operational application import manifest |
| `npm run applications:import -- --manifest <path> --apply` | Imports approved Submitted cases and their existing owners' files, idempotently |

## Environment variables

Everything the browser needs is prefixed `VITE_`; everything else is a server-side Supabase
Edge Function secret and must never be given that prefix.

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | Project URL |
| `VITE_SUPABASE_ANON_KEY` or `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | Public API key |
| `VITE_SITE_URL` | no | Canonical origin used as the auth redirect target |
| `VITE_SESSION_IDLE_TIMEOUT_MINUTES` | no | Idle limit, default 15 |
| `VITE_SESSION_ABSOLUTE_TIMEOUT_HOURS` | no | Absolute session limit, default 12 |
| `VITE_SESSION_WARNING_SECONDS` | no | Warning before expiry, default 60 |
| `VITE_SUPPORT_CHANNEL` | no | `inbox` (default) or `tawk` for the optional tawk.to widget |
| `VITE_SUPPORT_ASSISTANT` | no | `false` disables the deterministic assistant replies, leaving the human inbox |
| `VITE_TAWK_PROPERTY_ID` / `VITE_TAWK_WIDGET_ID` | no | Public tawk.to ids, used only when the channel is `tawk` |

Where they are read: `src/lib/supabaseClient.js` (URL and key), `src/lib/auth.js`
(`VITE_SITE_URL`), `src/lib/sessionTimeout.js` (session limits), `src/lib/supportMessages.js`
and `src/lib/supportChat.js` (support channel).

## Supabase setup

### Fresh project

1. Run `supabase/schema.sql` in the SQL editor. It creates every table, policy, trigger,
   function, both Storage buckets (`documents`, `avatars`), the seed catalog, and the
   `academic_programs` hierarchy.
2. Run the commented **pg_cron + pg_net** block at the bottom of the same file (07:00
   `Asia/Manila` deadline reminders). Replace `<project-ref>` and `<REMINDER_CRON_SECRET>`
   first; the secret must equal the Edge Function secret.
3. Create the first **Admissions Office Admin** by hand (see **Provisioning accounts**); every
   other staff account then comes from that Admin's **Accounts** page.

### Existing project

Apply the migrations under `supabase/migrations/` in version order (`supabase db push` or
`supabase migration up`). The repository head is `20261105000006_notification_outbox.sql`.
The currently deployed project was last verified through `20261063000000_add_privacy_consent.sql`;
check the target with `supabase migration list` before shipping the client. Never re-run
`schema.sql` on a deployed project — it is the reference for fresh ones, and the two are kept
aligned.

Areas worth knowing before you apply a batch:

| Migration(s) | What it adds |
| --- | --- |
| `20261005000000`, `20261055000000` | `osa_admin` → `admissions_office` → `admissions_head` → `admissions_admin` renames (pure renames; apply with the client build) |
| `20261009000000`, `20261026000000` | `documents` and `avatars` Storage buckets with their policies |
| `20261014000000`, `20261014000004`, `20261021000000` | Document-verification gates and rejected-file replacement |
| `20261029000000`–`20261033000000` | Interview stage overhaul, panel tables, Google Calendar ledger, office calendar entries |
| `20261036000000`–`20261049000000` | FORM 230-SCH completeness gates and the reviewer scope columns |
| `20261050000000`–`20261050000002` | Interviewer role, `approval_levels` routing, `results_releases` |
| `20261051000000`–`20261056000000` | Account provisioning and the Support inbox (schema, assistant, lifecycle cron) |
| `20261058000000` | Office-opened applications (Admin eligibility exception) |
| `20261059000000`, `20261060000000` | Recorded grant amounts |
| `20261061000000` | Waitlist outcome, offers, and offer confirmation |
| `20261062000000` | Staff access tightening (read-only application documents, scoped Chairperson profile read) and a database-required rejection reason |
| `20261063000000` | Account-level privacy consent (`privacy_consent_version`, `privacy_consented_at`, `record_privacy_consent()`); the guard trigger refuses a direct client write, and the app must ship with it |
| `20261105000000` | Normalized release coverage and role-scoped release reads; raw `application_ids` are no longer directly selectable |
| `20261105000001` | Application, document, notification, reminder, and later-added actor-FK indexes |
| `20261105000002` | Update cursors used by delta workspace refreshes |
| `20261105000003` | Private application-import audit tables and a service-role-only, validated batch RPC |
| `20261105000004` | Atomic, request-idempotent first-wave release RPC |
| `20261105000005` | Role-scoped stage totals (`get_application_stage_counts()`, security invoker) used as a refresh integrity check |
| `20261105000006` | Notification outbox (bounded, retried dispatch from the status and release triggers; pg_cron worker) and the append-only delivery-attempt history |

### Storage

| Bucket | Limit | Types | Who can read |
| --- | --- | --- | --- |
| `documents` | 10 MB | PDF, JPEG, PNG | The owner, both Admissions Office lanes, and a reviewer for students in scope |
| `avatars` | 5 MB | JPEG, PNG, WebP | The owner only — profile photos are never shared with reviewers |

Files are stored at `documents/<auth.uid()>/<documentId>/<file>`; every read goes through a
short-lived signed URL. Nothing in either bucket is public.

### Edge Functions

Seven functions live in `supabase/functions/`:

| Function | Auth | Purpose |
| --- | --- | --- |
| `process-deadline-reminders` | `--no-verify-jwt`; `REMINDER_CRON_SECRET` or a user JWT | Paged 7-day / 3-day / 1-day reminders; SMS only for the trusted scheduled caller |
| `notify-application-status` | `--no-verify-jwt`; same secret | Status email and SMS, plus the results-release and hold behavior |
| `notify-document-verification` | `--no-verify-jwt`; same secret | Verify/revert notices for Document Vault files |
| `notify-interview-update` | `--no-verify-jwt`; same secret | Schedule, reschedule, and cancellation notices to the student and the panel |
| `manage-interview-event` | `--no-verify-jwt` (validates the office JWT) | Google Calendar/Meet create, update, cancel, sync, verify |
| `send-test-email` | Platform JWT | Settings → *Send test email* |
| `send-test-sms` | Platform JWT | Settings → *Send test SMS*, only to the caller's own number |

```sh
supabase functions deploy process-deadline-reminders --no-verify-jwt
supabase functions deploy notify-application-status --no-verify-jwt
supabase functions deploy notify-document-verification --no-verify-jwt
supabase functions deploy notify-interview-update --no-verify-jwt
supabase functions deploy manage-interview-event --no-verify-jwt
supabase functions deploy send-test-email
supabase functions deploy send-test-sms
```

Add `--use-api` when Docker is unavailable. Deploying one function updates only that function,
so changes in `_shared/email.js`, `resend.js`, or `sms.js` require redeploying every consumer.

Edge Function secrets (server-side only, never `VITE_`):

```sh
supabase secrets set "RESEND_API_KEY=re_xxx" "RESEND_FROM_EMAIL=alerts@yourdomain" "RESEND_FROM_NAME=ScholarPath AdDU" "APP_SITE_URL=https://scholarpath-addu.vercel.app/" "REMINDER_CRON_SECRET=<long random value>" "IPROGSMS_API_TOKEN=<token>"
```

`IPROGSMS_PROVIDER` is optional and maps to the gateway's `sms_provider` flag (0/1/2). The four
Google values are documented under **Google Calendar and Meet**. Every secret is described in
`.env.example`.

## Authentication configuration

Google sign-in, password reset links, and account confirmation emails all return the browser to
a URL Supabase Auth must have allow-listed. When the requested URL is not allow-listed, Supabase
silently substitutes the project **Site URL** — which is why an unconfigured project sends the
deployed prototype back to `http://localhost:3000`.

**Authentication → URL Configuration**

- **Site URL:** the deployed origin, for example `https://scholarpath-addu.vercel.app`
- **Redirect URLs:** `https://scholarpath-addu.vercel.app/**`, a preview wildcard such as
  `https://scholarpath-addu*.vercel.app/**`, and `http://localhost:5173/**` plus
  `http://127.0.0.1:5173/**` for local work

**Authentication → Providers → Google:** the Google Cloud OAuth client must list
`https://<project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI.

**Authentication → Email → Confirm email must be ON.** Account provisioning matches an
invitation to a *confirmed* address; with confirmation off, anyone could claim an invitation by
signing up with the invited email.

Google sign-in deliberately accepts **personal** Google accounts as well as AdDU accounts:
incoming and current students often have no `addu.edu.ph` mailbox. Do not add an OAuth `hd`
restriction or an AdDU domain validator. Email/password sign-up and password reset likewise
accept any address.

Set `VITE_SITE_URL` in the deployed environment to pin every build to one canonical origin.
Leave it unset locally so development signs in against `http://localhost:5173`.

### Opening the prototype from another device

`npm run dev` listens on every interface, so Vite prints one or more `Network:` URLs. Add that
origin to the redirect URLs (for example `http://192.168.1.20:5173/**`) if sign-in should return
to the LAN address. Camera capture is unavailable on a plain-HTTP LAN address — browsers require
a secure context — so take photos on `localhost` or over HTTPS.

## Session security

Authenticated sessions end after **15 minutes without activity** or **12 hours after sign-in**,
whichever comes first. The app warns before either limit, re-checks the session with Supabase
when a suspended tab becomes active, and propagates sign-out across tabs. The absolute limit
survives a reload or browser restart; a session saved before the policy existed requires one
fresh sign-in to establish its baseline.

The defaults can be changed at build time with `VITE_SESSION_IDLE_TIMEOUT_MINUTES`,
`VITE_SESSION_ABSOLUTE_TIMEOUT_HOURS`, and `VITE_SESSION_WARNING_SECONDS`.

These are **client-enforced** limits, not a server-side inactivity detector. For defense in
depth, also set a suitable refresh-token lifetime and a short access-token lifetime under
**Authentication → Sessions**: Supabase keeps accepting an already-issued access token until it
expires, so sign-out does not instantly revoke it.

## Data model

| Table | Holds |
| --- | --- |
| `profiles` | One row per account: role, school (`department`), `review_*` scope, contact details, `eligibility_attributes`, `profile_details`, notification preferences, `avatar_path`, `deactivated_at` |
| `academic_programs` | The School → Cluster → Department → Program hierarchy the whole app reads |
| `scholarships` | The catalog, including `required_documents` and the academic floors |
| `applications` | One row per application: status, timeline, public interview record, frozen profile snapshot, endorsement record |
| `application_status_log` | Append-only status history with actor and role |
| `documents` / `application_documents` | The Document Vault and the reusable links between a file and applications |
| `student_financial_profiles` / `application_financial_details` | Household finances (office-only) and the per-application financial answers with their frozen snapshot |
| `application_review_comments` / `application_case_officers` | Staff-only notes and the officer roster |
| `interview_locations`, `application_interview_panelists`, `application_interview_notes`, `interview_calendar_events` | SOP step 5: venues, panel, private notes, Google Calendar ledger |
| `approval_levels` | Which reviewer level approves for a school or cluster |
| `results_releases`, `scholarship_offers`, `application_waitlist_ranks`, `application_grant_amounts` | Results rounds, offers, waitlist order, recorded grant amounts |
| `account_invitations` / `account_provisioning_log` | Invitation-only provisioning and its append-only audit trail |
| `support_threads` / `support_messages` | The Support inbox (append-only messages) |
| `notifications`, `custom_deadlines`, `notification_email_log`, `announcements`, `annual_qpi_records`, `office_calendar_entries`, `department_reviews` | Notification center, reminders, delivery ledger, announcements, QPI history, office planning dates, legacy Chair decisions |

Row-level security is authoritative. The client never filters a staff-only slice — the policy
refuses it, and `loadSupabaseWorkspace()` leaves staff-only slices empty for a student session.

## Public landing page

A signed-out visitor first sees the landing page (`src/pages/LandingPage.jsx`), which explains the
three AdDU grants, the path of one application, and what ScholarPath is and is not, then leads to
**Create account** or **Sign in**. On the sign-in card, the logo and "ScholarPath AdDU" name lead back to it. The landing page is
skipped, and the login screen shown directly, for anyone in the middle of signing in: an OAuth
return, a password-reset or email-confirmation link (or its error), a session-timeout or
deactivation notice, or a remembered email (`src/lib/landingGate.js`). It is a separate lazy
chunk, so signed-in sessions never download it, and it calls no Supabase API. Its eligibility
"Try it" panel is an illustration over a made-up sample track, not a real result.

## Student journey

### 1. Your Application Form (My Profile)

For a student, **Application Form** in the sidebar *is* FORM 230-SCH: six numbered parts
(Personal information, Address, Family details, Academic profile, Household finances,
Eligibility background) plus Overview and Account security. Each part saves independently, shows
its own status (a check when complete, amber while a "Needed to apply" answer is missing, red
when an attached proof was reverted or has gone stale), and marks every answer that is still
required with a rose `*`.

The application gate reads `getStandingRequirements()`:

- **Incoming first year:** senior high school, strand, and general average; no AdDU student
  number and no collegiate QPI. Ranked 2nd and 3rd program choices.
- **Current Ateneo student / transferee:** AdDU student number and QPI, no strand; a transferee
  records the college last attended and is never asked for a student number.

QPI and household income are **self-reported**. They can optionally be verified by the
Admissions Office against a Document Vault proof, and verification never blocks matching or
applying — but submitting requires a *current* proof attached to every answer the application
relies on.

Household finances are office-only: they live in `student_financial_profiles` and
`application_financial_details`, which no reviewer role can read.

### 2. Find a scholarship

**Scholarship Explorer** (`Scholarships`) offers faceted search plus an always-open Smart
Eligibility Checker per card: one row per criterion (your answer, what the track needs, the
reason, and an Update link), a verdict strip, the required documents, and **Start application**
only when the application form is complete and the gate passes.

The three AdDU internal tracks a student can apply to are Grant-in-Aid (GIA), the Jubilee
Scholarship (JSF), and the Working Scholar Program (WSP, formerly Student Assistant). Everything
else in the catalog — government-linked, corporate, donor, and external entries — is
reference-only. `isAdduInternalProgram()` (title-based) is the single in-scope predicate on the
client and `is_addu_in_scope_track()` mirrors it in the database.

### 3. Apply

A Draft opens the application workspace:

1. **Required documents** — attach each requirement from the Document Vault, upload a new file
   (which lands in the vault first), or capture a photo. Optional supporting documents may be
   added but never gate submission.
2. **Application form** — confirm the profile answers that will be frozen into the snapshot.
3. **Financial situation** — FORM 230-SCH household questions; required to submit.
4. **Statement** — prefilled from the default statement in the Application Form.
5. **Review and submit** — certify, consent to sharing with the Admissions Office and the
   Department Chair, and submit.

A submitted application is frozen: the profile snapshot, statement, and certification date are
stored on the row, later profile edits do not change it, and the only student writes afterwards
are answering an offer and leaving a waitlist.

## Application stages

| Stored status | Shown as | Moves it |
| --- | --- | --- |
| `Draft` | Draft | The student; the Admin may open a Draft for a student as an eligibility exception |
| `Submitted` | Submitted | The student |
| `Under Review` | Under Review | Automatic when an officer opens the case — never a button |
| `For Verification` | For Verification | The Admin |
| `For Endorsement` | Awaiting Endorsement | Legacy rows only; the separate hand-off is retired |
| `Endorsed` | For Interview | The Admin, once every attached file is Verified |
| `Interview` | Interview | An in-scope reviewer records the schedule |
| `Recommended` | Recommended | A panel member records the evaluation and its recommendation level |
| `Approved` | Approved | The school's configured approving level, or the Admin as an override |
| `Waitlisted` | Waitlisted | The approving level or the Admin, at `Recommended` |
| `Released` | Accepted (student) | The Admin, from **Final check and release** |
| `Declined` | Declined | The student answering an offer or leaving the waitlist, or the Admin recording an answer given offline |
| `Rejected` | Not accepted | The approving level or the Admin; the reason stays staff-only |

Stage authority lives in one function, `getNextApplicationStatuses(status, role, context)` in
`src/lib/constants.js`, and is repeated by the `enforce_admissions_office_lane_transitions`
trigger. The client never keeps a second map.

**Results hold.** No `Approved`, `Waitlisted`, or `Rejected` outcome reaches a student before its
release. `maskApplicationForStudent()` / `getStudentFacingStatus()` display **Under
deliberation** — or **Processed** for a case the office closed before the interview — and drop the
held timeline and status-log rows. The stored status column stays readable to its owner; only the
display is held. A project without `results_releases` (`resultsReleasesReady: false`) disables the
hold instead of hiding every decision.

## Document Vault

- One upload answers one question: *what kind of document is this?* The picker lists each type
  once, grouped by kind of paper, and each entry names the profile answers it proves. The type —
  not a second choice — decides the linked attributes.
- Every decision is attributable and dated: **Verify document** opens a confirmation that records
  the reviewer and date; **Revert for resubmission** requires a preset reason plus notes. The
  stored value stays `Rejected`; the label reads **Reverted for resubmission** and the note tells
  the student what to correct. Only the Admissions Office Admin writes a document decision.
- A reverted file can be replaced in place while the application is `Submitted`,
  `Under Review`, or `For Verification`, through `replace_rejected_application_document()`. The
  application's status never changes and the replacement arrives `Pending`.
- An *outdated* proof — the profile answer no longer matches the attested value, or an annual
  attribute was proven in an earlier academic year — is flagged in the vault and in the
  notification center. Changing the answer back makes it current again.
- Application photos (a square 2x2 ID photo and photos of residence) can be captured with the
  device camera, switched between front and rear, and fall back to the native camera or an
  existing file when permission is blocked. The profile photo is personal and separate: it is
  never sent with an application.

## Admissions Office workspace

Both office lanes see the Dashboard, the Intake pool, Interviews, the Calendar, the Support
inbox, and Statistics. Only the Admin sees the Review queue, Final check and release, the
Scholarship catalog, Announcements, and Accounts.

| Route | Page | Lane | Covers |
| --- | --- | --- | --- |
| `admin` | Dashboard | Both | The next piece of work, office metrics, links into each workspace, and recent application activity |
| `admin-intake` | Intake pool | Both | Every open application, oldest first, with a Coverage facet (Unclaimed / With officers / All open cases), stage, scholarship, school and search filters, a waiting-over-7-days toggle, and Admin-only workload cards |
| `admin-review` | Review queue | Admin | The cases the Admin opened: **Review documents**, **Forward to interview**, **Open case** |
| `admin-interviews` | Interviews | Both | Endorsed applicants awaiting a schedule, upcoming interviews grouped by the Manila date, and panelist/room clashes |
| `admin-calendar` | Calendar | Both | Interviews, in-scope catalog deadlines, recorded stage decisions, and the Admin's planning entries, with mark-kind filters and a day agenda; the venue manager lives here |
| `admin-release` | Final check and release | Admin | The final check per case, both release waves, the waitlist order, offer answers, and the Excel exports |
| `admin-statistics` | Statistics | Both | Volume, funnel, turnaround, documents, and profile bands — volume only for Staff |
| `admin-catalog` | Scholarship catalog | Admin | Publishing AdDU internal entries, their required documents, and the approving level per school/cluster |
| `admin-announcements` | Announcements | Admin | Publishing office updates |
| `admin-accounts` | Accounts | Admin | Invitations, scope changes, deactivation |
| `admin-support` | Support inbox | Both | The shared human inbox for student conversations |

The shared review surface is `ApplicationReviewModal`, opened from every queue: a fixed header
with the applicant, status, SOP stage track, and verified-file count; Overview, Profile snapshot,
Documents, Endorsement, Interview, and History tabs; and one sticky action bar rendering one
button per permitted transition. A stage move never closes the modal without explaining where the
case went — either a one-line strip on the tab that holds the next work, or an outcome card
naming who holds the case now. Document decisions, the forward to interview, the overrides, and
the release are the Admin's; a reviewer sees the same panes read-only.

**Office-opened applications.** The Admin can open a Draft for a student the Smart Eligibility
Checker would block (**Open application for a student** on the Intake pool), with a preset reason
and notes kept staff-only. Only the eligibility rules are waived: the student still completes,
certifies, and submits, and blank answers, the deadline, the profile gate, the documents, and the
financial step still apply.

## Final check, results, waitlist, and grant amount

Every scholarship's results are released by the Admin, in two waves, from **Final check and
release**.

1. **Final check.** Each `Approved` case is reviewed — siblings already on a grant and pending
   cases are listed — and ticked. A case that should not proceed ends here as **Not accepted**.
2. **First wave — offers.** **Release accepted and waitlisted** moves `Approved` → `Released`
   with a confirm-by date (default one week) and covers the `Waitlisted` cases. An
   `offers` release record sends the acceptance and waitlist letters.
3. **Second wave — closing.** **Close results** is refused while any case is still `Approved` or
   any offer is unanswered. It turns the remaining waitlist into **Not accepted** and sends the
   general letters together.

**The student's side.** An accepted applicant confirms or declines from the application details,
choosing a decline reason; a waitlisted applicant can leave the list. Both are SECURITY DEFINER
RPCs, because a submitted application is otherwise frozen. A confirmation can still be withdrawn
until the round closes. A student never sees a waitlist position.

**Promotion.** Each declined offer opens one slot. **Offer to next** promotes the top-ranked
waitlisted case, which requires a recorded grant amount and a confirm-by date. The Admin ranks the
waitlist; the pre-sort is the panel's recommendation level, then the earliest submission.

**Grant amount.** On the review modal's **Grant amount** tab, the school's approving level — or
the Admin — records a coverage percent and/or a peso amount per semester plus a note. It is
editable at `Recommended` and `Approved`, locks at `Released`, and is visible to a student only
once their own result is released. It is a recorded figure, never a disbursement, and approval is
not gated on it.

## Reviewers: the ladder and the interviewer

Reviewers own exactly one level of **School → Cluster → Department → Degree program**:

| Role value | Title | Scope columns | Sees |
| --- | --- | --- | --- |
| `dean` | Dean | `review_school` | Every cluster and department in that school |
| `assistant_dean` | Assistant Dean | `review_school` + `review_cluster` | Every department in that cluster |
| `department_chair` | Chairperson | `review_department` | That department and its programs |
| `interviewer` | Interviewer | any one of the above | That level's cases, for interviews |

`profiles_review_scope_check` enforces "exactly the levels the role owns", `profiles.department`
still holds the **school** label, and `public.reviewer_scopes_to_student()` resolves the applicant's
level from their degree program, so adding a department never needs a policy change.

Each reviewer lands on **Review** and has four scoped pages:

- **Review** (`review`) — the department/cluster/school queue. A row opens the review modal; the
  Interview tab is where a panel member records the evaluation and its recommendation level
  (Highly recommended / Recommended / Recommended with reservation / Not recommended / Deferred).
- **Interviews** (`chair-interviews`) — panel work first, then the rest of the scope. Scheduling,
  rescheduling, and cancellation belong to the Admissions Office; a reviewer who is not on the
  panel reads the schedule only.
- **Calendar** (`chair-calendar`) — the same derived layers as the office calendar, scoped.
- **Statistics** (`chair-statistics`) — the shared statistics workspace fed only the scoped queue,
  so it can never count a case outside the account's level. A Chairperson that is the configured
  approving level also gets **Your decisions**; a panel member gets **My interviews**.

SOP step 5a draws the panel from the applicant's school, so it may include any in-scope
interviewer, the Chairperson of the department, the Assistant Dean of the cluster, the Dean of the
school, and either Admissions Office lane, plus typed faculty guests without accounts. Students
never see panel names, emails, or notes.

### Approving level

`approval_levels` (school, optional cluster, `approver_role`) decides which reviewer level
approves an application; the Admin edits it on the Scholarship catalog page. Resolution order:
cluster row, then school row, else Chairperson. Seeded examples: School of Education → Dean,
School of Engineering and Architecture → Chairperson, School of Arts and Sciences · Computer
Studies → Assistant Dean.

**Check that an active account holds the configured role at that school or cluster** before
changing a level. A level with no scoped account dead-ends a case at `Recommended`
(`supabase/maintenance_restore_sas_approval_levels.sql` repairs one known drift).

## Provisioning accounts

Staff and reviewer accounts are created by **invitation**, not by seeding SQL:

1. The Admissions Office Admin records an invitation on **Accounts**: email, optional name, role,
   and the hierarchy level the role owns. Nothing is created and nothing is emailed.
2. When an account with that **confirmed** email signs up (Google arrives verified; email/password
   confirms by email), `claim_account_invitation()` writes the role, the school label, and the
   `review_*` scope. A failed claim never blocks sign-up.
3. Invitations last 30 days and can be renewed or revoked. The Admin can also change a scope,
   deactivate an account (which signs it out through `deactivated_at`), or reactivate it.

Every write is an Admin-only SECURITY DEFINER RPC that re-checks the caller, and
`account_provisioning_log` is append-only. The Admin cannot change or deactivate their own account.
A person who already has a confirmed account is never invited — a student is not converted to
staff — and `guard_profile_privileged_columns` refuses any direct client write to `role`,
`review_*`, `deactivated_at`, or a staff member's `department`.

**The first Admissions Office Admin is still created once by an operator in SQL** (Auth → Users,
then set `profiles.role`). After that, use the Accounts page:

```sql
-- bootstrap only: the first Admissions Office Admin
update public.profiles
set role = 'admissions_admin', department = 'Office of Admissions'
where email = '<the first admin address>';
```

An account's address lives in two places: `auth.users.email` is the identity (and where password
recovery goes), and `public.profiles.email` is what the Edge Functions deliver to. Change both
together, through the Auth Admin API or the dashboard, then the matching `profiles` row. Do not use
a user-initiated email change while Secure Email Change is on.

## Support inbox and the ScholarPath Assistant

The in-app **Support inbox** gives a student one continuous conversation with the Admissions
Office, staffed by a deterministic client-side assistant in between.

- The assistant answers from the loaded catalog and scholarship guide plus the student's own
  application data. It distinguishes catalog questions from eligibility-verdict questions,
  recognizes common plural phrasing, reports office hours without treating an office mention as a
  handoff request, and escalates sensitive questions. It never decides eligibility or an award.
- A student can ask for a live agent at any time (**Talk to a live agent**); the request stops
  assistant replies and notifies both office lanes. Office replies also turn assistant mode off.
- **Availability** comes from an office-session heartbeat plus weekday office hours (Philippine
  time). It is best-effort: a student can leave a message when no officer is online.
- Messages are text-only and limited to 2,000 characters. Both roles poll every 15 seconds while
  the conversation is open and every 60 seconds in the background. The thread payload stays in
  React memory, never in `localStorage`, and is cleared on sign-out.
- **Lifecycle.** **Close conversation** (office), **Mark as solved** (student), and an hourly cron
  that closes an answered thread quiet for 3 days all call `reset_support_thread()`. It clears the
  escalation, re-enables the assistant, and stamps `resolved_at`, so the student can begin a new
  question without losing the office's history.
- Notifications are generic in-app alerts only and respect each recipient's in-app preference:
  never message text, never student context.

The office **Support inbox** (`admin-support`) is shared by both office lanes; academic reviewers
have no access. Students see only their own thread. The assistant is a prototype addition outside
the manuscript scope, and `VITE_SUPPORT_ASSISTANT=false` turns its replies off while keeping the
human inbox.

An optional tawk.to widget remains as a fallback channel (`VITE_SUPPORT_CHANNEL=tawk`). It is
human live chat, not AI, is shown only during an authenticated student session, identifies the
visitor by profile name and email (without Secure Mode), and is torn down on sign-out. Its z-index
stays below the mobile navigation and application modals.

## Calendar and interviews

### The student calendar

`Calendar` shows the in-scope scholarship deadlines, exam and interview dates, and the student's
own reminders. A reminder can be added or removed, is stored locally *and* mirrored to
`custom_deadlines` so the scheduled function can email it, and uses the configured 7-day, 3-day,
and 1-day offsets.

### Interviews (SOP step 5)

The Admissions Office coordinates every interview; the panel comes from the applicant's school
(SOP 5a).

- A schedule records the mode (on-site or online), venue, date, time, duration, meeting link,
  applicant instructions, and the panel. Exactly one panel member is the lead.
- `applications.interview` is student-readable, so it holds only the public schedule. Panel
  membership, private evaluation notes, and the calendar ledger live in staff-only tables.
- Attendance is **not** tracked. A record only ever holds `scheduled` or `cancelled`, and
  **Recommend for approval** closes a live schedule first, so no live invitation is left behind.
- The panel's evaluation carries one of five recommendation levels; the note and its level are
  never shown to the student.
- Reschedules and cancellations require a reason and are announced to the student and the panel by
  `notify-interview-update`.

### Google Calendar and Meet

`manage-interview-event` creates and maintains the calendar event and the Meet link. It needs four
server-side secrets: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`GOOGLE_CALENDAR_REFRESH_TOKEN`, and `GOOGLE_CALENDAR_ID`.

1. **Google Cloud setup (once).** Enable the Google Calendar API, configure the OAuth consent
   screen, and create a *Web application* OAuth client with
   `http://localhost:5555/oauth2callback` as a redirect URI. Scopes: `calendar.events` at runtime
   and `calendar.calendarlist.readonly` for the helper only.
2. **Mint the refresh token.** Put the client id and secret in `.env`, then run
   `npm run google:auth`. Approve the consent screen **with the account that owns or can edit the
   interview calendar**; the script prints that account, every calendar it can write to, the
   refresh token, and a ready `supabase secrets set` command. A shell export wins over `.env` for
   that run.
3. **Set the secrets and deploy** `manage-interview-event --no-verify-jwt`. `GOOGLE_CALENDAR_ID`
   is the plain id with a literal `@` (`xxxx@group.calendar.google.com`) — never a `VITE_`
   variable, never a URL. The default `primary` puts interviews on the organizer's own calendar.

**One interview has exactly one live event.** A create adopts any event the application already
owns instead of adding a second, a cancel deletes every attributable event, and a reschedule
reuses the stored link but never the link of a cancelled interview. Each event carries
`extendedProperties.private` naming the application and revision, so a retried create cannot fork.

**Repair calendar event** appears in the Interview tab only when Google and the saved record
disagree. It creates an event that never landed, patches a drifted one, deletes a duplicate,
removes a leftover event, and attaches a Meet conference to an online event that has none.

**The 7-day refresh token.** While the OAuth app is *External + Testing*, Google expires the
refresh token after 7 days. Existing events and links keep working; new automatic Meet links stop
until the token is replaced. Re-run `npm run google:auth` and update the secret. Publishing the app
or consenting with an internal Workspace app removes the limit. Without the secrets,
`manage-interview-event` answers `{ configured: false }` and an online interview requires a pasted
`https` link (plus the `.ics` download).

| Symptom | Cause | Fix |
| --- | --- | --- |
| `configured: false` | a secret is missing | set all four, then re-check |
| `reauth_required` | the 7-day window lapsed, or consent was revoked | `npm run google:auth`, update the token |
| `calendar_not_found` | the token's account cannot see that calendar id | own or share the calendar with it, or correct the id |
| `calendar_forbidden` | the account has read-only access | re-share with *Make changes to events* |
| `insufficient_scope` | the token was minted without `calendar.events` | re-consent |
| a Meet link never appears | Google reported the conference as pending | **Repair calendar event**, or paste a link |
| two events at the same time | a cancel could not reach Google | delete the orphan in Google Calendar once, then repair |
| a link, but the app says *No meeting link* | the event owns no conference | **Repair calendar event** attaches one |

If the calendar stays unreachable, set `GOOGLE_CALENDAR_ID=primary` and retry: a success proves the
credentials are fine and the calendar id is the problem.

## Notifications: email and SMS

Delivery runs server-side through Supabase Edge Functions, never from the browser.

| Function | Trigger | Purpose |
| --- | --- | --- |
| `process-deadline-reminders` | pg_cron + pg_net, 07:00 Asia/Manila | 7-day / 3-day / 1-day reminders in-app, by email, and by SMS |
| `notify-application-status` | Database trigger on `applications.status`, plus the browser retry | Status email/SMS/in-app, the results-release letters, and it holds the Approved/Waitlisted/Not-accepted notices until their release |
| `notify-document-verification` | Database trigger on `documents` | Verify/revert notices |
| `notify-interview-update` | Database trigger on the interview revision/state | Schedule, reschedule, and cancellation notices |

**Preferences are the only input.** `profiles.notification_preferences` mirrors the Settings
toggles: `inAppEnabled`, `emailEnabled`, `smsEnabled`, and the three `deadlineReminders` offsets.
A reminder needs its channel *and* its offset.

**The ledger.** Every real delivery is recorded in `notification_email_log` with its channel status
and the Resend or iprogSMS message id. Ledger writes upsert on `(source_key,user_id)`; stable source
keys dedupe in-app rows and Resend uses an idempotency key. The reminder runner pages its inputs,
isolates recipient failures, and caps concurrency. Resend uses bounded timeouts and retries only
when a stable idempotency key is present. SMS has no provider idempotency, so it is sent only for the
trusted scheduled caller and is never automatically retried after an ambiguous timeout; the 200
response still means queue acceptance, not carrier delivery.

**SMS caveats.** A 200 response from iprogSMS confirms *queue accept* only, and there are no
delivery webhooks (poll `GET /sms_messages/status`). Globe, TM, DITO, and GOMO recipients use the
shared `iprogSMS` sender; Smart and TNT need a purchased custom sender name. A student without a
normalizable Philippine mobile number is skipped, not failed, so the reminder stays retryable.

**Verifying delivery.** Settings → *Send test email* and *Send test SMS* send one message to the
signed-in user only and report the real outcome, so delivery can be confirmed without waiting for a
schedule.

## Statistics and exports

`Statistics` is one shared page body (`src/components/StatisticsWorkspace.jsx`) fed by two
scopes, decided in `getStatisticsScope(role, profile)`:

- **Office** (`admin-statistics`, both lanes): filter by academic year, scholarship, and school.
  Headline counts and acceptance rate, the stage funnel and current-stage spread, submissions over
  time, outcomes by scholarship and by School → Department, median and 90th-percentile stage
  turnaround against the 5-day target, Document Vault verification and revert reasons, the latest
  panel recommendation levels and how they ended, and applicant-profile bands from the frozen
  snapshot.
- **Reviewer** (`chair-statistics`, every reviewer role): the same workspace fed only the scoped
  queue, with "Your scope" in place of the school filter, plus **Your decisions** for the
  configured approving level and **My interviews** for a panel member.

**Staff get volume only** — no acceptance rate, no accepted/not-accepted counts, no release step,
and no panel recommendations — because since Consultation 2 Staff are "not privy to the
application process". `buildOfficeStatistics()` never derives a section the role does not get, so
the Excel export follows the same cut.

**Excel exports** use `src/lib/xlsxWriter.js`, a dependency-free store-only ZIP writer, so no
spreadsheet library is installed.

- **Applicant summary** (`buildApplicantSummarySheets()`, `getApplicantSummaryFileName()`) is
  available on Final check and release and on the approver's queue. The **Applicants** sheet opens
  with a block naming where it was exported from, what it holds, the scholarship, when, by whom,
  and the totals, then one row per application with the result, stage, panel recommendation and
  who recorded it, School and Program, year level, academic measure and value,
  household income, contact details, and the submitted/recommended/decided/released dates. The
  **About** sheet defines each column. Decision reasons are never exported.
- **Statistics workbook** (`downloadStatisticsWorkbook()`) writes one sheet per derivation for the
  role's scope.

`Print` in the student's application details lays the application out in the order of FORM
230-SCH, including the required-document states, the interview summary, the Barangay certification
of residence page, and the affidavit-of-agreement signature page. It uses `window.print()` and the
`@media print` block in `src/styles.css`; there is no PDF dependency.

## Project structure

```
src/
  App.jsx                 state, routing-style view switching, auth/session, notifications
  pages/                  student + reviewer screens, and pages/admin/ (one route per function)
  components/             shared UI, the review modal, the interview and endorsement panes
  lib/                    domain logic: eligibility, requirements, constants, scope, helpers
  tailwind.css            theme primitives (Tailwind entry)
  styles.css              component CSS, print rules, pseudo-elements, keyframes
  landing.css             the public landing page's styles (ships with its lazy chunk)
supabase/
  schema.sql              reference schema for a fresh project
  migrations/             89 incremental migrations, applied in order
  functions/              seven Edge Functions + _shared/ modules
  maintenance_*.sql       manual operator scripts (never migrations)
scripts/                  Google auth, storage cleanup, and application import operators
tests/                    83 vitest files
```

| Module | Responsibility |
| --- | --- |
| `src/lib/constants.js` | Statuses, display labels, and `getNextApplicationStatuses()` — the single stage-authority map |
| `src/lib/eligibility.js` | The Smart Eligibility Checker rules and `isAdduInternalProgram()` |
| `src/lib/applicationRequirements.js` | Required documents, readiness, document-review gates, replacement |
| `src/lib/profile.js` | Field definitions, validators, standing rules, FORM 230-SCH completeness |
| `src/lib/reviewScope.js` | The reviewer ladder and approval routing (mirrors the SQL predicate) |
| `src/lib/resultsRound.js` | Results rounds, offers, waitlist ordering, confirm-by dates |
| `src/lib/grantAmount.js` | Grant-amount stages, validation, phrasing |
| `src/lib/admissionsOffice.js` | Intake pool, case officers, queues, applicant-summary workbook |
| `src/lib/admissionsStatistics.js` | Statistics scope and every office derivation |
| `src/lib/applicationForm.js` | FORM 230-SCH copy: essay topic, data-privacy notice, affidavit clauses |
| `src/lib/legalDocs.js` | Privacy policy, cookie and storage notice, and terms of use as data, plus the reader matrix and `PRIVACY_NOTICE_VERSION` |
| `src/lib/privacyConsent.js` | The browser-storage choice: categories, normalization, version matching, and the live-chat gate |

## Operational application import

`scripts/import-applications.mjs` imports existing submissions for already-provisioned students; it
does not create Auth users or profiles. The manifest must be version 1 and contain a stable
`batchId`, unique `sourceId` values, valid owner/scholarship IDs, and workflow-complete Submitted
records with a version-4 FORM 230-SCH snapshot, frozen `financial_snapshot`, financial answers,
certification/submission times, and all linked proof documents. New files are relative to the
manifest directory (PDF/JPEG/PNG, up to 10 MB); `{ "existing": true, "id": "<document-uuid>" }`
reuses an existing owner-owned Document Vault row. Rows are checked against the as-submitted
snapshot, current required-document/proof rules, financial-answer gate, scholarship scope/eligibility,
and the Manila deadline as of `submitted_at`. Imported documents enter `Pending` unless they are already verified
vault files; the importer never fabricates a verification actor or decision.

The manifest shape is explicit; replace the placeholder values with actual source rows, not with
sample/test records:

```json
{
  "version": 1,
  "batchId": "<stable-uuid>",
  "records": [
    {
      "sourceId": "<opaque-source-key>",
      "application": {
        "id": "<stable-application-uuid>",
        "student_id": "<existing-student-user-uuid>",
        "scholarship_id": "<in-scope-scholarship-uuid>",
        "submitted_at": "2026-10-30T02:00:00Z",
        "certified_at": "2026-10-30T02:00:00Z",
        "statement": "<submitted statement>",
        "profile_snapshot": { "version": 4 },
        "financial_snapshot": { "<submitted household-finance snapshot>": "..." },
        "financial_answers": { "<FORM 230-SCH financial situation answers>": "..." }
      },
      "documents": [
        {
          "id": "<stable-document-uuid>",
          "document_type": "<Document Vault type>",
          "file_name": "proof.pdf",
          "file_path": "files/proof.pdf",
          "uploaded_at": "2026-10-29T02:00:00Z",
          "linked_attributes": ["<profile attribute>"],
          "attested_values": { "<profile attribute>": "<submitted value>" }
        }
      ]
    }
  ]
}
```

The command is **dry-run by default**. Its service-role key is shell-only, and `--apply` also needs
the expected project ref and an explicit approval matching the manifest batch ID:

```powershell
$env:SUPABASE_URL="https://<project-ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
$env:APPLICATION_IMPORT_EXPECTED_PROJECT_REF="<project-ref>"
npm run applications:import -- --manifest .\incoming\applications.json
$env:APPLICATION_IMPORT_APPROVED_BATCH="<manifest-batch-uuid>"
npm run applications:import -- --manifest .\incoming\applications.json --apply
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
Remove-Item Env:APPLICATION_IMPORT_APPROVED_BATCH
```

Apply migrations through `20261105000006_notification_outbox.sql` on the isolated staging
project first. The operator path uploads bytes to deterministic private object paths, commits up to
25 cases per RPC call, validates each case inside its own transaction savepoint, and records only
hashed source keys/checksums in the import ledger. A retry with the same batch and identical content
skips already imported rows; changing a batch's manifest requires a new `batchId`. Row errors are
written to a sidecar with row number, SQLSTATE, and a validation message (no owner/source IDs). Failed rows remain absent from the application queue;
successful rows are visible even if other rows in the batch fail, so reconcile the batch's `partial`
status and import-error report before treating the whole seed as complete. Uploaded but unreferenced
objects can be retried at the same path and audited with `npm run cleanup:storage`.

Do not use this path for demo fixtures, unlinked application-only rows, Auth-user provisioning, or a
load test. Never put the service-role key in `.env`, a `VITE_` variable, browser code, a manifest, or
the repository. Run load tests with anonymized staging data and provision student owners separately.

## Database maintenance

Five helpers live in `supabase/`. None is a migration, none changes the schema, and nothing runs
them automatically.

| File | Purpose |
| --- | --- |
| `application_status_log_checks.sql` | Read-only checks over the append-only status log (RQ2) |
| `maintenance_out_of_scope_applications.sql` | The issue #3 audit queries and deactivation statement for catalog rows outside the three Appendix A tracks |
| `maintenance_reset_transactional_data.sql` | Clears every application, document, notification, and office-workflow row while keeping accounts and the catalog |
| `maintenance_redact_rejection_reasons.sql` | One-time privacy redaction of application rejection reasons stored in student-readable columns |
| `maintenance_restore_sas_approval_levels.sql` | Returns drifted `approval_levels` rows to the documented seed |

`maintenance_reset_transactional_data.sql` keeps `profiles`, `annual_qpi_records`,
`student_financial_profiles`, `scholarships`, `academic_programs`, and `interview_locations`. It
snapshots what it deletes into the `backups` schema first, runs in one transaction, and revokes the
snapshot from the API roles; drop it with `drop schema backups cascade;` once the reset is
accepted. Delete order is load-bearing: the status log goes before `applications` (its foreign key
is `NO ACTION`) and `documents` after the applications that reference them.

After any reset, re-run `npm run build` and `npm test`, then smoke-test the student submission flow
and the intake pool, which should both start empty.

## Reclaiming orphaned Storage files

`documents.storage_path` and `profiles.avatar_path` are the only handles the app has on a file, so
a row deleted without its object leaves bytes nothing can reach. Delete the rows first (the reset
above does), then sweep:

```powershell
$env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
npm run cleanup:storage              # dry run: one line per orphan, grouped by folder
npm run cleanup:storage -- --apply   # delete, then re-run the dry run to confirm 0
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
```

The service role is required because the bucket policies only let a folder owner delete, and most
orphans sit in folders of accounts that no longer exist. The project URL comes from `.env`; the key
must come from the shell for that run, never from a `VITE_` variable and never from `.env`.
Deleting `storage.objects` rows directly is not a substitute — it hides the files without freeing
the space.

## Tests and validation

```powershell
npm test        # vitest run: 83 files
npm run build   # Vite production build
npm run lint    # ESLint
```

The staging-only read-load harness is `tests/load/application-volume.k6.js`. It refuses the known
live project ref and requires `K6_TARGET_ENV=staging`, the matching `K6_STAGING_PROJECT_REF`, a
staging URL/anon key, 151 unique JWTs for each role (k6 VU IDs are global across the role scenarios),
and a separate office JWT for the exhaustive pagination audit. It ramps 25 → 50 → 100 → 150
concurrent authenticated readers plus the audit VU, exercises 50-row paged lists and
bounded related-ID reads, and checks for duplicate/missing page IDs. Run it only after loading at
least 1,000 anonymized staging applications and reviewing the Supabase plan/connection limits:

```powershell
$env:K6_TARGET_ENV="staging"
$env:K6_STAGING_PROJECT_REF="<staging-project-ref>"
$env:SUPABASE_URL="https://<staging-project-ref>.supabase.co"
$env:SUPABASE_ANON_KEY="<staging-anon-key>"
$env:K6_STUDENT_TOKENS="<151 staging student JWTs, comma-separated>"
$env:K6_OFFICE_TOKENS="<151 staging office JWTs, comma-separated>"
$env:K6_OFFICE_AUDIT_TOKEN="<separate staging office JWT>"
$env:K6_REVIEWER_TOKENS="<151 staging reviewer JWTs, comma-separated>"
$env:K6_EXPECTED_APPLICATIONS="1000"
k6 run tests/load/application-volume.k6.js
```

The default k6 run is read-only. An optional destructive `idempotent_release_replay` scenario is
disabled unless `K6_ENABLE_STAGING_WRITES=1`; it requires a disposable staging scholarship, a fresh
request UUID, a confirm-by date, an Admin JWT, and
`K6_WRITE_CONFIRM="release:<staging-project-ref>:<request-id>"`. It concurrently replays one
`release_scholarship_results` request to exercise request idempotency. Before enabling it, confirm
the selected staging cases and their notification preferences are test-only and disable all external
email/SMS secrets; it consumes Approved statuses. Never point either scenario at production. Use
disposable staging accounts and expire/revoke their tokens afterward.

`supabase/application_volume_health.sql` is a read-only operator snapshot for relation/index sizes,
top normalized query timing, connection waits, and failed/timed-out `pg_net` requests. Run it before
and after each staging ramp, and use Supabase Postgres/API/Edge Function dashboards for CPU, memory,
pool saturation, 429/5xx rates, and function duration. The script intentionally excludes `pg_net`
request/response bodies and all student-level rows.

The suite covers the shared email/SMS templates and clients, reminder math, eligibility rules,
application requirements and readiness, the rejection notice and staff-only reason, the
endorsement derivations and panes, status transitions per role, the interview
schedule/panel/conflict/gate and Google client helpers, statistics, grant amounts, results rounds
and offers, the privacy documents and the storage choice, app state and session isolation, the
profile validators and FORM 230-SCH gates, and the section renders (academic profile, address and
family proofs, profile view, print sheet).

Run `npm test` whenever `supabase/functions/_shared/`, `src/lib/appState.js`,
`src/lib/notificationMerge.js`, `src/lib/endorsement.js`, or `src/lib/profile.js` is touched.

Manual smoke test before a demo: start an application from Scholarship Explorer, attach and upload
its documents, take and upload the two application photos (including the blocked-camera fallback),
certify and submit, then print the sheet; upload, filter, and delete a vault file; replace a
reverted file; set and remove the profile photo; add and delete a calendar reminder; toggle the
notification channels; edit and save each Application Form part. On the office side: pick up a
case from the intake pool, verify or revert a file, forward to interview, schedule an interview,
record a recommendation as a panel member, approve as the configured level, run the final check,
and release.

## Privacy, storage, and consent

The three documents in `src/lib/legalDocs.js` — **Privacy Policy**, **Cookie and storage notice**, and
**Terms of Use** — are the app's own notice. They are reachable from the login screen footer, the
sidebar and mobile-drawer footer, Settings → **Privacy and data**, the certification step of the
application workspace, and the Document Vault. The **legal** route (`src/pages/LegalView.jsx`) renders
all three as tabs and works before sign-in, when the same documents open in a dialog.

Two separate records are involved, and they are deliberately not the same thing:

| Record | Where it lives | What it answers |
| --- | --- | --- |
| `privacyChoice` | The `localStorage` app record (device preference) | Which version of the cookie and storage notice this browser answered, and whether it allowed the optional live chat |
| `profiles.privacy_consent_version` / `privacy_consented_at` | Supabase, written only by `record_privacy_consent()` | Which notice version this **account** accepted, and when (RA 10173 evidence) |

- **No cookies for the app itself.** Application state and the session clock are `localStorage`
  (`scholarpath-addu-state`, `scholarpath-addu-session-activity`), and Supabase Auth keeps its session
  there too. The only third party that can set a cookie is the optional tawk.to live chat
  (`VITE_SUPPORT_CHANNEL=tawk`), and `syncSupportChat()` now refuses to load it until the storage
  notice's optional category is granted — withdrawing the choice unloads it.
- **The notice never blocks the app.** Required storage needs no permission, so dismissing the banner
  keeps only that; the blocking surface is the account consent card, shown once per account per
  notice version. Declining it signs the account out.
- **Google sign-up is covered.** The create-account form requires the notice, but Google never passes
  through it, so the consent card is what records consent for every role. The write path
  (`recordProfilePrivacyConsent`) calls a `security definer` RPC, and the guard trigger
  `guard_profile_privileged_columns` refuses a direct client write to either column.
- **A version bump re-asks.** `PRIVACY_NOTICE_VERSION` is free text in the database (1–32 characters),
  so changing the copy needs no migration; it re-prompts every device and re-records consent on each
  account. Settings → **Ask me about storage again** forgets the device answer.
- One `localStorage` record (`scholarpath-addu-state`) belongs to the signed-in `ownerId`. Sign-out
  resets it to `createFreshState()`, keeping only non-identifying device preferences (theme, the
  first-login flags, the support hint, and the storage-notice choice). A record saved under the
  retired `scholarpath-addu-demo-state` key is migrated once, keeping only theme, notification
  preferences, and custom deadlines.
- Support conversations, the household financial profile, and the staff note streams are React
  memory only and are cleared on account change and sign-out.
- RA 10173: never store a previous user's email, role, or applicant data in a device preference.
- The copy is **prototype wording** written for this study, not a legal instrument. It needs review by
  the University Data Protection Officer before it is used outside a demonstration, and the policy
  says so on the page.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "Supabase is not configured" | `.env` missing or unreadable | set `VITE_SUPABASE_URL` and a key, restart the dev server |
| Sign-in returns to `localhost:3000` | the redirect URL is not allow-listed | add it under **Authentication → URL Configuration** |
| A staff account signs in as a student | `profiles.role` was never claimed | check the invitation email matches the confirmed address, or invite again |
| A reviewer sees the wrong queue | `review_*` scope missing or at the wrong level | fix it on the Accounts page |
| A case is stuck at `Recommended` | no active account holds the configured approving level | create one, or change `approval_levels` on the Scholarship catalog |
| The Documents tab is missing | the case has not reached `For Verification` | **Continue to verification** first |
| An application cannot move forward | an attached file is not `Verified` | verify or revert it at the verification stage |
| The release button is refused | a case is still `Approved`, or an offer is unanswered | finish the final check, or record the answer |
| Status emails stopped | a function was not redeployed after a copy change | redeploy every `_shared/email.js` consumer |
| Interview emails have no Meet link | the Google refresh token expired | `npm run google:auth`, then update the secret |
| A reverted file cannot be replaced | the case has passed endorsement | ask the Admin to revert the application first |
| The assistant keeps replying | `VITE_SUPPORT_ASSISTANT` is unset | set it to `false`, or request a live agent |
| The consent card keeps reappearing | the migration is not applied, or `PRIVACY_NOTICE_VERSION` changed | apply `20261063000000`, or accept the new version once |
| The live chat widget does not load | the storage notice was answered "necessary only" | Settings → Privacy and data → Ask me about storage again, then accept all |

