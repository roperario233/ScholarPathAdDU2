import { StatusBadge } from './ui';

// One title surface per Admissions Office route. The section label stays fixed
// so the routes read as one workspace, while each page supplies its own title,
// description, and status badge.
export default function AdminPageHeader({ title, description, badge, badgeTone = 'info' }) {
  return (
    <section className="page-title-bar flex flex-col items-start justify-between gap-4 rounded-app border bg-app-card p-5 shadow-app backdrop-blur md:flex-row md:items-center">
      <div className="page-title-copy">
        <span className="page-section-label">Admissions Office workspace</span>
        <h2>{title}</h2>
        {description && <p className="mt-2 max-w-2xl text-sm text-app-muted">{description}</p>}
      </div>
      {badge && <StatusBadge tone={badgeTone}>{badge}</StatusBadge>}
    </section>
  );
}
