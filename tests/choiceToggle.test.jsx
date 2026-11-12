import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChoiceToggle, FormField } from '../src/components/ui';

// A two-answer question as a segmented pair of pills (My Profile's citizenship,
// IP community, PWD, community service, financial-aid, and sex-at-birth answers).
const options = [
  { value: '', label: 'Select' },
  { value: 'Yes', label: 'Yes' },
  { value: 'No', label: 'No' },
];
const noop = () => {};

const render = (props = {}) => renderToStaticMarkup(
  <ChoiceToggle label="Person with Disability (PWD)" fieldKey="pwd" options={options} onChange={noop} {...props} />,
);

describe('ChoiceToggle', () => {
  it('renders one pill per answer and leaves the blank placeholder out', () => {
    const html = render();
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('>Yes<');
    expect(html).toContain('>No<');
    // "Select" is a <select> placeholder, not an answer a student can pick.
    expect(html).not.toContain('>Select<');
    expect((html.match(/type="radio"/g) || []).length).toBe(2);
    // Both radios belong to one group, so arrow keys move between them.
    expect((html.match(/name="pwd"/g) || []).length).toBe(2);
  });

  it('checks only the recorded answer', () => {
    expect(render({ value: 'Yes' }).match(/checked=""/g)).toHaveLength(1);
    // An unanswered question leaves both pills clear, so the required star and the
    // blank still read as "not answered" instead of a silent "No".
    expect(render({}).match(/checked=""/g)).toBeNull();
  });

  it('keeps each pill label a sibling, never nested in the field label', () => {
    const html = render();
    const firstOpen = html.indexOf('<label');
    const firstClose = html.indexOf('</label>');
    const secondOpen = html.indexOf('<label', firstOpen + 1);
    // The pills come after the group container, and no pill sits inside another
    // label: the field header would otherwise forward its clicks to the first pill.
    expect(firstOpen).toBeGreaterThan(html.indexOf('role="radiogroup"'));
    expect(secondOpen).toBeGreaterThan(firstClose);
  });

  it('carries the required mark, the hint, and the error the form gives it', () => {
    const html = render({ required: true, hint: 'Needed to apply.', error: 'Choose a PWD option.' });
    expect(html).toContain('(required)');
    expect(html).toContain('Needed to apply.');
    expect(html).toContain('role="alert"');
  });

  it('keeps an adornment (the proof chip) under the control, not in the label', () => {
    const html = render({ labelAdornment: <span className="proof-slot">Proof</span> });
    expect(html).toContain('proof-slot');
    expect(html.indexOf('proof-slot')).toBeGreaterThan(html.indexOf('</label>'));
  });

  it('lets a plain field keep its label wrapper', () => {
    const html = renderToStaticMarkup(<FormField label="Full name"><input /></FormField>);
    expect(html).toContain('<label');
    expect(html).not.toContain('role="group"');
  });
});
