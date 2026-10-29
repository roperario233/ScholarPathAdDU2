# ScholarPath AdDU

A React + Vite and Supabase webapp for our ScholarPath AdDU capstone.

## What’s included
- Scholarship discovery with faceted search
- Smart Eligibility Checker based on QPI (enrolled students) or senior high school general average (incoming first-years), income, degree, and exclusion rules
- Application tracker
- Reusable document vault
- Admissions Office application operations
- Department chair review view
- My Profile editing for every role (personal, academic, household, eligibility background, and account security details)

## Student support inbox

The in-app **Support inbox** lets an authenticated student message the Admissions
Office and receive replies inside ScholarPath. One continuous conversation is kept
per student. Both Admissions Office Staff and the Admissions Office Head can answer
from the **Support inbox** route in the office workspace. Academic reviewers have
no access to support conversations. Messages are text-only, limited to 2,000
characters, and refreshed every 15 seconds while the student chat is open or the
office inbox route is active. An office reply adds an in-app notification, respecting
the student's in-app notification preference. This is human live chat, not an AI
assistant; the AI feature remains deferred.

Apply `/supabase/migrations/20261053000000_add_support_inbox.sql` to the Supabase
project before enabling the inbox. The same table, RLS, and trigger definitions are
included in `supabase/schema.sql` for fresh projects. The browser reports when the
migration is not yet available; the rest of the app continues to work. There is no
email/SMS alert to the office in this first phase, so an office agent needs to keep
the Support inbox route open to see new student messages.

The previous tawk.to widget remains an optional fallback. The default channel is
`inbox`; set `VITE_SUPPORT_CHANNEL=tawk` to use the student-only tawk.to widget
instead. For that fallback, the configured property and widget ids are:

```dotenv
VITE_SUPPORT_CHANNEL=tawk
VITE_TAWK_PROPERTY_ID=6ae2c9732afdd33474271165
VITE_TAWK_WIDGET_ID=1k62u5r7a
```

The tawk widget is free live chat and not AI. If using it, the signed-in student's
profile name and email are shared with tawk.to but are not cryptographically
verified with Secure Mode. Set `VITE_SUPPORT_CHANNEL=inbox` (or remove it) to use
the in-app inbox. Vite reads environment variables at build time; restart the dev
server or rebuild and redeploy after changing them.

## Authentication redirect configuration

Google sign-in, password reset links, and account confirmation emails all return
the browser to a URL that Supabase Auth must have allow-listed. When the
requested URL is not allow-listed, Supabase Auth silently substitutes its
project Site URL, which is the default `http://localhost:3000` for a fresh
project. That is why an unconfigured project sends the deployed prototype back
to localhost after Google sign-in.

In the Supabase dashboard, under **Authentication → URL Configuration**:

- **Site URL**: the deployed prototype origin, for example `https://scholarpath-addu.vercel.app`
- **Redirect URLs**: the deployed origin with a wildcard path (`https://scholarpath-addu.vercel.app/**`), a scoped wildcard for preview deployments such as `https://scholarpath-addu*.vercel.app/**`, and the local development origins `http://localhost:5173/**` and `http://127.0.0.1:5173/**`

Under **Authentication → Providers → Google**, the Google Cloud OAuth client must
list `https://<project-ref>.supabase.co/auth/v1/callback` as an authorized
redirect URI.

Optional: set `VITE_SITE_URL` in the deployed environment (see `.env.example`)
to make every build return to one canonical origin. Leave it unset locally so
local development signs in against `http://localhost:5173`.

## Session security

Authenticated sessions end after **15 minutes without activity** or **12 hours
after sign-in**, whichever comes first. ScholarPath warns shortly before either
limit, checks the session with Supabase when a suspended tab becomes active, and
propagates sign-out across tabs. The absolute timeout remains in effect across a
reload or browser restart; a new sign-in is required after expiry. Existing
sessions without a recorded sign-in time require one fresh sign-in to establish
the policy baseline.

The defaults can be changed at build time with
`VITE_SESSION_IDLE_TIMEOUT_MINUTES`, `VITE_SESSION_ABSOLUTE_TIMEOUT_HOURS`, and
`VITE_SESSION_WARNING_SECONDS` (see `.env.example`). These are client-enforced
controls, not a server-side inactivity detector. For defense in depth, set an
appropriate refresh-token lifetime under **Supabase → Authentication →
Sessions** as well. Supabase remains responsible for validating and revoking
the actual auth tokens.

### Opening the prototype from another device

`npm run dev` binds to every network interface, so Vite prints both a local URL
and one or more `Network:` URLs. Open a `Network:` URL (for example
`http://192.168.1.20:5173`) from a phone or another computer on the same Wi-Fi.
Add that same origin to Supabase **Authentication → URL Configuration → Redirect
URLs** (for example `http://192.168.1.20:5173/**`) if Google sign-in or email
links should return to the LAN address; otherwise Supabase falls back to the
project Site URL. Camera capture is unavailable on a plain-HTTP LAN address
because browsers only allow it in a secure context, so take photos on
`localhost` or over HTTPS.

## My Profile

Every role has a **My Profile** page (sidebar → My Profile, or the avatar in the
mobile header). Overview is read-only; every other section saves on its own:

| Section | Who sees it | What it covers |
| --- | --- | --- |
| Overview | Everyone | Identity card and a profile completeness checklist that also surfaces each verifiable attribute's Document Vault verification state |
| Personal information | Everyone | Profile photo (take one with the camera or choose an existing image), full name, Philippine mobile number (students also set religion, civil status, and an optional default statement/essay that prefills each new application); sign-in email, role, and department are read-only |
| Address | Students | Complete address, country, and a residing address that can mirror the complete address with a same-as toggle |
| Family details | Students | Father and mother name, occupation, and deceased status, family position, and number of siblings |
| Academic profile | Students | Degree program (sets the school, cluster, and academic department the profile is filed under), year standing, academic standing, AdDU student number, and annual QPI; an incoming first-year reports senior high school strand and general average instead of a student number and QPI, and ranks a 2nd and 3rd program choice |
| Household finances | Students | Office-only FORM 230-SCH household finances: perceived economic status, each parent's employment and income, assets, and appliances (readable by the student and the Admissions Office, never by a Department Chair) |
| Eligibility background | Students | Household income, the exclusion answers (active government grant, another active scholarship, prepaid tuition plan, sibling on AdDU aid), citizenship, IP community, PWD, employment status, graduating honors standing and class size, and sponsor ties (GSIS, AFP/CAA, US veteran). The grant list activates when one of the first three exclusion answers is on — or when a grant was already recorded — and requires at least one grant, and it is taken as declared (no document is verified for it) |
| Account security | Everyone | Change password or email a reset link |

The Smart Eligibility Checker uses the saved values right away. QPI and income
are self-reported and are not verified with the Registrar. A student can
optionally upload proof documents for these attributes in the Document Vault,
and the Admissions Office verifies the file and the linked attribute together;
verification is informational and never blocks eligibility matching or applying.

Department Chairs and both Admissions Office lanes can edit only their name and
mobile number. Department assignment is never self-editable, because it
scopes the Department Review queue.

Supabase is required: without the environment variables the app cannot load
data or sign in, and there is no offline fallback.

### Database migration

Apply `supabase/migrations/20261005140000_add_profile_details.sql` to an
existing Supabase project. It adds `profiles.bio` (up to 280 characters) and
`profiles.eligibility_attributes` (JSON). Until it is applied, the fields that
already have `profiles` columns still save (name, mobile number, student number,
degree program, QPI, household income, and the government grant answer). The
eligibility answers (year standing, academic standing, the
remaining household exclusion answers, and the whole Eligibility
background section) do not reach the server. Fresh projects get both columns
from `supabase/schema.sql`.

Profile attribute verification adds `documents.linked_attributes` through
`supabase/migrations/20261007000000_add_document_linked_attributes.sql`. Until it
is applied, the project still loads and uploads documents; only the proof links
that drive the verified badges are absent. Fresh projects get the column from
`supabase/schema.sql`.

Descriptive profile fields (religion, civil status, address, country, and family
details) are stored in `profiles.profile_details` (JSON) through
`supabase/migrations/20261008000000_add_profile_details_json.sql`. The new
eligibility answers (program choices, IP community, PWD, and employment status)
ride along in `profiles.eligibility_attributes`. Until the migration is applied,
these fields stay on the device and the rest of the profile still saves. Fresh
projects get the column from `supabase/schema.sql`.

Profile photos add `profiles.avatar_path` and the private `avatars` bucket through
`supabase/migrations/20261026000000_add_profile_avatar.sql`. Until it is applied,
the rest of My Profile still loads and saves (the path is read in its own query),
and the profile photo controls report that the server profile cannot store the
photo yet. Fresh projects get the column and the bucket from
`supabase/schema.sql`.

The two application photo requirements are backfilled by
`supabase/migrations/20261026000001_add_applicant_photo_requirement.sql`. It adds
`applicant-photo` and `residence-photos` to the in-scope catalog rows that do not
already list them; existing Draft applications must attach both before they can
be submitted, while already-submitted applications are unaffected.

Document Vault files are stored in a private Supabase Storage bucket named
`documents` (10 MB limit; PDF, JPG, and PNG only). The bucket, its storage RLS
policies, and the department-scoped `chair_documents_read` policy come from
`supabase/migrations/20261009000000_add_document_storage.sql`; fresh projects get
them from `supabase/schema.sql`. Students manage only their own folder, the
Admissions Office reads every document, and a Department Chair reads documents
owned by students in the chair's department. Viewing is always through a
short-lived signed URL, so no document is ever public.

Profile photos use a separate private `avatars` bucket (5 MB limit; JPG, PNG, or
WebP), with only an owner policy, plus a `profiles.avatar_path` column. They come
from `supabase/migrations/20261026000000_add_profile_avatar.sql`. A profile photo
is personal: it appears in the signed-in user's header and My Profile only, is
never sent with an application, and has no photo guidelines. The app resolves a
signed URL in memory and falls back to the user's initials when it expires.

### Photos submitted with applications

Every in-scope AdDU track (Grant-in-Aid, Jubilee, and the Working Scholar
Program) asks for two verifiable photo requirements:

- **Applicant photo** (`Applicant Photo`, shown as *2x2 ID Photo*): a recent
  square ID photo of the applicant.
- **Photos of residence** (`Photos of Residence`): exterior and interior photos
  of the student's home; one requirement can hold several attached files.

Students can take either with the device camera or choose an existing image, from
the application workspace, the Document Vault, or a resubmission replacement.
The camera opens from a tap, supports switching between the front and rear
camera, and falls back to an existing photo or the native device camera when
permission is blocked or unavailable. Captures are normalized to a JPEG: the ID
photo is cropped square at 1024 px, residence photos keep their aspect ratio at
1600 px on the long edge. A bullet-point guide (clean, presentable, well lit, face
unobstructed, recent, no filters) is shown beside the camera and in the upload
card, and it applies **only to application photos** — the profile photo has no
such rules.

Both are ordinary Document Vault files, so the Admissions Office verifies them at
Standard Procedure step 3 like any other required document, reverts them for
resubmission with a recorded note (including photo-specific notes), and the
student can replace a reverted file with another capture or upload. The stored
decision stays `Rejected`; the student-facing label is **Reverted for
resubmission**, and the recorded note stays visible because it tells the student
what to correct. The two requirements come from the default lists in
`src/lib/applicationRequirements.js`; existing catalog rows get them from
`supabase/migrations/20261026000001_add_applicant_photo_requirement.sql`.

## Database maintenance

Four helpers live in `supabase/`. None of them is a migration, none changes the
schema, and nothing runs them automatically.

- `supabase/application_status_log_checks.sql` — read-only checks over the
  append-only status log (RQ2).
- `supabase/maintenance_out_of_scope_applications.sql` — the issue #3 queries
  and the deactivation statement for catalog rows outside the three Appendix A
  tracks.
- `supabase/maintenance_reset_transactional_data.sql` — the clean-demo reset.
- `supabase/maintenance_redact_rejection_reasons.sql` — the one-time privacy
  redaction behind Consultation 2 #8: it replaces the reason already stored in
  `application_status_log.reason` and in the `Rejected` entry of
  `applications.timeline` with **Application not accepted.**, because those two
  columns are readable by the student. The recorded reason stays in the
  staff-only `application_review_comments` thread. It touches no
  `documents.rejection_reason` value — a document resubmission note stays visible.
  It is idempotent and runs in one transaction with
  `session_replication_role = replica` so the append-only log and the application
  triggers do not block it.

### Resetting the demo data

Run `supabase/maintenance_reset_transactional_data.sql` against the project to
clear every application, document, notification, and office-workflow row while
keeping the catalog and the accounts. It keeps `profiles` (so every role can
still sign in, with its answers and notification preferences intact),
`annual_qpi_records`, `student_financial_profiles`, `scholarships`,
`academic_programs`, and `interview_locations`.

The script snapshots what it removes into the `backups` schema
(`backups.reset_<date>_<table>`) before deleting, runs inside one transaction
that aborts if a row survives, and revokes the snapshot from the API roles. Drop
it once the reset is accepted with `drop schema backups cascade;`. The status log
is cleared before the applications (its foreign key does not cascade) and the
documents after them, so no deletion trigger blocks the run.

### Reclaiming orphaned Storage files

`documents.storage_path` and `profiles.avatar_path` are the only handles the app
has on a file, so a row deleted without its object leaves bytes in the private
bucket that nothing can reach. Delete the rows first (the reset above does), then
sweep the buckets:

```powershell
$env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
npm run cleanup:storage              # dry run: one line per orphan, grouped by folder
npm run cleanup:storage -- --apply   # delete, then re-run the dry run to confirm 0
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
```

The service role is required because the bucket policies only let a folder owner
delete, and most orphans sit in folders of accounts that no longer exist. The
project URL is read from `.env`; the key must come from the shell for a single
run and never from a `VITE_` variable. Deleting `storage.objects` rows directly
is not a substitute: it hides the files without freeing the space.

## Admissions Office workspace

The Admissions Office is one office with two accountability lanes. **Admissions
Office Staff** (`admissions_office`) prepare a case and **Admissions Office Head**
(`admissions_head`) has full office authority: the Head can run every Staff stage
and also decides endorsement, approval, and release. Both lanes share the overview
and the review queue; only the Head sees the endorsement, approval/release,
catalog, and announcement pages.

| Route | Page | Lane | What it covers |
| --- | --- | --- | --- |
| `admin` | Overview | Both | Role-scoped metrics, links into each accessible workspace, and the recent application activity feed |
| `admin-review` | Review queue | Both | SOP steps 2–6: starting a review, verifying attached documents or reverting one for resubmission, the hand-off for endorsement (the Head records the decision), coordinating interviews (panel from the applicant's school, SOP 5a), and the sub-committee recommendation |
| `admin-endorsement` | Endorsement | Head | SOP step 4: the cases the Staff handed over that await the endorsement decision, with the hand-off record, document readiness, waiting age against the 5-day target, the case officers who prepared the case, and the recorded-decisions history; each row opens the shared review surface on its Endorsement tab |
| `admin-interviews` | Interview schedule | Both | SOP step 5 operations: endorsed applicants awaiting a schedule, upcoming interviews grouped by Manila date, and roster-level panelist/room clashes. Scheduling, rescheduling, cancellation, and repair still open the shared review surface; only the Head manages the saved venues, from the calendar page |
| `admin-calendar` | Office calendar | Both | One month view of the SOP step-5 interviews, the AdDU scholarship deadlines the office publishes, the decisions the office recorded (endorsement, recommendation, approval, release), and the Head's office planning entries, with mark-kind filters, a Today jump, and a grouped day agenda; the Head's venue manager and planning-entry form live here |
| `admin-release` | Recommendation and results release | Head | SOP steps 7–8: approving recommendations, releasing approved results, and exporting the accepted list |
| `admin-catalog` | Scholarship catalog | Head | Publishing and editing AdDU internal catalog entries and the documents each entry requires; leaving with unsaved input asks before discarding |
| `admin-announcements` | Announcements | Head | Publishing office updates and reviewing the published list |

Stage authority is role-scoped: Staff may move an application through
`Submitted`, `Under Review`, `For Verification`, and `For Endorsement` (the
hand-off), and on through `Endorsed` → `Interview` → `Recommended`, but cannot
endorse, approve, or release. The Head can perform all of those Staff moves and
also records the endorsement (`For Endorsement` → `Endorsed`) and
`Recommended → Approved → Released`. The same rule is repeated in the database
(`enforce_admissions_office_lane_transitions`) and in the role-scoped transition
map, so a client-side bug cannot let Staff endorse, approve, or release.

The Department Chair workspace opens the same application review modal read-only.
Its **Endorsement** tab appears once an application reaches endorsement and shows
the hand-off record and the Office of Admissions & Aid decision, plus one internal
comment thread; the Chair has no Endorse action, because endorsement is a
central Admissions Office decision. Students never see the thread, and every
comment stays in the append-only review record.

The Chair also has a dedicated **Calendar** (`chair-calendar`) and **Interviews**
(`chair-interviews`) page. The calendar marks the interviews the Chair sits on
apart from the rest of the department, alongside the AdDU scholarship deadlines,
the decisions the Admissions Office recorded on the department's cases, and the
office's planning dates; its agenda groups those layers, with the Chair's own
panel work first. The interviews page lists the Chair's panel work with a link
into the review modal's Interview tab, where the Chair records evaluation notes.
Scheduling, rescheduling, and cancellation stay with the Admissions Office, and
only its Head publishes or removes a planning entry, so the Chair pages never
offer those controls, and the Department Chair still sees only their own
department. Attendance is not tracked: an interview is scheduled or cancelled,
and recording the recommendation closes a live schedule.

## Provisioning staff accounts

Public registration cannot grant a privileged role, so the Admissions Office and
Department Chair accounts are created server-side. The capstone prototype uses
these seeded credentials:

| Role | Email | Password | Lands on |
| --- | --- | --- | --- |
| Admissions Office Staff | `john67.admissions@gmail.com` | `john6767` | Admissions Office overview and review queue |
| Admissions Office Head | `samantha.headadmissions@gmail.com` | `scholarpath67` | Admissions Office overview, approval/release, catalog, and announcements |
| Dean (SEA) | `miguel.chair.sea@gmail.com` | `scholarpath67` | School Review and interview panel (every department in the School of Engineering and Architecture) |
| Admissions Office Staff (earlier seed) | `scholarpath.admissions@gmail.com` | `Admissions@2026` | Admissions Office review queue |
| Admissions Office Head (earlier seed) | `scholarpath.admissionshead@gmail.com` | `AdmissionsHead@2026` | Admissions Office overview |
| Assistant Dean (Computer Studies) | `ogs@addu.edu.ph` | — | Cluster Review (the Computer Studies cluster inside the School of Arts and Sciences) |
| Chairperson (IT & IS Department) | `scholarpath.chair@gmail.com` | `Chair@2026` | Department Review (the Information Technology and Information Systems Department) |

These credentials exist only for the capstone prototype; do not reuse them in
any real deployment. The addresses deliberately sit on Gmail rather than
`addu.edu.ph`: real AdDU mailboxes must never receive test mail, password
resets, or status notifications sent from the prototype.

Each account's address is stored twice, and both copies have to change together:
`auth.users.email` is the sign-in identity (and where password recovery goes),
while `public.profiles.email` is what the Edge Functions deliver to
(`send-test-email` and `notify-application-status` both select it, and the
`handle_new_user()` trigger only copies it on insert). Change the auth address
through the Auth Admin API (`updateUserById(id, { email, email_confirm: true })`)
or under Authentication -> Users in the dashboard, then write the same address to
the matching `profiles` row. Do not use a user-initiated email change: while
Secure Email Change is enabled it mails a confirmation to the old address, and
changing only the auth identity leaves delivery pointed at the previous mailbox.

To provision or reset an account, create the auth user with a confirmed
email address, then set the role and department on the matching `profiles` row.
The Admissions Office Head shares the Office of Admissions department with the
Staff lane; the role value, not the department, decides what the account may do:

```sql
update public.profiles
set role = 'admissions_office', department = 'Office of Admissions'
where email = 'john67.admissions@gmail.com';

update public.profiles
set role = 'admissions_head', department = 'Office of Admissions'
where email = 'samantha.headadmissions@gmail.com';

update public.profiles
set role = 'dean', department = 'School of Engineering and Architecture (SEA)',
    review_school = 'School of Engineering and Architecture (SEA)'
where email = 'miguel.chair.sea@gmail.com';

-- Earlier seeded accounts (kept for reference; the credentials table above
-- still lists them).
update public.profiles
set role = 'admissions_office', department = 'Office of Admissions'
where email = 'scholarpath.admissions@gmail.com';

update public.profiles
set role = 'admissions_head', department = 'Office of Admissions'
where email = 'scholarpath.admissionshead@gmail.com';

update public.profiles
set role = 'assistant_dean', department = 'School of Arts and Sciences (SAS)',
    review_school = 'School of Arts and Sciences (SAS)', review_cluster = 'Computer Studies'
where email = 'ogs@addu.edu.ph';

update public.profiles
set role = 'department_chair', department = 'School of Arts and Sciences (SAS)',
    review_department = 'Information Technology and Information Systems Department'
where email = 'scholarpath.chair@gmail.com';
```

## Academic reviewer ladder

Reviewers own one level of the AdDU hierarchy
**School → Cluster → Department → Degree Program**:

| Role value | Title | Scope column | Sees |
| --- | --- | --- | --- |
| `dean` | Dean | `review_school` | every cluster and department in that school |
| `assistant_dean` | Assistant Dean | `review_school` + `review_cluster` | every department in that cluster |
| `department_chair` | Chairperson | `review_department` | that department and its degree programs |

None of them takes a stage move — endorsement, approval, and release stay with the
Admissions Office. `public.reviewer_scopes_to_student()` is the single predicate
behind every reviewer row-level policy, and `src/lib/reviewScope.js` mirrors it for
the pages. The applicant's level is resolved from their degree program through
`academic_programs`, so adding a program or department needs no policy change.

`profiles.department` holds the **school** for students and reviewers, which is the
label the sidebar and the SOP 5a panel heading show; it is not the academic
department. A Chairperson whose `review_department` is still empty keeps a legacy
school-wide read, so an account that has not been assigned a department yet is never
locked out of its own queue. Assign the scope with an operator-run `update` like the
ones above; it is never self-editable.

The reviewer scope above is what decides which cases a reviewer can read, so it must
always name a level that exists in `academic_programs` (`school`, `school`+`cluster`,
or `department`). `profiles.department` stays the school label for every role, which
is also what the SOP 5a panel heading and the sidebar show. Sign-in resolves the role
from `profiles.role` first (`profiles.role` -> `user_metadata.role` -> `student`),
so a role change only takes effect once this row is updated. The Admissions
Office Staff and Head routes, and the Department Review view, appear in the
sidebar only for those roles.


## Email notifications (Resend)

Deadline reminders and application status updates are emailed through
[Resend](https://resend.com) and texted through
[iprogSMS](https://www.iprogsms.com/api/v1/documentation). Three Supabase Edge
Functions handle delivery on both channels:

| Function | Trigger | Purpose |
| --- | --- | --- |
| `process-deadline-reminders` | Scheduled (pg_cron + pg_net) | Sends the 7-day / 3-day / 1-day reminders for scholarships, open applications, and saved calendar deadlines, in-app plus email and SMS |
| `notify-application-status` | Called by the app after a status change | Notifies the applicant (email and SMS) when staff (or the applicant) moves an application |
| `send-test-email` | Settings -> Email delivery test | Sends one message to the signed-in user so delivery is verifiable without waiting for a schedule |
| `send-test-sms` | Settings -> SMS delivery test | Sends one text to the signed-in user's own mobile number |

### Setup

1. **Verify the sending domain in Resend.** Until its DNS records report as
   verified, Resend rejects mail from that address. The only sender that works
   without a verified domain is `onboarding@resend.dev`, which delivers solely
   to the Resend account owner's own inbox.
2. **Set the Edge Function secrets.** These are server-side only and must never
   carry a `VITE_` prefix, which would inline them into the browser bundle:

   ```sh
   supabase secrets set \
     RESEND_API_KEY=re_xxx \
     RESEND_FROM_EMAIL=alerts@yourdomain \
     RESEND_FROM_NAME="ScholarPath AdDU" \
     APP_SITE_URL=https://scholarpath-addu.vercel.app/ \
     REMINDER_CRON_SECRET=<a long random value> \
     IPROGSMS_API_TOKEN=<your iprogSMS API token> \
     IPROGSMS_PROVIDER=0
   ```

   SMS notes: `IPROGSMS_API_TOKEN` enables the mobile channel; leave it unset
   and every SMS send is skipped. `IPROGSMS_PROVIDER`
   maps to the gateway's optional `sms_provider` flag (0/1/2) and can be omitted.
   iprogSMS supports Globe, TM, DITO, and GOMO on the shared `iprogSMS` sender;
   Smart and TNT recipients require a paid custom sender name. A 200 response
   confirms queue-accept only — the gateway has no delivery webhooks, so the
   ledger records the `message_id` and delivery can be checked poll-only via
   `GET /sms_messages/status?message_id=...`.

3. **Deploy the functions:**

   ```sh
   supabase functions deploy process-deadline-reminders --no-verify-jwt --use-api
   supabase functions deploy notify-application-status
   supabase functions deploy send-test-email
   supabase functions deploy send-test-sms
   ```

   Two deliberate choices here:

   - `--no-verify-jwt` on the reminder function, because the platform-level JWT
     check rejects the service role key and the scheduled caller presents a
     shared secret instead. The function compares that secret by exact value and
     fails closed when `REMINDER_CRON_SECRET` is unset. Never point this endpoint
     at the anon key: it is public, and this function can email every student.
   - `--use-api` only if you do not have Docker running; the CLI needs Docker to
     bundle functions locally otherwise.

4. **Schedule the daily run.** `supabase/migrations/20261005000001_schedule_deadline_reminders.sql`
   enables `pg_cron` + `pg_net` and schedules the job (07:00 Asia/Manila). Replace
   its `<project-ref>` and `<REMINDER_CRON_SECRET>` placeholders (the latter with
   the same value as the Edge Function secret) before applying. The secret is
   bound into the scheduled command because Supabase's `postgres` role cannot run
   `alter database postgres set app.settings.reminder_cron_secret`. The equivalent
   block stays documented at the bottom of `supabase/schema.sql`.

### Verifying delivery

Open **Settings -> Email delivery test** and press *Send test email*. It sends
one message to the signed-in user's own address and reports the real outcome, so
delivery can be confirmed without waiting for a scheduled reminder. The matching
**SMS delivery test** text messages the signed-in user's own `profiles.phone`
number (masked in the response). Every scheduled send is also recorded in
`notification_email_log` with the Resend or iprogSMS message id and status, on
the same per-user ledger row.

### SMS recipients

Students add their mobile number in the first-login academic profile or later
under **My Profile → Personal information** (optional field, validated to the
Philippine mobile format, e.g. `0917 123 4567`). The Edge
Functions normalize it to the international `639XXXXXXXXX` form iprogSMS
expects; a student without a usable number is skipped, not failed, so the
reminder stays retryable once they add one.

### How delivery preferences are honored

The notification center settings live in localStorage, so they are mirrored to
`profiles.notification_preferences` whenever they change. The reminder function
skips the in-app row when `inAppEnabled` is false, skips the email when
`emailEnabled` is false or the relevant reminder timing is switched off, and
skips the SMS when `smsEnabled` is false, the timing is off, or the student has
no usable mobile number. Every delivery is recorded in `notification_email_log`,
keyed by a stable per-user source key, so a reminder is never sent twice on
either channel.

### Deploying so reminders actually email

Email reminders are computed server-side from the `custom_deadlines` table, so a
reminder must exist in Supabase before it can ever be emailed. The Calendar
saves to Supabase only when the app holds a live Supabase session, which means a
build running in demo mode saves reminders to localStorage only.

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or
`VITE_SUPABASE_ANON_KEY`) in the hosting environment as well as locally.
Otherwise the deployed site silently falls back to demo mode and its calendar
reminders never reach the reminder function.

The Calendar now reports the outcome each time a reminder is added or removed,
and any reminder that exists only in a browser is pushed to Supabase on the next
successful sign-in.

## Google Calendar and Meet (interviews)

SOP step 5 interviews can create a real Google Calendar event with a Google Meet
link, and invite the applicant, the account panelists, and any faculty guest with
an email. The integration is optional: without it the Admissions Office pastes a
meeting link and the applicant downloads an `.ics` file.

The event is written by the `manage-interview-event` Edge Function, never by the
browser. The refresh token stays in Supabase secrets.

### What it does

- An online interview with a blank meeting link gets a generated Meet link.
- The guest list is hidden from guests, so the applicant never sees the panel's
  names or addresses through the invitation.
- Rescheduling patches the same event, so the applicant gets one updated entry
  instead of two.
- Switching between online and on-site replaces the event, because a live Meet
  link cannot be reliably stripped from an existing one.
- Cancelling, and rejecting an application at the `Interview` stage, delete it.
- Each event records the application it belongs to, so **Repair calendar event**
  in the Interview tab can recreate or remove it after a failure.

### 1. Google Cloud setup (once)

1. Create a project (it may live outside the university organization).
2. **APIs & Services → Library → Google Calendar API → Enable.** No billing
   account is needed, and the Meet API is not required.
3. **OAuth consent screen**: app name, support email, developer contact;
   user type **External**, status **Testing**; add the office Google account as a
   test user.
4. **Data access → scopes**, exactly:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
     (the helper script only; the Edge Function never uses it)
   - `openid`, `email` (so the helper can print which account consented)
5. **Clients → Create client → Web application**, with the redirect URI
   `http://localhost:5555/oauth2callback`. Copy the client id and secret.
6. In Google Calendar, signed in as the **office account**, create a calendar
   (for example *ScholarPath AdDU — Scholarship Interviews*, time zone Manila)
   and copy its id from *Settings and sharing → Integrate calendar*.

### 2. Mint the refresh token

Put the client id and secret in `.env` in the project root (either line works;
the helper only reads those two keys):

```dotenv
GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...
```

Then, from the project root:

```powershell
npm run google:auth
```

Exporting them in the shell also works and wins over `.env` for that run:

```powershell
$env:GOOGLE_OAUTH_CLIENT_ID="..."; $env:GOOGLE_OAUTH_CLIENT_SECRET="..."; npm run google:auth
```

Approve the consent screen **with the account that owns the interview calendar**.
The script prints that account, every calendar it can write to, the refresh
token, and a ready `supabase secrets set` command.

Consent is bound to one Google account: if the token belongs to a different
account than the calendar, the Calendar API answers `404 Not Found` even though
the token itself is valid.

### 3. Set the secrets and deploy

```powershell
supabase secrets set "GOOGLE_OAUTH_CLIENT_ID=..." "GOOGLE_OAUTH_CLIENT_SECRET=..." "GOOGLE_CALENDAR_REFRESH_TOKEN=..." "GOOGLE_CALENDAR_ID=..."
supabase functions deploy manage-interview-event --no-verify-jwt
```

`GOOGLE_CALENDAR_ID` must be the plain id with a literal `@`
(`xxxx@group.calendar.google.com`). Never a `VITE_` variable, and never a URL.

The Interview tab shows the saved schedule: the state badges, a read-only meeting
link with copy and open controls (or the on-site location), who was invited, and
the panel. **Repair calendar event** appears only when Google and the saved record
disagree — a scheduled interview with no event or no link, or a cancelled one
whose event survived. Repair creates an event that never landed, patches one that
drifted, deletes a duplicate, removes the leftover event, and attaches a Meet
conference to an online event that has none.

### 4. The 7-day refresh token

While the OAuth app is External + Testing, Google expires the refresh token after
7 days. Existing events and Meet links keep working; new automatic Meet links
stop until the token is replaced.

Re-run `npm run google:auth` **every Monday and two days before a demo**, then
update `GOOGLE_CALENDAR_REFRESH_TOKEN`. Publishing the app (requires Google
verification) or consenting with an internal Workspace app removes the limit.

The app treats this as a normal state: the panel says the authorization expired,
and scheduling still works with a pasted meeting link.

### 5. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `configured: false` | a secret is missing | set all four, then re-check |
| `reauth_required` | the 7-day window lapsed, or consent was revoked | `npm run google:auth`, update the token |
| `calendar_not_found` | the token's account cannot see that calendar id | own or share the calendar with it, or correct the id |
| `calendar_forbidden` | the account has read-only access | re-share with *Make changes to events* |
| `insufficient_scope` | the token was minted without `calendar.events` | re-consent |
| a Meet link never appears | Google reported the conference as pending | use **Repair calendar event**, or paste a link |
| two events at the same time | a cancel could not reach Google, so the next schedule created a second one | delete the orphan in Google Calendar once, then **Repair calendar event** (it attaches a real Meet link and sweeps any tracked duplicate) |
| the calendar event shows a link but the app says *No meeting link* | the event was rebuilt from a reused link and owns no conference | **Repair calendar event** attaches one |

If the calendar stays unreachable, set `GOOGLE_CALENDAR_ID=primary` and retry: a
success proves the credentials are fine and the calendar id is the problem.

