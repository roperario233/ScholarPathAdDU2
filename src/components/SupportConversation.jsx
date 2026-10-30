import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { Button, EmptyState } from './ui';
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
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);
  const normalized = normalizeSupportMessageBody(draft);
  const composerId = `support-message-composer-${viewer === 'student' ? 'student' : 'office'}`;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length]);

  const submit = async (event) => {
    event.preventDefault();
    if (!normalized || disabled || sending) return;
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

  return (
    <div className={`grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3 ${className}`}>
      <div className="grid min-h-40 content-start gap-3 overflow-y-auto rounded-2xl border border-app-border bg-app-surface p-3 sm:min-h-64 sm:p-4" aria-live="polite" aria-label="Support conversation">
        {messages.length ? messages.map((message) => {
          const own = viewer === 'student'
            ? message.senderRole === 'student'
            : ['admissions_office', 'admissions_head'].includes(message.senderRole);
          const label = message.senderRole === 'student' ? (studentName || 'You')
            : message.senderRole === 'assistant' ? 'ScholarPath Assistant'
            : message.senderRole === 'admissions_head' ? 'Admissions Office Head'
              : 'Admissions Office Staff';
          const assistant = message.senderRole === 'assistant';
          return (
            <article key={message.id} className={`max-w-[90%] rounded-2xl border p-3 ${own ? 'ml-auto border-blue-500/25 bg-blue-500/10' : assistant ? 'mr-auto border-violet-500/25 bg-violet-500/5' : 'mr-auto border-app-border bg-app-card'}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-app-muted">
                <strong className="text-app-text">{label}</strong>
                <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
              </div>
              <p className="mb-0 mt-2 whitespace-pre-wrap break-words text-sm text-app-text">{message.body}</p>
            </article>
          );
        }) : (
          <EmptyState
            title={viewer === 'student' ? 'Start a conversation' : 'No messages yet'}
            description={viewer === 'student' ? 'Send a message to the Admissions Office. Replies will appear here.' : 'The student has not sent a message yet.'}
          />
        )}
        <div ref={endRef} />
      </div>

      <form className="grid gap-2" onSubmit={submit}>
        <label className="grid gap-1 text-sm font-semibold text-app-text" htmlFor={composerId}>
          {viewer === 'student' ? 'Message the Admissions Office' : 'Reply to student'}
        </label>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <textarea
            id={composerId}
            className="min-h-24 w-full resize-y rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-4 focus:ring-blue-500/20"
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, SUPPORT_MESSAGE_MAX_LENGTH))}
            maxLength={SUPPORT_MESSAGE_MAX_LENGTH}
            placeholder="Write your message…"
            disabled={disabled || sending}
          />
          <Button type="submit" variant="primary" disabled={!normalized || disabled || sending} className="self-end">
            <Send size={16} aria-hidden="true" />
            <span className="ml-2">{sending ? 'Sending…' : 'Send'}</span>
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-app-muted">
          <span>{normalized.length}/{SUPPORT_MESSAGE_MAX_LENGTH}</span>
          {error && <span className="text-rose-600 dark:text-rose-300" role="alert">{error}</span>}
        </div>
      </form>
    </div>
  );
}