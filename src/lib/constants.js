export const coverageTypes = ['all', 'Full Tuition', 'Partial Tuition', 'Allowance'];
export const applicationStatuses = ['Draft', 'Submitted', 'Under Review', 'For Verification', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released', 'Rejected'];

// Standard Procedure for Scholarship Applications stage sequence (SOP steps 3-8).
// Step 2 (Submission) maps to `Submitted`, step 3 (Document Verification) maps to
// `For Verification`, step 4 (Endorsement) maps to `Endorsed`, step 5 (Interview)
// maps to `Interview`, step 6 (Evaluation and Deliberation) maps to `Recommended`,
// step 7 (Recommendation and Approval) maps to `Approved`, and step 8 (Release of
// Results) maps to `Released`.
export const sopStages = ['Submitted', 'Under Review', 'For Verification', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released'];

const nextStatusMap = {
  Draft: ['Submitted'],
  Submitted: ['Under Review', 'For Verification', 'Rejected'],
  'Under Review': ['For Verification', 'Rejected'],
  'For Verification': ['Endorsed', 'Rejected'],
  Endorsed: ['Interview', 'Rejected'],
  Interview: ['Recommended', 'Rejected'],
  Recommended: ['Approved', 'Rejected'],
  Approved: ['Released'],
  Released: [],
  Rejected: [],
};

export const getNextApplicationStatuses = (status) => nextStatusMap[status] || [];

export const sopStageIndex = (status) => {
  const index = sopStages.indexOf(status);
  return index === -1 ? null : index;
};

export const departmentReviewStatuses = ['For Endorsement', 'Pending Documents', 'Endorsed', 'Returned'];

export const verificationStatuses = ['Pending', 'Verified', 'Rejected'];

// Profile-attribute verification states. An attribute is verified when the
// Admissions Office verifies a Document Vault file that declares it as proof
// (see src/lib/verification.js). The state is derived per attribute from the
// linked documents, so it is distinct from a document's own verificationStatus.
export const attributeVerificationStatuses = ['Unverified', 'Pending', 'Verified', 'Rejected'];

// Standard Procedure submission types (step 2 required documents) plus the
// generic fallbacks. These are the types offered when a vault file is a general
// application document rather than proof for a profile attribute.
export const generalDocumentTypeOptions = [
  { value: 'Application Form', label: 'Application Form' },
  { value: 'Entrance Exam Result', label: 'Entrance Exam Result' },
  { value: 'HS Report Card', label: 'HS Report Card' },
  { value: 'Recommendation Letter', label: 'Recommendation' },
  { value: 'Income Proof', label: 'Income Doc' },
  { value: 'Photos of Residence', label: 'Photos of Residence' },
  { value: 'Good Moral Character', label: 'Good Moral Certificate' },
  { value: 'Certificate of Award', label: 'Certificate of Award' },
  { value: 'Transcript', label: 'Transcript' },
  { value: 'Enrollment', label: 'Enrollment' },
  { value: 'Clearance', label: 'Clearance' },
  { value: 'Government ID', label: 'Government ID' },
  { value: 'Supporting Document', label: 'Supporting Doc' },
];

// Additional document types that only serve as proof for a profile attribute
// (see `acceptedDocumentTypes` in src/lib/profile.js). Kept separate from the
// Standard Procedure submission types so the SOP document check in
// ApplicationReviewModal keeps matching its own values.
export const attributeProofDocumentTypeOptions = [
  { value: 'Grade Report', label: 'Grade Report' },
  { value: 'PSA Birth Certificate', label: 'PSA Birth Certificate' },
  { value: 'Passport', label: 'Passport' },
  { value: "Driver's License", label: "Driver's License" },
  { value: 'Philippine National ID', label: 'Philippine National ID' },
  { value: 'PWD ID', label: 'PWD ID' },
  { value: 'Medical Certificate', label: 'Medical Certificate' },
  { value: 'Certificate of Employment', label: 'Certificate of Employment' },
  { value: 'Payslip', label: 'Payslip' },
  { value: 'Certificate of Indigency', label: 'Certificate of Indigency' },
  { value: 'Certificate of Tribal Membership', label: 'Certificate of Tribal Membership' },
];

// Every document type the vault can store, so `getDocumentTypeLabel` can resolve
// any stored value (including a proof type) to its display label.
export const documentTypeOptions = [...generalDocumentTypeOptions, ...attributeProofDocumentTypeOptions];

// Standard Procedure for Scholarship Applications, step 2 — required submissions.
export const sopRequiredDocuments = [
  { type: 'Application Form', label: 'Application Form' },
  { type: 'Entrance Exam Result', label: 'Entrance exam result with ACCEPTED remark' },
  { type: 'HS Report Card', label: 'HS report card with at least 85% average' },
  { type: 'Recommendation Letter', label: 'Recommendation from Homeroom Moderator' },
  { type: 'Income Proof', label: 'Financial income documents of parents / legal guardians' },
  { type: 'Photos of Residence', label: 'Photos of residence' },
  { type: 'Good Moral Character', label: 'Certificate of Good Moral Character' },
  { type: 'Certificate of Award', label: 'For academic grant, Certificate of Award as Rank 1 or 2' },
];

export const getDocumentTypeLabel = (value) => (
  documentTypeOptions.find((option) => option.value === value)?.label || value
);

