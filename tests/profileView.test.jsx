import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ProfileView from '../src/pages/ProfileView';
import { FamilySection } from '../src/components/ProfileSections';
import { academicPrograms } from '../src/lib/academicPrograms';

// My Profile is the student's application form (FORM 230-SCH): a numbered,
// status-marked section menu, a Continue action, and a progress strip. Staff keep
// the plain profile page.
const noop = () => {};

const student = {
  fullName: 'Ana Reyes',
  phone: '0917 123 4567',
  degreeProgram: 'BS Information Technology',
  yearStanding: '2nd',
  studentNumber: '202300001',
  qpi: 3.2,
  householdIncome: 180000,
  citizenship: 'Filipino',
  academicStanding: 'good',
  civilStatus: '',
  completeAddress: 'Roxas Ave, Davao City',
  ipCommunity: 'No',
  pwd: 'No',
  employed: 'Not employed',
  isTransferee: 'No',
  birthdate: '',
  sexAtBirth: 'Female',
  communityService: 'Yes',
  familyDetails: { fatherName: 'Jose Reyes', motherName: 'Maria Reyes' },
  financialProfile: {
    economicStatus: 'lower',
    father: { employmentStatus: 'employed', annualIncome: 120000 },
    mother: { employmentStatus: 'unemployed', annualIncome: 0 },
  },
};

// React separates adjacent text nodes with `<!-- -->`; drop them so a phrase
// built from several expressions reads as one string.
const render = (props) => renderToStaticMarkup(
  <ProfileView avatar={{ url: 'https://example.test/avatar.jpg' }} onSaveProfile={noop} onFindScholarship={noop} {...props} />,
).replace(/<!-- -->/g, '');

describe('My Profile as the application form', () => {
  it('frames the student page as the application form with a numbered, status-marked menu', () => {
    const html = render({ profile: student, role: 'student', attributeVerifications: { parents: 'Rejected' } });
    expect(html).toContain('Your scholarship application form');
    expect(html).toContain('Every AdDU scholarship application you submit copies these answers.');
    // The title bar no longer carries the profile photo.
    expect(html).not.toContain('https://example.test/avatar.jpg');
    // Two missing Personal information answers; the family proof was reverted.
    expect(html).toContain('2 left');
    expect(html).toContain('Reverted');
    expect(html).toContain(': Needs attention, 1 proof to replace');
    expect(html).toContain('Continue: Personal information');
    expect(html).toContain('21 of 23');
    expect(html).toContain('>Application form<');
    expect(html).toContain('Your application form');
  });

  it('offers a scholarship search once every part is complete', () => {
    const html = render({ profile: { ...student, civilStatus: 'Single', birthdate: '2005-04-12' }, role: 'student' });
    expect(html).toContain('Ready');
    expect(html).toContain('to apply');
    expect(html).toContain('Find a scholarship');
    expect(html).not.toContain('Continue:');
  });

  it('tags the answers a Scholarship Explorer link can highlight', () => {
    const background = render({ profile: student, role: 'student', initialSection: 'background', initialField: 'householdIncome' });
    expect(background).toContain('data-field="householdIncome"');
    expect(background).toContain('data-field="citizenship"');
    expect(background).toContain('data-field="hasActiveGovernmentGrant hasOtherActiveScholarship isOnPrepaidPlan hasSiblingOnAid"');
    const academic = render({ profile: student, role: 'student', initialSection: 'academic', academicPrograms });
    expect(academic).toContain('data-field="degreeProgram"');
    expect(academic).toContain('data-field="qpi"');
  });

  it('marks an unanswered required answer with a red asterisk', () => {
    const personal = render({ profile: student, role: 'student', initialSection: 'personal' });
    // The fixture leaves civil status and birthdate blank, so exactly those two
    // required answers are marked; the answered mobile number is not.
    expect(personal.match(/\(required\)/g)).toHaveLength(2);
    expect(personal).toContain('are still missing.');
    const answered = render({
      profile: { ...student, civilStatus: 'Single', birthdate: '2005-04-12' },
      role: 'student',
      initialSection: 'personal',
    });
    expect(answered).not.toContain('(required)');
  });

  it('keeps the plain profile page for staff', () => {
    const html = render({ profile: { fullName: 'Office Staff', phone: '' }, role: 'admissions_office' });
    expect(html).toContain('Profile and account details');
    expect(html).toContain('Profile complete');
    expect(html).not.toContain('Your scholarship application form');
    expect(html).not.toContain('Continue:');
  });
});

describe('Family details unknown parent', () => {
  it('replaces an unknown parent’s fields with the toggle', () => {
    const html = renderToStaticMarkup(
      <FamilySection profile={{ familyDetails: { fatherUnknown: true, motherName: 'Maria Reyes' } }} onSave={noop} onDirtyChange={noop} />,
    );
    expect(html).toContain('Father is unknown or not listed');
    expect(html).not.toContain('Father&#x27;s name');
    expect(html).toContain('Mother&#x27;s name');
    expect(html).toContain('Needed to apply.');
  });
});
