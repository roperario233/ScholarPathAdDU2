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
| Personal information | Everyone | Profile photo (take one with the camera or choose an existing image), full name, Philippine mobile number, and short bio (students also set religion, civil status, and an optional default scholarship statement that prefills each new application); sign-in email, role, and department are read-only |
| Address | Students | Complete address, country, and a residing address that can mirror the complete address with a same-as toggle |
| Family details | Students | Father and mother name, occupation, and deceased status, family position, and number of siblings |
| Academic profile | Students | Degree program (sets the department), year standing, academic standing, AdDU student number, and annual QPI; an incoming first-year reports senior high school strand and general average instead of a student number and QPI, and ranks a 2nd and 3rd program choice |
| Household and financial aid | Students | Household income plus the exclusion answers: active government grant, another active scholarship, sibling on AdDU aid, prepaid tuition plan |
| Eligibility background | Students | Citizenship, IP community, PWD, employment status, graduating honors standing and class size, and sponsor ties (GSIS, AFP/CAA, US veteran) |
| Account security | Everyone | Change password or email a reset link |

The Smart Eligibility Checker uses the saved values right away. QPI and income
are self-reported and are not verified with the Registrar. A student can
optionally upload proof documents for these attributes in the Document Vault,
and the Admissions Office verifies the file and the linked attribute together;
verification is informational and never blocks eligibility matching or applying.

Department Chairs and both Admissions Office lanes can edit only their name,
mobile number, and bio. Department assignment is never self-editable, because it
scopes the Department Review queue.

Supabase is required: without the environment variables the app cannot load
data or sign in, and there is no offline fallback.

### Database migration

Apply `supabase/migrations/20261005140000_add_profile_details.sql` to an
existing Supabase project. It adds `profiles.bio` (up to 280 characters) and
`profiles.eligibility_attributes` (JSON). Until it is applied, the fields that
already have `profiles` columns still save (name, mobile number, student number,
degree program, QPI, household income, and the government grant answer). The
bio and the other eligibility answers (year standing, academic standing, the
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

Every in-scope AdDU track (Grant-in-Aid, Jubilee, and the Student Assistant
Program) asks for two verifiable photo requirements:

- **Applicant photo** (`Applicant Photo`, shown as *2x2 ID Photo*): a recent
  square ID photo of the applicant.
- **Photos of residence** (`Photos of Residence`): exterior and interior photos
  of the student's home; one requirement can hold several attached files.

Students can take either with the device camera or choose an existing image, from
the application workspace, the Document Vault, or a rejected-file replacement.
The camera opens from a tap, supports switching between the front and rear
camera, and falls back to an existing photo or the native device camera when
permission is blocked or unavailable. Captures are normalized to a JPEG: the ID
photo is cropped square at 1024 px, residence photos keep their aspect ratio at
1600 px on the long edge. A bullet-point guide (clean, presentable, well lit, face
unobstructed, recent, no filters) is shown beside the camera and in the upload
card, and it applies **only to application photos** — the profile photo has no
such rules.

Both are ordinary Document Vault files, so the Admissions Office verifies them at
Standard Procedure step 3 like any other required document, rejects them with a
recorded reason (including photo-specific reasons), and the student can replace a
rejected file with another capture or upload. The two requirements come from the
default lists in `src/lib/applicationRequirements.js`; existing catalog rows get
them from `supabase/migrations/20261026000001_add_applicant_photo_requirement.sql`.

## Admissions Office workspace

The Admissions Office is one office with two accountability lanes. **Admissions
Office Staff** (`admissions_office`) prepare a case and **Admissions Office Head**
(`admissions_head`) has full office authority: the Head can run every Staff stage
and also decides approval and release. Both lanes share the overview and the
review queue; only the Head sees the approval/release, catalog, and announcement
pages.

| Route | Page | Lane | What it covers |
| --- | --- | --- | --- |
| `admin` | Overview | Both | Role-scoped metrics, links into each accessible workspace, and the recent application activity feed |
| `admin-review` | Review queue | Both | SOP steps 2–6: starting a review, verifying or rejecting attached documents, the hand-off to endorsement, coordinating interviews (panel from the applicant's school, SOP 5a), and the sub-committee recommendation |
| `admin-release` | Recommendation and results release | Head | SOP steps 7–8: approving recommendations, releasing approved results, and exporting the accepted list |
| `admin-catalog` | Scholarship catalog | Head | Publishing and editing AdDU internal catalog entries and the documents each entry requires; leaving with unsaved input asks before discarding |
| `admin-announcements` | Announcements | Head | Publishing office updates and reviewing the published list |

Stage authority is role-scoped: Staff may move an application through
`Submitted`, `Under Review`, `For Verification`, `For Endorsement` (hand-off),
`Endorsed` → `Interview` → `Recommended`, but cannot approve or release. The Head
can perform all of those Staff moves and also `Recommended → Approved →
Released`. The same rule is repeated in the database
(`enforce_admissions_office_lane_transitions`) and in the role-scoped transition
map, so a client-side bug cannot let Staff approve or release.

The Department Chair workspace opens the same application review modal. Its
**Endorsement** tab appears once an application reaches document verification and
shows the endorsement record (hand-off and decision), one internal comment
thread, and the Endorse action. Students never see the thread, and every comment
stays in the append-only review record.

## Provisioning staff accounts

Public registration cannot grant a privileged role, so the Admissions Office and
Department Chair accounts are created server-side. The capstone prototype uses
these seeded credentials:

| Role | Email | Password | Lands on |
| --- | --- | --- | --- |
| Admissions Office Staff | `john67.admissions@gmail.com` | `john6767` | Admissions Office overview and review queue |
| Admissions Office Head | `samantha.headadmissions@gmail.com` | `scholarpath67` | Admissions Office overview, approval/release, catalog, and announcements |
| Department Chair (SEA) | `miguel.chair.sea@gmail.com` | `scholarpath67` | Department Review and interview panel (School of Engineering and Architecture scoped) |
| Admissions Office Staff (earlier seed) | `scholarpath.admissions@gmail.com` | `Admissions@2026` | Admissions Office review queue |
| Admissions Office Head (earlier seed) | `scholarpath.admissionshead@gmail.com` | `AdmissionsHead@2026` | Admissions Office overview |
| Department Chair (earlier seed, CCS) | `scholarpath.chair@gmail.com` | `Chair@2026` | Department Review (College of Computer Studies scoped) |

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
set role = 'department_chair', department = 'School of Engineering and Architecture (SEA)'
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
set role = 'department_chair', department = 'College of Computer Studies (CCS)'
where email = 'scholarpath.chair@gmail.com';
```

The Department Chair `department` scopes the Department Review queue and the
interview panel, so it must match the applicant department the chair should see.
`miguel.chair.sea@gmail.com` is scoped to `School of Engineering and
Architecture (SEA)`; the earlier `scholarpath.chair@gmail.com` seed stays scoped
to `College of Computer Studies (CCS)`. Sign-in resolves the role
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
