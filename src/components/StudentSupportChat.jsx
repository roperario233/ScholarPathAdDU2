import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import SupportConversation from './SupportConversation';
import { SupportMessagesSkeleton } from './Skeleton';
import { Button, StatusBadge } from './ui';
import { getStudentSupportPhase, getSupportAvailabilityLabel } from '../lib/supportMessages';
import { SUPPORT_QUICK_REPLIES } from '../lib/supportAssistant';

// How long the chat panel and the help hint play their exits before unmounting
// (styles.css, `.support-chat-panel` / `.support-hint`).
const SUPPORT_PANEL_CLOSE_MS = 200;
const SUPPORT_HINT_EXIT_MS = 160;

const prefersReducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

export default function StudentSupportChat({ thread = null, messages = [], unreadCount = 0, ready = true, loaded = true, messagesLoaded = true, showHint = false, assistantEnabled = true, assistantReady = null, availability = {}, initialOpen = false, onSend, onRequestLiveAgent, onResolve, onStartNewTopic, onMarkRead, onOpenChange, onDismissHint }) {
  const [open, setOpen] = useState(initialOpen);
  // The panel and the hint stay mounted while they play their exit animation.
  const [closing, setClosing] = useState(false);
  const [hintExiting, setHintExiting] = useState(false);
  const closeTimerRef = useRef(null);
  const hintTimerRef = useRef(null);
  const isShown = open && !closing;
  const [actionError, setActionError] = useState('');
  const [actionBusy, setActionBusy] = useState('');
  const hintVisible = showHint && !open;
  const assistantUnavailable = !assistantEnabled || assistantReady === false;
  // assistant -> waiting -> with-office -> resolved; a resolved conversation is back with the assistant.
  const phase = getStudentSupportPhase(thread);
  const humanActive = phase === 'waiting' || phase === 'with-office';
  const assistantActive = !assistantUnavailable && !humanActive;
  const runAction = async (key, action, fallbackMessage) => {
    setActionBusy(key);
    setActionError('');
    const result = await action?.();
    if (result?.error) setActionError(result.error.message || fallbackMessage);
    setActionBusy('');
  };
  const linkButtonClass = 'text-xs font-bold text-ateneo underline-offset-2 hover:underline disabled:opacity-60 dark:text-sky-200';
  useEffect(() => () => {
    window.clearTimeout(closeTimerRef.current);
    window.clearTimeout(hintTimerRef.current);
  }, []);

  // Dismissing tells the parent at once and lets the hint fade out in place.
  const dismissHint = useCallback(() => {
    if (!prefersReducedMotion()) {
      window.clearTimeout(hintTimerRef.current);
      setHintExiting(true);
      hintTimerRef.current = window.setTimeout(() => setHintExiting(false), SUPPORT_HINT_EXIT_MS);
    }
    onDismissHint?.();
  }, [onDismissHint]);

  useEffect(() => {
    if (!hintVisible) return undefined;
    const dismissOnEscape = (event) => {
      if (event.key === 'Escape') dismissHint();
    };
    document.addEventListener('keydown', dismissOnEscape);
    return () => document.removeEventListener('keydown', dismissOnEscape);
  }, [hintVisible, dismissHint]);

  const toggle = () => {
    if (isShown) {
      onOpenChange?.(false);
      if (prefersReducedMotion()) {
        setOpen(false);
        return;
      }
      setClosing(true);
      closeTimerRef.current = window.setTimeout(() => {
        setOpen(false);
        setClosing(false);
      }, SUPPORT_PANEL_CLOSE_MS);
      return;
    }
    // Closed, or still sliding shut: (re)open.
    window.clearTimeout(closeTimerRef.current);
    setClosing(false);
    setOpen(true);
    onOpenChange?.(true);
    if (showHint) dismissHint();
    if (thread?.id) onMarkRead?.(thread.id);
  };
  return (
    <>
      {(hintVisible || hintExiting) && (
        <aside
          className="support-hint fixed bottom-24 left-4 z-20 w-[min(20rem,calc(100vw-2rem))] rounded-app border border-app-border bg-app-card p-4 shadow-2xl sm:bottom-28 sm:left-5"
          data-state={hintVisible && !hintExiting ? 'open' : 'closed'}
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
              onClick={dismissHint}
              aria-label="Dismiss chat help"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <Button type="button" variant="primary" className="mt-3 min-h-9 w-full" onClick={dismissHint}>
            Got it
          </Button>
        </aside>
      )}
      {open && (
        <section className="support-chat-panel fixed bottom-20 left-3 z-20 flex max-h-[min(80dvh,40rem)] min-h-[min(26rem,80dvh)] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-app-border bg-white shadow-2xl dark:bg-[#0a1c3a] sm:bottom-24 sm:left-5" data-state={closing ? 'closed' : 'open'} aria-label="Admissions Office support chat">
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
            {!loaded || (ready && !messagesLoaded) ? (
              <SupportMessagesSkeleton className="flex-1" />
            ) : !ready ? (
              <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-app-text" role="status">
                The support inbox is not available yet. Please try again later or contact the Admissions Office directly.
              </div>
            ) : (
              <SupportConversation
                messages={messages}
                viewer="student"
                onSend={onSend}
                className="min-h-0 flex-1"
                recentLimit={2}
                suggestions={assistantActive ? (
                  <div className={messages.length === 0 ? 'flex flex-wrap gap-2' : '-mx-1 flex gap-2 overflow-x-auto px-1 pb-1'} aria-label="Suggested support questions">
                    {SUPPORT_QUICK_REPLIES.map((suggestion, index) => (
                      <button key={suggestion} type="button" style={{ '--i': index }} className="support-chip shrink-0 whitespace-nowrap rounded-full border border-app-border bg-app-surface px-3 py-1.5 text-xs font-semibold text-app-text hover:border-blue-500/40" onClick={() => onSend?.(suggestion)}>
                        {suggestion}
                      </button>
                    ))}
                  </div>
                ) : null}
              />
            )}
            {loaded && ready && (
              <div className="grid justify-items-start gap-2 border-t border-app-border pt-3">
                <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  {phase === 'waiting' && <StatusBadge tone="warning">Waiting for the Admissions Office</StatusBadge>}
                  {phase === 'with-office' && (
                    <>
                      <StatusBadge tone="neutral">Chatting with the Admissions Office</StatusBadge>
                      <button type="button" disabled={Boolean(actionBusy)} className={linkButtonClass} onClick={() => runAction('resolve', onResolve, 'The conversation could not be marked as solved.')}>
                        {actionBusy === 'resolve' ? 'Saving…' : 'Mark as solved'}
                      </button>
                    </>
                  )}
                  {phase === 'resolved' && (
                    <>
                      <StatusBadge tone="success">Resolved</StatusBadge>
                      <Button type="button" variant="primary" className="min-h-9 px-3 text-xs" disabled={Boolean(actionBusy)} onClick={() => runAction('new', onStartNewTopic, 'A new question could not be started.')}>
                        {actionBusy === 'new' ? 'Starting…' : 'Start a new question'}
                      </Button>
                    </>
                  )}
                  {!humanActive && phase !== 'resolved' && (
                    <button type="button" disabled={Boolean(actionBusy)} className={linkButtonClass} onClick={() => runAction('handoff', onRequestLiveAgent, 'Your request could not be sent.')}>
                      {actionBusy === 'handoff' ? 'Connecting…' : 'Talk to a live agent'}
                    </button>
                  )}
                </div>
                <p className="m-0 text-xs leading-snug text-app-muted">
                  {phase === 'waiting'
                    ? 'The Admissions Office will reply here.'
                    : phase === 'with-office'
                      ? 'A staff member can reply here.'
                      : assistantActive
                        ? 'The assistant gives general guidance, not eligibility or award decisions. Admissions Office staff can read this chat.'
                        : 'Automated replies are not available right now. Leave a message for staff.'}
                  {phase === 'resolved' && assistantActive && ' Send a message to ask something else.'}
                  {!availability.online && !humanActive && ' Staff reply when available.'}
                </p>
                {actionError && <p className="m-0 text-xs text-rose-600 dark:text-rose-300" role="alert">{actionError}</p>}
              </div>
            )}
          </div>
        </section>
      )}
      <button
        type="button"
        className="fixed bottom-4 left-4 z-20 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright text-white shadow-xl transition duration-200 hover:-translate-y-0.5 hover:shadow-2xl active:scale-95 focus:outline-none focus:ring-4 focus:ring-blue-500/30 sm:bottom-5 sm:left-5"
        onClick={toggle}
        aria-expanded={isShown}
        aria-label={isShown ? 'Close support chat' : 'Chat with the Admissions Office'}
        title={isShown ? 'Close support chat' : 'Chat with the Admissions Office'}
      >
        {/* The two glyphs cross-rotate instead of swapping. */}
        <span className="relative grid h-5 w-5 place-items-center" aria-hidden="true">
          <MessageCircle size={19} className={`absolute transition duration-200 ease-out ${isShown ? '-rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100'}`} />
          <X size={19} className={`absolute transition duration-200 ease-out ${isShown ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-50 opacity-0'}`} />
        </span>
        {unreadCount > 0 && <span key={unreadCount} className="support-badge-pop absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full border-2 border-app-bg bg-rose-500 px-1 text-[10px] font-extrabold text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
    </>
  );
}