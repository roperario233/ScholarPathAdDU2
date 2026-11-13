import { useRef, useState } from 'react';
import { CalendarClock, Check, ChevronDown, ListChecks } from 'lucide-react';
import ScholarshipTrackIcon from '../ScholarshipTrackIcon';
import { APPLICATION_PERIODS, PRELIMINARY_REQUIREMENTS, SCHOLARSHIP_GUIDES } from '../../lib/scholarshipGuide';
import { usePointerField } from './motion';

const ACCENTS = { 'general-pool': 'blue', 'work-study': 'cyan', honors: 'indigo' };

// The leaflet's program list as a disclosure: a real button (aria-expanded and
// aria-controls) over a panel whose height eases open and shut. A closed panel stays
// in the markup but is `visibility: hidden` and `aria-hidden`, so it is out of the tab
// order and the accessibility tree; under reduced motion it simply swaps.
function ProgramList({ guide, count }) {
  const [open, setOpen] = useState(false);
  const panelId = `lp-programs-${guide.ruleFamily}`;
  return (
    <div className={`lp-programs ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="lp-programs-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span>The {count} WSP programs</span>
        <ChevronDown size={16} aria-hidden="true" className="lp-programs-chevron" />
      </button>
      <div id={panelId} role="region" aria-label={`The ${count} WSP programs`} className="lp-programs-panel" aria-hidden={!open}>
        <div className="lp-programs-body">
          {guide.programs.map((group, index) => (
            <p key={group.heading} style={{ '--i': index }}><strong>{group.heading}</strong> {group.names.join(', ')}</p>
          ))}
        </div>
      </div>
    </div>
  );
}

function GrantCard({ guide, index, pointerOn }) {
  const ref = useRef(null);
  usePointerField(ref, pointerOn);
  const programCount = (guide.programs || []).reduce((total, group) => total + group.names.length, 0);

  return (
    <article
      ref={ref}
      className={`lp-grant lp-grant--${ACCENTS[guide.ruleFamily] || 'blue'}`}
      data-reveal
      style={{ '--d': `${index * 110}ms` }}
      aria-labelledby={`lp-grant-${guide.ruleFamily}`}
    >
      <div className="lp-grant-inner">
        <span className="lp-grant-index" aria-hidden="true">0{index + 1}</span>
        <div className="flex items-center gap-3">
          <span className="lp-grant-icon"><ScholarshipTrackIcon ruleFamily={guide.ruleFamily} /></span>
          <span className="lp-pill lp-pill--soft">{guide.kind}</span>
        </div>
        <h3 id={`lp-grant-${guide.ruleFamily}`} className="lp-grant-title">{guide.name}</h3>
        <p className="lp-grant-summary">{guide.summary}</p>

        <div className="lp-grant-block">
          <h4 className="lp-grant-label">Coverage</h4>
          <ul className="lp-grant-coverage">
            {guide.coverage.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>

        <div className="lp-grant-block">
          <h4 className="lp-grant-label">Who can apply</h4>
          <ul className="lp-checklist">
            {guide.criteria.map((line) => (
              <li key={line}><Check size={15} aria-hidden="true" /><span>{line}</span></li>
            ))}
          </ul>
        </div>

        {programCount > 0 && (
          <ProgramList guide={guide} count={programCount} />
        )}
      </div>
    </article>
  );
}

export default function GrantCards({ pointerOn }) {
  return (
    <section id="grants" className="lp-section" aria-labelledby="lp-grants-title">
      <div className="lp-shell">
        <header className="lp-section-head" data-reveal>
          <p className="lp-eyebrow">The three AdDU grants</p>
          <h2 id="lp-grants-title" className="lp-h2">Three ways in. <span className="lp-serif">One application path.</span></h2>
          <p className="lp-lede">
            Grant-in-Aid, the Working Scholar Program and the Jubilee Scholarship, as the Office of Admission and Aid describes them. Academic floors, income ceilings and deadlines come from the live catalog once you sign in.
          </p>
        </header>

        <div className="lp-grants">
          {SCHOLARSHIP_GUIDES.map((guide, index) => (
            <GrantCard key={guide.ruleFamily} guide={guide} index={index} pointerOn={pointerOn} />
          ))}
        </div>

        <div className="lp-prelim" data-reveal>
          <div className="lp-prelim-col">
            <h3 className="lp-prelim-title"><ListChecks size={18} aria-hidden="true" /> Before any grant</h3>
            <ul className="lp-checklist">
              {PRELIMINARY_REQUIREMENTS.map((line) => (
                <li key={line}><Check size={15} aria-hidden="true" /><span>{line}</span></li>
              ))}
            </ul>
          </div>
          <div className="lp-prelim-col">
            <h3 className="lp-prelim-title"><CalendarClock size={18} aria-hidden="true" /> Application periods</h3>
            <dl className="lp-periods">
              {APPLICATION_PERIODS.map((period) => (
                <div key={period.label}>
                  <dt>{period.label}</dt>
                  <dd>{period.detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
