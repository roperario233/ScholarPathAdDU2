import { getStandingRequirements } from './profile';

const toDate = (value) => new Date(value);
const daysBetween = (dateA, dateB) => Math.round((dateB.getTime() - dateA.getTime()) / 86400000);

export const GENERAL_POOL_INCOME_CEILING = 250000;
export const GENERAL_POOL_QPI_FLOOR = 2.5;
// Incoming first-years have no collegiate QPI yet, so the general pool gates
// them on their senior high school general average instead. This mirrors the
// QPI floor for the standing where a collegiate QPI does not apply; a
// scholarship can override it with its own `minimumShsAverage` catalog value.
export const GENERAL_POOL_SHS_AVERAGE_FLOOR = 85;
export const GENERAL_POOL_EXCLUDED_DEGREES = ['BS Nursing', 'BS Architecture'];

const toFiniteNumber = (value) => {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

// The academic credential the engine reads for a standing. This is the
// eligibility half of the profile layer's single standing control
// (getStandingRequirements in src/lib/profile.js): an incoming first-year is
// matched on their senior high school general average, and every enrolled year
// (1st–5th) is matched on the collegiate QPI. The credential keys are the
// profile field names (`hsAverage` and `qpi`).
export const getAcademicCredential = (profile) => (
  getStandingRequirements(profile).isIncomingFirstYear ? 'hsAverage' : 'qpi'
);

// Resolves the exact academic requirement a scholarship applies to this student:
// which credential, which floor, and the messages the application gate and the
// general-pool evaluator surface. The Admissions Office catalog stores a
// collegiate QPI floor (`minimumQpi`) and an incoming first-year floor
// (`minimumShsAverage`); a blank entry falls back to the internal rule default.
export const getAcademicRequirement = (profile, scholarship = {}) => {
  const credential = getAcademicCredential(profile);
  const rawValue = profile?.[credential];
  if (credential === 'hsAverage') {
    const min = toFiniteNumber(scholarship?.minimumShsAverage) ?? GENERAL_POOL_SHS_AVERAGE_FLOOR;
    return {
      credential,
      label: 'Senior high school general average',
      shortLabel: 'SHS GWA',
      detailLabel: 'Minimum SHS general average',
      unit: '/100',
      rawValue,
      value: toFiniteNumber(rawValue),
      min,
      hardMin: 60,
      max: 100,
      // Normalizes the SHS 60–100 span onto the QPI margin scale for fit scoring.
      scale: 20,
      catalogFloor: toFiniteNumber(scholarship?.minimumShsAverage),
      floorLabel: String(min),
      floorReason: `Needs a senior high school general average of ${min}+.`,
      unsetReason: 'Enter your senior high school general average before checking qualifications.',
      rangeReason: 'Your senior high school general average must be between 60 and 100.',
    };
  }
  const min = toFiniteNumber(scholarship?.minimumQpi) ?? GENERAL_POOL_QPI_FLOOR;
  return {
    credential,
    label: 'Annual QPI',
    shortLabel: 'QPI',
    detailLabel: 'Minimum QPI',
    unit: '',
    rawValue,
    value: toFiniteNumber(rawValue),
    min,
    hardMin: 0,
    max: 4,
    scale: 1,
    catalogFloor: toFiniteNumber(scholarship?.minimumQpi),
    floorLabel: min.toFixed(2),
    floorReason: `Needs QPI ${min.toFixed(2)}+.`,
    unsetReason: 'Enter a valid QPI before checking qualifications.',
    rangeReason: 'QPI must be between 0.00 and 4.00.',
  };
};

export const ADDU_INTERNAL_RULE_FAMILIES = ['general-pool', 'honors', 'work-study'];
export const DENIAL_MESSAGE = "You don't have any qualifications for this scholarship.";

export const ADDU_INTERNAL_PROGRAM_TITLES = [
  'Grant-in-Aid (GIA)',
  'Jubilee Scholarship Fund (Valedictorian & Salutatorian)',
  'Student Assistant (SA) Program',
];

const ADDU_INTERNAL_PROGRAM_TITLE_SET = new Set(ADDU_INTERNAL_PROGRAM_TITLES.map((title) => title.toLowerCase()));

// A title that names one of the three in-scope tracks, tolerating the wording
// variants the catalog and the documents use (for example "Jubilee Scholarship"
// and "Student Assistant Program (Working Scholars)").
const ADDU_INTERNAL_PROGRAM_TITLE_PATTERN = /jubilee|grant[ -]?in[ -]?aid|\bgia\b|student assistant|working scholar/;

// The single in-scope predicate: only GIA, Jubilee, and the Student Assistant /
// Working Scholar program may be applied to. It reads the *title*, never
// ruleFamily/category alone, because other internal catalog entries (for example
// a donor endowment set to `general-pool`) share those values without being one
// of the three tracks. Use this wherever an application can be started,
// continued, or submitted; `isInternalScholarship` below is the looser
// catalog-listing helper and must not gate the application lifecycle.
export const isAdduInternalProgram = (scholarship = {}) => {
  const title = String(scholarship.title || '').trim().toLowerCase();
  return ADDU_INTERNAL_PROGRAM_TITLE_SET.has(title) || ADDU_INTERNAL_PROGRAM_TITLE_PATTERN.test(title);
};

// The Explorer currently surfaces only the three AdDU programs in scope.
export const getAdduInternalPrograms = (scholarships = []) => scholarships.filter(isAdduInternalProgram);

export const isInternalScholarship = (scholarship = {}) => {
  if (ADDU_INTERNAL_RULE_FAMILIES.includes(scholarship.ruleFamily)) return true;
  const title = String(scholarship.title || '').toLowerCase();
  return /jubilee|grant[ -]?in[ -]?aid|\bgia\b|student assistant|working scholar/.test(title);
};

export const getInternalScholarships = (scholarships = []) => scholarships.filter(isInternalScholarship);

const getInternalRuleFamily = (scholarship) => {
  if (ADDU_INTERNAL_RULE_FAMILIES.includes(scholarship.ruleFamily)) return scholarship.ruleFamily;
  const title = String(scholarship.title || '').toLowerCase();
  if (/jubilee/.test(title)) return 'honors';
  if (/student assistant|working scholar/.test(title)) return 'work-study';
  if (/grant[ -]?in[ -]?aid|\bgia\b/.test(title)) return 'general-pool';
  return null;
};

// The academic requirement chip a catalog entry shows for a student's standing,
// resolved from the same model the gate and evaluator use. Returns null when the
// entry has no academic gate (honors and work-study gate on other criteria).
export const getScholarshipAcademicDisplay = (profile, scholarship = {}) => {
  const ruleFamily = getInternalRuleFamily(scholarship) || scholarship.ruleFamily;
  const requirement = getAcademicRequirement(profile, scholarship);
  const hasFloor = requirement.catalogFloor != null || ruleFamily === 'general-pool';
  if (!hasFloor) return null;
  return {
    credential: requirement.credential,
    label: requirement.shortLabel,
    detailLabel: requirement.detailLabel,
    floorLabel: requirement.floorLabel,
  };
};

export const getDeadlineStatus = (deadline, today = new Date()) => {
  if (!deadline) return { label: 'Rolling / TBA', tone: 'neutral', remainingDays: null };
  const due = toDate(deadline);
  const remainingDays = daysBetween(today, due);
  if (Number.isNaN(due.getTime())) return { label: 'Unknown', tone: 'neutral', remainingDays: null };
  if (remainingDays < 0) return { label: 'Closed', tone: 'danger', remainingDays };
  if (remainingDays <= 3) return { label: 'Urgent', tone: 'warning', remainingDays };
  if (remainingDays <= 14) return { label: 'Active', tone: 'success', remainingDays };
  return { label: 'Upcoming', tone: 'info', remainingDays };
};

// A failed check, tagged with the profile field the student can change to
// resolve it (null when no profile answer is involved, such as a closed
// deadline). `reasons` stays the plain message list; `issues` lets the Smart
// Eligibility Checker link each message to its My Profile section.
const issue = (message, field = null) => ({ message, field });
const toReasons = (issues) => issues.map((item) => item.message);

export const checkUniversalGate = (profile) => {
  const issues = [];
  if (profile.citizenship && profile.citizenship !== 'Filipino') {
    issues.push(issue('Non-Filipino citizenship — every program requires Filipino citizenship.', 'citizenship'));
  }
  return { passed: issues.length === 0, reasons: toReasons(issues), issues };
};

export const checkAdduInternalGate = (profile) => {
  const issues = [];
  if (profile.isOnPrepaidPlan) issues.push(issue('On a prepaid tuition-and-fee plan — excluded from AdDU financial aid.', 'isOnPrepaidPlan'));
  if (profile.hasSiblingOnAid) issues.push(issue('A sibling is currently on AdDU financial aid — automatically waitlisted.', 'hasSiblingOnAid'));
  if (profile.hasOtherActiveScholarship) issues.push(issue('Holds another scholarship without College Scholarship Committee approval.', 'hasOtherActiveScholarship'));
  if (profile.academicStanding === 'disqualified') issues.push(issue('Academically disqualified students are ineligible for AdDU-administered aid.', 'academicStanding'));
  return { passed: issues.length === 0, reasons: toReasons(issues), issues };
};

export const getScholarshipFit = (profile, scholarship) => {
  if (scholarship.maximumIncome == null) return null;
  const academic = getAcademicRequirement(profile, scholarship);
  // Only a scholarship that declares a floor for the student's standing has a
  // measurable academic margin; honors and work-study declare none.
  if (academic.catalogFloor == null || academic.value == null) return null;
  // Normalize the academic margin so QPI (0.00–4.00) and SHS GWA (60–100)
  // profiles rank on the same footing.
  const academicMargin = (academic.value - academic.min) / academic.scale;
  const incomeMargin = Number(scholarship.maximumIncome) - Number(profile.householdIncome);
  return Number(((academicMargin * 0.5) + ((incomeMargin / 10000) * 0.5)).toFixed(2));
};

const evaluateGeneralPool = (profile, scholarship) => {
  const issues = [];
  const income = Number(profile.householdIncome);
  const maxIncome = scholarship.maximumIncome ?? GENERAL_POOL_INCOME_CEILING;
  // The academic gate follows the standing: a collegiate QPI for enrolled
  // students, a senior high school general average for incoming first-years.
  const academic = getAcademicRequirement(profile, scholarship);
  const academicValue = Number(academic.rawValue);
  if (!(academicValue >= academic.min)) issues.push(issue(academic.floorReason, academic.credential));
  if (income > maxIncome) issues.push(issue(`Household income must be at or below \u20b1${maxIncome.toLocaleString()}.`, 'householdIncome'));
  if (GENERAL_POOL_EXCLUDED_DEGREES.includes(profile.degreeProgram)) {
    issues.push(issue(`${profile.degreeProgram} is excluded from the general scholarship pool.`, 'degreeProgram'));
  }
  return issues;
};

const evaluateHonorsTrack = (profile) => {
  const issues = [];
  if (!profile.isHonorsGraduate) issues.push(issue('Requires official Valedictorian or Salutatorian standing.', 'honorsRank'));
  if (!profile.graduatingClassSize || Number(profile.graduatingClassSize) < 80) issues.push(issue('Graduating class must have at least 80 students.', 'graduatingClassSize'));
  return issues;
};

const evaluateWorkStudy = () => [];

const GOV_EVALUATORS = {
  CHED_SSP: () => [issue('SSP is reserved for SUC/LUC students \u2014 AdDU is a private HEI, so this program does not apply.')],
  CHED_DEFAULT: (profile) => {
    const issues = [];
    if (Number(profile.householdIncome) > 500000) issues.push(issue('Exceeds the CHED income ceiling (confirm with CHEDRO XI for the current cycle).', 'householdIncome'));
    return issues;
  },
  DOST_FRESHMAN: (profile) => {
    const issues = [];
    const isIncomingFreshman = getStandingRequirements(profile).isIncomingFirstYear;
    if (!isIncomingFreshman) issues.push(issue('Only open to incoming first-year students with no prior college units.', 'yearStanding'));
    if (profile.hsStrand !== 'STEM' && Number(profile.hsAverage || 0) < 95) issues.push(issue('Non-STEM strand applicants must be in the top 5% of their graduating class.', 'hsStrand'));
    return issues;
  },
  DOST_JLAP: (profile) => {
    const issues = [];
    if (getStandingRequirements(profile).isIncomingFirstYear) issues.push(issue('JLAP/JLSS targets continuing (2nd year+) students, not incoming freshmen.', 'yearStanding'));
    issues.push(issue('__INFO__Opens periodically \u2014 confirm current availability with DOST-SEI.'));
    return issues;
  },
  GSIS: (profile) => {
    if (!profile.sponsorTies?.gsisMemberDependent) return [issue('Requires a parent/guardian who is an active GSIS member.', 'sponsorTies')];
    return [];
  },
  AFPEBSO: (profile) => {
    if (!profile.sponsorTies?.afpDependent) return [issue('Requires the applicant to be a dependent of AFP/CAA personnel.', 'sponsorTies')];
    return [];
  },
  US_VA: (profile) => {
    if (!profile.sponsorTies?.usVeteranDependent) return [issue('Requires qualifying US veteran dependent status.', 'sponsorTies')];
    return [];
  },
};

const resolveGovEvaluator = (govProgram) => {
  if (govProgram === 'CHED_SSP') return GOV_EVALUATORS.CHED_SSP;
  if (typeof govProgram === 'string' && govProgram.startsWith('CHED_')) return GOV_EVALUATORS.CHED_DEFAULT;
  if (govProgram === 'DOST_MERIT' || govProgram === 'DOST_RA7687') return GOV_EVALUATORS.DOST_FRESHMAN;
  if (govProgram === 'DOST_JLAP') return GOV_EVALUATORS.DOST_JLAP;
  if (govProgram === 'GSIS') return GOV_EVALUATORS.GSIS;
  if (govProgram === 'AFPEBSO') return GOV_EVALUATORS.AFPEBSO;
  if (govProgram === 'US_VA') return GOV_EVALUATORS.US_VA;
  return () => [];
};

export const evaluateScholarship = (profile, scholarship) => {
  const deadlineStatus = getDeadlineStatus(scholarship.deadline);

  if (scholarship.isMatchable === false) {
    const issues = [issue('Not a student-facing application \u2014 this is a donor/giving program.')];
    return {
      eligible: false,
      reasons: toReasons(issues),
      issues,
      infoNotes: [],
      fitScore: null,
      deadlineStatus,
    };
  }

  const issues = [];
  if (!scholarship.isActive || deadlineStatus.label === 'Closed') issues.push(issue('Inactive or past deadline.'));
  issues.push(...checkUniversalGate(profile).issues);

  const isAdduAdministered = ['general-pool', 'honors', 'work-study'].includes(scholarship.ruleFamily);
  if (isAdduAdministered) issues.push(...checkAdduInternalGate(profile).issues);

  let branchOutput = [];
  switch (scholarship.ruleFamily) {
    case 'general-pool': branchOutput = evaluateGeneralPool(profile, scholarship); break;
    case 'honors': branchOutput = evaluateHonorsTrack(profile); break;
    case 'work-study': branchOutput = evaluateWorkStudy(profile, scholarship); break;
    case 'government-linked': branchOutput = resolveGovEvaluator(scholarship.govProgram)(profile); break;
    default: branchOutput = [issue('Unrecognized rule family.')];
  }

  const isInfo = (item) => item.message.startsWith('__INFO__');
  const infoNotes = branchOutput.filter(isInfo).map((item) => item.message.replace('__INFO__', ''));
  issues.push(...branchOutput.filter((item) => !isInfo(item)));

  const eligible = issues.length === 0;
  return {
    eligible,
    reasons: toReasons(issues),
    issues,
    infoNotes,
    fitScore: eligible ? getScholarshipFit(profile, scholarship) : null,
    deadlineStatus,
  };
};

export const evaluateApplicationGate = (profile, scholarship) => {
  const issues = [];
  const householdIncome = Number(profile?.householdIncome);

  // The required academic credential follows the standing: a collegiate QPI for
  // enrolled students, a senior high school general average for incoming
  // first-years. Both are self-reported.
  const academic = getAcademicRequirement(profile, scholarship);
  if (academic.value == null) {
    issues.push(issue(academic.unsetReason, academic.credential));
  } else if (academic.value < academic.hardMin || academic.value > academic.max) {
    issues.push(issue(academic.rangeReason, academic.credential));
  }

  if (profile?.householdIncome == null || profile.householdIncome === '' || !Number.isFinite(householdIncome)) {
    issues.push(issue('Enter your household income before checking qualifications.', 'householdIncome'));
  } else if (householdIncome < 0) {
    issues.push(issue('Household income cannot be negative.', 'householdIncome'));
  }

  if (!scholarship) issues.push(issue('Select an internal scholarship to check.'));
  // Only the three in-scope AdDU tracks are evaluated (and therefore only they
  // can be applied to); an unrelated internal catalog entry is rejected here.
  if (scholarship && !isAdduInternalProgram(scholarship)) {
    issues.push(issue('The Smart Eligibility Checker only evaluates AdDU internal scholarships.'));
  }

  if (scholarship && isAdduInternalProgram(scholarship) && issues.length === 0) {
    const ruleFamily = getInternalRuleFamily(scholarship);
    if (!ruleFamily) {
      issues.push(issue('Scholarship qualification rules are not configured. Please contact the Admissions Office.'));
    } else {
      issues.push(...evaluateScholarship(profile, { ...scholarship, ruleFamily }).issues);
    }
  }

  const allowed = issues.length === 0;
  return {
    allowed,
    reasons: toReasons(issues),
    issues,
    message: allowed ? 'You meet the qualifications to proceed with this scholarship application.' : DENIAL_MESSAGE,
  };
};

export const searchScholarships = (scholarships, query, filters = {}) => {
  const normalizedQuery = query.trim().toLowerCase();
  const activeToday = new Date();
  return scholarships.filter((scholarship) => {
    const deadlineStatus = getDeadlineStatus(scholarship.deadline, activeToday);
    const haystack = [scholarship.title, scholarship.category, scholarship.origin, scholarship.description, scholarship.coverage, scholarship.departmentScope, (scholarship.tags || []).join(' ')].join(' ').toLowerCase();
    const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
    const matchesCategory = !filters.category || filters.category === 'all' || scholarship.category === filters.category;
    const matchesCoverage = !filters.coverage || filters.coverage === 'all' || scholarship.coverageType === filters.coverage;
    const matchesDeadline = !filters.deadline || filters.deadline === 'all'
      || (filters.deadline === 'open' && deadlineStatus.tone !== 'danger')
      || (filters.deadline === 'urgent' && deadlineStatus.tone === 'warning')
      || (filters.deadline === 'closed' && deadlineStatus.tone === 'danger');
    const matchesActive = filters.activeOnly ? scholarship.isActive && deadlineStatus.tone !== 'danger' : true;
    return matchesQuery && matchesCategory && matchesCoverage && matchesDeadline && matchesActive;
  });
};

const sortableDeadlineTime = (deadline) => {
  if (!deadline) return Infinity;
  const time = new Date(deadline).getTime();
  return Number.isNaN(time) ? Infinity : time;
};

export const rankScholarships = (profile, scholarships) => {
  return scholarships
    .map((scholarship) => ({ ...scholarship, ...evaluateScholarship(profile, scholarship) }))
    .filter((grant) => grant.eligible)
    .sort((a, b) => {
      const aD = sortableDeadlineTime(a.deadline);
      const bD = sortableDeadlineTime(b.deadline);
      if (aD !== bD) return aD - bD;
      return (b.fitScore ?? 0) - (a.fitScore ?? 0);
    });
};

export const getApplicationProgress = (status) => {
  switch (status) {
    case 'Draft': return 15;
    case 'Submitted': return 35;
    case 'Under Review': return 45;
    case 'For Verification': return 55;
    case 'Endorsed': return 65;
    case 'Interview': return 75;
    case 'Recommended': return 85;
    case 'Approved': return 95;
    case 'Released': return 100;
    case 'Rejected': return 100;
    default: return 0;
  }
};
