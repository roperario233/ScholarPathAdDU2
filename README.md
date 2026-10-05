# ScholarPath AdDU

A React + Vite and Supabase webapp for our ScholarPath AdDU capstone.

## What’s included
- Scholarship discovery with faceted search
- Smart Eligibility Checker based on QPI, income, degree, and exclusion rules
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

## My Profile

Every role has a **My Profile** page (sidebar → My Profile, or the avatar in the
mobile header). Overview is read-only; every other section saves on its own:

| Section | Who sees it | What it covers |
| --- | --- | --- |
| Overview | Everyone | Identity card, profile completeness checklist, and (students) an eligibility snapshot listing any Exclusion Flag Hierarchy flags |
| Personal information | Everyone | Full name, Philippine mobile number, and short bio; sign-in email, role, and department are read-only |
| Academic profile | Students | Student number, degree program (sets the department), year level, applicant type, academic standing, and annual QPI |
| Household and financial aid | Students | Household income plus the exclusion answers: active government grant, another active scholarship, sibling on AdDU aid, prepaid tuition plan |
| Eligibility background | Students | Citizenship, graduating honors standing and class size, senior high school strand and average, and sponsor ties (GSIS, AFP/CAA, US veteran) |
| Account security | Everyone | Change password or email a reset link (needs Supabase; demo accounts see a notice) |

The Smart Eligibility Checker uses the saved values right away. QPI and income
are self-reported; the prototype does not verify them with the Registrar.

Department Chairs and Admissions Office administrators can edit only their name,
mobile number, and bio. Department assignment is never self-editable, because it
scopes the Department Review queue.

In demo mode (no Supabase environment variables), edits are stored in the
browser and survive signing out and back in.

### Database migration

Apply `supabase/migrations/20261005140000_add_profile_details.sql` to an
existing Supabase project. It adds `profiles.bio` (up to 280 characters) and
`profiles.eligibility_attributes` (JSON). Until it is applied, the fields that
already have `profiles` columns still save (name, mobile number, student number,
degree program, QPI, household income, and the government grant answer). The
bio and the other eligibility answers (year level, applicant type, academic
standing, the remaining household exclusion answers, and the whole Eligibility
background section) do not reach the server. Fresh projects get both columns
from `supabase/schema.sql`.

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
   and every SMS send is skipped (the demo flow keeps working). `IPROGSMS_PROVIDER`
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
