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


- `src/App.jsx` is the main state and routing-style coordinator for authentication, demo state, theme, profile hydration, notification generation, deadline reminders, and view switching. It persists the demo state in localStorage under `scholarpath-addu-demo-state`.
- `src/pages/` contains the main screens:
  - `LoginScreen.jsx`
  - `DashboardView.jsx`
  - `ScholarshipExplorer.jsx`
  - `EligibilityChecker.jsx`
  - `ApplicationsView.jsx` — student application filtering, progress, submission, detail modal, and text report export.
  - `DocumentVaultView.jsx` — student document upload, search/filter, verification display, and deletion.
  - `ApplicationsAndVault.jsx` — legacy/combined application and vault screen retained for compatibility where referenced.
  - `AdminConsole.jsx`
  - `DepartmentReviewView.jsx`
  - `CalendarView.jsx`
  - `SettingsView.jsx`
- `src/components/` contains shared UI building blocks, modal/page-part helpers, notification cards, announcements, and the `NotificationDropdown` center.
- `src/lib/` contains the domain logic, formatting helpers, authentication helpers, eligibility rules, demo state, backend-status helpers, academic-program taxonomy, and Supabase setup. The scholarship catalog is read from the Supabase `scholarships` table via `src/lib/supabaseData.js`; offline demo state (demo users, applications, documents, notifications, announcements, and department reviews) lives in `src/lib/demoState.js`; and academic programs are loaded from the Supabase `academic_programs` table via `loadSupabaseAcademicPrograms()` (in `src/lib/supabaseData.js`), with `src/lib/academicPrograms.js` (value/label/department/category) as the offline fallback.
- `supabase/schema.sql` is the reference schema for fresh Supabase projects. For an existing/deployed project, add and apply a migration under `supabase/migrations/` rather than re-running the full schema; keep the reference schema aligned with those migrations.
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
- Treat `applications`, `documents`, `notifications`, `announcements`, `customDeadlines`, `notificationPreferences`, and `theme` as persisted demo-state domains; add compatibility defaults when extending them.
- Keep file-upload behavior demo-safe: the browser stores document metadata and a local demo record rather than requiring a storage backend.


## Domain Rules
These rules come from the manuscript and should guide implementation details:


- Eligibility matching should honor QPI, income, degree program, active status, deadline state, and exclusion logic.
- Specific exclusions must override broad inclusions.
- Scholarship discovery should support faceted filtering and fast search over the current taxonomy.
- Document handling should behave like a normalized vault where the same file can be attached to multiple applications.
- Notifications should remain event-oriented in concept, even if the local demo simulates the behavior.
- Role-based access should preserve student, central Admissions Office administrator, and department-scoped Department Chair boundaries; never give the central administrator Dean-like scope under a department role.
- Application progress should remain status-driven (`Draft`, `Submitted`, `Under Review`, `For Verification`, `Approved`, and `Rejected`) and submitting a draft should create a trackable review event.
- Documents should expose verification states (`Pending`, `Verified`, and `Rejected`) and remain reusable across applications through attached document IDs.
- Custom calendar deadlines must be future-facing, persisted locally, removable, and eligible for configured 7-day, 3-day, and 1-day in-app reminders.
- In-app notification creation must respect `notificationPreferences.inAppEnabled`; generated reminders must use a stable source key so they are not duplicated on each render.
- Server-side email must honor `emailEnabled` and the `deadlineReminders` offsets read from `profiles.notification_preferences`, and must record every delivery in `notification_email_log` so a reminder reaches a student at most once.
- The app should continue to feel like a prototype aligned with the study, not a generic scholarship portal.


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
- New localStorage state must be merged with defaults so older saved sessions remain loadable; do not assume `customDeadlines` or notification preferences exist in older records.


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
- Manually smoke-test the student flows: apply from Scholarship Explorer, submit/view/export an application, upload/filter/delete a vault document, add/delete a calendar reminder, and toggle notification preferences.


If validation fails, fix the same slice before widening the scope.

## Pre-Push Checklist
Before pushing a change:

- Run `npm run build` and resolve any build errors.
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
- Email notifications are a real integration through Resend: deadline reminders (scholarship, application, and persisted custom deadlines) and application status updates are delivered by the `process-deadline-reminders` and `notify-application-status` Edge Functions, with `send-test-email` for self-service delivery checks.
- SMS remains a prototype preference only. There is no SMS gateway integration, so do not claim that text-message delivery exists.


## Practical Notes For Future Agents
The most likely high-value work in this repo is feature polishing, manuscript-aligned copy improvements, eligibility logic refinement, document workflow adjustments, and admin/student role behavior updates.


Before any first substantive edit, identify the exact file and behavior being changed, confirm how it relates to the manuscript, and make the smallest edit that preserves the app's demo-first workflow.

## Recent UI Implementation Notes

- Use the shared `page-title-bar` and `page-section-label` pattern for authenticated page headers. Keep one clear title surface per page; avoid stacking a separate welcome card and a second introductory hero unless the content hierarchy clearly requires it.
- Dashboard student entry content should keep the welcome message, primary actions, and profile/match summaries within one balanced hero section. The layout must remain responsive and avoid large unused areas.
- Use the `page-metric` pattern for comparable summary boxes, including Applications, Document Vault, Scholarship Explorer, and Smart Eligibility Checker metrics. Center the Eligible grants metric when it is displayed as a standalone count.
- Primary page actions such as `View Applications`, `Explore scholarships`, and `Save as my profile` should use the shared Ateneo blue gradient treatment; secondary actions should use the app surface treatment.
- Authenticated page actions are normalized through the `blue-action-view` wrapper in `src/App.jsx` and the matching rules in `src/styles.css`. Preserve the Dashboard action palette across authenticated pages while excluding semantic danger/amber actions, calendar cells, picker options, overlays, and login-specific controls.
- The shared `SelectPicker` exported by `src/pages/LoginScreen.jsx` is a searchable, grouped modal selector used by Scholarship Explorer, Smart Eligibility Checker, Document Vault, and the Academic Profile modal. It is rendered with a portal to `document.body` so the popup is centered above parent cards/modals and cannot be clipped by an ancestor; keep its full-viewport backdrop separate from the dialog panel.
- Scholarship Explorer reset actions must clear the search query and reset category, coverage, deadline, and Active only state together.
- Keep explanatory copy inside the relevant forms, filters, workflow cards, or settings groups rather than placing long descriptions in every page header.
- The authenticated header profile identity is mobile-only: keep the top-right avatar/name visible below the `sm` breakpoint, while the desktop layout uses the persistent profile panel in the left navigation sidebar.