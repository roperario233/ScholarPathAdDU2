# ScholarPath AdDU Agents Guide


## Purpose
This repository contains ScholarPath AdDU, a React + Vite scholarship discovery, eligibility matching, Document Vault, application tracking, notification, calendar, and admin review prototype for Ateneo de Davao University.


This file is the operating guide for any future coding agent working in this workspace.


## Source Of Truth Priority
When deciding what to change, use this priority order:


1. The manuscript and its stated research objectives, scope, limitations, terminology, and evaluation design.
2. The actual codebase and its current working behavior.
3. Future enhancements or refactors that are not already supported by the manuscript or the current app.


If the manuscript and the codebase conflict, preserve the manuscript intent first and then make the smallest code change that keeps the demo stable.


## Product Context
ScholarPath AdDU is a centralized hybrid web and mobile system for student scholarship discovery and application tracking. The manuscript defines the core system goals as:


- Centralized scholarship discovery across AdDU's financial aid pipelines.
- A Smart Eligibility Checker that evaluates QPI, household income, degree program, and exclusion rules.
- A Document Vault that supports one-time upload and multi-application reuse.
- A notification subsystem for deadline and status alerts.
- Role-based access control for students, Admissions Office administrators, and Department Chairs.
- A student application workspace for filtering, submitting, inspecting, and exporting application reports.
- A reusable Document Vault with upload validation, verification states, and application links.
- A deadline calendar supporting scholarship deadlines and student-created reminders.
- Configurable notification channels and reminder timing, with an in-app notification center.
- A polished task-based usability prototype evaluated with ISO/IEC 25010 and SUS.


The manuscript also establishes important scope boundaries that must stay intact:


- The system is discovery, matching, upload, and tracking focused.
- It does not implement actual financial disbursement.
- It does not integrate with the registrar for verified QPI.
- It does not give external scholarship organizations direct administrative access.
- It remains a prototype and must continue to work in demo mode when Supabase is not configured.


## Canonical Manuscript Terms
Use the manuscript language consistently in new code, UI text, documentation, and comments where relevant:


- Smart Eligibility Checker.
- Exclusion Flag Hierarchy.
- Document Vault.
- Dynamic Faceted Search.
- Admissions Office administrators.
- Department Chairs and Coordinators.
- Grant-in-Aid or GIA.
- Financial aid pipelines.
- Application tracking.
- Application workspace.
- Notification center.
- Deadline calendar.

The Admissions Office administrator is the central office operations role, not a Dean or a reviewer for every academic department. Department Chair access and review remain scoped to the Chair's assigned department. OSA is not a participating scholarship-process role in the web app.


Avoid introducing alternate names for the same feature unless the current codebase already uses a different stable label that users see.


## Current Codebase Map
The present implementation is organized as follows:


- `src/App.jsx` is the main state and routing-style coordinator for authentication, demo state, theme, profile hydration and saving (`saveProfile`), notification generation, deadline reminders, and view switching. It persists the demo state in localStorage under `scholarpath-addu-demo-state`.
- `src/pages/` contains the main screens:
  - `LoginScreen.jsx`
  - `DashboardView.jsx`
  - `ScholarshipExplorer.jsx` — scholarship discovery with the inline Smart Eligibility Checker on each scholarship card.
  - `ApplicationsView.jsx` — student application filtering, progress, submission, detail modal, and text report export.
  - `DocumentVaultView.jsx` — student document upload, search/filter, verification display, and deletion.
  - `ApplicationsAndVault.jsx` — legacy/combined application and vault screen retained for compatibility where referenced.
  - `AdminConsole.jsx`
  - `DepartmentReviewView.jsx`
  - `CalendarView.jsx`
  - `SettingsView.jsx`
  - `ProfileView.jsx` — My Profile for every role: section menu, completeness metric, and the Overview, Personal information, Academic profile, Household and financial aid, Eligibility background, and Account security sections. Academic profile, Household and financial aid, and Eligibility background are student-only.
- `src/components/` contains shared UI building blocks (`ui.jsx`: `Button`, `Card`, `FormField`, `SettingToggle`, `ModalShell`, and related primitives), modal/page-part helpers, notification cards, announcements, the `NotificationDropdown` center, the first-login `AcademicProfileModal`, and the My Profile section forms in `ProfileSections.jsx` (built on its `useSectionForm` draft/validate/save hook).
- `src/lib/` contains the domain logic, formatting helpers, authentication and profile helpers (`auth.js`), eligibility rules, demo state, backend-status helpers, academic-program taxonomy, profile field definitions and validators (`profile.js`), and Supabase setup. The scholarship catalog is read from the Supabase `scholarships` table via `src/lib/supabaseData.js`; offline demo state (demo users, applications, documents, notifications, announcements, and department reviews) lives in `src/lib/demoState.js`; and academic programs are loaded from the Supabase `academic_programs` table via `loadSupabaseAcademicPrograms()` (in `src/lib/supabaseData.js`), with `src/lib/academicPrograms.js` (value/label/department/category) as the offline fallback.
- `supabase/schema.sql` is the reference schema for fresh Supabase projects. For an existing/deployed project, add and apply a migration under `supabase/migrations/` rather than re-running the full schema; keep the reference schema aligned with those migrations.
- `supabase/functions/` holds the email and SMS delivery Edge Functions described under Email And SMS Notification Delivery.
- `src/tailwind.css` is the primary Tailwind entry point and contains the shared theme primitives.
- `src/styles.css` contains component-specific CSS, browser behavior, pseudo-elements, keyframes, and rules that are not practical as utilities.

## Styling Conventions
The interface uses Tailwind CSS alongside the existing component stylesheet:

- Import `src/tailwind.css` before `src/styles.css` in `src/main.jsx`.
- Use Tailwind utility classes for layout, spacing, typography, colors, responsive behavior, and component states.
- Prefer the shared tokens in `tailwind.config.js`, including `bg-app-card`, `bg-app-surface`, `border-app-border`, `text-app-text`, `text-app-muted`, `shadow-app`, and `rounded-app`.
- Before adding a selector to `src/styles.css`, check whether a Tailwind utility, theme token, or reusable React component can solve the need instead.
- Keep `postcss.config.js` and `tailwind.config.js` aligned with the local Vite build; do not add a global styling dependency for a one-off rule.


## Editing Principles
Follow these rules when making changes:


- Prefer the smallest change that solves the task.
- Reuse existing shared components, helpers, and data shapes instead of duplicating logic.
- Keep demo mode intact unless the task explicitly requires backend integration work.
- Preserve backward compatibility with stored demo state in localStorage.
- Keep Supabase optional and safe when environment variables are missing.
- Do not introduce new dependencies unless they clearly solve the task better than the current stack.
- Do not remove or rewrite manuscript-aligned terminology just to make the code more generic.
- Avoid unnecessary refactors that change behavior, layout, or data shape.
- Treat `applications`, `documents`, `notifications`, `announcements`, `customDeadlines`, `notificationPreferences`, `profileDraft`, `profileEdits`, and `theme` as persisted demo-state domains; add compatibility defaults when extending them.
- Keep file-upload behavior demo-safe: the browser stores document metadata and a local demo record rather than requiring a storage backend.


## Domain Rules
These rules come from the manuscript and should guide implementation details:


- Eligibility matching should honor QPI, income, degree program, active status, deadline state, and exclusion logic.
- Specific exclusions must override broad inclusions.
- Jubilee Scholarship eligibility is not restricted to incoming first-year students; retain its official Valedictorian/Salutatorian standing and graduating-class size criteria.
- Student Assistant (SA) / Working Scholar eligibility is open to students across all academic programs and must not be blocked by degree-specific catalog metadata.
- Scholarship discovery should support faceted filtering and fast search over the current taxonomy.
- Document handling should behave like a normalized vault where the same file can be attached to multiple applications.
- Notifications should remain event-oriented in concept, even if the local demo simulates the behavior.
- Role-based access should preserve student, central Admissions Office administrator, and department-scoped Department Chair boundaries; never give the central administrator Dean-like scope under a department role.
- My Profile editing must keep the same boundaries: students edit their academic, household, and eligibility background fields, while Admissions Office administrators and Department Chairs edit only their name, mobile number, and bio. Department assignment is never self-editable because it scopes the Department Review queue; `saveProfile` in `App.jsx` enforces this with `STAFF_EDITABLE_FIELD_KEYS`, not only the UI.
- Profile QPI and household income are self-reported. Do not describe them as Registrar-verified.
- Year standing is the single student control (Incoming 1st year, then 1st–5th year); `applicantType` and `yearLevel` are derived from it for the eligibility engine and stored alongside it. `getStandingRequirements()` in `src/lib/profile.js` is the single source for which fields apply, and the onboarding modal, the My Profile sections, the validators, and the routing gates all read it. An incoming first-year reports senior high school strand and general average (in the Academic profile section) instead of an AdDU student number and QPI, so the profile-completeness and onboarding gates skip both for that case.
- Application progress should remain status-driven (`Draft`, `Submitted`, `Under Review`, `For Verification`, `Approved`, and `Rejected`) and submitting a draft should create a trackable review event.
- Documents should expose verification states (`Pending`, `Verified`, and `Rejected`) and remain reusable across applications through attached document IDs.
- Custom calendar deadlines must be future-facing, persisted locally, removable, and eligible for the configured 7-day, 3-day, and 1-day reminders. They are also mirrored to the Supabase `custom_deadlines` table with the client id stored verbatim (for example `custom-<uuid>`), so the scheduled function can email the same reminder the client generates locally.
- In-app notification creation must respect `notificationPreferences.inAppEnabled`; generated reminders must use a stable source key so they are not duplicated on each render.
- Server-side delivery must honor `profiles.notification_preferences` per channel and per reminder, and must record only real deliveries in `notification_email_log` so a reminder reaches a student at most once while a skipped or failed send stays unlogged and retryable. See Email And SMS Notification Delivery.
- The app should continue to feel like a prototype aligned with the study, not a generic scholarship portal.


## Email And SMS Notification Delivery
Notifications stay event-oriented, and delivery runs through Supabase Edge Functions rather than the browser:

- `process-deadline-reminders` is invoked daily at 07:00 Asia/Manila by pg_cron + pg_net (`supabase/migrations/20261005000001_schedule_deadline_reminders.sql`, with the reference block at the bottom of `supabase/schema.sql`). It evaluates the reminder rule on the Manila calendar, writes the in-app row, emails through Resend, texts through iprogSMS, and records the delivery in `notification_email_log`. It runs with `verify_jwt` disabled and authenticates the scheduled caller against `REMINDER_CRON_SECRET` by exact value; a signed-in user's JWT is also accepted for on-demand runs. Never point this endpoint at the anon key.
- `notify-application-status` is called by the app after a status change and runs with `verify_jwt` enabled. It re-reads the application, recipient, and caller role server-side so the request body cannot spoof the recipient, and it allows only the Admissions Office administrator, the Department Chair for that student's department, or the student who owns the application. It sends email and SMS independently, so either channel alone still records the transition.
- `send-test-email` backs Settings -> Email delivery test and only ever sends to the signed-in caller; `send-test-sms` is its SMS counterpart and text messages only the caller's own `profiles.phone` number (echoed back masked).
- Shared, dependency-free modules live in `supabase/functions/_shared/`: `email.js` (Resend-compatible table HTML, plain-text alternatives, and the delivery-preference checks), `reminders.js` (the reminder math shared with `src/App.jsx`), `resend.js` (the minimal email fetch client), and `sms.js` (iprogSMS client, Philippine mobile normalization, and SMS text renderers). They are plain JavaScript so Deno, the vitest suite, and the client bundle can all import them (for example, `validateMobileNumber` in `src/lib/profile.js` reuses `formatPhilippineMobile` for the onboarding modal and My Profile, and Settings reuses `maskPhilippineMobile`).
- Delivery is opt-in per channel and per reminder. `profiles.notification_preferences` is the only server-side input: the in-app row needs `inAppEnabled` plus the matching `deadlineReminders` offset, the email needs `emailEnabled` plus the same offset, and the SMS needs `smsEnabled` plus the same offset and a normalizable `profiles.phone` value. Status notifications honor the student's `emailEnabled` / `smsEnabled` and dedupe on `application-status-<applicationId>-<status>` across both channels.
- `notifications.channel` is constrained to `SMS` / `Email` / `In-app`, so carry the deadline kind in the notification title and body instead of adding a channel value.
- Email requires the verified Resend sending domain and the Edge Function secrets (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`, `APP_SITE_URL`, `REMINDER_CRON_SECRET`); SMS requires `IPROGSMS_API_TOKEN` (with optional `IPROGSMS_PROVIDER`, the gateway's `sms_provider` 0/1/2 flag). They are server-side only and must never carry a `VITE_` prefix. A send only happens when the Supabase workspace is loaded, and the demo flow must keep working with either gateway unset (skipped, never thrown).
- The email CTA links use `?view=calendar`, `?view=applications`, and `?view=settings`, but the app does not read a `view` query parameter yet, so a recipient lands on the role's landing view. Do not describe those links as deep links until `App.jsx` handles the parameter.
- iprogSMS constraints: a 200 response confirms queue-accept (`message_id`) only — there are no delivery webhooks, so ledger rows describe queue-accept rather than confirmed carrier delivery (poll-only status via `GET /sms_messages/status`). Globe, TM, DITO, and GOMO recipients use the shared `iprogSMS` sender; Smart and TNT require a purchased custom sender name.


## UI And UX Expectations
Match the existing design direction unless a task explicitly calls for redesign:


- Keep the interface polished, readable, and consistent with the existing Ateneo blue visual identity.
- Treat every visual change as web and mobile aware; styling should work cleanly on both desktop and handset layouts.
- Preserve responsiveness for desktop and mobile layouts, with mobile-safe spacing, typography, and interaction targets by default.
- Avoid introducing a visually generic dashboard style.
- Keep forms and task flows simple enough for the manuscript's usability-testing narrative.
- When adding visible text, prefer the manuscript's formal research tone and user-facing terminology.
- Keep notification menus keyboard- and mobile-friendly: support outside-click/Escape dismissal, readable unread counts, and adequate touch targets.
- Keep the mobile page-navigation drawer minimal: it should use a solid theme-aware background and show only the page links, without extra branding or a duplicate drawer heading.
- The light/dark theme toggle is available on both the authenticated shell and login screen and must remain persisted across reloads.
- The login action control combines Google sign in and Create account into one responsive control: it is split 50/50 at rest, uses a CSS-drawn diagonal slash divider, and expands the hovered desktop action to the full control while hiding the inactive action. On mobile widths, keep both actions visible and 50/50 because touch devices do not use cursor hover.


## Data And State Conventions
Use the existing local shapes and patterns already established in the app:


- Demo state should remain compatible with `src/lib/demoState.js`; the scholarship catalog is read from the Supabase `scholarships` table (including the manuscript-only columns `rule_family`, `gov_program`, `is_matchable`, `application_route`, `is_external`, and `appendix_number`) and falls back to an empty catalog when the Supabase workspace is not loaded.
- Academic programs should remain consistent with `src/lib/academicPrograms.js` and load from the Supabase `academic_programs` table via `loadSupabaseAcademicPrograms()` when the Supabase workspace is configured, falling back to the static file otherwise.
- Eligibility logic should remain consistent with `src/lib/eligibility.js`.
- Supabase configuration should continue to route through `src/lib/supabaseClient.js`.
- New persisted state should be additive and guarded so old localStorage entries do not break the app.
- Avoid breaking assumptions in `App.jsx` around `viewerRole`, `activeView`, `profileDraft`, `documents`, `applications`, `notifications`, and `announcements`.
- Preserve the nested shape of `notificationPreferences`, including `smsEnabled`, `emailEnabled`, `inAppEnabled`, and `deadlineReminders.oneWeekBefore`, `threeDaysBefore`, and `dayBefore`.
- That preference shape is mirrored to `profiles.notification_preferences` whenever the Settings toggles change, and it is the scheduled function's only input. The other server-side mirrors are `custom_deadlines` (one row per student-created deadline, id stored verbatim) and `notification_email_log` (the service-role delivery ledger). Keep the local and server shapes identical so the two never disagree.
- Profile data has three local homes. `authUser` holds the account fields (`fullName`, `phone`, `bio`, `studentNumber`, `degreeProgram`, `department`, `qpi`, `householdIncome`, `hasActiveGovernmentGrant`), mirrored to the core `profiles` columns. `profileDraft` holds what the Smart Eligibility Checker reads, including the extended attributes listed in `ELIGIBILITY_ATTRIBUTE_KEYS` (`src/lib/profile.js`), mirrored to `profiles.eligibility_attributes`. `profileEdits` is demo-only: per-account edits restored on a demo (fallback) login. Save through `saveProfile` / `updateProfileFields`, which write only the keys present on the patch, and keep the key lists in `src/lib/profile.js` as the single source.
- `profiles.bio` and `profiles.eligibility_attributes` come from `supabase/migrations/20261005140000_add_profile_details.sql`. `getProfileDetails()` reads them in a separate query and `updateProfileFields()` writes them in a separate statement, reporting `detailsSynced: false` when the columns are missing, so a project with the migration pending still signs in and saves core fields. Do not add these columns to the `getUserProfile()` select: a missing column would fail the whole query and reopen the onboarding modal.
- Saving a QPI through `updateUserProfile` or `updateProfileFields` also upserts the current academic year in `annual_qpi_records`.
- New localStorage state must be merged with defaults so older saved sessions remain loadable; do not assume `customDeadlines`, `profileEdits`, or notification preferences exist in older records.


## Safe Implementation Workflow
When working on this repo, use this order:


1. Read the relevant manuscript section first to understand the intended behavior.
2. Inspect the specific code path in the current app.
3. Make the smallest targeted change that aligns code with the manuscript and keeps the demo working.
4. Validate the touched area with the cheapest meaningful check, usually `npm run build`.
5. If the change affects a narrow feature slice, prefer a narrow smoke test or local run before broader validation.


## Validation Expectations
Prefer these checks when appropriate:


- `npm run build` for general validation.
- `npm run dev` for manual review of the local prototype.
- Targeted checks for any touched Supabase, auth, or eligibility logic.
- `npm test` (vitest) covers the shared email and SMS templates, the SMS client, reminder math, eligibility rules, demo state, auth redirect, notification merge, and the profile validators; run it whenever `supabase/functions/_shared/`, `src/lib/notificationMerge.js`, or `src/lib/profile.js` is touched.
- Manually smoke-test the student flows: apply from Scholarship Explorer, submit/view/export an application, upload/filter/delete a vault document, add/delete a calendar reminder, toggle notification preferences, and edit and save each My Profile section.


If validation fails, fix the same slice before widening the scope.

## Pre-Push Checklist
Before pushing a change:

- Run `npm run build` and resolve any build errors.
- Run `npm test` when the change touches reminder, notification, email or SMS rendering, or profile validation logic.
- Confirm `package-lock.json` is updated whenever `package.json` dependencies change.
- Check that demo mode still loads when Supabase environment variables are absent.
- Review `git diff` for accidental changes, generated secrets, or unrelated files.
- Smoke-test the affected student or reviewer flow in the Vite app when the change is visual or interactive.


## Documentation Expectations
When updating docs or explanatory text:


- Keep the manuscript terminology aligned with the final behavior.
- Preserve the current project framing as a capstone prototype.
- Reflect the actual implemented behavior, not an aspirational feature list.
- If a manuscript statement is no longer true in code, flag it clearly in the change rather than silently changing the meaning.


## Things To Avoid
Do not:


- Add features that imply direct scholarship award allocation or monetary disbursement.
- Turn optional Supabase support into a hard requirement.
- Break demo mode or local state restoration.
- Replace the current domain model with a generic template app model.
- Rename core manuscript concepts without a good reason.
- Make broad styling changes that are unrelated to the task.
- Do not add a browser-side mailer or SMS sender, a second email provider, or a client-visible email/IPROG token instead of the Resend and iprogSMS Edge Functions.
- Write a delivery row for a reminder that was skipped or failed; leave it out of `notification_email_log` so the next run retries it.
- Describe SMS ledger rows as confirmed carrier delivery; iprogSMS only confirms queue-accept, and delivery is poll-only. Do not reintroduce a Smart/TNT claim — those networks need a purchased custom sender name.


## Practical Notes For Future Agents
The most likely high-value work in this repo is feature polishing, manuscript-aligned copy improvements, eligibility logic refinement, document workflow adjustments, and admin/student role behavior updates.


Before any first substantive edit, identify the exact file and behavior being changed, confirm how it relates to the manuscript, and make the smallest edit that preserves the app's demo-first workflow.

## Recent UI Implementation Notes

- Use the shared `page-title-bar` and `page-section-label` pattern for authenticated page headers. Keep one clear title surface per page; avoid stacking a separate welcome card and a second introductory hero unless the content hierarchy clearly requires it.
- Dashboard student entry content should keep the welcome message, primary actions, and profile/match summaries within one balanced hero section. The layout must remain responsive and avoid large unused areas.
- Use the `page-metric` pattern for comparable summary boxes, including Applications, Document Vault, Scholarship Explorer, Smart Eligibility Checker, and the My Profile completeness metrics. Center the Eligible grants metric when it is displayed as a standalone count.
- Primary page actions such as `View Applications`, `Explore scholarships`, and `Save as my profile` should use the shared Ateneo blue gradient treatment; secondary actions should use the app surface treatment.
- Authenticated page actions are normalized through the `blue-action-view` wrapper in `src/App.jsx` and the matching rules in `src/styles.css`. Preserve the Dashboard action palette across authenticated pages while excluding semantic danger/amber actions, calendar cells, picker options, overlays, and login-specific controls.
- The shared `SelectPicker` exported by `src/pages/LoginScreen.jsx` is a searchable, grouped modal selector used by Scholarship Explorer, Smart Eligibility Checker, Document Vault, the Academic Profile modal, and the My Profile Academic profile section. It is rendered with a portal to `document.body` so the popup is centered above parent cards/modals and cannot be clipped by an ancestor; keep its full-viewport backdrop separate from the dialog panel.
- Scholarship Explorer reset actions must clear the search query and reset category, coverage, deadline, and Active only state together.
- Keep explanatory copy inside the relevant forms, filters, workflow cards, or settings groups rather than placing long descriptions in every page header.
- The authenticated header profile identity is mobile-only: keep the top-right avatar/name visible below the `sm` breakpoint, while the desktop layout uses the persistent profile panel in the left navigation sidebar. The mobile avatar is a button that opens My Profile.
- My Profile keeps its section menu in a side column only from the `xl` breakpoint; below that the menu sits above the form as a two- or three-column grid, so form fields keep usable widths between 1024px and 1279px. Each section saves independently through `useSectionForm` and asks before discarding unsaved changes when the user switches sections.
- Side-by-side fields must line up. `FormField` and the profile `ReadOnlyField` use `content-start` so a neighbour's longer hint or error cannot stretch them, and profile text inputs and native selects share the fixed `h-12 py-0` height (`controlClass` in `ProfileSections.jsx`) because the global padding otherwise renders inputs and selects a few pixels apart. Keep input and select rows in profile cards to at most two columns; toggle groups may use three.