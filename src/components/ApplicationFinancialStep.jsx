import { FormField, Panel } from './ui';
import {
  COPING_OPTIONS,
  DIFFICULTY_REASON_OPTIONS,
  TRANSPORT_MODE_OPTIONS,
  foodIntakeOptions,
  yesNoAnswerOptions,
} from '../lib/financialDetails';

const controlClass = 'h-12 py-0';

const AmountInput = ({ value, onChange, label }) => (
  <input
    type="number"
    inputMode="decimal"
    min="0"
    step="0.01"
    className={controlClass}
    value={value}
    onChange={(event) => onChange(event.target.value)}
    aria-label={label}
  />
);

// A "check as many" answer, stored as a list of option keys. FORM 230-SCH asks the
// financial-difficulty reasons and the coping strategies this way, with one
// free-text follow-up when "Other" is chosen.
function CheckboxGroup({ legend, hint, options, selected, onToggle, otherValue, onOtherChange }) {
  const isSelected = (key) => selected.includes(key);
  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0 md:col-span-2">
      <legend className="mb-1 text-sm font-semibold text-app-text">{legend}</legend>
      {hint ? <small className="field-hint block">{hint}</small> : null}
      <div className="grid gap-2 md:grid-cols-2">
        {options.map((option) => (
          <label key={option.key} className="flex items-start gap-2 text-sm text-app-text">
            <input type="checkbox" className="mt-1" checked={isSelected(option.key)} onChange={() => onToggle(option.key)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {isSelected('other') && otherValue !== undefined ? (
        <FormField label="Please specify">
          <input className={controlClass} value={otherValue} onChange={(event) => onOtherChange(event.target.value)} maxLength={300} />
        </FormField>
      ) : null}
    </fieldset>
  );
}

// The per-application "Financial situation" step of the application workspace
// (FORM 230-SCH: other income, difficulty in the last 3 months, allowance and
// daily expenses). These answers are time-sensitive, so they belong to this
// application rather than the reusable profile, and they go to the Admissions
// Office only.
export default function ApplicationFinancialStep({ answers, onChange, missing = [] }) {
  const set = (key) => (value) => onChange({ ...answers, [key]: value });
  const text = (key) => (event) => set(key)(event.target.value);
  const selection = (key) => (Array.isArray(answers[key]) ? answers[key] : []);
  const toggle = (key) => (option) => {
    const current = selection(key);
    set(key)(current.includes(option) ? current.filter((entry) => entry !== option) : [...current, option]);
  };

  return (
    <section className="grid gap-3" aria-label="Financial situation">
      <p className="m-0 rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-app-text" role="note">
        These answers are for this application only and are shared with the Admissions Office, not your Department Chair. Enter 0 when an amount does not apply.
      </p>

      <Panel className="grid gap-4 md:grid-cols-2">
        <FormField label="Do you have other sources of income?">
          <select className={controlClass} value={answers.otherIncomeAnswer} onChange={text('otherIncomeAnswer')}>
            {yesNoAnswerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FormField>
        {answers.otherIncomeAnswer === 'yes' ? (
          <>
            <FormField label="Other income sources">
              <input className={controlClass} value={answers.otherIncomeSources} onChange={text('otherIncomeSources')} maxLength={300} />
            </FormField>
            <FormField label="Average monthly amount (PHP)">
              <AmountInput value={answers.otherIncomeMonthly} onChange={set('otherIncomeMonthly')} label="Average monthly amount of other income" />
            </FormField>
          </>
        ) : null}
      </Panel>

      <Panel className="grid gap-4 md:grid-cols-2">
        <FormField label="Has your family had financial difficulty in the last 3 months?">
          <select className={controlClass} value={answers.difficultyAnswer} onChange={text('difficultyAnswer')}>
            {yesNoAnswerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FormField>
        {answers.difficultyAnswer === 'yes' ? (
          <>
            <CheckboxGroup
              legend="Reasons for the financial difficulty"
              hint="Check as many as apply."
              options={DIFFICULTY_REASON_OPTIONS}
              selected={selection('difficultyReasons')}
              onToggle={toggle('difficultyReasons')}
              otherValue={answers.difficultyOther}
              onOtherChange={(value) => set('difficultyOther')(value)}
            />
            <CheckboxGroup
              legend="How does your family cope?"
              hint="Check as many as apply."
              options={COPING_OPTIONS}
              selected={selection('difficultyCoping')}
              onToggle={toggle('difficultyCoping')}
              otherValue={answers.copingOther}
              onOtherChange={(value) => set('copingOther')(value)}
            />
          </>
        ) : null}
      </Panel>

      <Panel className="grid gap-4 md:grid-cols-2">
        <FormField label="Daily allowance (PHP)">
          <AmountInput value={answers.allowanceDaily} onChange={set('allowanceDaily')} label="Daily allowance" />
        </FormField>
        <FormField label="Is your daily allowance enough?">
          <select className={controlClass} value={answers.allowanceEnough} onChange={text('allowanceEnough')}>
            {yesNoAnswerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FormField>
        <FormField label="Daily food intake">
          <select className={controlClass} value={answers.foodIntakeAdequacy} onChange={text('foodIntakeAdequacy')}>
            <option value="">Select</option>
            {foodIntakeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FormField>
        <FormField label="Mode of transport to school">
          <select className={controlClass} value={answers.transportMode} onChange={text('transportMode')}>
            <option value="">Select</option>
            {TRANSPORT_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FormField>
        {answers.transportMode === 'other' ? (
          <FormField label="Please specify your mode of transport" className="md:col-span-2">
            <input className={controlClass} value={answers.transportOther} onChange={text('transportOther')} maxLength={100} />
          </FormField>
        ) : null}
        <FormField label="What do you usually eat in a day?" hint="Optional." className="md:col-span-2">
          <input className={controlClass} value={answers.foodIntake} onChange={text('foodIntake')} maxLength={300} />
        </FormField>
      </Panel>

      <Panel className="grid gap-4 md:grid-cols-3">
        <FormField label="Daily food expense (PHP)">
          <AmountInput value={answers.expenseFood} onChange={set('expenseFood')} label="Daily food expense" />
        </FormField>
        <FormField label="Daily transport expense (PHP)">
          <AmountInput value={answers.expenseTransport} onChange={set('expenseTransport')} label="Daily transport expense" />
        </FormField>
        <FormField label="Other daily expenses (PHP)">
          <AmountInput value={answers.expenseOther} onChange={set('expenseOther')} label="Other daily expenses" />
        </FormField>
      </Panel>

      {missing.length ? (
        <p className="m-0 text-sm text-app-muted" role="status">Still needed: {missing.join('; ')}.</p>
      ) : null}
    </section>
  );
}
