import { useState } from 'react';
import { Button, EmptyState } from './ui';
import { fmtDate } from '../lib/formatters';

const roleLabels = {
  admissions_office: 'Admissions Office Staff',
  admissions_head: 'Admissions Office Head',
  dean: 'Dean',
  assistant_dean: 'Assistant Dean',
  department_chair: 'Department Chair',
  interviewer: 'Interviewer',
};

const fmtWhen = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${fmtDate(value)} · ${date.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}`;
};

// One simple internal thread per application. Staff only and append-only.
export default function ApplicationCommentThread({ comments = [], onAddComment }) {
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) {
      setError('Write a comment first.');
      return;
    }
    if (!onAddComment) return;
    setSubmitting(true);
    setError('');
    const result = await onAddComment(trimmed);
    setSubmitting(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setBody('');
  };

  return (
    <div className="grid gap-3">
      <p className="m-0 text-xs text-app-muted">Internal — visible to reviewers only, never to the student.</p>

      {comments.length ? (
        <ul className="m-0 grid gap-2 p-0">
          {comments.map((comment) => (
            <li key={comment.id} className="grid gap-1 rounded-[14px] border border-app-border bg-app-surface p-3">
              <span className="text-xs text-app-muted">
                <strong className="text-app-text">{comment.authorName || 'Reviewer'}</strong>
                {' · '}
                {roleLabels[comment.authorRole] || 'Staff'}
                {' · '}
                {fmtWhen(comment.createdAt)}
              </span>
              <p className="m-0 whitespace-pre-line text-sm text-app-text">{comment.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No comments yet" description="Leave a note for the other reviewer." />
      )}

      {onAddComment ? (
        <form className="grid gap-2" onSubmit={submit}>
          <label className="grid gap-1 text-sm text-app-text">
            <span className="font-semibold">Add a comment</span>
            <textarea
              rows="3"
              value={body}
              maxLength={2000}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Share context, ask a question, or record the reason for a decision."
            />
          </label>
          <div className="flex justify-end">
            <Button type="submit" disabled={submitting || !body.trim()}>
              {submitting ? 'Adding…' : 'Add comment'}
            </Button>
          </div>
          {error ? <p className="m-0 text-sm text-rose-700 dark:text-rose-200" role="alert">{error}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
