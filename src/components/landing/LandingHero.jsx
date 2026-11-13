import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowRight, Bell, CheckCircle2, CircleDot, FileCheck2, FileClock, FileWarning } from 'lucide-react';
import { CampusBackdrop } from './CampusBackdrop';
import { DOCUMENT_STATES, LANDING_FACTS, STAGE_LABELS } from './content';
import { useCountUp, useInView, useMagnetic, usePointerField } from './motion';

const HEADLINE_LEAD = ['Your', 'AdDU', 'scholarship,'];
const HEADLINE_ACCENT = ['one', 'clear', 'path.'];

function Fact({ fact, run }) {
  const value = useCountUp(fact.value, { run });
  return (
    <div className="lp-fact">
      {/* The label is the term; the number is its value. CSS shows the number first. */}
      <dt className="lp-fact-term">
        <span className="lp-fact-label">{fact.label}</span>
        <span className="lp-fact-detail">{fact.detail}</span>
      </dt>
      <dd className="lp-fact-value">
        <span aria-hidden="true">{value}</span>
        <span className="sr-only">{fact.value}</span>
      </dd>
    </div>
  );
}

// The SOP stage track in miniature, `current` stages in.
export function MiniStageTrack({ current = 2, compact = false }) {
  return (
    <ol className={`lp-track ${compact ? 'lp-track--compact' : ''}`} aria-hidden="true">
      {STAGE_LABELS.map((label, index) => (
        <li key={label} className={index < current ? 'is-done' : index === current ? 'is-current' : ''} style={{ '--i': index }}>
          <span className="lp-track-bar" />
        </li>
      ))}
    </ol>
  );
}

const ROUTE_D = 'M 28 44 C 210 30 488 96 462 236 C 438 360 70 322 84 456 C 96 552 300 592 502 572';
const ROUTE_BOX = { width: 520, height: 600 };
const DOT_RADIUS_PX = 6;

// The comet that travels the route. The streak is three dashes of different
// lengths sharing one head position (a dash of length L whose leading end is at h
// has stroke-dashoffset L - h, the path being normalised with pathLength="1"),
// and the dot rides the same path with the same easing, so the two never drift
// apart. The whole group fades in as it leaves the start and out before the end
// of the line, then rests, so nothing pops in or out.
const COMET_LOOP = '8s';
const COMET_START = '3.2s'; // after the base line has drawn itself in
const COMET_KEY_TIMES = '0;0.8;1';
const COMET_SPLINES = '0.5 0 0.3 1; 0 0 1 1';
const COMET_TAILS = [
  { id: 'tail-3', length: 0.22 },
  { id: 'tail-2', length: 0.13 },
  { id: 'tail-1', length: 0.06 },
];
const timing = { dur: COMET_LOOP, begin: COMET_START, repeatCount: 'indefinite' };

function RouteComet() {
  return (
    <g className="lp-comet-group" opacity="0">
      <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.05;0.72;0.8;1" {...timing} />
      {COMET_TAILS.map(({ id, length }) => (
        <path
          key={id}
          className={`lp-comet lp-comet--${id}`}
          d={ROUTE_D}
          pathLength="1"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${length} 3`}
          strokeDashoffset={length}
        >
          <animate
            attributeName="stroke-dashoffset"
            values={`${length};${(length - 1).toFixed(2)};${(length - 1).toFixed(2)}`}
            keyTimes={COMET_KEY_TIMES}
            calcMode="spline"
            keySplines={COMET_SPLINES}
            {...timing}
          />
        </path>
      ))}
      {/* The outer <g> carries only the motion; the circle inside is scaled back
          to round (the SVG stretches to the card stack's shape). */}
      <g>
        <animateMotion
          keyPoints="0;1;1"
          keyTimes={COMET_KEY_TIMES}
          calcMode="spline"
          keySplines={COMET_SPLINES}
          {...timing}
        >
          <mpath href="#lp-hero-route" />
        </animateMotion>
        <circle r="1" className="lp-comet-dot" />
      </g>
    </g>
  );
}

function HeroStack({ motionOn, live }) {
  const svgRef = useRef(null);

  // Keep the comet mounted (so it never re-enters from nowhere) and pause the SVG
  // clock while the hero is off screen or the tab is hidden.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof svg.pauseAnimations !== 'function') return undefined;
    const sync = () => {
      const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
      if (live && visible) svg.unpauseAnimations();
      else svg.pauseAnimations();
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [live, motionOn]);

  // The route SVG is stretched to the stack, so a circle would turn oval on a tall
  // phone layout. Hand CSS the counter-scale that keeps the dot round.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return undefined;
    const apply = () => {
      const { width, height } = svg.getBoundingClientRect();
      if (!width || !height) return;
      svg.style.setProperty('--dot-x', (DOT_RADIUS_PX / (width / ROUTE_BOX.width)).toFixed(3));
      svg.style.setProperty('--dot-y', (DOT_RADIUS_PX / (height / ROUTE_BOX.height)).toFixed(3));
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  return (
    <figure className="lp-stack" aria-label="Illustrative preview of the ScholarPath workspace">
      <svg ref={svgRef} className="lp-stack-path" viewBox={`0 0 ${ROUTE_BOX.width} ${ROUTE_BOX.height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="lp-path-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--lp-glow)" stopOpacity="0" />
            <stop offset="35%" stopColor="var(--lp-glow)" />
            <stop offset="100%" stopColor="var(--lp-spark)" />
          </linearGradient>
        </defs>
        <path id="lp-hero-route" className="lp-route" pathLength="1" d={ROUTE_D} fill="none" stroke="url(#lp-path-grad)" strokeWidth="2.5" strokeLinecap="round" />
        {motionOn && <RouteComet />}
      </svg>

      {/* Back layer: application tracking */}
      <div className="lp-float lp-float--track" style={{ '--depth': 0.35 }}>
        <div className="lp-glass lp-mock">
          <div className="lp-mock-head">
            <span className="lp-mock-kicker">Application tracking</span>
            <span className="lp-pill lp-pill--blue">{STAGE_LABELS[2]}</span>
          </div>
          <MiniStageTrack current={2} />
          <p className="lp-mock-foot">Standard Procedure stage 3 of {STAGE_LABELS.length}</p>
        </div>
      </div>

      {/* Middle layer: Document Vault */}
      <div className="lp-float lp-float--vault" style={{ '--depth': 0.7 }}>
        <div className="lp-glass lp-mock">
          <div className="lp-mock-head">
            <span className="lp-mock-kicker">Document Vault</span>
            <span className="lp-mock-meta">3 files</span>
          </div>
          <ul className="lp-files">
            <li><FileCheck2 size={16} aria-hidden="true" className="text-emerald-500 dark:text-emerald-300" /><span>Grade report</span><span className="lp-pill lp-pill--ok">{DOCUMENT_STATES.Verified}</span></li>
            <li><FileClock size={16} aria-hidden="true" className="text-amber-600 dark:text-amber-300" /><span>Proof of address</span><span className="lp-pill lp-pill--wait">{DOCUMENT_STATES.Pending}</span></li>
            <li><FileWarning size={16} aria-hidden="true" className="text-rose-600 dark:text-rose-300" /><span>Applicant photo</span><span className="lp-pill lp-pill--warn">{DOCUMENT_STATES.Rejected}</span></li>
          </ul>
        </div>
      </div>

      {/* Front layer: the eligibility verdict strip */}
      <div className="lp-float lp-float--verdict" style={{ '--depth': 1.1 }}>
        <div className="lp-glass lp-glass--strong lp-mock">
          <div className="lp-mock-head">
            <span className="lp-mock-kicker">Grant-in-Aid (GIA)</span>
            <span className="lp-mock-meta">Smart Eligibility Checker</span>
          </div>
          <div className="lp-verdict lp-verdict--ok">
            <CheckCircle2 size={18} aria-hidden="true" />
            <strong>You qualify</strong>
          </div>
          <ul className="lp-criteria">
            <li><CheckCircle2 size={14} aria-hidden="true" /> Annual QPI meets the floor</li>
            <li><CheckCircle2 size={14} aria-hidden="true" /> Household income within the ceiling</li>
            <li><CheckCircle2 size={14} aria-hidden="true" /> Degree program is open to this grant</li>
          </ul>
        </div>
      </div>

      {/* Floating notification */}
      <div className="lp-float lp-float--note" style={{ '--depth': 1.5 }}>
        <div className="lp-glass lp-glass--strong lp-note">
          <span className="lp-note-icon"><Bell size={15} aria-hidden="true" /></span>
          <span className="min-w-0">
            <strong>Now {STAGE_LABELS[3]}</strong>
            <small>In-app · Email · SMS</small>
          </span>
        </div>
      </div>

      <figcaption className="lp-caption">Illustration · sample screens, not real data</figcaption>
    </figure>
  );
}

export default function LandingHero({ motionOn, finePointer, onGetStarted, onSignIn }) {
  const stageRef = useRef(null);
  const factsRef = useRef(null);
  const sectionRef = useRef(null);
  const heroInView = useInView(sectionRef);
  const factsInView = useInView(factsRef, { threshold: 0.4 });
  const pointerOn = motionOn && finePointer;
  usePointerField(stageRef, pointerOn);
  const primaryRef = useMagnetic(pointerOn);
  const secondaryRef = useMagnetic(pointerOn, 0.2);

  let wordIndex = 0;

  return (
    <section ref={sectionRef} id="lp-top" className={`lp-hero ${heroInView ? 'is-live' : ''}`} aria-labelledby="lp-hero-title">
      <div className="lp-aurora" aria-hidden="true">
        <CampusBackdrop className="lp-campus--hero" />
        <span className="lp-blob lp-blob--a" />
        <span className="lp-blob lp-blob--b" />
        <span className="lp-blob lp-blob--c" />
        <span className="lp-grid" />
        <span className="lp-grain" />
      </div>

      <div className="lp-shell lp-hero-grid">
        <div className="lp-hero-copy">
          <h1 id="lp-hero-title" className="lp-display">
            {HEADLINE_LEAD.map((word) => (
              <span key={word}><span className="lp-word" style={{ '--i': wordIndex++ }}>{word}</span>{' '}</span>
            ))}
            <span className="lp-display-accent">
              {HEADLINE_ACCENT.map((word, index) => (
                <span key={word}>
                  <span className="lp-word" style={{ '--i': wordIndex++ }}>{word}</span>
                  {index < HEADLINE_ACCENT.length - 1 ? ' ' : ''}
                </span>
              ))}
              <svg className="lp-underline" viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                <path pathLength="1" d="M4 14 C 80 4, 200 4, 296 10" />
              </svg>
            </span>
          </h1>

          <p className="lp-lede lp-hero-lede">
            Find, check and track Ateneo de Davao University scholarships in one place, from your first eligibility check to a recorded result.
          </p>

          <div className="lp-hero-actions">
            <button ref={primaryRef} type="button" className="lp-btn lp-btn--primary lp-btn--lg lp-magnetic" onClick={onGetStarted}>
              <span>Create account</span>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
            <button ref={secondaryRef} type="button" className="lp-btn lp-btn--glass lp-btn--lg lp-magnetic" onClick={onSignIn}>
              Sign in
            </button>
          </div>
          <p className="lp-hero-note">
            <CircleDot size={14} aria-hidden="true" />
            Personal Google and email accounts welcome. No AdDU email needed.
          </p>

          <dl ref={factsRef} className="lp-facts">
            {LANDING_FACTS.map((fact) => <Fact key={fact.label} fact={fact} run={motionOn && factsInView} />)}
          </dl>
        </div>

        <div ref={stageRef} className="lp-hero-stage">
          <HeroStack motionOn={motionOn} live={heroInView} />
        </div>
      </div>

      <a href="#grants" className="lp-scroll-cue">
        <span>See the grants</span>
        <ArrowDown size={16} aria-hidden="true" />
      </a>
    </section>
  );
}
