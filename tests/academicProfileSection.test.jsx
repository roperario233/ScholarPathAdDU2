import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AcademicSection } from '../src/components/ProfileSections';

const programs = [
  { value: 'BS Information Technology', label: 'BS Information Technology', school: 'School of Arts and Sciences (SAS)', cluster: 'Computer Studies', department: 'Information Technology and Information Systems Department' },
  { value: 'BS Accountancy', label: 'BS Accountancy', school: 'School of Business and Governance (SBG)', cluster: 'Accountancy', department: 'Accountancy Department' },
  { value: 'BS Nursing', label: 'BS Nursing', school: 'School of Nursing (SON)', cluster: null, department: 'Nursing Department' },
];

const render = (profile) => renderToStaticMarkup(
  <AcademicSection
    profile={{ fullName: 'Ana Reyes', degreeProgram: 'BS Information Technology', academicStanding: 'good', ...profile }}
    academicPrograms={programs}
    onSave={() => {}}
    onDirtyChange={() => {}}
  />,
);

describe('My Profile academic profile', () => {
  it('leaves the year standing out entirely for an incoming first-year', () => {
    const html = render({ yearStanding: 'incoming-1st', isTransferee: 'No', hsStrand: 'STEM', hsAverage: '94' });
    // The applicant status already answers the year, so there is no control and no
    // read-only echo of it.
    expect(html).not.toContain('Year standing');
    expect(html).not.toContain('Incoming 1st year');
    expect(html).not.toContain('Choose year standing');
    // A ranked list belongs to the incoming first-year, and so do the senior high
    // school answers.
    expect(html).toContain('Ranked program choices');
    expect(html).toContain('Senior high school strand');
    expect(html).toContain('Senior high school last attended');
  });

  it('offers only the continuing years, and no ranked choices, to an enrolled student', () => {
    const html = render({ yearStanding: '2nd', isTransferee: 'No', studentNumber: '2023001', qpi: '3.2' });
    expect(html).toContain('Year standing');
    expect(html).toContain('Incoming 2nd year');
    expect(html).not.toContain('Incoming 1st year');
    expect(html).not.toContain('Ranked program choices');
    expect(html).toContain('AdDU student number');
  });

  it('hides the senior high school answers from a current Ateneo student', () => {
    const html = render({ yearStanding: '3rd', isTransferee: 'No', studentNumber: '2023001', qpi: '3.2', hsStrand: 'STEM' });
    // They are already in college: neither the strand nor a previous school is asked.
    expect(html).not.toContain('Senior high school strand');
    expect(html).not.toContain('Senior high school general average');
    expect(html).not.toContain('Senior high school last attended');
    expect(html).not.toContain('School last attended');
  });

  it('asks for the year again when a saved 1st year standing is no longer offered', () => {
    const html = render({ yearStanding: '1st', isTransferee: 'No', studentNumber: '2023001', qpi: '3.2' });
    expect(html).toContain('Your saved 1st year standing is no longer offered');
    expect(html).not.toContain('Incoming 1st year');
  });

  it('never asks a transferee for an AdDU student number', () => {
    const html = render({ yearStanding: '2nd', isTransferee: 'Yes', studentNumber: '', qpi: '3.2' });
    expect(html).toContain('Year standing');
    expect(html).not.toContain('AdDU student number');
    // The college last attended is what a transferee reports instead, and the senior
    // high school strand is not asked of them.
    expect(html).toContain('College last attended');
    expect(html).not.toContain('Senior high school strand');
    expect(html).not.toContain('Senior high school last attended');
  });

  it('keeps every standing available while the applicant status is unanswered', () => {
    const html = render({ yearStanding: '', isTransferee: '' });
    expect(html).toContain('Incoming 1st year');
    expect(html).toContain('Incoming 2nd year');
  });
});

describe('My Profile academic profile hierarchy', () => {
  it('shows all four levels for a clustered program', () => {
    const html = render({ yearStanding: '2nd', isTransferee: 'No', studentNumber: '2023001', qpi: '3.2' });
    // School -> Cluster -> Department, with the program itself in the picker.
    expect(html).toContain('School of Arts and Sciences (SAS)');
    expect(html).toContain('Computer Studies');
    expect(html).toContain('Information Technology and Information Systems Department');
    expect(html).toContain('BS Information Technology');
    // The old misnamed row is gone.
    expect(html).not.toContain('School / Department');
    expect(html).not.toContain('College of');
  });

  it('leaves the cluster out for a school that has no sub-clusters', () => {
    const html = renderToStaticMarkup(
      <AcademicSection
        profile={{ fullName: 'Ana Reyes', degreeProgram: 'BS Nursing', yearStanding: '2nd', isTransferee: 'No', studentNumber: '2023001', qpi: '3.2', academicStanding: 'good' }}
        academicPrograms={programs}
        onSave={() => {}}
        onDirtyChange={() => {}}
      />,
    );
    expect(html).toContain('School of Nursing (SON)');
    expect(html).toContain('Nursing Department');
    expect(html).not.toContain('>Cluster<');
  });
});
