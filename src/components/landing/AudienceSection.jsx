import { BadgeCheck, Building2, GraduationCap, KeyRound, School, UserRoundCheck, Users } from 'lucide-react';
import { AUDIENCES, OFFICE_ROLES } from './content';

const AUDIENCE_ICONS = { incoming: GraduationCap, current: School, transferee: UserRoundCheck };
const OFFICE_ICONS = { office: Building2, interviewers: Users, ladder: BadgeCheck };

export default function AudienceSection() {
  return (
    <section id="who" className="lp-section" aria-labelledby="lp-who-title">
      <div className="lp-shell">
        <header className="lp-section-head" data-reveal>
          <p className="lp-eyebrow">Who it’s for</p>
          <h2 id="lp-who-title" className="lp-h2">Made for applicants. <span className="lp-serif">Read by the people who decide.</span></h2>
        </header>

        <div className="lp-audiences">
          {AUDIENCES.map((audience, index) => {
            const Icon = AUDIENCE_ICONS[audience.id];
            return (
              <article key={audience.id} className="lp-audience" data-reveal style={{ '--d': `${index * 90}ms` }}>
                <span className="lp-audience-icon"><Icon size={22} aria-hidden="true" /></span>
                <h3 className="lp-audience-title">{audience.title}</h3>
                <p className="lp-audience-body">{audience.body}</p>
              </article>
            );
          })}
        </div>

        <div className="lp-office" data-reveal>
          <div className="lp-office-head">
            <h3 className="lp-office-title">On the other side of your application</h3>
            <p className="lp-office-note">
              <KeyRound size={15} aria-hidden="true" />
              Staff and reviewer accounts are by invitation only. There is no staff sign-up.
            </p>
          </div>
          <ul className="lp-office-roles">
            {OFFICE_ROLES.map((role) => {
              const Icon = OFFICE_ICONS[role.id];
              return (
                <li key={role.id}>
                  <Icon size={18} aria-hidden="true" />
                  <div className="min-w-0">
                    <strong>{role.title}</strong>
                    <p>{role.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
