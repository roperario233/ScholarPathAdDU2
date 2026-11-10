// Synthetic, internally consistent import fixtures for the operator import test
// (scripts/loadtest-import.mjs). Plain ESM with no browser or bundler imports, so
// plain `node` can run it; tests/importFixture.test.js compares its snapshot with
// the real buildProfileSnapshot() and its answers with the app's own gates, so the
// two cannot drift apart unnoticed.
//
// Every student is a continuing student on a throwaway General Pool scholarship,
// with no honors, IP, PWD or employment claim, so exactly two proof documents are
// required (a grade report and an income proof) and both prove only values that
// match the profile.

import { academicPrograms } from '../../src/lib/academicPrograms.js';

export const IMPORT_TEST_TITLE = 'LOAD TEST Import Grant-in-Aid (GIA) - safe to delete';
export const IMPORT_EMAIL_DOMAIN = 'loadtest-import.scholarpath.invalid';
export const IMPORT_NAME_PREFIX = 'Load Test Import Student';
export const SNAPSHOT_VERSION = 4;

export const importStudentEmail = (index) => `loadtest-import-${String(index).padStart(4, '0')}@${IMPORT_EMAIL_DOMAIN}`;
export const importStudentName = (index) => `${IMPORT_NAME_PREFIX} ${String(index).padStart(4, '0')}`;

// What the throwaway scholarship asks every applicant to attach.
export const FIXTURE_REQUIRED_DOCUMENTS = [
  { id: 'grade-report', label: 'Grade report', documentTypes: ['Grade Report'], standing: 'continuing' },
  { id: 'income-proof', label: 'Proof of income', documentTypes: ['Income Proof'], standing: 'all' },
];

export const IMPORT_SCHOLARSHIP_ROW = Object.freeze({
  title: IMPORT_TEST_TITLE,
  category: 'Grant-in-Aid',
  origin: 'AdDU internal',
  coverage_type: 'Partial',
  coverage: 'Load test only - not a real scholarship',
  rule_family: 'general-pool',
  // Stated explicitly: the import function compares income and QPI with these
  // columns, and an older column default can otherwise leave a low ceiling.
  maximum_income: 250000,
  minimum_qpi: 2.5,
  minimum_shs_average: 85,
  is_active: false,
  is_matchable: true,
  is_external: false,
  required_documents: FIXTURE_REQUIRED_DOCUMENTS,
});

// A spread of real program keys (never BS Nursing or BS Architecture, which the
// General Pool excludes).
const PROGRAMS = academicPrograms
  .filter((program) => !['BS Nursing', 'BS Architecture'].includes(program.value))
  .slice(0, 24);

const STANDINGS = ['2nd', '3rd', '4th'];
const SEXES = ['Female', 'Male'];

export const buildStudent = (index) => {
  const program = PROGRAMS[index % PROGRAMS.length];
  const female = SEXES[index % 2] === 'Female';
  const qpi = Number((2.6 + (index % 14) * 0.1).toFixed(2));
  const householdIncome = 60000 + (index % 19) * 10000;
  const fullName = importStudentName(index);
  const profile = {
    fullName,
    studentNumber: `2024${String(index).padStart(5, '0')}`,
    degreeProgram: program.value,
    department: program.school,
    yearStanding: STANDINGS[index % STANDINGS.length],
    qpi,
    householdIncome,
    citizenship: 'Filipino',
    academicStanding: 'good',
    civilStatus: 'Single',
    completeAddress: `Block ${index % 40}, Lot ${index % 25}, Davao City`,
    sameAsCompleteAddress: true,
    residingAddress: '',
    country: 'Philippines',
    housingType: 'I live at home',
    ipCommunity: 'No',
    pwd: 'No',
    employed: 'Not employed',
    isTransferee: 'No',
    phone: '09000000000',
    email: importStudentEmail(index),
    birthdate: '2005-04-12',
    sexAtBirth: SEXES[index % 2],
    religion: 'Roman Catholic',
    pronouns: female ? 'she/her' : 'he/him',
    awards: '',
    awardsNone: true,
    previousGrantsAnswered: 'No',
    previousGrants: [],
    hsStrand: 'STEM',
    communityService: index % 3 === 0 ? 'No' : 'Yes',
    schoolLastAttended: { name: 'Davao Senior High School', city: 'Davao City', province: 'Davao del Sur' },
    familyDetails: {
      fatherName: `Father of ${fullName}`,
      fatherAge: 45 + (index % 15),
      fatherOccupation: 'Driver',
      motherName: `Mother of ${fullName}`,
      motherAge: 42 + (index % 15),
      motherOccupation: 'Vendor',
      familyPosition: 'Eldest',
      numberOfSiblings: 0,
      siblingsNone: true,
      householdAdultsNone: true,
    },
    financialProfile: {
      economicStatus: 'lower',
      father: { employmentStatus: 'employed', annualIncome: householdIncome, employer: 'Davao Transit' },
      mother: { employmentStatus: 'unemployed', annualIncome: 0, lastEmployed: 'March 2024', unemploymentReason: 'Health' },
      assets: { none: true, others: '' },
      appliances: { none: true, others: '' },
    },
  };
  const financialAnswers = {
    otherIncomeAnswer: 'no',
    difficultyAnswer: 'no',
    allowanceEnough: 'yes',
    foodIntakeAdequacy: 'adequate',
    transportMode: 'jeepney',
    allowanceDaily: '150',
    expenseFood: '80',
    expenseTransport: '40',
    expenseOther: '30',
  };
  return { profile, financialProfile: profile.financialProfile, financialAnswers, program };
};

const asText = (value) => (value == null ? '' : String(value).trim());
const asNumberOrNull = (value) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
const status = 'Unverified';
const proven = (value) => ({ value: asText(value), verification: status });

const YEAR_LABELS = { '2nd': 'Incoming 2nd year', '3rd': 'Incoming 3rd year', '4th': 'Incoming 4th year' };

// The same group layout as buildProfileSnapshot() in
// src/lib/applicationRequirements.js (version 4), for the profiles this fixture builds.
export const buildSnapshot = (profile, capturedAt) => {
  const family = profile.familyDetails;
  return {
    version: SNAPSHOT_VERSION,
    capturedAt,
    fullName: profile.fullName,
    studentNumber: profile.studentNumber,
    degreeProgram: profile.degreeProgram,
    department: profile.department,
    yearStanding: profile.yearStanding,
    yearStandingLabel: YEAR_LABELS[profile.yearStanding],
    academic: { credential: 'qpi', label: 'Annual QPI', value: Number(profile.qpi), verification: status },
    householdIncome: { value: Number(profile.householdIncome), verification: status },
    citizenship: { value: profile.citizenship, verification: status },
    eligibility: {
      academicStanding: proven(profile.academicStanding),
      honorsRank: proven(''),
      graduatingClassSize: null,
      isOnPrepaidPlan: false,
      hasSiblingOnAid: false,
      hasOtherActiveScholarship: false,
      isTransferee: profile.isTransferee,
      hsStrand: profile.hsStrand,
    },
    background: {
      ipCommunity: proven(profile.ipCommunity),
      pwd: proven(profile.pwd),
      employed: proven(profile.employed),
      ipGroupName: '',
    },
    personal: {
      firstName: '',
      middleName: '',
      lastName: '',
      civilStatus: profile.civilStatus,
      religion: profile.religion,
      religionOther: '',
      birthdate: profile.birthdate,
      sexAtBirth: profile.sexAtBirth,
      pronouns: profile.pronouns,
      email: profile.email,
      phone: profile.phone,
    },
    address: {
      completeAddress: profile.completeAddress,
      residingAddress: profile.completeAddress,
      country: profile.country,
      housingType: profile.housingType,
      housingOther: '',
      verification: { completeAddress: status, residingAddress: status },
    },
    education: {
      schoolLastAttended: { ...profile.schoolLastAttended },
      awards: asText(profile.awards),
    },
    family: {
      fatherUnknown: false,
      fatherName: family.fatherName,
      fatherOccupation: family.fatherOccupation,
      fatherDeceased: false,
      fatherAge: asNumberOrNull(family.fatherAge),
      fatherDateOfDeath: '',
      motherUnknown: false,
      motherName: family.motherName,
      motherOccupation: family.motherOccupation,
      motherDeceased: false,
      motherAge: asNumberOrNull(family.motherAge),
      motherDateOfDeath: '',
      familyPosition: family.familyPosition,
      numberOfSiblings: asNumberOrNull(family.numberOfSiblings),
      siblings: [],
      householdAdults: [],
      verification: { parents: status, householdMembers: status },
    },
    aid: { communityService: profile.communityService, previousGrants: [] },
  };
};

// A tiny valid PDF so the uploaded objects are real, openable files.
export const buildPlaceholderPdf = (label) => {
  const text = `BT /F1 14 Tf 20 60 Td (${label} - LOAD TEST) Tj ET`;
  return [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
    `4 0 obj<</Length ${text.length}>>stream`,
    text,
    'endstream endobj',
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
    'trailer<</Root 1 0 R/Size 6>>',
    '%%EOF',
    '',
  ].join('\n');
};

const DAY_MS = 86_400_000;

// One manifest record per student. `ids` supplies the application and document
// UUIDs so the same manifest can be rebuilt byte-for-byte on a rerun.
export const buildRecord = ({ index, studentId, scholarshipId, applicationId, gradeReportId, incomeProofId, now }) => {
  const { profile, financialProfile, financialAnswers } = buildStudent(index);
  const submittedAt = new Date(now.getTime() - ((index % 25) + 1) * DAY_MS - (index % 24) * 3_600_000);
  const uploadedAt = new Date(submittedAt.getTime() - DAY_MS);
  return {
    sourceId: `loadtest-import-${String(index).padStart(5, '0')}`,
    application: {
      id: applicationId,
      student_id: studentId,
      scholarship_id: scholarshipId,
      submitted_at: submittedAt.toISOString(),
      certified_at: submittedAt.toISOString(),
      statement: `Load test statement ${index}: I am applying because the scholarship would let me continue my studies.`,
      profile_snapshot: buildSnapshot(profile, submittedAt.toISOString()),
      financial_snapshot: financialProfile,
      financial_answers: financialAnswers,
    },
    documents: [
      {
        id: gradeReportId,
        document_type: 'Grade Report',
        file_name: 'grade-report.pdf',
        title: 'Grade Report',
        file_path: 'files/grade-report.pdf',
        uploaded_at: uploadedAt.toISOString(),
        linked_attributes: ['qpi', 'academicStanding'],
        attested_values: { qpi: profile.qpi, academicStanding: profile.academicStanding },
      },
      {
        id: incomeProofId,
        document_type: 'Income Proof',
        file_name: 'income-proof.pdf',
        title: 'Income Proof',
        file_path: 'files/income-proof.pdf',
        uploaded_at: uploadedAt.toISOString(),
        linked_attributes: ['householdIncome'],
        attested_values: { householdIncome: profile.householdIncome },
      },
    ],
  };
};

// Pure pass/fail rules for the post-import reconciliation.
export const evaluateImport = ({ expected, counts }) => {
  const checks = [
    { name: 'Every case is stored as Submitted', ok: counts.submitted === expected, detail: `${counts.submitted} of ${expected}` },
    { name: 'The import ledger has one row per case', ok: counts.importRecords === expected, detail: `${counts.importRecords} of ${expected}` },
    { name: 'The batch finished as completed', ok: counts.batchStatus === 'completed' && counts.batchFailed === 0, detail: `${counts.batchStatus}, ${counts.batchFailed} failed rows` },
    { name: 'Two documents are attached to every case', ok: counts.links === expected * 2, detail: `${counts.links} of ${expected * 2}` },
    { name: 'Every document is awaiting verification (no decision invented)', ok: counts.pendingDocuments === expected * 2 && counts.decidedDocuments === 0, detail: `${counts.pendingDocuments} pending, ${counts.decidedDocuments} decided` },
    { name: 'Every case has its frozen financial snapshot', ok: counts.financialSnapshots === expected, detail: `${counts.financialSnapshots} of ${expected}` },
    { name: 'Exactly one Submitted status-history row per case, from the system', ok: counts.submittedLogRows === expected && counts.systemLogRows === expected, detail: `${counts.submittedLogRows} rows, ${counts.systemLogRows} by the system` },
    { name: 'No notification was sent for a historical case', ok: counts.notifications === 0 && counts.outboxRows === 0, detail: `${counts.notifications} in-app, ${counts.outboxRows} queued` },
    { name: 'The sampled stored files exist', ok: counts.sampledFilesMissing === 0, detail: `${counts.sampledFilesChecked} checked, ${counts.sampledFilesMissing} missing` },
  ];
  return { checks, passed: checks.every((check) => check.ok) };
};
