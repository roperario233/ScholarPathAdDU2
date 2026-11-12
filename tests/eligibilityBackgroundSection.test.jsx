import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BackgroundSection } from '../src/components/ProfileSections';

// The retired "Household and financial aid" section now lives here: the household
// income, the Exclusion Flag Hierarchy toggles, and the grant list those toggles
// open (isGrantListActive in src/lib/profile.js).
const noop = () => {};
const GRANT_LIST = 'Add a grant applied for or received';
const settledVerifications = {
  householdIncome: 'Verified',
  citizenship: 'Verified',
  ipCommunity: 'No proof needed',
  pwd: 'No proof needed',
  employed: 'No proof needed',
  honorsRank: 'No proof needed',
};

const render = (profile = {}, attributeVerifications = settledVerifications) => renderToStaticMarkup(
  <BackgroundSection
    profile={profile}
    onSave={noop}
    onDirtyChange={noop}
    attributeVerifications={attributeVerifications}
    onAttachProof={noop}
  />,
);

describe('My Profile Eligibility background', () => {
  it('carries the household income and all four exclusion answers', () => {
    const html = render();
    expect(html).toContain('Annual household income');
    expect(html).toContain('Financial aid already received');
    expect(html).toContain('Active government grant');
    expect(html).toContain('Another active scholarship');
    expect(html).toContain('Prepaid tuition plan');
    expect(html).toContain('Sibling on AdDU financial aid');
  });

  it('keeps the grant list closed until an answer says the student receives aid', () => {
    expect(render()).not.toContain(GRANT_LIST);
    // A sibling on AdDU financial aid is about the sibling, so it does not open it.
    expect(render({ hasSiblingOnAid: true })).not.toContain(GRANT_LIST);
  });

  it.each([
    ['active government grant', { hasActiveGovernmentGrant: true }],
    ['another active scholarship', { hasOtherActiveScholarship: true }],
    ['prepaid tuition plan', { isOnPrepaidPlan: true }],
  ])('opens the grant list for %s', (_label, profile) => {
    const html = render(profile);
    expect(html).toContain(GRANT_LIST);
    expect(html).toContain('At least one grant is required');
  });

  it('keeps a saved grant reachable after every toggle is switched off', () => {
    const html = render({ previousGrants: [{ type: 'Government', name: 'CHED', status: 'accepted', institution: 'CHED', amount: 12000 }] });
    expect(html).toContain(GRANT_LIST);
    expect(html).toContain('CHED');
  });

  it('shows the recorded household income value', () => {
    expect(render({ householdIncome: 240000 })).toContain('240000');
  });

  it('badges the household income and offers its vault link', () => {
    // Every other answer is settled, so the only action left belongs to the income.
    expect(render()).not.toContain('Attach proof');
    const unverified = render({}, { ...settledVerifications, householdIncome: 'Unverified' });
    expect((unverified.match(/Attach proof/g) || []).length).toBe(1);
  });

  it('asks the two-answer questions as toggles instead of dropdowns', () => {
    const html = render();
    // Citizenship, IP community, PWD, community service, and the financial-aid
    // question are each one segmented pair, so five radio groups in all.
    expect((html.match(/role="radiogroup"/g) || []).length).toBe(5);
    ['Filipino', 'Non-Filipino', 'Yes', 'No'].forEach((label) => expect(html).toContain(`>${label}<`));
    // The multi-answer questions keep their pickers.
    expect(html).toContain('Employment status');
    expect(html).toContain('Graduating honors standing');
  });

  it('carries the chosen answer on its pill and leaves the rest clear', () => {
    const answered = render({ citizenship: 'Filipino', ipCommunity: 'Yes' });
    // One checked radio per answered question: citizenship and IP community.
    expect((answered.match(/checked=""/g) || []).length).toBe(2);
    expect(render({}).match(/checked=""/g)).toBeNull();
  });

  it('compares the parents’ saved incomes with the declared household income', () => {
    const finances = { father: { employmentStatus: 'employed', annualIncome: 250000 }, mother: { employmentStatus: 'employed', annualIncome: 50000 } };
    const over = render({ householdIncome: 200000, financialProfile: finances });
    expect(over).toContain("Parents&#x27; incomes add up to");
    expect(over).toContain('which is more than the');
    expect(over).toContain('This discrepancy will be reflected on your application.');
    // A household total above the parents' share is normal and only explained.
    const under = render({ householdIncome: 400000, financialProfile: finances });
    expect(under).toContain('the rest may come from another household member');
    expect(under).not.toContain('This discrepancy will be reflected on your application.');
    // Nothing to compare before both figures exist.
    expect(render({ householdIncome: 200000 })).not.toContain('Parents&#x27; incomes add up to');
  });

  it('points at Household finances from the income note', () => {
    const html = renderToStaticMarkup(
      <BackgroundSection
        profile={{ householdIncome: 200000, financialProfile: { father: { employmentStatus: 'employed', annualIncome: 250000 } } }}
        onSave={noop}
        onDirtyChange={noop}
        onOpenSection={noop}
      />,
    );
    expect(html).toContain('Review parent incomes');
  });
});
