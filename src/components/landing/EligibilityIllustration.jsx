import { useId, useState } from 'react';
import { CheckCircle2, CircleHelp, Info, RotateCcw, ShieldAlert, XCircle } from 'lucide-react';
import { SAMPLE_TRACK, STANDING_OPTIONS, VERDICT_COPY, createIllustrationAnswers, evaluateIllustration, getAcademicScale } from './content';

const VERDICT_ICON = { eligible: CheckCircle2, ineligible: XCircle, incomplete: CircleHelp };
const ROW_ICON = { pass: CheckCircle2, fail: XCircle, missing: CircleHelp };
const ROW_STATE_LABEL = { pass: 'Meets the sample track', fail: 'Does not meet the sample track', missing: 'Not answered yet' };

function ChoiceGroup({ legend, name, options, value, onChange, columns = 2 }) {
  return (
    <fieldset className="lp-field">
      <legend className="lp-field-label">{legend}</legend>
      <div className={`lp-choices lp-choices--${columns}`}>
        {options.map((option) => (
          <label key={option.value} className={`lp-choice ${value === option.value ? 'is-checked' : ''}`}>
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// A toy Smart Eligibility Checker for a made-up sample track. It never reads the
// live catalog and never calls Supabase; it only shows how a verdict and its
// per-criterion rows respond to answers.
export default function EligibilityIllustration() {
  const [answers, setAnswers] = useState(createIllustrationAnswers);
  const id = useId();
  const result = evaluateIllustration(answers);
  const scale = getAcademicScale(answers.standing);
  const verdict = VERDICT_COPY[result.verdict];
  const VerdictIcon = VERDICT_ICON[result.verdict];
  const set = (patch) => setAnswers((previous) => ({ ...previous, ...patch }));
  const academicAnswered = answers.academic !== null;
  const sliderValue = academicAnswered ? answers.academic : scale.start;

  return (
    <section id="try" className="lp-section lp-try" aria-labelledby="lp-try-title">
      <div className="lp-shell">
        <header className="lp-section-head" data-reveal>
          <p className="lp-eyebrow">Try it</p>
          <h2 id="lp-try-title" className="lp-h2">Watch a verdict <span className="lp-serif">form as you answer.</span></h2>
          <p className="lp-lede">A small illustration of the Smart Eligibility Checker. Change an answer and every criterion re-checks at once.</p>
        </header>

        <div className="lp-try-grid" data-reveal>
          <form className="lp-glass lp-try-controls" onSubmit={(event) => event.preventDefault()} aria-describedby={`${id}-disclaimer`}>
            <p id={`${id}-disclaimer`} className="lp-disclaimer">
              <Info size={16} aria-hidden="true" />
              <span><strong>Illustration.</strong> Your real result uses the live catalog and your Application Form. The thresholds below belong to a made-up sample track.</span>
            </p>

            <ChoiceGroup
              legend="Year standing"
              name={`${id}-standing`}
              options={STANDING_OPTIONS}
              value={answers.standing}
              onChange={(standing) => set({ standing, academic: null })}
            />

            <div className="lp-field">
              <label htmlFor={`${id}-academic`} className="lp-field-label lp-field-label--row">
                <span>{answers.standing ? scale.label : 'Academic measure'}</span>
                <output htmlFor={`${id}-academic`} className={`lp-output ${academicAnswered ? '' : 'is-empty'}`}>
                  {academicAnswered ? scale.format(answers.academic) : 'Not answered'}
                </output>
              </label>
              <input
                id={`${id}-academic`}
                type="range"
                className="lp-range"
                min={scale.min}
                max={scale.max}
                step={scale.step}
                value={sliderValue}
                disabled={!answers.standing}
                aria-valuetext={academicAnswered ? scale.format(answers.academic) : 'Not answered'}
                style={{ '--fill': `${((sliderValue - scale.min) / (scale.max - scale.min)) * 100}%`, '--floor': `${((scale.floor - scale.min) / (scale.max - scale.min)) * 100}%` }}
                onChange={(event) => set({ academic: Number(event.target.value) })}
              />
              <span className="lp-hint">
                {answers.standing
                  ? `Sample floor: ${scale.short} ${scale.format(scale.floor)}. Drag the slider or use the arrow keys.`
                  : 'Choose a year standing first. It decides whether the QPI or the senior high school average is read.'}
              </span>
            </div>

            <ChoiceGroup
              legend="Household income"
              name={`${id}-income`}
              options={SAMPLE_TRACK.incomeBands}
              value={answers.income}
              onChange={(income) => set({ income })}
              columns={1}
            />

            <div className="lp-field">
              <label htmlFor={`${id}-program`} className="lp-field-label">Degree program</label>
              <select id={`${id}-program`} className="lp-select" value={answers.program} onChange={(event) => set({ program: event.target.value })}>
                <option value="">Choose a program</option>
                {SAMPLE_TRACK.programs.map((program) => (
                  <option key={program.value} value={program.value}>{program.value}</option>
                ))}
              </select>
            </div>

            <label className="lp-switch">
              <input type="checkbox" className="sr-only" checked={answers.prepaidPlan} onChange={(event) => set({ prepaidPlan: event.target.checked })} />
              <span className="lp-switch-track" aria-hidden="true"><span className="lp-switch-thumb" /></span>
              <span className="min-w-0">
                <strong>I am on a prepaid tuition plan</strong>
                <small>Exclusion Flag Hierarchy: a specific exclusion overrides every other match.</small>
              </span>
            </label>

            <button type="button" className="lp-btn lp-btn--ghost lp-btn--sm justify-self-start" onClick={() => setAnswers(createIllustrationAnswers())}>
              <RotateCcw size={15} aria-hidden="true" /> Start over
            </button>
          </form>

          <div className={`lp-glass lp-glass--strong lp-try-result is-${result.verdict}`}>
            <div className="lp-mock-head">
              <span className="lp-mock-kicker">{SAMPLE_TRACK.name}</span>
              <span className="lp-pill lp-pill--soft">Illustration</span>
            </div>
            <div className={`lp-verdict lp-verdict--big lp-verdict--${result.verdict}`} role="status" aria-live="polite" aria-atomic="true">
              <VerdictIcon key={result.verdict} size={26} aria-hidden="true" className="lp-verdict-icon" />
              <span className="min-w-0">
                <strong key={`t-${result.verdict}`} className="lp-verdict-title">{verdict.title}</strong>
                <small>{result.overriddenByExclusion ? 'A specific exclusion applies, so no other answer can qualify.' : verdict.detail}</small>
              </span>
            </div>

            <ul className="lp-rows" aria-label="Criteria">
              {result.rows.map((row) => {
                const Icon = row.id === 'exclusion' && row.state === 'fail' ? ShieldAlert : ROW_ICON[row.state];
                return (
                  <li key={row.id} className={`lp-row is-${row.state}`}>
                    <Icon size={18} aria-hidden="true" className="lp-row-icon" />
                    <div className="min-w-0">
                      <p className="lp-row-label">{row.label}<span className="sr-only">: {ROW_STATE_LABEL[row.state]}</span></p>
                      <p className="lp-row-answer">{row.answer}</p>
                      <p className="lp-row-needs">Needs: {row.needs}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
