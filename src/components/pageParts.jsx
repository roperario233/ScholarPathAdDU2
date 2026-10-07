import { useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { getApplicationProgress } from '../lib/eligibility';
import { fmtCurrency, fmtDate, toPercent } from '../lib/formatters';
import { Button, EmptyState, StatusBadge } from './ui';

export { Button, Card, EmptyState, StatusBadge } from './ui';

export function StatCard({ label, value, note }) {
  return (
    <article className="group relative flex flex-col gap-1 overflow-hidden rounded-app border border-app-border bg-app-card p-5 shadow-card backdrop-blur transition hover:-translate-y-1 hover:shadow-app">
      <span className="absolute right-0 top-0 h-20 w-20 translate-x-5 -translate-y-5 rounded-full bg-blue-500/10 transition group-hover:scale-125" />
      <span className="text-sm font-semibold text-app-muted">{label}</span>
      <strong className="text-3xl font-bold text-app-text">{value}</strong>
      <p className="mb-0 text-sm text-app-muted">{note}</p>
    </article>
  );
}

export function ScholarshipRow({ scholarship, onApply, compact = false }) {
  return (
    <article className={`rounded-app border border-app-border bg-app-card p-5 shadow-app backdrop-blur ${compact ? 'py-4' : ''}`}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-base font-semibold text-app-text">{scholarship.title}</h3>
          <p className="mt-1 text-sm text-app-muted">{scholarship.category} · {fmtDate(scholarship.deadline)}</p>
        </div>
        <StatusBadge className="max-w-full shrink-0">{scholarship.fitScore ?? 'Match'}</StatusBadge>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-app-muted mt-4">
        <span><strong>QPI</strong> {scholarship.minimumQpi}+</span>
        <span><strong>Income</strong> ≤ {fmtCurrency(scholarship.maximumIncome)}</span>
      </div>
      <p className="mt-3 text-sm text-app-muted">{scholarship.coverage}</p>
      <Button className="mt-2" type="button" onClick={() => onApply(scholarship)}>Track in dashboard</Button>
    </article>
  );
}

export function NotificationItem({ entry, onMarkRead }) {
  return (
    <article
      className="cursor-pointer rounded-app border border-app-border bg-app-card p-5 shadow-app backdrop-blur transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20"
      tabIndex="0"
      role="button"
      aria-label={`${entry.status === 'Unread' ? 'Mark as read: ' : ''}${entry.title}`}
      onClick={() => onMarkRead(entry.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onMarkRead(entry.id);
        }
      }}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-base font-semibold text-app-text">{entry.title}</h3>
          <p className="mt-1 text-sm text-app-muted">{entry.channel} · {fmtDate(entry.createdAt)}</p>
        </div>
        <StatusBadge className="max-w-full shrink-0">{entry.status}</StatusBadge>
      </div>
      <p className="mt-3 text-sm text-app-muted">{entry.body}</p>
    </article>
  );
}

export function AnnouncementItem({ entry }) {
  return (
    <article className="rounded-app border border-app-border bg-app-card p-5 shadow-app backdrop-blur">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-base font-semibold text-app-text">{entry.title}</h3>
          <p className="mt-1 text-sm text-app-muted">{entry.audience} · {fmtDate(entry.createdAt)}</p>
        </div>
        <StatusBadge className="max-w-full shrink-0">Announcement</StatusBadge>
      </div>
      <p className="mt-3 text-sm text-app-muted">{entry.body}</p>
    </article>
  );
}

export function NotificationDropdown({ notifications, announcements, onMarkRead }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const unreadCount = notifications.filter((entry) => entry.status === 'Unread').length;

  useEffect(() => {
    if (!isOpen) return undefined;

    const closeOnOutsideClick = (event) => {
      if (!dropdownRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div className="relative z-[45] min-w-0" ref={dropdownRef}>
      <button
        type="button"
        className={`relative inline-grid h-11 w-11 place-items-center rounded-full border border-app-border bg-app-surface text-app-text shadow-card transition hover:-translate-y-px hover:shadow-app focus:outline-none focus:ring-4 focus:ring-blue-500/20 ${unreadCount ? 'ring-2 ring-rose-400/30' : ''}`}
        onClick={() => setIsOpen((previous) => !previous)}
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={isOpen}
        title="View notifications and announcements"
      >
        <Bell aria-hidden="true" size={20} />
        {unreadCount > 0 && <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full border-2 border-app-bg bg-rose-500 px-1 text-[10px] font-extrabold text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>

      {isOpen && (
        <div className="notification-dropdown absolute right-0 top-[calc(100%+0.7rem)] w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-app-border bg-app-card shadow-2xl animate-[notificationMenuIn_140ms_ease-out] sm:w-96" role="dialog" aria-label="Notifications and announcements">
          <div className="flex items-start justify-between gap-4 border-b border-app-border px-4 py-3">
            <div className="grid gap-1">
              <strong className="text-sm text-app-text">Notifications</strong>
              <span className="text-xs text-app-muted">{unreadCount ? `${unreadCount} unread update${unreadCount === 1 ? '' : 's'}` : 'You are all caught up'}</span>
            </div>
            <button type="button" className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg text-app-muted transition hover:bg-app-surface hover:text-app-text focus:outline-none focus:ring-4 focus:ring-blue-500/20" onClick={() => setIsOpen(false)} aria-label="Close notifications"><X size={18} /></button>
          </div>
          <div className="app-scroll grid max-h-[min(62vh,32rem)] gap-2 overflow-y-auto p-3">
            {notifications.slice(0, 5).map((entry) => (
              <NotificationItem key={entry.id} entry={entry} onMarkRead={onMarkRead} />
            ))}
            {announcements.slice(0, 3).map((entry) => (
              <AnnouncementItem key={entry.id} entry={entry} />
            ))}
            {!notifications.length && !announcements.length && (
              <EmptyState title="No updates yet" description="New deadline reminders and announcements will appear here." />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ApplicationProgressLabel({ status }) {
  return toPercent(getApplicationProgress(status));
}
