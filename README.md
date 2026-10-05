# ScholarPath AdDU

A React + Vite and Supabase webapp for our ScholarPath AdDU capstone.

## What’s included
- Scholarship discovery with faceted search
- Smart Eligibility Checker based on QPI, income, degree, and exclusion rules
- Application tracker
- Reusable document vault
- Admissions Office application operations
- Department chair review view

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

## Email notifications (Resend)

Deadline reminders and application status updates are emailed through
[Resend](https://resend.com). Three Supabase Edge Functions handle delivery:

| Function | Trigger | Purpose |
| --- | --- | --- |
| `process-deadline-reminders` | Scheduled (pg_cron + pg_net) | Emails the 7-day / 3-day / 1-day reminders for scholarships, open applications, and saved calendar deadlines |
| `notify-application-status` | Called by the app after a status change | Emails the applicant when staff (or the applicant) moves an application |
| `send-test-email` | Settings -> Email delivery test | Sends one message to the signed-in user so delivery is verifiable without waiting for a schedule |

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
     REMINDER_CRON_SECRET=<a long random value>
   ```

3. **Deploy the functions:**

   ```sh
   supabase functions deploy process-deadline-reminders --no-verify-jwt --use-api
   supabase functions deploy notify-application-status
   supabase functions deploy send-test-email
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
delivery can be confirmed without waiting for a scheduled reminder. Every
scheduled send is also recorded in `notification_email_log` with the Resend
message id and status.

### How delivery preferences are honored

The notification center settings live in localStorage, so they are mirrored to
`profiles.notification_preferences` whenever they change. The reminder function
skips the in-app row when `inAppEnabled` is false, and skips the email when
`emailEnabled` is false or the relevant reminder timing is switched off. Every
delivery is recorded in `notification_email_log`, keyed by a stable per-user
source key, so a reminder is never sent twice.
