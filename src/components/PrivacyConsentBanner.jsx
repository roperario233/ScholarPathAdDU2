import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from './ui';
import { acceptAllCategories, acceptNecessaryOnly, buildConsentChoice, getConsentCategories, hasCurrentNotice } from '../lib/privacyConsent';
import { getLegalDocumentSummaries } from '../lib/legalDocs';

// The first-visit notice. It never blocks the app: the storage that keeps a session
// alive is required for the site to work, so declining everything only decides the
// optional category. The one optional category is the tawk.to live chat, and it is
// offered only when this build is actually configured to use it.
export default function PrivacyConsentBanner({ choice, onDecide, onOpenDocument = null, chatWidgetConfigured = false }) {
  const [isManaging, setIsManaging] = useState(false);
  const [liveChat, setLiveChat] = useState(false);

  // A stored choice for the current notice version means there is nothing to ask.
  if (hasCurrentNotice(choice)) return null;

  const categories = getConsentCategories({ chatWidgetConfigured });
  const hasOptionalCategory = categories.some((category) => !category.locked);

  const decide = (nextChoice) => {
    setIsManaging(false);
    onDecide(nextChoice);
  };

  return (
    <aside
      className="fixed inset-x-3 bottom-3 z-[45] mx-auto w-[min(46rem,calc(100vw-1.5rem))] rounded-app border border-app-border bg-app-card p-4 shadow-app backdrop-blur sm:bottom-5 sm:p-5"
      aria-label="Privacy and storage notice"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-200" aria-hidden="true">
          <ShieldCheck size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <strong className="block text-sm font-bold text-app-text">Your privacy, in one screen</strong>
          <p className="mb-0 mt-1 text-sm text-app-muted">
            {hasOptionalCategory
              ? 'ScholarPath AdDU sets no advertising or analytics cookies. It stores what keeps you signed in, plus an optional live chat that does set third-party cookies.'
              : 'ScholarPath AdDU sets no advertising, analytics, or third-party cookies. It stores only what keeps you signed in and keeps your place in the app.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
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
        </div>
      </div>

      {isManaging && hasOptionalCategory && (
        <div className="mt-3 grid gap-2 rounded-xl border border-app-border bg-app-surface/70 p-3">
          {categories.map((category) => (
            <label key={category.key} className="flex min-w-0 items-start gap-3 text-sm text-app-text">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--primary)]"
                checked={category.locked ? true : liveChat}
                disabled={category.locked}
                onChange={(event) => setLiveChat(event.target.checked)}
              />
              <span className="min-w-0">
                <strong className="block font-semibold">{category.label}</strong>
                <span className="block text-xs text-app-muted">{category.description}</span>
                {category.locked ? <span className="mt-0.5 block text-xs font-semibold text-app-muted">Required, so it cannot be turned off.</span> : null}
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {hasOptionalCategory ? (
          <>
            <Button variant="primary" type="button" onClick={() => decide(acceptAllCategories())}>Accept all</Button>
            <Button variant="secondary" type="button" onClick={() => decide(acceptNecessaryOnly())}>Necessary only</Button>
            {isManaging ? (
              <Button variant="secondary" type="button" onClick={() => decide(buildConsentChoice({ supportChat: liveChat }))}>Save my choices</Button>
            ) : (
              <Button variant="secondary" type="button" onClick={() => setIsManaging(true)}>Manage</Button>
            )}
          </>
        ) : (
          <>
            <Button variant="primary" type="button" onClick={() => decide(acceptNecessaryOnly())}>Understood</Button>
            {isManaging ? null : (
              <Button variant="secondary" type="button" onClick={() => setIsManaging(true)}>What is stored?</Button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
