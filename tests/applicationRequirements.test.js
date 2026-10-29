import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REQUIRED_DOCUMENTS,
  ENDORSEMENT_BLOCKED_STATUSES,
  areApplicationDocumentsVisible,
  areDocumentsReviewable,
  buildProfileSnapshot,
  describeApplicantAcademic,
  describeStatusActor,
  describeDocumentDecision,
  getApplicationReadiness,
  getApplicationLiveAttributeVerifications,
  getCatalogRequirements,
  getDocumentChecklist,
  getDocumentProofReview,
  getDocumentVerificationReadiness,
  getApplicantPhotoDocument,
  getLinkedDocuments,
  getProfileSnapshotSections,
  getReplaceableRejectedDocuments,
  getReplacementOptions,
  getRequirementUploadPreset,
  getScholarshipRequirements,
  isApplicationVerifiedForEndorsement,
  normalizeRequirements,
  pickDefaultAttachments,
} from '../src/lib/applicationRequirements';
import { documentTypeOptions } from '../src/lib/constants';
import { fmtDate } from '../src/lib/formatters';

const completeFinancialAnswers = {
  otherIncomeAnswer: 'no',
  difficultyAnswer: 'no',
  allowanceDaily: 150,
  allowanceEnough: 'yes',
  foodIntakeAdequacy: 'adequate',
  transportMode: 'public-transport',
  expenseFood: 100,
  expenseTransport: 40,
  expenseOther: 20,
};

const readinessOf = (args) => getApplicationReadiness({ financialAnswers: completeFinancialAnswers, ...args });

const continuingProfile = {
  fullName: 'Ana Reyes',
  studentNumber: '202300001',
  degreeProgram: 'BS Information Technology',
  department: 'School of Engineering and Architecture',
  yearStanding: '2nd',
  qpi: 3.2,
  householdIncome: 180000,
  citizenship: 'Filipino',
  academicStanding: 'good',
  // The remaining "Needed to apply" answers and the FORM 230-SCH core.
  civilStatus: 'Single',
  completeAddress: 'Roxas Ave, Davao City',
  housingType: 'I live at home',
  ipCommunity: 'No',
  pwd: 'No',
  employed: 'Not employed',
  // FORM 230-SCH Applicant Status.
  isTransferee: 'No',
  phone: '0917 123 4567',
  email: 'ana.reyes@example.com',
  birthdate: '2005-04-12',
  sexAtBirth: 'Female',
  religion: 'Roman Catholic',
  pronouns: 'she/her',
  awardsNone: true,
  graduatingClassSize: 120,
  previousGrantsAnswered: 'No',
  hsStrand: 'STEM',
  communityService: 'Yes',
  schoolLastAttended: { name: 'Davao Senior High School', city: 'Davao City', province: 'Davao del Sur' },
  // Each listed parent's name, age, and occupation are printed on the form.
  familyDetails: {
    fatherName: 'Jose Reyes',
    fatherAge: 52,
    fatherOccupation: 'Driver',
    motherName: 'Maria Reyes',
    motherAge: 49,
    motherOccupation: 'Teacher',
    numberOfSiblings: 0,
    siblingsNone: true,
    householdAdultsNone: true,
  },
  financialProfile: {
    economicStatus: 'lower',
    father: { employmentStatus: 'employed', annualIncome: 120000, employer: 'Davao Transit' },
    mother: { employmentStatus: 'unemployed', annualIncome: 0, lastEmployed: 'March 2024', unemploymentReason: 'Health' },
    assets: { none: true, others: '' },
    appliances: { none: true, others: '' },
  },
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

  it('asks for the applicant photo and residence photos on every in-scope track', () => {
    const known = new Set(documentTypeOptions.map((option) => option.value));
    Object.values(DEFAULT_REQUIRED_DOCUMENTS).forEach((items) => {
      const byId = Object.fromEntries(items.map((item) => [item.id, item]));
      expect(byId['applicant-photo']).toMatchObject({ documentTypes: ['Applicant Photo'], standing: 'all' });
      expect(byId['residence-photos']).toMatchObject({ documentTypes: ['Photos of Residence'], standing: 'all' });
    });
    expect(known.has('Applicant Photo')).toBe(true);
    expect(known.has('Photos of Residence')).toBe(true);
  });

  it('asks for the two paper pages, not the generic application form, on every in-scope track', () => {
    Object.values(DEFAULT_REQUIRED_DOCUMENTS).forEach((items) => {
      const byId = Object.fromEntries(items.map((item) => [item.id, item]));
      expect(byId['application-form']).toBeUndefined();
      expect(byId['barangay-residence-certification']).toMatchObject({ documentTypes: ['Barangay Residence Certification'], standing: 'all' });
      expect(byId['signed-affidavit']).toMatchObject({ documentTypes: ['Signed Affidavit of Agreement'], standing: 'all' });
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
    // The application is filled in the system; two pages stay on paper.
    expect(continuing).toEqual(expect.arrayContaining(['barangay-residence-certification', 'signed-affidavit']));
    expect(incoming).toEqual(expect.arrayContaining(['barangay-residence-certification', 'signed-affidavit']));
    expect(incoming).not.toContain('application-form');
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
      doc('old-form', 'Signed Affidavit of Agreement', 'Verified', '2026-01-01'),
      doc('new-form', 'Signed Affidavit of Agreement', 'Pending', '2026-09-01'),
      doc('bad-income', 'Income Proof', 'Rejected', '2026-09-02'),
    ];
    expect(pickDefaultAttachments(requirements, documents)).toEqual(['new-form']);
  });
});

describe('application readiness', () => {
  const requirements = getScholarshipRequirements(gia, continuingProfile);
  const allDocs = requirements.map((item, index) => doc(`d${index}`, item.documentTypes[0]));
  const complete = { attachedDocuments: allDocs.map((entry) => entry.id), statement: 'I need support to continue my studies.' };

  it('blocks submission until the applicant photo and residence photos are attached', () => {
    const requirements = getScholarshipRequirements(gia, continuingProfile);
    expect(ids(requirements)).toEqual(expect.arrayContaining(['applicant-photo', 'residence-photos']));
    const photoIds = ['applicant-photo', 'residence-photos'];
    const partialDocs = requirements
      .filter((item) => !photoIds.includes(item.id))
      .map((item, index) => doc(`partial-${index}`, item.documentTypes[0]));
    const result = readinessOf({
      application: { attachedDocuments: partialDocs.map((entry) => entry.id), statement: 'I need support to continue my studies.' },
      scholarship: gia,
      documents: partialDocs,
      profile: continuingProfile,
      certified: true,
    });
    expect(result.ready).toBe(false);
    expect(result.requirements.find((item) => item.id === 'applicant-photo').state).toBe('missing');
    expect(result.requirements.find((item) => item.id === 'residence-photos').state).toBe('missing');
  });

  it('is ready once every requirement is attached, the statement is written, and the student certifies', () => {
    const result = readinessOf({ application: complete, scholarship: gia, documents: allDocs, profile: continuingProfile, certified: true });
    expect(result.route).toBe('internal');
    expect(result.blockers).toEqual([]);
    expect(result.ready).toBe(true);
    expect(result.attachedCount).toBe(result.requiredCount);
  });

  it('blocks submission until certification', () => {
    const result = readinessOf({ application: complete, scholarship: gia, documents: allDocs, profile: continuingProfile });
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(['Certify that your information and documents are true and complete.']);
  });

  it('reports missing documents and a blank statement', () => {
    const result = readinessOf({ application: { attachedDocuments: [], statement: '  ' }, scholarship: gia, documents: allDocs, profile: continuingProfile, certified: true });
    expect(result.requirements.every((item) => item.state === 'missing')).toBe(true);
    expect(result.blockers[0]).toMatch(/^Attach \d+ required documents/);
    expect(result.blockers).toContain('Write your application statement.');
  });

  it('treats a requirement whose only file was rejected as needing replacement', () => {
    const documents = allDocs.map((entry, index) => (index === 0 ? { ...entry, verificationStatus: 'Rejected' } : entry));
    const result = readinessOf({ application: complete, scholarship: gia, documents, profile: continuingProfile, certified: true });
    expect(result.requirements[0].state).toBe('rejected');
    expect(result.blockers.some((blocker) => blocker.startsWith('Upload a replacement for the reverted file'))).toBe(true);
  });

  it('marks verified files and allows pending ones', () => {
    const documents = allDocs.map((entry, index) => (index === 0 ? { ...entry, verificationStatus: 'Verified' } : entry));
    const result = readinessOf({ application: complete, scholarship: gia, documents, profile: continuingProfile, certified: true });
    expect(result.requirements[0].state).toBe('verified');
    expect(result.requirements[1].state).toBe('attached');
    expect(result.ready).toBe(true);
  });

  it('blocks submission until the financial situation step is complete', () => {
    const base = { application: complete, scholarship: gia, documents: allDocs, profile: continuingProfile, certified: true };
    const none = getApplicationReadiness(base);
    expect(none.ready).toBe(false);
    expect(none.blockers).toEqual([expect.stringMatching(/^Complete the financial situation step: Other sources of income;/)]);

    const partial = getApplicationReadiness({ ...base, financialAnswers: { ...completeFinancialAnswers, difficultyAnswer: 'yes' } });
    expect(partial.blockers[0]).toMatch(/Reasons for the financial difficulty; How the family copes/);
    expect(getApplicationReadiness({ ...base, financialAnswers: completeFinancialAnswers }).ready).toBe(true);
  });

  it('does not ask a submitted application for the financial step again', () => {
    const submitted = { ...complete, status: 'Submitted', profileSnapshot: buildProfileSnapshot(continuingProfile) };
    const result = getApplicationReadiness({ application: submitted, scholarship: gia, documents: allDocs, profile: continuingProfile, certified: true });
    expect(result.blockers.some((blocker) => blocker.includes('financial situation'))).toBe(false);
  });

  it('blocks a closed scholarship', () => {
    const result = readinessOf({ application: complete, scholarship: { ...gia, deadline: '2020-01-01' }, documents: allDocs, profile: continuingProfile, certified: true });
    expect(result.blockers).toContain('This scholarship is no longer accepting applications.');
  });

  it('re-runs the eligibility gate on the current profile', () => {
    const result = readinessOf({ application: complete, scholarship: gia, documents: allDocs, profile: { ...continuingProfile, householdIncome: 900000 }, certified: true });
    expect(result.ready).toBe(false);
    expect(result.blockers.some((blocker) => blocker.startsWith('Eligibility:'))).toBe(true);
  });

  it('tracks external entries without a submit route', () => {
    const result = readinessOf({ application: {}, scholarship: external, documents: [], profile: continuingProfile, certified: true });
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
      yearStandingLabel: 'Incoming 2nd year',
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
    expect(snapshot.version).toBe(4);
    expect(snapshot.eligibility).toEqual({
      academicStanding: { value: 'good', verification: 'Unverified' },
      honorsRank: { value: 'Valedictorian', verification: 'Verified' },
      graduatingClassSize: 120,
      isOnPrepaidPlan: false,
      hasSiblingOnAid: true,
      hasOtherActiveScholarship: false,
      isTransferee: 'No',
      hsStrand: 'STEM',
    });
    expect(snapshot.background.pwd).toEqual({ value: 'No', verification: 'Pending' });
    expect(snapshot.personal).toEqual({ firstName: '', middleName: '', lastName: '', civilStatus: 'Single', religion: 'Roman Catholic', birthdate: '2005-04-12', sexAtBirth: 'Female', pronouns: 'she/her', email: 'ana.reyes@example.com', phone: '0917 123 4567' });
    expect(snapshot.address).toEqual({
      completeAddress: 'Roxas Ave, Davao City',
      residingAddress: 'Roxas Ave, Davao City',
      country: 'Philippines',
      housingType: 'I live at home',
      housingOther: '',
      verification: { completeAddress: 'Unverified', residingAddress: 'Unverified' },
    });
    expect(snapshot.education).toEqual({ schoolLastAttended: { name: 'Davao Senior High School', city: 'Davao City', province: 'Davao del Sur' }, awards: '' });
    expect(snapshot.aid).toEqual({ communityService: 'Yes', previousGrants: [] });
    expect(snapshot.background.ipGroupName).toBe('');
    expect(snapshot.family).toMatchObject({
      fatherName: 'Jose Reyes',
      motherDeceased: true,
      numberOfSiblings: 2,
      verification: { parents: 'Unverified', householdMembers: 'Unverified' },
    });
    expect(JSON.stringify(snapshot)).not.toContain('My default statement.');
  });

  it('never carries the office-only financial details into the snapshot the Department Chair can read', () => {
    const json = JSON.stringify(buildProfileSnapshot(fullProfile));
    ['economicStatus', 'annualIncome', 'employmentStatus', 'assets', 'appliances', 'financialProfile'].forEach((key) => expect(json).not.toContain(key));
  });

  it('records the FORM 230-SCH family, education and grant details', () => {
    const snapshot = buildProfileSnapshot({
      ...fullProfile,
      ipGroupName: 'Bagobo',
      housingType: 'Other',
      housingOther: 'Rented room',
      awards: 'With Honors',
      previousGrants: [{ type: 'Government', name: 'CHED', status: 'applied', institution: 'CHED XI' }],
      familyDetails: { ...fullProfile.familyDetails, fatherAge: 52, siblings: [{ name: 'Mika', age: 12, relationship: 'Sister', status: 'Studying' }], householdAdults: [{ name: 'Lola Ana', age: 70, relationship: 'Grandmother' }] },
    });
    expect(snapshot.background.ipGroupName).toBe('Bagobo');
    expect(snapshot.address).toMatchObject({ housingType: 'Other', housingOther: 'Rented room' });
    expect(snapshot.education.awards).toBe('With Honors');
    expect(snapshot.family).toMatchObject({ fatherAge: 52, siblings: [{ name: 'Mika', age: 12 }], householdAdults: [{ name: 'Lola Ana' }] });
    expect(snapshot.aid.previousGrants).toEqual([{ type: 'Government', name: 'CHED', status: 'applied', institution: 'CHED XI' }]);
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
      familyDetails: { fatherUnknown: true, motherName: 'Maria Reyes', motherOccupation: 'Vendor', motherDeceased: true },
    }, { qpi: 'Verified' }));
    expect(legacy).toBe(false);
    expect(sections.map((section) => section.key)).toEqual(['application', 'eligibility', 'background', 'personal', 'education', 'family', 'aid']);
    const rows = Object.fromEntries(sections.flatMap((section) => section.rows).map((row) => [row.label, row]));
    expect(rows['Annual QPI']).toEqual({ label: 'Annual QPI', value: '3.20', verification: 'Verified' });
    expect(rows['Household income'].value).toBe('₱180,000');
    expect(rows['Academic standing'].value).toBe('Good academic standing');
    expect(rows['Employment status'].value).toBe('Part-time employed');
    expect(rows['Sibling on AdDU financial aid'].value).toBe('No');
    expect(rows.Mother.value).toBe('Maria Reyes · Vendor · Deceased');
    expect(rows.Father.value).toBe('Unknown / not listed');
    expect(rows['Sex assigned at birth'].value).toBe('Female');
    expect(rows['School last attended'].value).toBe('Davao Senior High School, Davao City, Davao del Sur');
    expect(rows['Willing to render community service'].value).toBe('Yes');
  });

  it('lists siblings, household members and grants as labelled rows', () => {
    const { sections } = getProfileSnapshotSections(buildProfileSnapshot({
      ...continuingProfile,
      previousGrants: [{ type: 'Private', name: 'Alumni grant', status: 'accepted', institution: 'AdDU' }],
      familyDetails: { siblings: [{ name: 'Mika', age: 12, relationship: 'Sister', status: 'Studying' }], householdAdults: [{ name: 'Lola Ana', age: 70, relationship: 'Grandmother' }] },
    }));
    const rows = Object.fromEntries(sections.flatMap((section) => section.rows).map((row) => [row.label, row.value]));
    expect(rows['Sibling 1']).toBe('Mika · 12 yrs · Sister · Still studying');
    expect(rows['Other household member 1']).toBe('Lola Ana · 70 yrs · Grandmother');
    expect(rows['Grant 1']).toBe('Alumni grant · Private · Accepted · AdDU');
  });

  it('renders the FORM 230-SCH printed name, applicant status and senior high school aid', () => {
    const { sections } = getProfileSnapshotSections(buildProfileSnapshot({
      ...continuingProfile,
      isTransferee: 'Yes',
      lastName: 'Reyes', firstName: 'Ana', middleName: 'Cruz',
      graduatingClassSize: '120',
      previousGrants: [{ type: 'Government', name: 'CHED', level: 'Senior high school', status: 'accepted', institution: 'CHED', amount: 12000 }],
    }));
    const rows = Object.fromEntries(sections.flatMap((section) => section.rows).map((row) => [row.label, row.value]));
    expect(rows['Name of applicant (Last, First, Middle)']).toBe('Reyes, Ana Cruz');
    expect(rows.Name).toBeUndefined();
    expect(rows['Applicant status']).toBe('Transferee');
    expect(rows['College last attended']).toBe('Davao Senior High School, Davao City, Davao del Sur');
    expect(rows['Number of graduates of your senior high school']).toBe('120');
    expect(rows['Financial aid in senior high school']).toContain('Senior high school');
    expect(rows['Financial aid in senior high school']).toContain('₱12,000 a year');
  });

  it('keeps a version 2 snapshot rendering without the version 3 groups', () => {
    const current = buildProfileSnapshot(continuingProfile);
    const v2 = { ...current, version: 2 };
    delete v2.education;
    delete v2.aid;
    const { sections } = getProfileSnapshotSections(v2);
    expect(sections.map((section) => section.key)).toEqual(['application', 'eligibility', 'background', 'personal', 'family']);
    expect(sections.flatMap((section) => section.rows).map((row) => row.label)).not.toContain('Birthdate');
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
    const result = readinessOf({ application, scholarship: gia, documents: [...required, pwdId, extraTranscript], profile: continuingProfile, certified: true });
    expect(ids(result.supportingDocuments)).toEqual(['pwd-id']);
    expect(result.ready).toBe(true);
    expect(result.attachedCount).toBe(result.requiredCount);
  });

  it('is empty for tracked external entries', () => {
    expect(readinessOf({ application, scholarship: external, documents: [pwdId], profile: continuingProfile }).supportingDocuments).toEqual([]);
  });
});

describe('applicant 2x2 photo in the profile snapshot', () => {
  const photo = (id, verificationStatus = 'Pending', uploadedAt = '2026-10-01') => ({
    ...doc(id, 'Applicant Photo', verificationStatus, uploadedAt),
    title: 'Applicant Photo',
    fileName: 'applicant-photo.jpg',
    storagePath: `student-1/${id}/applicant-photo.jpg`,
  });

  it('resolves the attached 2x2 photo and ignores other vault files', () => {
    const attached = photo('photo-attached');
    const residence = { ...doc('residence', 'Photos of Residence'), storagePath: 'student-1/residence/p.jpg' };
    const unattached = photo('photo-unattached');
    const application = { attachedDocuments: [attached.id, residence.id] };
    expect(getApplicantPhotoDocument(application, [attached, residence, unattached])?.id).toBe('photo-attached');
  });

  it('prefers the newest file that is not rejected, so a replacement is shown', () => {
    const verifiedOld = photo('photo-old', 'Verified', '2026-01-01');
    const pendingNew = photo('photo-new', 'Pending', '2026-09-01');
    const application = { attachedDocuments: [verifiedOld.id, pendingNew.id] };
    expect(getApplicantPhotoDocument(application, [verifiedOld, pendingNew])?.id).toBe('photo-new');
  });

  it('falls back to the rejected attachment when it is all the application has', () => {
    const rejected = photo('photo-rejected', 'Rejected');
    expect(getApplicantPhotoDocument({ attachedDocuments: [rejected.id] }, [rejected])?.id).toBe('photo-rejected');
  });

  it('returns nothing when no 2x2 photo is attached', () => {
    expect(getApplicantPhotoDocument({ attachedDocuments: [] }, [photo('photo-vault')])).toBeNull();
    expect(getApplicantPhotoDocument(undefined, undefined)).toBeNull();
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
    expect(ids(checklist.items)).toEqual(['applicant-photo', 'citizenship-proof', 'address-proof', 'family-proof', 'college-grades', 'income-proof', 'residence-photos', 'good-moral', 'barangay-residence-certification', 'signed-affidavit', 'certificate-of-award']);
    expect(keyOf(checklist.items, 'signed-affidavit').askedByAll).toBe(true);
    expect(keyOf(checklist.items, 'income-proof').scholarships.map((item) => item.id)).toEqual(['gia', 'sa']);
    expect(keyOf(checklist.items, 'income-proof').notAskedBy).toEqual([{ id: 'jubilee', title: jubilee.title }]);
    expect(keyOf(checklist.items, 'signed-affidavit').notAskedBy).toEqual([]);
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
    const documents = [doc('a', 'Signed Affidavit of Agreement', 'Verified'), doc('t', 'Transcript'), doc('i', 'Income Proof', 'Rejected')];
    const checklist = getDocumentChecklist({ scholarships: [gia, jubilee, sa], profile: continuingProfile, documents, today });
    expect(Object.fromEntries(checklist.items.map((item) => [item.id, item.state]))).toEqual({
      'signed-affidavit': 'verified',
      'barangay-residence-certification': 'missing',
      'applicant-photo': 'missing',
      'citizenship-proof': 'missing',
      'address-proof': 'missing',
      'family-proof': 'missing',
      'college-grades': 'attached',
      'income-proof': 'rejected',
      'residence-photos': 'missing',
      'good-moral': 'missing',
      'certificate-of-award': 'missing',
    });
    // A pending file counts, a rejected one does not: the same bar as submitting.
    expect([checklist.ready, checklist.total]).toEqual([2, 11]);
  });

  it('is empty when no internal scholarship is open', () => {
    expect(getDocumentChecklist({ scholarships: [closed, external], profile: continuingProfile, today })).toMatchObject({ scholarships: [], items: [], ready: 0, total: 0 });
  });

  it('preselects the first type under the attribute it proves, or as a general document', () => {
    expect(getRequirementUploadPreset({ documentTypes: ['Grade Report', 'Transcript'] })).toEqual({ attribute: 'qpi', documentType: 'Grade Report' });
    expect(getRequirementUploadPreset({ documentTypes: ['HS Report Card'] }, incomingProfile)).toEqual({ attribute: 'hsAverage', documentType: 'HS Report Card' });
    expect(getRequirementUploadPreset({ documentTypes: ['Application Form'] })).toEqual({ attribute: '', documentType: 'Application Form' });
    expect(getRequirementUploadPreset({ documentTypes: ['Grade Report'] })).toEqual({ attribute: 'qpi', documentType: 'Grade Report' });
    expect(getRequirementUploadPreset({ documentTypes: ['Applicant Photo'] })).toEqual({ attribute: '', documentType: 'Applicant Photo' });
    expect(getRequirementUploadPreset({ documentTypes: ['Photos of Residence'] })).toEqual({ attribute: '', documentType: 'Photos of Residence' });
    expect(getRequirementUploadPreset({ documentTypes: ['Unknown Type'] })).toEqual({ attribute: '', documentType: '' });
  });
});

describe('document verification readiness for endorsement', () => {
  const application = (attachedDocuments = []) => ({ id: 'app-1', attachedDocuments });
  const doc = (id, verificationStatus) => ({ id, verificationStatus });

  it('flags the SOP stages that require every attached document verified', () => {
    expect(ENDORSEMENT_BLOCKED_STATUSES).toEqual(['For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released']);
    expect(ENDORSEMENT_BLOCKED_STATUSES).not.toContain('Rejected');
  });

  it('resolves only the attached documents that are loaded', () => {
    expect(getLinkedDocuments(application(['doc-1', 'doc-missing']), [doc('doc-1', 'Verified')]).map((entry) => entry.id)).toEqual(['doc-1']);
  });

  it('is ready only when every attached document is Verified', () => {
    const ready = getDocumentVerificationReadiness(application(['doc-1', 'doc-2']), [
      doc('doc-1', 'Verified'),
      doc('doc-2', 'Verified'),
    ]);
    expect(ready).toMatchObject({ total: 2, verified: 2, outstanding: 0, ready: true });

    const pending = getDocumentVerificationReadiness(application(['doc-1', 'doc-2']), [
      doc('doc-1', 'Verified'),
      doc('doc-2', 'Pending'),
    ]);
    expect(pending).toMatchObject({ total: 2, verified: 1, outstanding: 1, ready: false });

    const rejected = getDocumentVerificationReadiness(application(['doc-1']), [doc('doc-1', 'Rejected')]);
    expect(rejected).toMatchObject({ outstanding: 1, ready: false });
  });

  it('treats an application with no attached documents as ready', () => {
    expect(isApplicationVerifiedForEndorsement(application([]), [])).toBe(true);
    expect(isApplicationVerifiedForEndorsement({}, [])).toBe(true);
    expect(isApplicationVerifiedForEndorsement(application([]), undefined)).toBe(true);
  });

  it('blocks endorsement while any attached document is not verified', () => {
    expect(isApplicationVerifiedForEndorsement(application(['doc-1']), [doc('doc-1', 'Pending')])).toBe(false);
    expect(isApplicationVerifiedForEndorsement(application(['doc-1']), [doc('doc-1', 'Verified')])).toBe(true);
  });

  it('tolerates malformed inputs', () => {
    expect(getDocumentVerificationReadiness(undefined, undefined)).toMatchObject({ total: 0, outstanding: 0, ready: true });
    expect(getDocumentVerificationReadiness({ attachedDocuments: ['x'] }, 'not an array')).toMatchObject({ total: 0, ready: true });
  });
});

// The Document Vault review is gated to the SOP verification stage: an
// application's files cannot be verified or rejected before it gets there.
describe('document review stage gate', () => {
  it('keeps documents locked until the application reaches verification', () => {
    expect(areDocumentsReviewable('Draft')).toBe(false);
    expect(areDocumentsReviewable('Submitted')).toBe(false);
    expect(areDocumentsReviewable('Under Review')).toBe(false);
    expect(areDocumentsReviewable('For Verification')).toBe(true);
  });

  it('stays unlocked for every stage after verification', () => {
    ['For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released'].forEach((status) => {
      expect(areDocumentsReviewable(status)).toBe(true);
    });
  });

  it('treats a terminal or unknown status as locked', () => {
    expect(areDocumentsReviewable('Rejected')).toBe(false);
    expect(areDocumentsReviewable('')).toBe(false);
    expect(areDocumentsReviewable(undefined)).toBe(false);
  });

  it('keeps a rejected application readable for its recorded decision', () => {
    // The review surface uses this broader predicate: a rejected application has
    // no stage action left, but its files must stay inspectable.
    expect(areApplicationDocumentsVisible('Rejected')).toBe(true);
    expect(areApplicationDocumentsVisible('For Verification')).toBe(true);
    expect(areApplicationDocumentsVisible('Submitted')).toBe(false);
    expect(areApplicationDocumentsVisible('Under Review')).toBe(false);
  });
});


// An internal catalog entry that is not one of the three in-scope tracks must
// behave like an external program: no requirement checklist and no submit path.
describe('out-of-scope internal programs', () => {
  const villanueva = {
    id: 'villanueva',
    title: 'Antonio A. Villanueva Endowment Fund',
    category: 'Internal Endowment',
    ruleFamily: 'general-pool',
    isExternal: false,
    isActive: true,
    deadline: '2999-12-31',
  };

  it('returns no catalog requirements for an out-of-scope internal entry', () => {
    expect(getCatalogRequirements(villanueva)).toEqual([]);
  });

  it('does not list the out-of-scope entry in the My Profile document checklist', () => {
    const checklist = getDocumentChecklist({ scholarships: [gia, villanueva], documents: [], profile: continuingProfile, today: new Date('2026-10-12T00:00:00') });
    expect(checklist.scholarships.some((item) => item.title === villanueva.title)).toBe(false);
    expect(checklist.scholarships.some((item) => item.title === gia.title)).toBe(true);
    expect(checklist.items.every((item) => item.scholarships.every((entry) => entry.title !== villanueva.title))).toBe(true);
  });

  it('routes an out-of-scope application as tracked-only (no readiness)', () => {
    const readiness = readinessOf({
      application: { id: 'app-v', attachedDocuments: [] },
      scholarship: villanueva,
      documents: [],
      profile: continuingProfile,
    });
    expect(readiness.route).toBe('external');
    expect(readiness.ready).toBe(false);
    expect(readiness.requirements).toEqual([]);
  });
});


// The append-only status log (application_status_log) is the trustworthy history;
// staff see the reviewer's name, a student sees the role, and a system move has
// no user. describeStatusActor() is the single label used by the review modal,
// the console activity feed, and the student's detail view.
describe('describeStatusActor', () => {
  const logRow = (overrides = {}) => ({ actorRole: 'admissions_office', actorName: null, ...overrides });

  it('shows the reviewer name for staff when the directory resolves it', () => {
    expect(describeStatusActor(logRow({ actorName: 'Ada Cruz' }), true)).toBe('Ada Cruz');
  });

  it('falls back to the humanized role for staff when the name cannot be resolved', () => {
    expect(describeStatusActor(logRow({ actorName: null }), true)).toBe('Admissions Office Staff');
    expect(describeStatusActor(logRow({ actorRole: 'admissions_head', actorName: null }), true)).toBe('Admissions Office Head');
    expect(describeStatusActor(logRow({ actorRole: 'department_chair', actorName: null }), true)).toBe('Department Chair');
    expect(describeStatusActor(logRow({ actorRole: 'student', actorName: null }), true)).toBe('Student');
  });

  it('shows the role (never the name) for a student', () => {
    expect(describeStatusActor(logRow({ actorName: 'Ada Cruz' }), false)).toBe('Admissions Office Staff');
    expect(describeStatusActor(logRow({ actorRole: 'admissions_head', actorName: 'Ada Cruz' }))).toBe('Admissions Office Head');
  });

  it('labels an automated move as System', () => {
    expect(describeStatusActor(logRow({ actorRole: 'system', actorName: null }), true)).toBe('System');
    expect(describeStatusActor(logRow({ actorRole: null, actorName: null }), true)).toBe('System');
  });

  it('tolerates a missing row', () => {
    expect(describeStatusActor(null, true)).toBe('Recorded automatically');
    expect(describeStatusActor(undefined)).toBe('Recorded automatically');
  });
});


describe('describeDocumentDecision', () => {
  const decidedAt = '2026-10-21T03:42:00.000Z';
  const on = fmtDate(decidedAt);
  const verified = {
    verificationStatus: 'Verified',
    decidedAt,
    reviewedBy: 'staff-1',
    reviewedByRole: 'admissions_office',
    reviewedByName: 'Juan Dela Cruz',
  };

  it('names the reviewer, lane, and date for staff surfaces', () => {
    expect(describeDocumentDecision(verified, { showName: true }))
      .toBe(`Verified by Juan Dela Cruz · Admissions Office Staff · ${on}`);
  });

  it('shows the lane and date to a student, never the reviewer name', () => {
    expect(describeDocumentDecision(verified)).toBe(`Verified by Admissions Office Staff · ${on}`);
  });

  it('labels the Head lane and a rejection', () => {
    const rejected = { ...verified, verificationStatus: 'Rejected', reviewedByRole: 'admissions_head', reviewedByName: 'Ada Cruz' };
    expect(describeDocumentDecision(rejected, { showName: true }))
      .toBe(`Reverted for resubmission by Ada Cruz · Admissions Office Head · ${on}`);
  });

  it('treats a reset file as awaiting review', () => {
    expect(describeDocumentDecision({ verificationStatus: 'Pending', decidedAt: null, reviewedBy: null, reviewedByRole: null }))
      .toBe('Awaiting review — no decision recorded yet.');
  });

  it('states when reviewer details were not kept rather than inventing them', () => {
    expect(describeDocumentDecision({ verificationStatus: 'Verified' }))
      .toBe('Verified · recorded before reviewer details were kept.');
    expect(describeDocumentDecision({ verificationStatus: 'Rejected', rejectionReason: 'Blurry' }))
      .toBe('Reverted for resubmission · recorded before reviewer details were kept.');
  });

  it('falls back to the Admissions Office lane when no role was recorded', () => {
    expect(describeDocumentDecision({ verificationStatus: 'Verified', decidedAt, reviewedByName: 'Juan Dela Cruz' }, { showName: true }))
      .toBe(`Verified by Juan Dela Cruz · Admissions Office · ${on}`);
  });

  it('tolerates a missing document', () => {
    expect(describeDocumentDecision(null)).toBe('No review decision recorded.');
  });
});

describe('replacing a rejected document on a submitted application', () => {
  const rejected = { id: 'doc-itr', documentType: 'Income Tax Return', verificationStatus: 'Rejected', uploadedAt: '2026-09-01' };
  const verifiedCert = { id: 'doc-cert', documentType: 'Certificate of Enrollment', verificationStatus: 'Verified', uploadedAt: '2026-09-02' };
  const newItr = { id: 'doc-itr-2', documentType: 'Income Tax Return', verificationStatus: 'Pending', uploadedAt: '2026-10-01' };
  const indigency = { id: 'doc-indigency', documentType: 'Certificate of Indigency', verificationStatus: 'Pending', uploadedAt: '2026-10-02' };
  const rejectedAgain = { id: 'doc-itr-3', documentType: 'Income Tax Return', verificationStatus: 'Rejected', uploadedAt: '2026-10-03' };
  const other = { id: 'doc-photo', documentType: 'Photo', verificationStatus: 'Pending', uploadedAt: '2026-10-04' };
  const documents = [rejected, verifiedCert, newItr, indigency, rejectedAgain, other];
  const requirements = [
    { id: 'income', documentTypes: ['Income Tax Return', 'Certificate of Indigency'] },
    { id: 'enrollment', documentTypes: ['Certificate of Enrollment'] },
  ];

  it('lists rejected attachments only before endorsement', () => {
    const application = { status: 'For Verification', attachedDocuments: ['doc-itr', 'doc-cert'] };
    expect(getReplaceableRejectedDocuments(application, documents).map((doc) => doc.id)).toEqual(['doc-itr']);
    expect(getReplaceableRejectedDocuments({ ...application, status: 'Draft' }, documents)).toEqual([]);
    expect(getReplaceableRejectedDocuments({ ...application, status: 'Endorsed' }, documents)).toEqual([]);
    expect(getReplaceableRejectedDocuments({ ...application, status: 'Rejected' }, documents)).toEqual([]);
  });

  it('offers non-rejected, unattached files of any type the requirement accepts, newest first', () => {
    const application = { status: 'Submitted', attachedDocuments: ['doc-itr', 'doc-cert'] };
    const { documentTypes, candidates } = getReplacementOptions({ application, requirements, rejectedDocument: rejected, documents });
    expect(documentTypes).toEqual(['Income Tax Return', 'Certificate of Indigency']);
    expect(candidates.map((doc) => doc.id)).toEqual(['doc-indigency', 'doc-itr-2']);
  });

  it('falls back to the file\'s own type for a supporting document', () => {
    const application = { status: 'Submitted', attachedDocuments: ['doc-photo'] };
    const rejectedPhoto = { ...other, verificationStatus: 'Rejected' };
    const { documentTypes, candidates } = getReplacementOptions({ application, requirements, rejectedDocument: rejectedPhoto, documents });
    expect(documentTypes).toEqual(['Photo']);
    expect(candidates).toEqual([]);
  });
});

describe('profile answers behind the requirements', () => {
  const proof = (id, documentType, attestedValues, overrides = {}) => ({
    ...doc(id, documentType, 'Pending', '2026-10-01'),
    linkedAttributes: Object.keys(attestedValues),
    attestedValues,
    ...overrides,
  });
  const today = new Date('2026-10-12T00:00:00');
  const requirements = getScholarshipRequirements(gia, continuingProfile);
  const byId = Object.fromEntries(requirements.map((item) => [item.id, item]));
  // One current file per requirement; proof types attest the profile values.
  const currentDocs = () => requirements.map((item, index) => {
    const type = item.documentTypes[0];
    if (item.id === 'college-grades') return proof(`d${index}`, type, { qpi: 3.2, academicStanding: 'good' });
    if (item.id === 'income-proof') return proof(`d${index}`, type, { householdIncome: 180000 });
    if (item.id === 'citizenship-proof') return proof(`d${index}`, type, { citizenship: 'Filipino' });
    return doc(`d${index}`, type);
  });
  const draft = (documents) => ({ status: 'Draft', attachedDocuments: documents.map((entry) => entry.id), statement: 'Statement.' });

  it('names the answers each requirement proves for the standing', () => {
    expect(byId['college-grades'].proves).toEqual(['qpi', 'academicStanding']);
    expect(byId['income-proof'].proves).toEqual(['householdIncome']);
    // A PSA birth certificate proves citizenship and the parents' names.
    expect(byId['citizenship-proof'].proves).toEqual(['citizenship', 'parents']);
    // The address row accepts the barangay certificate too, which also proves the
    // household list; a proof of billing proves only the two addresses.
    expect(byId['address-proof'].proves).toEqual(['completeAddress', 'residingAddress', 'householdMembers']);
    expect(byId['family-proof'].proves).toEqual(['citizenship', 'parents', 'completeAddress', 'residingAddress', 'householdMembers']);
    expect(byId['signed-affidavit'].proves).toEqual([]);
    const incoming = Object.fromEntries(getScholarshipRequirements(gia, incomingProfile).map((item) => [item.id, item]));
    expect(incoming['hs-report-card'].proves).toEqual(['hsAverage', 'academicStanding']);
  });

  it('asks every in-scope track for proof of citizenship, the address and the family details', () => {
    Object.values(DEFAULT_REQUIRED_DOCUMENTS).forEach((items) => {
      expect(items.find((item) => item.id === 'citizenship-proof')).toMatchObject({ standing: 'all' });
      expect(items.find((item) => item.id === 'address-proof')).toMatchObject({ standing: 'all', documentTypes: ['Proof of Billing', 'Certificate of Residency'] });
      expect(items.find((item) => item.id === 'family-proof')).toMatchObject({ standing: 'all', documentTypes: ['PSA Birth Certificate', 'Certificate of Residency'] });
    });
  });

  it('lets one barangay certificate answer the address and the family rows at once', () => {
    const certificate = proof('d', 'Certificate of Residency', { completeAddress: continuingProfile.completeAddress, residingAddress: continuingProfile.completeAddress });
    const documents = [certificate];
    const application = { status: 'Draft', attachedDocuments: [certificate.id], statement: 'Statement.' };
    const result = readinessOf({ application, scholarship: gia, documents, profile: continuingProfile, certified: true, today });
    const states = Object.fromEntries(result.requirements.map((item) => [item.id, item.state]));
    expect(states['address-proof']).toBe('attached');
    expect(states['family-proof']).toBe('attached');
  });

  it('reads an address proof as outdated once the declared address changes', () => {
    const billing = proof('d', 'Proof of Billing', { completeAddress: 'Old address, Davao City', residingAddress: 'Old address, Davao City' });
    const documents = [billing];
    const application = { status: 'Draft', attachedDocuments: [billing.id], statement: 'Statement.' };
    const result = readinessOf({ application, scholarship: gia, documents, profile: continuingProfile, certified: true, today });
    expect(result.requirements.find((item) => item.id === 'address-proof').state).toBe('outdated');
    expect(result.blockers.some((blocker) => blocker.startsWith('Upload a current proof for Proof of address'))).toBe(true);
  });

  it('is ready with current proofs and blocks a proof the profile no longer matches', () => {
    const documents = currentDocs();
    const ready = readinessOf({ application: draft(documents), scholarship: gia, documents, profile: continuingProfile, certified: true, today });
    expect(ready.blockers).toEqual([]);
    const changed = readinessOf({ application: draft(documents), scholarship: gia, documents, profile: { ...continuingProfile, qpi: 3.5 }, certified: true, today });
    expect(changed.requirements.find((item) => item.id === 'college-grades').state).toBe('outdated');
    expect(changed.ready).toBe(false);
    expect(changed.blockers).toContain('Upload a current proof for Latest grade report or transcript: your Annual QPI in your Application Form is now 3.50, which the attached file was not uploaded to prove.');
  });

  it('attaches a current proof by default over a newer outdated one', () => {
    const current = proof('current', 'Grade Report', { qpi: 3.2, academicStanding: 'good' }, { uploadedAt: '2026-09-01' });
    const stale = proof('stale', 'Grade Report', { qpi: 2.9, academicStanding: 'good' }, { uploadedAt: '2026-10-01' });
    expect(pickDefaultAttachments([byId['college-grades']], [stale, current], { profile: continuingProfile, today })).toEqual(['current']);
    expect(pickDefaultAttachments([byId['college-grades']], [stale], { profile: continuingProfile, today })).toEqual(['stale']);
  });

  it('blocks an annual proof from an earlier academic year', () => {
    const documents = currentDocs().map((entry) => (entry.documentType === 'Income Proof' ? { ...entry, uploadedAt: '2026-05-01' } : entry));
    const result = readinessOf({ application: draft(documents), scholarship: gia, documents, profile: continuingProfile, certified: true, today });
    expect(result.requirements.find((item) => item.id === 'income-proof').state).toBe('outdated');
    expect(result.blockers.some((blocker) => blocker.includes('earlier academic year'))).toBe(true);
  });

  it('adds a requirement row for each claim and removes it when the answer is No', () => {
    const claiming = { ...continuingProfile, pwd: 'Yes', ipCommunity: 'No' };
    const rows = getScholarshipRequirements(gia, claiming);
    expect(rows.find((item) => item.id === 'proof-pwd')).toMatchObject({ claim: true, proves: ['pwd'], documentTypes: ['PWD ID', 'Medical Certificate'] });
    expect(rows.some((item) => item.id === 'proof-ipCommunity')).toBe(false);
    expect(getScholarshipRequirements(gia, { ...claiming, pwd: 'No' }).some((item) => item.id === 'proof-pwd')).toBe(false);
    const documents = currentDocs();
    const blocked = readinessOf({ application: draft(documents), scholarship: gia, documents, profile: claiming, certified: true, today });
    expect(blocked.blockers.some((blocker) => blocker.includes('Proof of PWD status'))).toBe(true);
  });

  it('does not repeat a claim a catalog requirement already proves', () => {
    const jubilee = { id: 'jubilee', title: 'Jubilee Scholarship Fund (Valedictorian & Salutatorian)', ruleFamily: 'honors', isActive: true, deadline: '2999-12-31' };
    const rows = getScholarshipRequirements(jubilee, { ...continuingProfile, honorsRank: 'Valedictorian' });
    expect(rows.find((item) => item.id === 'certificate-of-award').proves).toEqual(['honorsRank']);
    expect(rows.some((item) => item.id === 'proof-honorsRank')).toBe(false);
  });

  it('asks for the year standing before listing standing-specific documents', () => {
    const unset = { ...continuingProfile, yearStanding: '' };
    const ids = getScholarshipRequirements(gia, unset).map((item) => item.id);
    expect(ids).not.toContain('college-grades');
    expect(ids).not.toContain('hs-report-card');
    const result = readinessOf({ application: draft([]), scholarship: gia, documents: [], profile: unset, certified: true, today });
    expect(result.blockers[0]).toBe('Set your year standing in your Application Form so the documents for your standing can be listed.');
  });

  it('judges a submitted application against its frozen snapshot, not the live profile', () => {
    const documents = currentDocs();
    const submitted = {
      ...draft(documents),
      status: 'Submitted',
      certifiedAt: '2026-10-05T00:00:00.000Z',
      profileSnapshot: buildProfileSnapshot(continuingProfile, {}, '2026-10-05T00:00:00.000Z'),
    };
    const later = new Date('2027-07-01T00:00:00');
    const result = readinessOf({ application: submitted, scholarship: gia, documents, profile: { ...continuingProfile, qpi: 3.9 }, today: later });
    expect(result.requirements.every((item) => item.state !== 'outdated')).toBe(true);
  });

  it('shows the reviewer what a file proves and where it disagrees with the snapshot', () => {
    const snapshot = buildProfileSnapshot({ ...continuingProfile, qpi: 3.4 }, {}, '2026-10-05T00:00:00.000Z');
    const application = { status: 'For Verification', certifiedAt: '2026-10-05T00:00:00.000Z', profileSnapshot: snapshot };
    const gradeReport = proof('g', 'Grade Report', { qpi: 3.2, academicStanding: 'good' });
    const review = getDocumentProofReview(gradeReport, application);
    expect(review.map((entry) => [entry.key, entry.source, entry.staleReason])).toEqual([['qpi', 'snapshot', 'value'], ['academicStanding', 'snapshot', null]]);
    expect(review[0]).toMatchObject({ attested: 3.2, declared: 3.4 });
  });
});

describe('live application badges on the reviewer overview', () => {
  const submittedProfile = { ...continuingProfile, qpi: 3.3, householdIncome: 12312 };
  const submittedAt = '2026-10-21T04:55:31.000Z';
  const submittedApplication = (applicationDocuments) => ({
    status: 'Interview',
    certifiedAt: submittedAt,
    attachedDocuments: applicationDocuments.map((entry) => entry.id),
    profileSnapshot: buildProfileSnapshot(submittedProfile, {}, submittedAt),
  });

  it('reports a file verified after submission instead of the badge frozen before the decision', () => {
    const gradeReport = { ...doc('grade-report', 'Grade Report', 'Verified', '2026-10-21T04:54:12.000Z'), linkedAttributes: ['qpi', 'academicStanding'] };
    const application = submittedApplication([gradeReport]);
    // The frozen snapshot is the record of what the student saw at submission.
    expect(application.profileSnapshot.academic.verification).toBe('Unverified');
    expect(getApplicationLiveAttributeVerifications(application, [gradeReport]))
      .toMatchObject({ qpi: 'Verified', academicStanding: 'Verified' });
  });

  it('reads the attached file status now and ignores vault files the case does not attach', () => {
    const attached = { ...doc('attached', 'Income Proof', 'Rejected', '2026-10-21T04:54:19.000Z'), linkedAttributes: ['householdIncome'] };
    const vaultOnly = { ...doc('vault-only', 'Grade Report', 'Verified', '2026-10-21T04:54:12.000Z'), linkedAttributes: ['qpi'] };
    expect(getApplicationLiveAttributeVerifications(submittedApplication([attached]), [attached, vaultOnly]))
      .toMatchObject({ householdIncome: 'Rejected', qpi: 'Unverified' });
  });

  it('still counts a file whose links were not recorded at upload', () => {
    const gradeReport = doc('legacy-report', 'Grade Report', 'Verified', '2026-10-21T04:54:12.000Z');
    expect(getApplicationLiveAttributeVerifications(submittedApplication([gradeReport]), [gradeReport]).qpi).toBe('Verified');
  });

  it('judges an annual proof at submission time, so a later academic year never reads Outdated', () => {
    const transcript = {
      ...doc('transcript', 'Transcript', 'Verified', '2026-10-21T04:54:12.000Z'),
      linkedAttributes: ['qpi', 'academicStanding'],
      attestedValues: { qpi: 3.3 },
    };
    expect(getApplicationLiveAttributeVerifications(submittedApplication([transcript]), [transcript], { today: new Date('2027-07-01T00:00:00.000Z') }))
      .toMatchObject({ qpi: 'Verified', academicStanding: 'Verified' });
  });
});
