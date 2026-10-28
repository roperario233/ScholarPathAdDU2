import { ADDU_INTERNAL_PROGRAM_TITLES, getInternalRuleFamily, isAdduInternalProgram } from './eligibility';
import { getCatalogRequirements } from './applicationRequirements';
import { getStandingRequirements } from './profile';

// The explanations the student Dashboard shows for the three AdDU internal
// financial aid pipelines, written from the Office of Admission and Aid
// scholarship leaflet. Coverage and the descriptions come from the leaflet;
// the documents a student must submit come from the catalog entry
// (getCatalogRequirements), so the Dashboard lists exactly what the
// application workspace will ask for.
export const SCHOLARSHIP_GUIDES = [
  {
    ruleFamily: 'general-pool',
    catalogTitle: ADDU_INTERNAL_PROGRAM_TITLES[0],
    name: 'Grant-in-Aid (GIA)',
    kind: 'Financial assistance',
    summary: 'General financial assistance given in varying amounts to students who need help meeting their tuition and fees.',
    coverage: ['From 100% tuition and fees down to Php 10,000 every semester'],
    criteria: [
      'Demonstrated financial need, shown through proof of financial capacity',
    ],
  },
  {
    ruleFamily: 'work-study',
    catalogTitle: ADDU_INTERNAL_PROGRAM_TITLES[2],
    name: 'Working Scholar Program (WSP)',
    kind: 'Work-study',
    summary: 'Financial assistance in which recipients render service hours as payment for a portion of their total assessment.',
    coverage: ['100% tuition and fees'],
    criteria: [
      'Willing to render at least four (4) hours of service a day',
      'Enrolled in, or entering, one of the WSP programs',
    ],
    // The leaflet's WSP program list, as printed. The eligibility rule reads the
    // matching taxonomy keys in WORKING_SCHOLAR_ELIGIBLE_DEGREES.
    programs: [
      {
        heading: 'Bachelor of Science in',
        names: ['Business Management', 'Entrepreneurship', 'Finance', 'Human Resource Development and Management', 'Management Accounting', 'Marketing', 'Mathematics'],
      },
      { heading: 'Bachelor in', names: ['Public Management'] },
      {
        heading: 'Bachelor of Arts in',
        names: ['Communication', 'Development Studies', 'Economics', 'English', 'Interdisciplinary Studies', 'International Studies', 'Philosophy', 'Political Science', 'Psychology', 'Sociology'],
      },
    ],
  },
  {
    ruleFamily: 'honors',
    catalogTitle: ADDU_INTERNAL_PROGRAM_TITLES[1],
    name: 'Jubilee Scholarship (JSF)',
    kind: 'Academic scholarship',
    summary: 'An academic scholarship for students who graduated Valedictorian or Salutatorian from senior high school.',
    coverage: ['Valedictorian (Rank 1): 100% tuition only', 'Salutatorian (Rank 2): 50% tuition only'],
    criteria: [
      'Graduated Valedictorian (Rank 1) or Salutatorian (Rank 2) from senior high school',
      'Graduating class of at least 80 students',
    ],
  },
];

// The leaflet guide for a catalog entry, or null when it is not one of the
// three tracks.
export const getScholarshipGuide = (scholarship = {}) => {
  const ruleFamily = isAdduInternalProgram(scholarship) ? getInternalRuleFamily(scholarship) : null;
  return SCHOLARSHIP_GUIDES.find((guide) => guide.ruleFamily === ruleFamily) || null;
};

// Every applicant to any of the three tracks must meet these first.
export const PRELIMINARY_REQUIREMENTS = [
  'Take and pass the QEAC examination.',
  'Have no failing grade in any subject.',
  'Obtain a minimum overall average of 85%.',
];

export const APPLICATION_PERIODS = [
  { label: 'First semester', detail: 'January to April, before the start of the next school year.' },
  { label: 'Second semester', detail: 'The last month of the first semester of the current school year, subject to availability.' },
];

// One card per guide, joined to its live catalog entry (when the catalog has
// one) and to the catalog documents for the student's standing. A track the
// catalog has not loaded still shows its rule-family default documents.
export const getScholarshipGuideCards = (scholarships = [], profile = {}) => {
  const standing = getStandingRequirements(profile);
  const internal = scholarships.filter(isAdduInternalProgram);
  return SCHOLARSHIP_GUIDES.map((guide) => {
    const scholarship = internal.find((entry) => getInternalRuleFamily(entry) === guide.ruleFamily) || null;
    const requirements = getCatalogRequirements(scholarship || { title: guide.catalogTitle, ruleFamily: guide.ruleFamily })
      .filter((item) => (
        item.standing === 'all'
        || (standing.yearStanding && (item.standing === 'incoming') === standing.isIncomingFirstYear)
      ));
    return { ...guide, scholarship, requirements };
  });
};
