import { FormField, Panel } from './ui';
import { yesNoAnswerOptions } from '../lib/financialDetails';

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

// The per-application "Financial situation" step of the application workspace
// (FORM 230-SCH: other income, difficulty in the last 3 months, allowance and
// daily expenses). These answers are time-sensitive, so they belong to this
// application rather than the reusable profile, and they go to the Admissions
// Office only.
export default function ApplicationFinancialStep({ answers, onChange, missing = [] }) {
  const set = (key) => (value) => onChange({ ...answers, [key]: value });
  const text = (key) => (event) => set(key)(event.target.value);

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
            <FormField label="What were the reasons?" className="md:col-span-2">
              <textarea rows={3} value={answers.difficultyReasons} onChange={text('difficultyReasons')} maxLength={300} />
            </FormField>
            <FormField label="How does your family cope?" className="md:col-span-2">
              <textarea rows={3} value={answers.difficultyCoping} onChange={text('difficultyCoping')} maxLength={300} />
            </FormField>
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
        <FormField label="What do you usually eat in a day?" className="md:col-span-2">
          <input className={controlClass} value={answers.foodIntake} onChange={text('foodIntake')} maxLength={300} />
        </FormField>
        <FormField label="Mode of transport to school">
          <input className={controlClass} value={answers.transportMode} onChange={text('transportMode')} maxLength={100} />
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
