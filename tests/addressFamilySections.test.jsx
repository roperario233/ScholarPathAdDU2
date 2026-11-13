import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AddressSection, FamilySection } from '../src/components/ProfileSections';

// The four answers the address and family sections can now prove through the
// Document Vault (VERIFIABLE_ATTRIBUTE_OPTIONS in src/lib/profile.js).
const noop = () => {};

describe('My Profile address and family proofs', () => {
  it('shows a badge and an attach-proof link on each address answer', () => {
    const html = renderToStaticMarkup(
      <AddressSection
        profile={{ completeAddress: 'Roxas Ave, Davao City', residingAddress: 'Board house, Davao City', sameAsCompleteAddress: false }}
        onSave={noop}
        onDirtyChange={noop}
        attributeVerifications={{ completeAddress: 'Verified', residingAddress: 'Unverified' }}
        onAttachProof={noop}
      />,
    );
    expect(html).toContain('Every application asks for a proof of address.');
    expect(html).toContain('Verified');
    // The verified answer needs nothing more; the unverified one is one link away.
    expect((html.match(/Attach proof/g) || []).length).toBe(1);
  });

  it('lists both family proofs in one block', () => {
    const html = renderToStaticMarkup(
      <FamilySection
        profile={{ familyDetails: { fatherName: 'Jose Reyes' } }}
        onSave={noop}
        onDirtyChange={noop}
        attributeVerifications={{ parents: 'Unverified', householdMembers: 'Pending' }}
        onAttachProof={noop}
      />,
    );
    expect(html).toContain('Proof of family details');
    expect(html).toContain('Siblings and household members');
    // An unverified and a pending proof both offer the vault link: the unverified
    // answer asks for a proof, the pending one opens the file already uploaded.
    expect((html.match(/class="proof-action"/g) || []).length).toBe(2);
    expect(html).toContain('Attach proof');
    expect(html).toContain('View proof');
  });

  it('keeps the proof action outside the field label, under the control', () => {
    const html = renderToStaticMarkup(
      <AddressSection
        profile={{ completeAddress: 'Roxas Ave, Davao City' }}
        onSave={noop}
        onDirtyChange={noop}
        attributeVerifications={{ completeAddress: 'Unverified' }}
        onAttachProof={noop}
      />,
    );
    // The badge and its action get their own row under the control: sharing the
    // label line wrapped the header and pushed this control out of line with the
    // field beside it. The action is also a sibling of the <label>, because a
    // button nested in a label is invalid markup and forwards its click to the
    // field control.
    const label = html.indexOf('>Complete address<');
    const labelClose = html.indexOf('</label>', label);
    const control = html.indexOf('Roxas Ave, Davao City');
    const chip = html.indexOf('class="proof-action"');
    expect(label).toBeGreaterThan(-1);
    expect(control).toBeGreaterThan(label);
    expect(labelClose).toBeGreaterThan(control);
    expect(chip).toBeGreaterThan(labelClose);
  });

  it('keeps a saved "none" answer on its toggle and hides the row editors', () => {
    const html = renderToStaticMarkup(
      <FamilySection
        profile={{ familyDetails: { siblingsNone: true, householdAdultsNone: true } }}
        onSave={noop}
        onDirtyChange={noop}
      />,
    );
    expect(html).toContain('No siblings to list');
    expect(html).toContain('No other adults in the household');
    // "None" is a saved answer (validateFamilySection returns both flags), so the
    // draft has to carry it: the toggles open checked instead of snapping back to
    // "no" after a save, and the lists they replace stay hidden.
    expect(html).not.toContain('Add a sibling');
    expect(html).not.toContain('Add another adult in the household');
    expect((html.match(/checked=""/g) || []).length).toBe(2);
  });

  it('offers both household lists while the "none" answers are off', () => {
    const html = renderToStaticMarkup(<FamilySection profile={{ familyDetails: {} }} onSave={noop} onDirtyChange={noop} />);
    expect(html).toContain('Add a sibling');
    expect(html).toContain('Add another adult in the household');
    expect((html.match(/checked=""/g) || []).length).toBe(0);
  });

  it('answers the sibling questions with "Only child"', () => {
    const html = renderToStaticMarkup(
      <FamilySection profile={{ familyDetails: { familyPosition: 'Only child', numberOfSiblings: 0, siblingsNone: true } }} onSave={noop} onDirtyChange={noop} />,
    );
    // The count reads back as a recorded 0 instead of an input, and there is no list
    // to mark "none" on, so neither the toggle nor the row editor is rendered.
    expect(html).toContain('Recorded automatically because you are an only child.');
    expect(html).toContain('so there are no siblings to list');
    expect(html).not.toContain('No siblings to list');
    expect(html).not.toContain('Add a sibling');
    // "Only child" is the only position a sibling total of 0 allows.
    expect(html).not.toContain('Eldest (first-born)');
    expect(html).not.toContain('>Middle child<');
  });

  it('offers the positions the recorded sibling total allows', () => {
    const one = renderToStaticMarkup(
      <FamilySection profile={{ familyDetails: { numberOfSiblings: 1, familyPosition: 'Eldest' } }} onSave={noop} onDirtyChange={noop} />,
    );
    // With one sibling there is no middle to be, and the student is not an only child.
    expect(one).toContain('Eldest (first-born)');
    expect(one).toContain('Youngest (last-born)');
    expect(one).not.toContain('>Middle child<');
    expect(one).not.toContain('>Only child<');
    const two = renderToStaticMarkup(
      <FamilySection profile={{ familyDetails: { numberOfSiblings: 2, familyPosition: 'Middle' } }} onSave={noop} onDirtyChange={noop} />,
    );
    expect(two).toContain('>Middle child<');
    expect(two).not.toContain('>Only child<');
  });

  it('warns when the sibling list is longer than the recorded total', () => {
    const html = renderToStaticMarkup(
      <FamilySection
        profile={{ familyDetails: { numberOfSiblings: 2, familyPosition: 'Eldest', siblings: [{ name: 'A', age: 10 }, { name: 'B', age: 12 }, { name: 'C', age: 14 }] } }}
        onSave={noop}
        onDirtyChange={noop}
      />,
    );
    expect(html).toContain('You listed 3 siblings but recorded 2.');
  });

  it('renders without the proof props, as the staff preview does', () => {
    const html = renderToStaticMarkup(<FamilySection profile={{}} onSave={noop} onDirtyChange={noop} />);
    expect(html).toContain('Proof of family details');
    expect(html).not.toContain('Attach proof');
  });
});
