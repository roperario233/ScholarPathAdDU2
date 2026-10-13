import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REQUIRED_DOCUMENTS,
  buildProfileSnapshot,
  describeApplicantAcademic,
  getApplicationReadiness,
  getCatalogRequirements,
  getDocumentChecklist,
  getProfileSnapshotSections,
  getRequirementUploadPreset,
  getScholarshipRequirements,
  normalizeRequirements,
  pickDefaultAttachments,
} from '../src/lib/applicationRequirements';
import { documentTypeOptions } from '../src/lib/constants';

const continuingProfile = {
  fullName: 'Ana Reyes',
  studentNumber: '2023-00001',
  degreeProgram: 'BS Information Technology',
  department: 'School of Engineering and Architecture',
  yearStanding: '2nd',
  qpi: 3.2,
  householdIncome: 180000,
  citizenship: 'Filipino',
  academicStanding: 'good',
};

const incomingProfile = {
  ...continuingProfile,
  yearStanding: 'incoming-1st',
  studentNumber: '',
  qpi: null,
  hsStrand: 'STEM',
  hsAverage: 92,
};

const gia = {
  id: 'gia',
  title: 'Grant-in-Aid (GIA)',
  ruleFamily: 'general-pool',
  category: 'Internal Endowment',
  isActive: true,
  minimumQpi: 2.5,
  maximumIncome: 250000,
  deadline: '2999-12-31',
};

const external = { id: 'dost', title: 'DOST-SEI Merit Scholarship', ruleFamily: 'government-linked', isExternal: true, isActive: true };

const doc = (id, documentType, verificationStatus = 'Pending', uploadedAt = '2026-10-01') => ({ id, documentType, verificationStatus, uploadedAt });

const ids = (items) => items.map((item) => item.id);

describe('scholarship requirements', () => {
  it('uses only vault document types the vault knows about', () => {
    const known = new Set(documentTypeOptions.map((option) => option.value));
    Object.values(DEFAULT_REQUIRED_DOCUMENTS).flat().forEach((item) => {
      item.documentTypes.forEach((type) => expect(known.has(type)).toBe(true));
    });
  });

  it('filters the defaults by year standing', () => {
    const continuing = ids(getScholarshipRequirements(gia, continuingProfile));
    const incoming = ids(getScholarshipRequirements(gia, incomingProfile));
    expect(continuing).toContain('college-grades');
    expect(continuing).not.toContain('entrance-exam');
    expect(continuing).not.toContain('hs-report-card');
    expect(incoming).toEqual(expect.arrayContaining(['entrance-exam', 'hs-report-card', 'recommendation']));
    expect(incoming).not.toContain('college-grades');
    expect(incoming).toContain('application-form');
  });

  it('falls back to the rule family resolved from the title', () => {
    expect(ids(getCatalogRequirements({ title: 'Jubilee Scholarship Fund (Valedictorian & Salutatorian)' }))).toContain('certificate-of-award');
  });

  it('prefers the catalog list when the Admissions Office set one', () => {
    const custom = { ...gia, requiredDocuments: [{ id: 'only', label: 'Application Form', documentTypes: ['Application Form'], standing: 'all' }] };
    expect(ids(getScholarshipRequirements(custom, continuingProfile))).toEqual(['only']);
  });

  it('drops malformed catalog items and defaults the standing', () => {
    expect(normalizeRequirements([{ label: 'x' }, null, { label: 'Form', documentTypes: ['Application Form'], standing: 'nope' }]))
      .toEqual([{ id: 'requirement-1', label: 'Form', documentTypes: ['Application Form'], standing: 'all' }]);
  });

  it('asks nothing of external and government-linked entries', () => {
    expect(getScholarshipRequirements(external, continuingProfile)).toEqual([]);
  });
});

describe('default attachments', () => {
  it('picks the newest non-rejected file per requirement', () => {
    const requirements = getScholarshipRequirements(gia, continuingProfile);
    const documents = [
      doc('old-form', 'Application Form', 'Verified', '2026-01-01'),
      doc('new-form', 'Application Form', 'Pending', '2026-09-01'),
      doc('bad-income', 'Income Proof', 'Rejected', '2026-09-02'),
    ];
    expect(pickDefaultAttachments(requirements, documents)).toEqual(['new-form']);
  });
});

describe('application readiness', () => {
  const requirements = getScholarshipRequirements(gia, continuingProfile);
  const allDocs = requirements.map((item, index) => doc(`d${index}`, item.documentTypes[0]));
  const complete = { attachedDocuments: allDocs.map((entry) => entry.id), statement: 'I need support to continue my studies.' };

  it('is ready once every requirement is attached, the statement is written, and the student certifies', () => {
    const result = getApplicationReadiness({ application: complete, scholarship: gia, documents: allDocs, profile: continuingProfile, certified: true });
    expect(result.route).toBe('internal');
    expect(result.blockers).toEqual([]);
    expect(result.ready).toBe(true);
    expect(result.attachedCount).toBe(result.requiredCount);
  });

  it('blocks submission until certification', () => {
    const result = getApplicationReadiness({ application: complete, scholarship: gia, documents: allDocs, profile: continuingProfile });
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(['Certify that your information and documents are true and complete.']);
  });

  it('reports missing documents and a blank statement', () => {
    const result = getApplicationReadiness({ application: { attachedDocuments: [], statement: '  ' }, scholarship: gia, documents: allDocs, profile: continuingProfile, certified: true });
    expect(result.requirements.every((item) => item.state === 'missing')).toBe(true);
    expect(result.blockers[0]).toMatch(/^Attach \d+ required documents/);
    expect(result.blockers).toContain('Write your application statement.');
  });

  it('treats a requirement whose only file was rejected as needing replacement', () => {
    const documents = allDocs.map((entry, index) => (index === 0 ? { ...entry, verificationStatus: 'Rejected' } : entry));
    const result = getApplicationReadiness({ application: complete, scholarship: gia, documents, profile: continuingProfile, certified: true });
    expect(result.requirements[0].state).toBe('rejected');
    expect(result.blockers.some((blocker) => blocker.startsWith('Replace the rejected file'))).toBe(true);
  });

  it('marks verified files and allows pending ones', () => {
    const documents = allDocs.map((entry, index) => (index === 0 ? { ...entry, verificationStatus: 'Verified' } : entry));
    const result = getApplicationReadiness({ application: complete, scholarship: gia, documents, profile: continuingProfile, certified: true });
    expect(result.requirements[0].state).toBe('verified');
    expect(result.requirements[1].state).toBe('attached');
    expect(result.ready).toBe(true);
  });

  it('blocks a closed scholarship', () => {
    const result = getApplicationReadiness({ application: complete, scholarship: { ...gia, deadline: '2020-01-01' }, documents: allDocs, profile: continuingProfile, certified: true });
    expect(result.blockers).toContain('This scholarship is no longer accepting applications.');
  });

  it('re-runs the eligibility gate on the current profile', () => {
    const result = getApplicationReadiness({ application: complete, scholarship: gia, documents: allDocs, profile: { ...continuingProfile, householdIncome: 900000 }, certified: true });
    expect(result.ready).toBe(false);
    expect(result.blockers.some((blocker) => blocker.startsWith('Eligibility:'))).toBe(true);
  });

  it('tracks external entries without a submit route', () => {
    const result = getApplicationReadiness({ application: {}, scholarship: external, documents: [], profile: continuingProfile, certified: true });
    expect(result).toMatchObject({ route: 'external', ready: false, requirements: [] });
  });
});

describe('profile snapshot', () => {
  it('captures the QPI for an enrolled student with its verification badge', () => {
    const snapshot = buildProfileSnapshot(continuingProfile, { qpi: 'Verified' }, '2026-10-12T00:00:00.000Z');
    expect(snapshot).toMatchObject({
      capturedAt: '2026-10-12T00:00:00.000Z',
      fullName: 'Ana Reyes',
      yearStanding: '2nd',
      yearStandingLabel: '2nd year',
      academic: { credential: 'qpi', value: 3.2, verification: 'Verified' },
      householdIncome: { value: 180000, verification: 'Unverified' },
      citizenship: { value: 'Filipino', verification: 'Unverified' },
    });
  });

  it('captures the senior high school average for an incoming first-year', () => {
    const snapshot = buildProfileSnapshot(incomingProfile, {});
    expect(snapshot.academic).toMatchObject({ credential: 'hsAverage', label: 'Senior high school general average', value: 92 });
    expect(snapshot.yearStandingLabel).toBe('Incoming 1st year');
  });

  const fullProfile = {
    ...continuingProfile,
    honorsRank: 'Valedictorian',
    graduatingClassSize: '120',
    hasSiblingOnAid: true,
    ipCommunity: 'Yes',
    pwd: 'No',
    employed: 'Part-time',
    civilStatus: 'Single',
    religion: 'Roman Catholic',
    completeAddress: 'Roxas Ave, Davao City',
    sameAsCompleteAddress: true,
    residingAddress: '',
    country: 'Philippines',
    familyDetails: { fatherName: 'Jose Reyes', fatherOccupation: 'Driver', fatherDeceased: false, motherName: 'Maria Reyes', motherDeceased: true, familyPosition: 'Eldest', numberOfSiblings: '2' },
    essay: 'My default statement.',
  };

  it('freezes the eligibility answers, background, personal, address, and family groups', () => {
    const snapshot = buildProfileSnapshot(fullProfile, { honorsRank: 'Verified', pwd: 'Pending' });
    expect(snapshot.version).toBe(2);
    expect(snapshot.eligibility).toEqual({
      academicStanding: { value: 'good', verification: 'Unverified' },
      honorsRank: { value: 'Valedictorian', verification: 'Verified' },
      graduatingClassSize: 120,
      isOnPrepaidPlan: false,
      hasSiblingOnAid: true,
      hasOtherActiveScholarship: false,
    });
    expect(snapshot.background.pwd).toEqual({ value: 'No', verification: 'Pending' });
    expect(snapshot.personal).toEqual({ civilStatus: 'Single', religion: 'Roman Catholic' });
    expect(snapshot.address).toEqual({ completeAddress: 'Roxas Ave, Davao City', residingAddress: 'Roxas Ave, Davao City', country: 'Philippines' });
    expect(snapshot.family).toMatchObject({ fatherName: 'Jose Reyes', motherDeceased: true, numberOfSiblings: 2 });
    expect(JSON.stringify(snapshot)).not.toContain('My default statement.');
  });

  it('adds the strand and ranked program choices only for an incoming first-year', () => {
    expect(buildProfileSnapshot(fullProfile).eligibility).not.toHaveProperty('programChoices');
    const incoming = buildProfileSnapshot({ ...incomingProfile, programChoice2: 'BS Accountancy' });
    expect(incoming.eligibility).toMatchObject({ hsStrand: 'STEM', programChoices: ['BS Accountancy', ''] });
  });
});

describe('profile snapshot sections', () => {
  it('labels every group the student and reviewers see', () => {
    const { legacy, sections } = getProfileSnapshotSections(buildProfileSnapshot({
      ...continuingProfile,
      employed: 'Part-time',
      familyDetails: { motherName: 'Maria Reyes', motherOccupation: 'Vendor', motherDeceased: true },
    }, { qpi: 'Verified' }));
    expect(legacy).toBe(false);
    expect(sections.map((section) => section.key)).toEqual(['application', 'eligibility', 'background', 'personal', 'family']);
    const rows = Object.fromEntries(sections.flatMap((section) => section.rows).map((row) => [row.label, row]));
    expect(rows['Annual QPI']).toEqual({ label: 'Annual QPI', value: '3.20', verification: 'Verified' });
    expect(rows['Household income'].value).toBe('₱180,000');
    expect(rows['Academic standing'].value).toBe('Good academic standing');
    expect(rows['Employment status'].value).toBe('Part-time employed');
    expect(rows['Sibling on AdDU financial aid'].value).toBe('No');
    expect(rows.Mother.value).toBe('Maria Reyes · Vendor · Deceased');
  });

  it('shows only the original fields for a snapshot submitted before the extended groups', () => {
    const current = buildProfileSnapshot(continuingProfile);
    const legacyKeys = ['capturedAt', 'fullName', 'studentNumber', 'degreeProgram', 'department', 'yearStanding', 'yearStandingLabel', 'academic', 'householdIncome', 'citizenship'];
    const { legacy, sections } = getProfileSnapshotSections(Object.fromEntries(legacyKeys.map((key) => [key, current[key]])));
    expect(legacy).toBe(true);
    expect(sections).toHaveLength(1);
    expect(sections[0].rows.map((row) => row.label)).toEqual(['Name', 'Student number', 'Program', 'Year standing', 'Annual QPI', 'Household income', 'Citizenship']);
  });

  it('is empty without a snapshot', () => {
    expect(getProfileSnapshotSections(null)).toEqual({ legacy: false, sections: [] });
  });
});

describe('supporting documents', () => {
  const requirements = getScholarshipRequirements(gia, continuingProfile);
  const required = requirements.map((item, index) => doc(`d${index}`, item.documentTypes[0]));
  const pwdId = doc('pwd-id', 'PWD ID');
  const extraTranscript = doc('extra-transcript', 'Transcript');
  const application = { attachedDocuments: [...required, pwdId, extraTranscript].map((entry) => entry.id), statement: 'Statement.' };

  it('lists attached files that match no requirement without changing readiness', () => {
    const result = getApplicationReadiness({ application, scholarship: gia, documents: [...required, pwdId, extraTranscript], profile: continuingProfile, certified: true });
    expect(ids(result.supportingDocuments)).toEqual(['pwd-id']);
    expect(result.ready).toBe(true);
    expect(result.attachedCount).toBe(result.requiredCount);
  });

  it('is empty for tracked external entries', () => {
    expect(getApplicationReadiness({ application, scholarship: external, documents: [pwdId], profile: continuingProfile }).supportingDocuments).toEqual([]);
  });
});

describe('applicant academic summary', () => {
  it('shows the frozen senior high school average for an incoming first-year and the QPI otherwise', () => {
    expect(describeApplicantAcademic({ studentQpi: null, profileSnapshot: buildProfileSnapshot(incomingProfile) })).toBe('SHS average 92');
    expect(describeApplicantAcademic({ studentQpi: 3.2, profileSnapshot: buildProfileSnapshot(continuingProfile) })).toBe('QPI 3.2');
    expect(describeApplicantAcademic({ studentQpi: null })).toBe('QPI —');
  });
});

describe('My Profile document checklist', () => {
  const today = new Date('2026-10-12T00:00:00');
  const jubilee = { id: 'jubilee', title: 'Jubilee Scholarship Fund (Valedictorian & Salutatorian)', ruleFamily: 'honors', category: 'Internal Endowment', isActive: true, deadline: '2999-12-31' };
  const sa = { id: 'sa', title: 'Student Assistant (SA) Program', ruleFamily: 'work-study', category: 'Internal Endowment', isActive: true, deadline: '2999-12-31' };
  const closed = { ...gia, id: 'gia-closed', deadline: '2000-01-01' };
  const inactive = { ...gia, id: 'gia-inactive', isActive: false };
  const keyOf = (items, id) => items.find((item) => item.id === id);

  it('merges the open internal scholarships into one list per document', () => {
    const checklist = getDocumentChecklist({ scholarships: [gia, jubilee, sa, closed, inactive, external], profile: continuingProfile, today });
    expect(checklist.scholarships.map((item) => item.id)).toEqual(['gia', 'jubilee', 'sa']);
    expect(ids(checklist.items)).toEqual(['application-form', 'college-grades', 'income-proof', 'residence-photos', 'good-moral', 'certificate-of-award']);
    expect(keyOf(checklist.items, 'application-form').askedByAll).toBe(true);
    expect(keyOf(checklist.items, 'income-proof').scholarships.map((item) => item.id)).toEqual(['gia', 'sa']);
    expect(keyOf(checklist.items, 'income-proof').notAskedBy).toEqual([{ id: 'jubilee', title: jubilee.title }]);
    expect(keyOf(checklist.items, 'application-form').notAskedBy).toEqual([]);
    expect(keyOf(checklist.items, 'certificate-of-award')).toMatchObject({ askedByAll: false, scholarships: [{ id: 'jubilee', title: jubilee.title }] });
  });

  it('follows the year standing', () => {
    const incoming = ids(getDocumentChecklist({ scholarships: [gia], profile: incomingProfile, today }).items);
    expect(incoming).toEqual(expect.arrayContaining(['entrance-exam', 'hs-report-card', 'recommendation']));
    expect(incoming).not.toContain('college-grades');
    const continuing = ids(getDocumentChecklist({ scholarships: [gia], profile: continuingProfile, today }).items);
    expect(continuing).toContain('college-grades');
    expect(continuing).not.toContain('hs-report-card');
  });

  it('reads each document against the whole vault', () => {
    const documents = [doc('a', 'Application Form', 'Verified'), doc('t', 'Transcript'), doc('i', 'Income Proof', 'Rejected')];
    const checklist = getDocumentChecklist({ scholarships: [gia, jubilee, sa], profile: continuingProfile, documents, today });
    expect(Object.fromEntries(checklist.items.map((item) => [item.id, item.state]))).toEqual({
      'application-form': 'verified',
      'college-grades': 'attached',
      'income-proof': 'rejected',
      'residence-photos': 'missing',
      'good-moral': 'missing',
      'certificate-of-award': 'missing',
    });
    // A pending file counts, a rejected one does not: the same bar as submitting.
    expect([checklist.ready, checklist.total]).toEqual([2, 6]);
  });

  it('is empty when no internal scholarship is open', () => {
    expect(getDocumentChecklist({ scholarships: [closed, external], profile: continuingProfile, today })).toMatchObject({ scholarships: [], items: [], ready: 0, total: 0 });
  });

  it('preselects a general vault type, falling back to the attribute that accepts a proof-only type', () => {
    expect(getRequirementUploadPreset({ documentTypes: ['Grade Report', 'Transcript'] })).toEqual({ attribute: '', documentType: 'Transcript' });
    expect(getRequirementUploadPreset({ documentTypes: ['Grade Report'] })).toEqual({ attribute: 'qpi', documentType: 'Grade Report' });
    expect(getRequirementUploadPreset({ documentTypes: ['Unknown Type'] })).toEqual({ attribute: '', documentType: '' });
  });
});
