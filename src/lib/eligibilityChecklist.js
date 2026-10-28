import {
  GENERAL_POOL_EXCLUDED_DEGREES,
  GENERAL_POOL_INCOME_CEILING,
  evaluateApplicationGate,
  evaluateScholarship,
  getAcademicRequirement,
  getDeadlineStatus,
  getInternalRuleFamily,
} from './eligibility';
import { fmtCurrency, fmtDate } from './formatters';
import { academicStandingOptions, getProfileSectionForField } from './profile';

const isBlank = (value) => value == null || String(value).trim() === '';
const optionLabel = (options, value) => options.find((option) => option.value === value)?.label || value;

// The Smart Eligibility Checker as one row per criterion, for the Scholarship
// Explorer. It is a presentation layer over evaluateApplicationGate (the gate
// Start application reads) and evaluateScholarship (the rule branch), never a
// second rule set: a row fails only when one of their issues names its field,
// and an issue no row claims lands on the program row, so every reason the
// gate gives is shown. The rule branch is read even when the gate stopped at
// an unanswered question, so the student sees every check at once.
export const getEligibilityChecklist = (profile = {}, scholarship = {}) => {
  const gate = evaluateApplicationGate(profile, scholarship);
  const ruleFamily = getInternalRuleFamily(scholarship);
  const ruleIssues = ruleFamily ? evaluateScholarship(profile, { ...scholarship, ruleFamily }).issues : [];
  const gateFields = new Set(gate.issues.map((item) => item.field).filter(Boolean));
  const seen = new Set();
  const issues = [...gate.issues, ...ruleIssues.filter((item) => !item.field || !gateFields.has(item.field))]
    .filter((item) => (seen.has(item.message) ? false : seen.add(item.message)));

  const academic = getAcademicRequirement(profile, scholarship);
  const isGeneralPool = ruleFamily === 'general-pool';
  const exclusionAnswers = [
    profile.isOnPrepaidPlan && 'Prepaid tuition plan',
    profile.hasSiblingOnAid && 'Sibling on AdDU aid',
    profile.hasOtherActiveScholarship && 'Another active scholarship',
  ].filter(Boolean);
  const deadline = getDeadlineStatus(scholarship.deadline);

  const definitions = [
    // Every track needs the answer; only the general pool sets a floor.
    {
      key: 'academic',
      label: academic.label,
      fields: [academic.credential],
      answer: isBlank(academic.rawValue) ? null : String(academic.rawValue),
      required: isGeneralPool ? `${academic.floorLabel} or higher` : 'Answered (no minimum)',
    },
    {
      key: 'householdIncome',
      label: 'Household income',
      fields: ['householdIncome'],
      answer: isBlank(profile.householdIncome) ? null : fmtCurrency(profile.householdIncome),
      required: isGeneralPool ? `Up to ${fmtCurrency(scholarship.maximumIncome ?? GENERAL_POOL_INCOME_CEILING)}` : 'Answered (no limit)',
    },
    {
      key: 'degreeProgram',
      label: 'Degree program',
      fields: ['degreeProgram'],
      answer: isBlank(profile.degreeProgram) ? null : profile.degreeProgram,
      required: isGeneralPool ? `Any except ${GENERAL_POOL_EXCLUDED_DEGREES.join(' and ')}` : 'All programs',
    },
    {
      key: 'citizenship',
      label: 'Citizenship',
      fields: ['citizenship'],
      answer: isBlank(profile.citizenship) ? null : profile.citizenship,
      required: 'Filipino',
    },
    {
      key: 'academicStanding',
      label: 'Academic standing',
      fields: ['academicStanding'],
      answer: isBlank(profile.academicStanding) ? null : optionLabel(academicStandingOptions, profile.academicStanding),
      required: 'Not academically disqualified',
    },
    {
      key: 'exclusions',
      label: 'Exclusion Flag Hierarchy',
      fields: ['isOnPrepaidPlan', 'hasSiblingOnAid', 'hasOtherActiveScholarship'],
      answer: exclusionAnswers.length ? exclusionAnswers.join(', ') : 'None declared',
      required: 'No prepaid plan, sibling on AdDU aid, or other scholarship',
    },
    {
      key: 'program',
      label: 'Application window',
      fields: [],
      answer: scholarship.deadline ? `${deadline.label} · ${fmtDate(scholarship.deadline)}` : deadline.label,
      required: 'Open for applications',
    },
    // Track-only checks come last, so the criteria every track shares fall on the
    // same rows in each Scholarship Explorer card and line up across them.
    ruleFamily === 'honors' && {
      key: 'honorsRank',
      label: 'Graduation honors',
      fields: ['honorsRank'],
      answer: isBlank(profile.honorsRank) ? 'None' : profile.honorsRank,
      required: 'Valedictorian or Salutatorian',
    },
    ruleFamily === 'honors' && {
      key: 'graduatingClassSize',
      label: 'Graduating class size',
      fields: ['graduatingClassSize'],
      answer: isBlank(profile.graduatingClassSize) ? null : `${profile.graduatingClassSize} students`,
      required: '80 students or more',
    },
  ].filter(Boolean);

  const claimed = new Set(definitions.flatMap((row) => row.fields));
  const rows = definitions.map((row) => {
    const rowIssues = row.key === 'program'
      ? issues.filter((item) => !item.field || !claimed.has(item.field))
      : issues.filter((item) => row.fields.includes(item.field));
    const status = !rowIssues.length ? 'pass' : row.answer == null ? 'unanswered' : 'fail';
    // The first issue with an editing section decides where Update links to, and
    // its field is the answer highlighted there.
    const linked = rowIssues.find((item) => getProfileSectionForField(item.field));
    const section = linked ? getProfileSectionForField(linked.field) : null;
    return { ...row, status, messages: rowIssues.map((item) => item.message), section, field: linked?.field || null };
  });

  const failed = rows.filter((row) => row.status === 'fail').length;
  const unanswered = rows.filter((row) => row.status === 'unanswered').length;
  const verdict = gate.allowed ? 'eligible' : failed ? 'ineligible' : 'incomplete';
  return { verdict, rows, failed, unanswered, passed: rows.length - failed - unanswered, gate };
};
