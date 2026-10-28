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
    // An unverified and a pending proof both offer the vault link.
    expect((html.match(/Attach proof/g) || []).length).toBe(2);
  });

  it('renders without the proof props, as the staff preview does', () => {
    const html = renderToStaticMarkup(<FamilySection profile={{}} onSave={noop} onDirtyChange={noop} />);
    expect(html).toContain('Proof of family details');
    expect(html).not.toContain('Attach proof');
  });
});
