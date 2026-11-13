import { ChoiceToggle, FormField, Panel, RequiredMark } from './ui';
import {
  COPING_OPTIONS,
  DIFFICULTY_REASON_OPTIONS,
  TRANSPORT_MODE_OPTIONS,
  foodIntakeOptions,
  getMissingFinancialAnswerKeys,
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
function CheckboxGroup({ legend, hint, options, selected, onToggle, otherValue, onOtherChange, required = false, otherRequired = false }) {
  const isSelected = (key) => selected.includes(key);
  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0 md:col-span-2">
      <legend className="mb-0.5 p-0 text-sm font-semibold text-app-text">
        {legend}
        {required && <RequiredMark />}
      </legend>
      {hint ? <small className="field-hint block">{hint}</small> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label key={option.key} className="group relative block cursor-pointer">
            {/* The native checkbox stays in the tab order and the accessibility tree; the card is its visual. */}
            <input type="checkbox" className="peer sr-only" checked={isSelected(option.key)} onChange={() => onToggle(option.key)} />
            <span className="flex min-h-[48px] items-center gap-3 rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm text-app-text transition-colors duration-150 group-hover:border-blue-500/50 peer-checked:border-blue-500/70 peer-checked:bg-blue-500/10 peer-checked:font-medium peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500/60 peer-checked:[&_.check-box]:border-blue-600 peer-checked:[&_.check-box]:bg-blue-600 peer-checked:[&_.check-icon]:opacity-100">
              <span className="check-box grid h-5 w-5 shrink-0 place-items-center rounded-md border border-app-border bg-app-card transition-colors duration-150" aria-hidden="true">
                <svg className="check-icon h-3.5 w-3.5 text-white opacity-0 transition-opacity duration-150" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3.5 8.5l3 3 6-7" />
                </svg>
              </span>
              <span className="min-w-0 [overflow-wrap:anywhere]">{option.label}</span>
            </span>
          </label>
        ))}
      </div>
      {isSelected('other') && otherValue !== undefined ? (
        <FormField label="Please specify" required={otherRequired}>
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
export default function ApplicationFinancialStep({ answers, onChange }) {
  const set = (key) => (value) => onChange({ ...answers, [key]: value });
  const text = (key) => (event) => set(key)(event.target.value);
  const selection = (key) => (Array.isArray(answers[key]) ? answers[key] : []);
  const toggle = (key) => (option) => {
    const current = selection(key);
    set(key)(current.includes(option) ? current.filter((entry) => entry !== option) : [...current, option]);
  };
  // The answers this submission still needs, from the same rule the readiness gate
  // and "Still needed" read, so an asterisk never disagrees with that list.
  const missingKeys = new Set(getMissingFinancialAnswerKeys(answers));
  const needs = (key) => missingKeys.has(key);

  return (
    <section className="grid gap-3" aria-label="Financial situation">
      <p className="m-0 rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-app-text" role="note">
        These answers are for this application only and are shared with the Admissions Office, not your Department Chair. Enter 0 when an amount does not apply.
      </p>

      <Panel className="grid gap-4 md:grid-cols-2">
        <ChoiceToggle
          fieldKey="otherIncomeAnswer"
          label="Do you have other sources of income?"
          value={answers.otherIncomeAnswer}
          onChange={set('otherIncomeAnswer')}
          options={yesNoAnswerOptions}
          required={needs('otherIncomeAnswer')}
        />
        {answers.otherIncomeAnswer === 'yes' ? (
          <>
            <FormField label="Other income sources" required={needs('otherIncomeSources')}>
              <input className={controlClass} value={answers.otherIncomeSources} onChange={text('otherIncomeSources')} maxLength={300} />
            </FormField>
            <FormField label="Average monthly amount (PHP)" required={needs('otherIncomeMonthly')}>
              <AmountInput value={answers.otherIncomeMonthly} onChange={set('otherIncomeMonthly')} label="Average monthly amount of other income" />
            </FormField>
          </>
        ) : null}
      </Panel>

      <Panel className="grid gap-4 md:grid-cols-2">
        <ChoiceToggle
          fieldKey="difficultyAnswer"
          label="Has your family had financial difficulty in the last 3 months?"
          value={answers.difficultyAnswer}
          onChange={set('difficultyAnswer')}
          options={yesNoAnswerOptions}
          required={needs('difficultyAnswer')}
        />
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
              required={needs('difficultyReasons')}
              otherRequired={needs('difficultyOther')}
            />
            <CheckboxGroup
              legend="How does your family cope?"
              hint="Check as many as apply."
              options={COPING_OPTIONS}
              selected={selection('difficultyCoping')}
              onToggle={toggle('difficultyCoping')}
              otherValue={answers.copingOther}
              onOtherChange={(value) => set('copingOther')(value)}
              required={needs('difficultyCoping')}
              otherRequired={needs('copingOther')}
            />
          </>
        ) : null}
      </Panel>

      <Panel className="grid gap-4 md:grid-cols-2">
        <FormField label="Daily allowance (PHP)" required={needs('allowanceDaily')}>
          <AmountInput value={answers.allowanceDaily} onChange={set('allowanceDaily')} label="Daily allowance" />
        </FormField>
        <ChoiceToggle
          fieldKey="allowanceEnough"
          label="Is your daily allowance enough?"
          value={answers.allowanceEnough}
          onChange={set('allowanceEnough')}
          options={yesNoAnswerOptions}
          required={needs('allowanceEnough')}
        />
        <ChoiceToggle
          fieldKey="foodIntakeAdequacy"
          label="Daily food intake"
          value={answers.foodIntakeAdequacy}
          onChange={set('foodIntakeAdequacy')}
          options={foodIntakeOptions}
          required={needs('foodIntakeAdequacy')}
        />
        <FormField label="Mode of transport to school" required={needs('transportMode')}>
          <select className={controlClass} value={answers.transportMode} onChange={text('transportMode')}>
            <option value="">Select</option>
            {TRANSPORT_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FormField>
        {answers.transportMode === 'other' ? (
          <FormField label="Please specify your mode of transport" className="md:col-span-2" required={needs('transportOther')}>
            <input className={controlClass} value={answers.transportOther} onChange={text('transportOther')} maxLength={100} />
          </FormField>
        ) : null}
        <FormField label="What do you usually eat in a day?" hint="Optional." className="md:col-span-2">
          <input className={controlClass} value={answers.foodIntake} onChange={text('foodIntake')} maxLength={300} />
        </FormField>
      </Panel>

      <Panel className="grid gap-4 md:grid-cols-3">
        <FormField label="Daily food expense (PHP)" required={needs('expenseFood')}>
          <AmountInput value={answers.expenseFood} onChange={set('expenseFood')} label="Daily food expense" />
        </FormField>
        <FormField label="Daily transport expense (PHP)" required={needs('expenseTransport')}>
          <AmountInput value={answers.expenseTransport} onChange={set('expenseTransport')} label="Daily transport expense" />
        </FormField>
        <FormField label="Other daily expenses (PHP)" required={needs('expenseOther')}>
          <AmountInput value={answers.expenseOther} onChange={set('expenseOther')} label="Other daily expenses" />
        </FormField>
      </Panel>
    </section>
  );
}
