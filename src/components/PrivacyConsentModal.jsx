import { useState } from 'react';
import { CircleAlert, ShieldCheck } from 'lucide-react';
import { Button, ModalShell } from './ui';
import { getLegalDocumentSummaries, PRIVACY_NOTICE_VERSION } from '../lib/legalDocs';

// The account-level consent record (RA 10173), shown once per account per notice
// version. It is the one blocking surface, because the scholarship answers that
// follow are sensitive personal information and a record of consent has to exist
// before they are collected. Google sign-up never passes through the create-account
// form, so every role sees this card instead of relying on a form checkbox.
export default function PrivacyConsentModal({
  roleLabel = 'Student',
  onAccept,
  onDecline,
  onOpenDocument = null,
  isSaving = false,
  errorMessage = '',
}) {
  const [agreed, setAgreed] = useState(false);

  return (
    <ModalShell
      title="How ScholarPath AdDU handles your information"
      className="w-[min(44rem,calc(100vw-1.5rem))]"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-200" aria-hidden="true">
          <ShieldCheck size={18} />
        </span>
        <p className="m-0 text-sm text-app-text">
          Before you continue as {roleLabel.toLowerCase()}, please read how your information is collected, who can see it, and what is stored in this browser.
        </p>
      </div>

      <ul className="mt-4 grid gap-2 pl-5 text-sm text-app-text">
        <li>The Office of Admission and Aid uses your answers and documents only to evaluate scholarship applications and keep scholarship records, under the Data Privacy Act of 2012 (RA 10173).</li>
        <li>Your QPI or senior high school average, household income, and eligibility answers are self-reported. They are never pulled from the Registrar.</li>
        <li>Household finances are visible only to the Admissions Office, and internal notes such as panel recommendations and rejection reasons are never shown to an applicant.</li>
        <li>This browser stores what keeps you signed in and the notice choice you make. No advertising or analytics cookie is used.</li>
      </ul>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
        {getLegalDocumentSummaries().map((entry) => (
          <button
            key={entry.key}
            type="button"
            className="proof-action text-sm font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-sky-300"
            onClick={() => onOpenDocument?.(entry.key)}
          >
            {entry.title}
          </button>
        ))}
      </div>

      <label className="mt-4 flex min-w-0 items-start gap-3 rounded-xl border border-app-border bg-app-surface p-3 text-sm text-app-text">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
          checked={agreed}
          onChange={(event) => setAgreed(event.target.checked)}
        />
        <span className="min-w-0">
          I have read and accept the Privacy Policy and the Terms of Use, and I understand the cookie and storage notice.
        </span>
      </label>

      {errorMessage && (
        <p className="mb-0 mt-3 flex items-start gap-2 rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200" role="alert">
          <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{errorMessage}</span>
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" type="button" onClick={onDecline} disabled={isSaving}>Sign out instead</Button>
        <Button variant="primary" type="button" onClick={onAccept} disabled={!agreed || isSaving}>
          {isSaving ? 'Saving…' : 'Agree and continue'}
        </Button>
      </div>

      <p className="mb-0 mt-3 text-xs text-app-muted">
        Your consent is recorded against version {PRIVACY_NOTICE_VERSION} of the notice. If the notice changes, you are asked again.
      </p>
    </ModalShell>
  );
}
