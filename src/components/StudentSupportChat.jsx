import { useEffect, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import SupportConversation from './SupportConversation';
import { Button, StatusBadge } from './ui';import { getSupportAvailabilityLabel } from '../lib/supportMessages';
import { SUPPORT_QUICK_REPLIES } from '../lib/supportAssistant';

export default function StudentSupportChat({ thread = null, messages = [], unreadCount = 0, ready = true, showHint = false, assistantEnabled = true, assistantReady = null, availability = {}, initialOpen = false, onSend, onRequestLiveAgent, onMarkRead, onOpenChange, onDismissHint }) {
  const [open, setOpen] = useState(initialOpen);
  const [handoffError, setHandoffError] = useState('');
  const [handoffBusy, setHandoffBusy] = useState(false);
  const hintVisible = showHint && !open;
  const assistantUnavailable = !assistantEnabled || assistantReady === false;
  const humanActive = Boolean(thread?.escalatedAt || thread?.assistantEnabled === false);
  const assistantActive = !assistantUnavailable && !humanActive;
  useEffect(() => {
    if (!hintVisible) return undefined;
    const dismissOnEscape = (event) => {
      if (event.key === 'Escape') onDismissHint?.();
    };
    document.addEventListener('keydown', dismissOnEscape);
    return () => document.removeEventListener('keydown', dismissOnEscape);
  }, [hintVisible, onDismissHint]);

  const toggle = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
    if (nextOpen && showHint) onDismissHint?.();
    if (nextOpen && thread?.id) onMarkRead?.(thread.id);
  };
  return (
    <>
      {hintVisible && (
        <aside
          className="fixed bottom-24 left-4 z-20 w-[min(20rem,calc(100vw-2rem))] rounded-app border border-app-border bg-app-card p-4 shadow-2xl animate-[notificationMenuIn_160ms_ease-out] sm:bottom-28 sm:left-5"
          role="region"
          aria-label="Chat help"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-ateneo dark:text-sky-200">
              <MessageCircle size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-bold text-app-text">Need help?</p>
              <p className="mb-0 mt-1 text-sm leading-relaxed text-app-muted">
                Ask the ScholarPath Assistant about scholarships and application steps, or request a live agent from the Admissions Office.
              </p>
            </div>
            <button
              type="button"
              className="-mr-2 -mt-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-app-muted hover:bg-app-surface hover:text-app-text focus:outline-none focus:ring-4 focus:ring-blue-500/20"
              onClick={onDismissHint}
              aria-label="Dismiss chat help"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <Button type="button" variant="primary" className="mt-3 min-h-9 w-full" onClick={onDismissHint}>
            Got it
          </Button>
        </aside>
      )}
      {open && (
        <section className="fixed bottom-20 left-3 z-20 flex max-h-[min(80dvh,40rem)] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-app-border bg-white shadow-2xl dark:bg-[#0a1c3a] sm:bottom-24 sm:left-5" aria-label="Admissions Office support chat">
          <header className="flex items-center gap-3 bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright px-4 py-3 text-white">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/15">
              <MessageCircle size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="m-0 truncate text-base font-bold text-white">{assistantActive ? 'ScholarPath Assistant' : 'Admissions Office'}</h2>
              {assistantReady !== false && (
                <p className="m-0 mt-0.5 flex items-center gap-1.5 text-xs text-white/85">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${availability.online ? 'bg-emerald-400' : 'bg-slate-300'}`} aria-hidden="true" />
                  <span className="truncate">{getSupportAvailabilityLabel(availability)}</span>
                </p>
              )}
            </div>
            <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white hover:bg-white/15 focus:outline-none focus:ring-4 focus:ring-white/30" onClick={toggle} aria-label="Close support chat">
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
            {!ready ? (
              <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-app-text" role="status">
                The support inbox is not available yet. Please try again later or contact the Admissions Office directly.
              </div>
            ) : (
              <SupportConversation
                messages={messages}
                viewer="student"
                onSend={onSend}
                className="min-h-0 flex-1"
                suggestions={assistantActive && messages.length === 0 ? (
                  <div className="flex flex-wrap gap-2" aria-label="Suggested support questions">
                    {SUPPORT_QUICK_REPLIES.map((suggestion) => (
                      <button key={suggestion} type="button" className="rounded-full border border-app-border bg-app-surface px-3 py-1.5 text-xs font-semibold text-app-text hover:border-blue-500/40" onClick={() => onSend?.(suggestion)}>
                        {suggestion}
                      </button>
                    ))}
                  </div>
                ) : null}
              />
            )}
            {ready && (
              <div className="grid gap-1.5 border-t border-app-border pt-3">
                <div className="flex items-center justify-between gap-3">
                  {thread?.escalatedAt ? (
                    <StatusBadge tone="warning">Live-agent request sent</StatusBadge>
                  ) : (
                    <button
                      type="button"
                      disabled={handoffBusy}
                      className="text-xs font-bold text-ateneo underline-offset-2 hover:underline disabled:opacity-60 dark:text-sky-200"
                      onClick={async () => {
                        setHandoffBusy(true);
                        setHandoffError('');
                        const result = await onRequestLiveAgent?.();
                        if (result?.error) setHandoffError(result.error.message || 'Your request could not be sent.');
                        setHandoffBusy(false);
                      }}
                    >
                      {handoffBusy ? 'Connecting…' : 'Talk to a live agent'}
                    </button>
                  )}
                  {thread?.status === 'Closed' && <span className="text-xs text-app-muted">Sending a message reopens this thread.</span>}
                </div>
                <p className="m-0 text-[11px] leading-snug text-app-muted">
                  {thread?.escalatedAt
                    ? 'The Admissions Office will reply here.'
                    : assistantActive
                      ? 'The assistant gives general guidance, not eligibility or award decisions. Your conversation is visible to Admissions Office Staff and the Admissions Office Head.'
                      : humanActive
                        ? 'This conversation is with the Admissions Office. A staff member can reply here.'
                        : 'Automated replies are not available right now. You can leave a message for Admissions Office Staff.'}
                  {!availability.online && !thread?.escalatedAt && ' Staff will reply when available.'}
                </p>
                {handoffError && <p className="m-0 text-xs text-rose-600 dark:text-rose-300" role="alert">{handoffError}</p>}
              </div>
            )}
          </div>
        </section>
      )}
      <button
        type="button"
        className="fixed bottom-4 left-4 z-20 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright text-white shadow-xl focus:outline-none focus:ring-4 focus:ring-blue-500/30 sm:bottom-5 sm:left-5"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? 'Close support chat' : 'Chat with the Admissions Office'}
        title={open ? 'Close support chat' : 'Chat with the Admissions Office'}
      >
        {open ? <X size={19} aria-hidden="true" /> : <MessageCircle size={19} aria-hidden="true" />}
        {unreadCount > 0 && <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full border-2 border-app-bg bg-rose-500 px-1 text-[10px] font-extrabold text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
    </>
  );
}