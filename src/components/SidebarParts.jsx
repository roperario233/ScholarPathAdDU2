import {
  Award, BarChart3, Bell, CalendarClock, CalendarDays, ClipboardCheck, ClipboardList, Compass, FolderOpen,
  GraduationCap, Inbox, LayoutDashboard, LibraryBig, ListChecks, Megaphone, Settings, ShieldCheck, UserCog, UserRound, Users, Vault,
} from 'lucide-react';
import ProfileAvatar from './ProfileAvatar';
import { Skeleton } from './Skeleton';

// One glyph per route, shared by the desktop sidebar and the mobile drawer. The
// student's `profile` route is the Application Form; staff keep My Profile.
const NAV_ICONS = {
  dashboard: LayoutDashboard,
  explore: Compass,
  applications: FolderOpen,
  vault: Vault,
  calendar: CalendarDays,
  admin: LayoutDashboard,
  'admin-intake': Inbox,
  'admin-review': ListChecks,
  'admin-interviews': Users,
  'admin-calendar': CalendarDays,
  'admin-release': Award,
  'admin-statistics': BarChart3,
  'admin-catalog': LibraryBig,
  'admin-announcements': Megaphone,
  'admin-accounts': UserCog,
  review: ClipboardCheck,
  'chair-interviews': Users,
  'chair-calendar': CalendarDays,
  'chair-statistics': BarChart3,
  settings: Settings,
  // The privacy and storage surface is one route with three documents.
  legal: ShieldCheck,
};

const renderNavIcon = (item) => {
  let Icon = NAV_ICONS[item.view] || LayoutDashboard;
  if (item.view === 'profile') Icon = item.label === 'Application Form' ? ClipboardList : UserRound;
  return <Icon size={16} />;
};

// The page links. Active routes get the Ateneo gradient (the same treatment as a
// primary action); the rest stay flat so a long list of routes reads quietly.
// Never give these buttons `bg-app-surface` / `bg-app-card`: a global rule repaints
// every button carrying those classes as a tinted page action.
// A row that does something instead of opening a page (the drawer's Sign out). It
// wears the inactive page-link treatment exactly, so it reads as part of the list.
export function SidebarNavAction({ icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      className="group flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm font-semibold text-app-muted transition hover:bg-blue-500/10 hover:text-app-text focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20"
      onClick={onClick}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-app-muted-surface text-app-muted transition-colors group-hover:bg-blue-500/15 group-hover:text-blue-600 dark:group-hover:text-blue-200" aria-hidden="true">
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{label}</span>
    </button>
  );
}

// Consecutive items that share a `group` become one labelled section; items with
// no group (a student's list, the office Dashboard) stay flat, so only the long
// office list pays for headings. A group with no visible item renders no heading.
const buildNavSections = (items) => items.reduce((sections, item) => {
  const last = sections[sections.length - 1];
  if (last && (last.label || '') === (item.group || '')) last.items.push(item);
  else sections.push({ label: item.group || '', items: [item] });
  return sections;
}, []);

function SidebarNavLink({ item, isActive, onNavigate }) {
  return (
    <button
      type="button"
      className={`group flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm font-semibold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20 ${
        isActive
          ? 'bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright text-white shadow-sm'
          : 'text-app-muted hover:bg-blue-500/10 hover:text-app-text'
      }`}
      onClick={() => onNavigate(item.view)}
      aria-current={isActive ? 'page' : undefined}
    >
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors ${isActive ? 'bg-white/15 text-white' : 'bg-app-muted-surface text-app-muted group-hover:bg-blue-500/15 group-hover:text-blue-600 dark:group-hover:text-blue-200'}`} aria-hidden="true">
        {renderNavIcon(item)}
      </span>
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{item.label}</span>
      {Number(item.badge) > 0 && (
        <span
          className="shrink-0 rounded-full bg-rose-500 px-2 py-0.5 text-xs font-extrabold leading-5 text-white"
          aria-label={`${item.badge} unread support message${Number(item.badge) === 1 ? '' : 's'}`}
          title={`${item.badge} unread support message${Number(item.badge) === 1 ? '' : 's'}`}
        >
          {Number(item.badge) > 99 ? '99+' : item.badge}
        </span>
      )}
    </button>
  );
}

export function SidebarNav({ items, activeView, onNavigate, className = '', children = null }) {
  const sections = buildNavSections(items);
  return (
    <nav className={`grid gap-1 ${className}`} aria-label="Page navigation">
      {sections.map((section, sectionIndex) => (
        <div
          key={section.label || `section-${sectionIndex}`}
          className={`grid gap-1 ${section.label ? 'mt-2' : ''}`}
          role={section.label ? 'group' : undefined}
          aria-label={section.label || undefined}
        >
          {section.label ? (
            <p className="m-0 px-2.5 pb-0.5 pt-1 text-[0.68rem] font-extrabold uppercase tracking-[0.08em] text-app-muted/80" aria-hidden="true">
              {section.label}
            </p>
          ) : null}
          {section.items.map((item) => (
            <SidebarNavLink key={item.view} item={item} isActive={activeView === item.view} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
      {children}
    </nav>
  );
}

// The signed-in user's identity: photo, name, a role pill, and the department
// line. The caller passes already de-duplicated strings (a staff account whose
// name is its role label shows no pill).
export function SidebarProfile({ avatarUrl, name, roleLine = '', detailLine = '' }) {
  return (
    <div className="relative grid gap-2 overflow-hidden rounded-2xl border border-app-border bg-gradient-to-br from-blue-500/15 via-blue-500/5 to-transparent p-2.5">
      <div className="flex items-center gap-2.5">
        <ProfileAvatar src={avatarUrl} name={name} size="lg" rounded="rounded-xl" className="!h-10 !w-10 shrink-0 !text-sm ring-2 ring-blue-500/25" />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-sm font-bold leading-snug text-app-text [overflow-wrap:anywhere]">{name}</h2>
          {roleLine ? (
            <span className="mt-1 inline-block rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[0.65rem] font-bold leading-tight text-blue-700 dark:text-blue-200">{roleLine}</span>
          ) : null}
        </div>
      </div>
      {/* The department takes the full card width and wraps instead of truncating. */}
      {detailLine ? <p className="m-0 text-[0.7rem] leading-snug text-app-muted [overflow-wrap:anywhere]">{detailLine}</p> : null}
    </div>
  );
}

function GlanceTile({ icon: Icon, label, value, tone, highlight = false }) {
  return (
    <div className="grid min-w-0 content-start justify-items-center gap-1.5 rounded-2xl border border-app-border bg-app-muted-surface px-2 py-3 text-center">
      <span className={`relative grid h-8 w-8 place-items-center rounded-xl ${tone}`} aria-hidden="true">
        <Icon size={16} />
        {highlight ? <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[color:var(--card)] bg-rose-500" /> : null}
      </span>
      <strong className="text-xl font-extrabold leading-none text-app-text">{value}</strong>
      <span className="text-[0.68rem] font-semibold leading-tight text-app-muted">{label}</span>
    </div>
  );
}

const GLANCE_BLUE = 'bg-blue-500/15 text-blue-600 dark:text-blue-200';
const GLANCE_AMBER = 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
const GLANCE_GREEN = 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';

// Icon and tone per quick-glance key; the sidebar's role decides which keys it gets.
const GLANCE_VISUALS = {
  programs: { icon: GraduationCap, tone: GLANCE_BLUE },
  deadlines: { icon: CalendarClock, tone: GLANCE_AMBER },
  intake: { icon: Inbox, tone: GLANCE_BLUE },
  verify: { icon: ClipboardCheck, tone: GLANCE_AMBER },
  release: { icon: Award, tone: GLANCE_GREEN },
  interviews: { icon: CalendarDays, tone: GLANCE_BLUE },
  cases: { icon: ClipboardList, tone: GLANCE_BLUE },
  schedule: { icon: CalendarClock, tone: GLANCE_AMBER },
  approve: { icon: ListChecks, tone: GLANCE_GREEN },
};

// The quick-glance numbers: equal tiles instead of a stack of rows. `items` is
// `{ key, label, value }[]`; an unread-alerts tile turns rose while anything is unread.
export function SidebarStats({ items = [], loading = false }) {
  if (loading) {
    // The numbers are derived from the workspace, so until it loads they would
    // read 0 and then jump.
    return (
      <section aria-label="At a glance" aria-busy="true">
        <div className="grid grid-cols-3 gap-2" aria-hidden="true">
          {Array.from({ length: items.length || 3 }, (_, index) => (
            <div key={index} className="grid min-w-0 justify-items-center gap-1.5 rounded-2xl border border-app-border bg-app-muted-surface px-2 py-3">
              <Skeleton className="h-8 w-8 rounded-xl" />
              <Skeleton className="h-5 w-7" />
              <Skeleton className="h-2.5 w-12" />
            </div>
          ))}
        </div>
      </section>
    );
  }
  return (
    <section aria-label="At a glance">
      <div className="grid grid-cols-3 gap-2">
        {items.map(({ key, label, value }) => {
          if (key === 'unread') {
            return <GlanceTile key={key} icon={Bell} label={label} value={value} highlight={value > 0} tone={value > 0 ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300' : 'bg-slate-500/15 text-app-muted'} />;
          }
          const visual = GLANCE_VISUALS[key] || GLANCE_VISUALS.cases;
          return <GlanceTile key={key} icon={visual.icon} label={label} value={value} tone={visual.tone} />;
        })}
      </div>
    </section>
  );
}
