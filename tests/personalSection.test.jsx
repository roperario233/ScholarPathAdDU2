import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PersonalSection } from '../src/components/ProfileSections';

const noop = () => {};

const render = (profile = {}, role = 'student') => renderToStaticMarkup(
  <PersonalSection
    profile={{ fullName: 'Ana Reyes', email: 'ana@addu.edu.ph', department: 'School of Arts and Sciences (SAS)', ...profile }}
    role={role}
    roleLabel={role === 'student' ? 'Student' : 'Admissions Office Staff'}
    onSave={noop}
    onDirtyChange={noop}
  />,
);

describe('My Profile personal information', () => {
  it('drops the short bio and keeps the statement/essay template', () => {
    const html = render({ essay: 'Draft text' });
    expect(html).not.toContain('Short bio');
    expect(html).toContain('Default statement/essay');
    // The statement/essay is the only free-text template left in the section.
    expect((html.match(/<textarea/g) || []).length).toBe(1);
  });

  it('shows no bio or statement field to a staff account', () => {
    const html = render({}, 'admissions_office');
    expect(html).not.toContain('Short bio');
    expect(html).not.toContain('Default statement/essay');
  });

  it('renders the composed full name as a read-only control', () => {
    const html = render({ lastName: 'Reyes', firstName: 'Ana' });
    expect(html).toContain('class="readonly-control"');
    expect(html).toContain('Reyes, Ana');
  });

  it('offers the expanded religion list and asks an "Other" answer to be named', () => {
    const html = render({});
    expect(html).toContain('Seventh-day Adventist');
    expect(html).toContain('Jehovah');
    expect(html).toContain('No religion / atheist / agnostic');
    // The free-text field appears only for "Other", so the select's own label is
    // the one thing both renderings share.
    expect(render({ religion: 'Other', religionOther: 'Baha’i' })).toContain('Religion you follow');
    expect(render({ religion: 'Other', religionOther: 'Baha’i' })).toContain('Baha’i');
    expect(render({ religion: 'Islam' })).not.toContain('Religion you follow');
    // Staff answer only their name and mobile number.
    expect(render({}, 'admissions_office')).not.toContain('Religion you follow');
  });
});
