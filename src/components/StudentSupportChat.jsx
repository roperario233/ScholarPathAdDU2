import { useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import SupportConversation from './SupportConversation';
import { Button, StatusBadge } from './ui';

export default function StudentSupportChat({ thread = null, messages = [], unreadCount = 0, ready = true, onSend, onMarkRead, onOpenChange }) {
  const [open, setOpen] = useState(false);
  const toggle = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
    if (nextOpen && thread?.id) onMarkRead?.(thread.id);
  };
  return (
    <>
      {open && (
        <section className="fixed bottom-20 right-3 z-20 flex max-h-[min(75dvh,42rem)] w-[min(28rem,calc(100vw-1.5rem))] flex-col gap-3 rounded-app border border-app-border bg-app-card p-4 shadow-2xl sm:bottom-24 sm:right-5 sm:p-5" aria-label="Admissions Office support chat">
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="m-0 text-lg font-bold text-app-text">Admissions Office</h2>
              <p className="m-0 mt-1 text-xs text-app-muted">Send a message or read the office’s reply here.</p>
            </div>
            <Button type="button" variant="ghost" className="!min-h-9 !min-w-9 !p-2" onClick={toggle} aria-label="Close support chat">
              <X size={18} aria-hidden="true" />
            </Button>
          </header>
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
            />
          )}
          {thread?.status === 'Closed' && <StatusBadge tone="neutral">Office closed this thread; sending a message reopens it.</StatusBadge>}
        </section>
      )}
      <button
        type="button"
        className="fixed bottom-4 right-4 z-20 inline-flex min-h-12 items-center gap-2 rounded-full bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright px-4 text-sm font-bold text-white shadow-xl focus:outline-none focus:ring-4 focus:ring-blue-500/30 sm:bottom-5 sm:right-5"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? 'Close Admissions Office support chat' : 'Chat with the Admissions Office'}
      >
        {open ? <X size={19} aria-hidden="true" /> : <MessageCircle size={19} aria-hidden="true" />}
        <span>{open ? 'Close chat' : 'Admissions Office'}</span>
        {unreadCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white px-1 text-xs font-bold text-blue-800">{unreadCount}</span>}
      </button>
    </>
  );
}