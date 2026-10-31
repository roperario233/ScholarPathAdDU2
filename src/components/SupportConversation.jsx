import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send } from 'lucide-react';
import { SUPPORT_MESSAGE_MAX_LENGTH, normalizeSupportMessageBody } from '../lib/supportMessages';

const formatMessageTime = (value) => {
  if (!value || Number.isNaN(Date.parse(value))) return 'Time unavailable';
  return new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
};

export default function SupportConversation({
  messages = [],
  viewer = 'student',
  studentName = '',
  onSend,
  disabled = false,
  className = '',
  suggestions = null,
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);
  const normalized = normalizeSupportMessageBody(draft);
  const composerId = `support-message-composer-${viewer === 'student' ? 'student' : 'office'}`;
  const nearLimit = draft.length >= SUPPORT_MESSAGE_MAX_LENGTH * 0.9;
  const canSend = Boolean(normalized) && !disabled && !sending;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length]);

  const submit = async (event) => {
    event?.preventDefault();
    if (!canSend) return;
    setSending(true);
    setError('');
    try {
      const result = await onSend?.(normalized);
      if (result?.error) throw new Error(result.error.message || 'Your message could not be sent.');
      setDraft('');
    } catch (sendError) {
      setError(sendError?.message || 'Your message could not be sent.');
    } finally {
      setSending(false);
    }
  };

  // Enter sends, Shift+Enter adds a line, like every chat surface.
  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className={`grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3 ${className}`}>
      <div className="grid min-h-40 content-start gap-3 overflow-y-auto rounded-2xl bg-app-muted-surface p-3 sm:p-4" aria-live="polite" aria-label="Support conversation">
        {messages.length ? messages.map((message) => {
          const own = viewer === 'student'
            ? message.senderRole === 'student'
            : ['admissions_office', 'admissions_admin'].includes(message.senderRole);
          const label = message.senderRole === 'student' ? (studentName || 'You')
            : message.senderRole === 'assistant' ? 'ScholarPath Assistant'
            : message.senderRole === 'admissions_admin' ? 'Admissions Office Admin'
              : 'Admissions Office Staff';
          const assistant = message.senderRole === 'assistant';
          return (
            <article key={message.id} className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 ${own ? 'ml-auto rounded-br-md bg-ateneo text-white' : assistant ? 'mr-auto rounded-bl-md border border-violet-500/25 bg-violet-500/10' : 'mr-auto rounded-bl-md border border-app-border bg-app-card'}`}>
              <div className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px] ${own ? 'text-white/80' : 'text-app-muted'}`}>
                <strong className={own ? 'text-white' : 'text-app-text'}>{label}</strong>
                <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
              </div>
              <p className={`mb-0 mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed ${own ? 'text-white' : 'text-app-text'}`}>{message.body}</p>
            </article>
          );
        }) : (
          <div className="grid place-items-center gap-2 py-6 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-blue-500/10 text-ateneo dark:text-sky-200">
              <MessageCircle size={20} aria-hidden="true" />
            </span>
            <strong className="text-sm text-app-text">{viewer === 'student' ? 'Start a conversation' : 'No messages yet'}</strong>
            <p className="m-0 max-w-[16rem] text-xs leading-relaxed text-app-muted">
              {viewer === 'student' ? 'Ask a question below. Replies will appear here.' : 'The student has not sent a message yet.'}
            </p>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {suggestions}

      <form className="grid gap-1.5" onSubmit={submit}>
        <label className="sr-only" htmlFor={composerId}>
          {viewer === 'student' ? 'Message the Admissions Office' : 'Reply to student'}
        </label>
        <div className="relative">
          <textarea
            id={composerId}
            rows={2}
            className="block max-h-40 min-h-[3.5rem] w-full resize-none rounded-2xl border border-app-border bg-app-surface py-3 pl-4 pr-14 text-sm text-app-text placeholder:text-app-muted focus:border-blue-500/50 focus:outline-none focus:ring-4 focus:ring-blue-500/20"
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, SUPPORT_MESSAGE_MAX_LENGTH))}
            onKeyDown={handleKeyDown}
            maxLength={SUPPORT_MESSAGE_MAX_LENGTH}
            placeholder={viewer === 'student' ? 'Type your message…' : 'Write a reply…'}
            disabled={disabled || sending}
          />
          <button
            type="submit"
            className="absolute bottom-2.5 right-2.5 grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright text-white shadow-md transition disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-4 focus:ring-blue-500/30"
            disabled={!canSend}
            aria-label={sending ? 'Sending message' : 'Send message'}
            title="Send (Enter)"
          >
            <Send size={16} aria-hidden="true" />
          </button>
        </div>
        {(error || nearLimit) && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-app-muted">
            {error ? <span className="text-rose-600 dark:text-rose-300" role="alert">{error}</span> : <span />}
            {nearLimit && <span>{normalized.length}/{SUPPORT_MESSAGE_MAX_LENGTH}</span>}
          </div>
        )}
      </form>
    </div>
  );
}
