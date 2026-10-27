// The AdDU Higher Education Unit (Jacinto Campus) undergraduate academic
// hierarchy, as four levels:
//
//   School -> Cluster -> Department -> Degree program
//
// Two levels are load-bearing outside the picker:
//   * `school` is what `profiles.department` stores (the Chair's school label and
//     the identity line in the sidebar), so it must stay identical to the
//     `academic_programs.school` values in Supabase.
//   * `department` is the level the Dean / Assistant Dean / Chairperson scope
//     ladder resolves against (see src/lib/reviewScope.js).
//
// `value` is the stable key. It is written into `profiles.degree_program`,
// compared against `scholarships.eligible_degrees`, and frozen into every
// submitted application's profile snapshot, so it must never be renamed — only
// `label` and the hierarchy fields may change.
//
// Mirrors `supabase/migrations/20261042000000_academic_program_hierarchy.sql`.
// Keep the two in step: the Supabase table is the source of truth at runtime and
// this file is the offline reference fallback.

// Schools. The parenthetical code is part of the stored label, matching the
// pre-existing `profiles.department` strings, so no stored scope changes shape
// when the hierarchy is corrected.
const SCHOOL = {
  sas: 'School of Arts and Sciences (SAS)',
  sbg: 'School of Business and Governance (SBG)',
  sea: 'School of Engineering and Architecture (SEA)',
  soe: 'School of Education (SOE)',
  son: 'School of Nursing (SON)',
};

// Clusters. SEA, SOE, and SON are "direct under" schools with no sub-clusters, so
// their programs carry a null cluster.
const CLUSTER = {
  computerStudies: 'Computer Studies',
  nsm: 'Natural Sciences and Mathematics',
  socialSciences: 'Social Sciences',
  humanities: 'Humanities and Letters',
  accountancy: 'Accountancy',
  business: 'Business and Management',
};

// Academic departments. A Chairperson's scope is one of these, and an Assistant
// Dean's scope is every department in one cluster.
const DEPARTMENT = {
  computerScience: 'Computer Science Department',
  itAndIs: 'Information Technology and Information Systems Department',
  biology: 'Biology Department',
  chemistry: 'Chemistry Department',
  environmentalScience: 'Environmental Science Department',
  mathematics: 'Mathematics Department',
  physics: 'Physics Department',
  anthropology: 'Anthropology Department',
  developmentStudies: 'Development Studies Department',
  economics: 'Economics Department',
  internationalStudies: 'International Studies Department',
  islamicStudies: 'Islamic Studies Department',
  politicalScienceHistory: 'Political Science and History Department',
  psychology: 'Psychology Department',
  socialWork: 'Social Work Department',
  sociology: 'Sociology Department',
  communication: 'Communication Department',
  languagesLiteratureArts: 'Languages, Literature, and Arts Department',
  philosophy: 'Philosophy Department',
  accountancy: 'Accountancy Department',
  managementAccounting: 'Management Accounting Department',
  businessManagement: 'Business Management Department',
  entrepreneurship: 'Entrepreneurship Department',
  finance: 'Finance Department',
  hrdm: 'Human Resource Development and Management Department',
  marketing: 'Marketing Department',
  publicManagement: 'Public Management and Governance Department',
  architecture: 'Architecture Department',
  aerospace: 'Aerospace Engineering Department',
  chemicalEngineering: 'Chemical Engineering Department',
  civilEngineering: 'Civil Engineering Department',
  computerEngineering: 'Computer Engineering Department',
  electricalEngineering: 'Electrical Engineering Department',
  electronicsEngineering: 'Electronics Engineering Department',
  industrialEngineering: 'Industrial Engineering Department',
  mechanicalEngineering: 'Mechanical Engineering Department',
  roboticsEngineering: 'Robotics Engineering Department',
  teacherEducation: 'Teacher Education Department',
  nursing: 'Nursing Department',
};

// Ordered school -> cluster -> department -> program so `sort_order` in Supabase
// can reuse this array index and every picker groups identically.
const programRecords = [
  // --- School of Arts and Sciences (SAS) ---
  // Computer Studies
  { value: 'BS Computer Science', label: 'BS Computer Science', school: SCHOOL.sas, cluster: CLUSTER.computerStudies, department: DEPARTMENT.computerScience },
  { value: 'BS Data Science', label: 'BS Data Science', school: SCHOOL.sas, cluster: CLUSTER.computerStudies, department: DEPARTMENT.computerScience },
  { value: 'BS Information Systems', label: 'BS Information Systems', school: SCHOOL.sas, cluster: CLUSTER.computerStudies, department: DEPARTMENT.itAndIs },
  { value: 'BS Information Technology', label: 'BS Information Technology', school: SCHOOL.sas, cluster: CLUSTER.computerStudies, department: DEPARTMENT.itAndIs },
  // Natural Sciences and Mathematics
  { value: 'BS Biology Major in General Biology', label: 'BS Biology Major in General Biology', school: SCHOOL.sas, cluster: CLUSTER.nsm, department: DEPARTMENT.biology },
  { value: 'BS Biology Major in Medical Biology', label: 'BS Biology Major in Medical Biology', school: SCHOOL.sas, cluster: CLUSTER.nsm, department: DEPARTMENT.biology },
  { value: 'BS Chemistry', label: 'BS Chemistry', school: SCHOOL.sas, cluster: CLUSTER.nsm, department: DEPARTMENT.chemistry },
  { value: 'BS Environmental Science', label: 'BS Environmental Science', school: SCHOOL.sas, cluster: CLUSTER.nsm, department: DEPARTMENT.environmentalScience },
  { value: 'BS Mathematics', label: 'BS Mathematics', school: SCHOOL.sas, cluster: CLUSTER.nsm, department: DEPARTMENT.mathematics },
  { value: 'BS Physics', label: 'BS Physics', school: SCHOOL.sas, cluster: CLUSTER.nsm, department: DEPARTMENT.physics },
  // Social Sciences
  { value: 'AB Anthropology', label: 'AB Anthropology', school: SCHOOL.sas, cluster: CLUSTER.socialSciences, department: DEPARTMENT.anthropology },
  { value: 'AB Development Studies', label: 'AB Development Studies', school: SCHOOL.sas, cluster: CLUSTER.socialSciences, department: DEPARTMENT.developmentStudies },
  { value: 'AB Economics', label: 'AB Economics', school: SCHOOL.sas, cluster: CLUSTER.socialSciences, department: DEPARTMENT.economics },
  { value: 'AB International Studies Major in American Studies', label: 'AB International Studies Major in American Studies', school: SCHOOL.sas, cluster: CLUSTER.socialSciences, department: DEPARTMENT.internationalStudies },
  { value: 'AB International Studies Major in Asian Studies', label: 'AB International Studies Major in Asian Studies', school: SCHOOL.sas, cluster: CLUSTER.socialSciences, department: DEPARTMENT.internationalStudies },
  { value: 'AB Islamic Studies Minor in Education', label: 'AB Islamic Studies Minor in Education', school: SCHOOL.sas, cluster: CLUSTER.socialSciences, department: DEPARTMENT.islamicStudies },
  { value: 'AB Political Science', label: 'AB Political Science', school: SCHOOL.sas, cluster: CLUSTER.socialSciences, department: DEPARTMENT.politicalScienceHistory },
  { value: 'AB Psychology', label: 'AB Psychology', school: SCHOOL.sas, cluster: CLUSTER.socialSciences, department: DEPARTMENT.psychology },
  { value: 'BS Psychology', label: 'BS Psychology', school: SCHOOL.sas, cluster: CLUSTER.socialSciences, department: DEPARTMENT.psychology },
  { value: 'BS Social Work', label: 'BS Social Work', school: SCHOOL.sas, cluster: CLUSTER.socialSciences, department: DEPARTMENT.socialWork },
  { value: 'BS Sociology', label: 'BS Sociology', school: SCHOOL.sas, cluster: CLUSTER.socialSciences, department: DEPARTMENT.sociology },
  // Humanities and Letters
  { value: 'AB Communications', label: 'AB Communications', school: SCHOOL.sas, cluster: CLUSTER.humanities, department: DEPARTMENT.communication },
  { value: 'AB English Language', label: 'AB English Language', school: SCHOOL.sas, cluster: CLUSTER.humanities, department: DEPARTMENT.languagesLiteratureArts },
  { value: 'AB Interdisciplinary Studies Minor in Language and Literature', label: 'AB Interdisciplinary Studies Minor in Language and Literature', school: SCHOOL.sas, cluster: CLUSTER.humanities, department: DEPARTMENT.languagesLiteratureArts },
  { value: 'AB Interdisciplinary Studies Minor in Media and Business', label: 'AB Interdisciplinary Studies Minor in Media and Business', school: SCHOOL.sas, cluster: CLUSTER.humanities, department: DEPARTMENT.languagesLiteratureArts },
  { value: 'AB Interdisciplinary Studies Minor in Media and Philosophy', label: 'AB Interdisciplinary Studies Minor in Media and Philosophy', school: SCHOOL.sas, cluster: CLUSTER.humanities, department: DEPARTMENT.languagesLiteratureArts },
  { value: 'AB Interdisciplinary Studies Minor in Media and Technology', label: 'AB Interdisciplinary Studies Minor in Media and Technology', school: SCHOOL.sas, cluster: CLUSTER.humanities, department: DEPARTMENT.languagesLiteratureArts },
  { value: 'AB Interdisciplinary Studies Minor in Philosophy and Theology', label: 'AB Interdisciplinary Studies Minor in Philosophy and Theology', school: SCHOOL.sas, cluster: CLUSTER.humanities, department: DEPARTMENT.languagesLiteratureArts },
  { value: 'AB Philosophy', label: 'AB Philosophy', school: SCHOOL.sas, cluster: CLUSTER.humanities, department: DEPARTMENT.philosophy },

  // --- School of Business and Governance (SBG) ---
  // Accountancy
  { value: 'BS Accountancy', label: 'BS Accountancy', school: SCHOOL.sbg, cluster: CLUSTER.accountancy, department: DEPARTMENT.accountancy },
  { value: 'BS Management Accounting', label: 'BS Management Accounting', school: SCHOOL.sbg, cluster: CLUSTER.accountancy, department: DEPARTMENT.managementAccounting },
  // Business and Management
  { value: 'BS Business Management', label: 'BS Business Management', school: SCHOOL.sbg, cluster: CLUSTER.business, department: DEPARTMENT.businessManagement },
  { value: 'BS Entrepreneurship', label: 'BS Entrepreneurship', school: SCHOOL.sbg, cluster: CLUSTER.business, department: DEPARTMENT.entrepreneurship },
  { value: 'BS Entrepreneurship Major in Agri-Business', label: 'BS Entrepreneurship Major in Agri-Business', school: SCHOOL.sbg, cluster: CLUSTER.business, department: DEPARTMENT.entrepreneurship },
  { value: 'BS Finance', label: 'BS Finance', school: SCHOOL.sbg, cluster: CLUSTER.business, department: DEPARTMENT.finance },
  { value: 'BS Human Resource Development and Management', label: 'BS Human Resource Development and Management', school: SCHOOL.sbg, cluster: CLUSTER.business, department: DEPARTMENT.hrdm },
  { value: 'BS Marketing', label: 'BS Marketing', school: SCHOOL.sbg, cluster: CLUSTER.business, department: DEPARTMENT.marketing },
  // The printed program is "Bachelor of Public Management (BPM)"; the `value` is
  // kept because profiles and the catalog already reference it.
  { value: 'BS Public Management', label: 'Bachelor of Public Management (BPM)', school: SCHOOL.sbg, cluster: CLUSTER.business, department: DEPARTMENT.publicManagement },

  // --- School of Engineering and Architecture (SEA) ---
  // Direct under SEA: no sub-clusters.
  { value: 'BS Architecture', label: 'BS Architecture', school: SCHOOL.sea, cluster: null, department: DEPARTMENT.architecture },
  { value: 'BS Aerospace Engineering (Academic Research)', label: 'BS Aerospace Engineering (Academic Research)', school: SCHOOL.sea, cluster: null, department: DEPARTMENT.aerospace },
  { value: 'BS Aerospace Engineering (Industry and Technopreneurship)', label: 'BS Aerospace Engineering (Industry and Technopreneurship)', school: SCHOOL.sea, cluster: null, department: DEPARTMENT.aerospace },
  { value: 'BS Chemical Engineering', label: 'BS Chemical Engineering', school: SCHOOL.sea, cluster: null, department: DEPARTMENT.chemicalEngineering },
  { value: 'BS Civil Engineering (Construction Engineering and Management)', label: 'BS Civil Engineering (Construction Engineering and Management)', school: SCHOOL.sea, cluster: null, department: DEPARTMENT.civilEngineering },
  { value: 'BS Civil Engineering (Structural)', label: 'BS Civil Engineering (Structural)', school: SCHOOL.sea, cluster: null, department: DEPARTMENT.civilEngineering },
  { value: 'BS Civil Engineering (Transportation)', label: 'BS Civil Engineering (Transportation)', school: SCHOOL.sea, cluster: null, department: DEPARTMENT.civilEngineering },
  { value: 'BS Computer Engineering', label: 'BS Computer Engineering', school: SCHOOL.sea, cluster: null, department: DEPARTMENT.computerEngineering },
  { value: 'BS Electrical Engineering', label: 'BS Electrical Engineering', school: SCHOOL.sea, cluster: null, department: DEPARTMENT.electricalEngineering },
  { value: 'BS Electronics Engineering', label: 'BS Electronics Engineering', school: SCHOOL.sea, cluster: null, department: DEPARTMENT.electronicsEngineering },
  { value: 'BS Industrial Engineering', label: 'BS Industrial Engineering', school: SCHOOL.sea, cluster: null, department: DEPARTMENT.industrialEngineering },
  { value: 'BS Mechanical Engineering', label: 'BS Mechanical Engineering', school: SCHOOL.sea, cluster: null, department: DEPARTMENT.mechanicalEngineering },
  { value: 'BS Robotics Engineering', label: 'BS Robotics Engineering', school: SCHOOL.sea, cluster: null, department: DEPARTMENT.roboticsEngineering },

  // --- School of Education (SOE) ---
  // Direct under SOE: no sub-clusters.
  { value: 'Bachelor of Early Childhood Education', label: 'Bachelor of Early Childhood Education', school: SCHOOL.soe, cluster: null, department: DEPARTMENT.teacherEducation },
  { value: 'Bachelor of Elementary Education', label: 'Bachelor of Elementary Education', school: SCHOOL.soe, cluster: null, department: DEPARTMENT.teacherEducation },
  { value: 'Bachelor of Secondary Education', label: 'Bachelor of Secondary Education', school: SCHOOL.soe, cluster: null, department: DEPARTMENT.teacherEducation },
  { value: 'Bachelor of Secondary Education Major in English', label: 'Bachelor of Secondary Education Major in English', school: SCHOOL.soe, cluster: null, department: DEPARTMENT.teacherEducation },
  { value: 'Bachelor of Secondary Education Major in Mathematics', label: 'Bachelor of Secondary Education Major in Mathematics', school: SCHOOL.soe, cluster: null, department: DEPARTMENT.teacherEducation },
  { value: 'Bachelor of Secondary Education Major in Science', label: 'Bachelor of Secondary Education Major in Science', school: SCHOOL.soe, cluster: null, department: DEPARTMENT.teacherEducation },
  { value: 'Bachelor of Secondary Education Major in Social Studies', label: 'Bachelor of Secondary Education Major in Social Studies', school: SCHOOL.soe, cluster: null, department: DEPARTMENT.teacherEducation },

  // --- School of Nursing (SON) ---
  // Direct under SON: no sub-clusters.
  { value: 'BS Nursing', label: 'BS Nursing', school: SCHOOL.son, cluster: null, department: DEPARTMENT.nursing },
];

// Bumped whenever the hierarchy shape or its stored values change. The persisted
// localStorage record keeps a copy of this catalog for the pre-load paint, so
// `createInitialState` discards a cached list that predates the current shape
// instead of showing retired school names for a frame.
export const ACADEMIC_TAXONOMY_VERSION = 2;

export const academicPrograms = programRecords;

// True for a record that carries the four-level hierarchy. A cached list written
// before the hierarchy existed fails this and is replaced by the defaults.
export const isHierarchyProgram = (program) => Boolean(program?.value && program?.school && program?.department);

// The two levels a reviewer scope resolves against, plus the school label that
// `profiles.department` stores.
export const getAcademicProgramHierarchy = (program) => ({
  school: program?.school || '',
  cluster: program?.cluster || '',
  department: program?.department || '',
});

// The picker group a program belongs to: "School — Cluster", or the school alone
// for SEA / SOE / SON, which have no sub-clusters.
export const getAcademicProgramGroupLabel = (program) => (
  program?.cluster ? `${program.school} — ${program.cluster}` : (program?.school || '')
);

// The `SelectPicker` option list: one group header per school/cluster pair, in
// taxonomy order, with each program's department as its description so the
// narrowest level is visible without opening anything else.
export const getAcademicProgramGroups = (programs = academicPrograms) => {
  const groups = [];
  const seen = new Map();
  (Array.isArray(programs) ? programs : []).forEach((program) => {
    if (!isHierarchyProgram(program)) return;
    const key = `${program.school}::${program.cluster || ''}`;
    if (!seen.has(key)) {
      const group = { value: `group-${key}`, label: getAcademicProgramGroupLabel(program), isGroup: true, programs: [] };
      seen.set(key, group);
      groups.push(group);
    }
    seen.get(key).programs.push({ value: program.value, label: program.label, description: program.department });
  });
  return groups.flatMap((group) => [group, ...group.programs]);
};

// Cluster names in taxonomy order.
export const getAcademicProgramClusters = (programs = academicPrograms) => (
  [...new Set((Array.isArray(programs) ? programs : []).map((program) => program.cluster).filter(Boolean))]
);

export const academicProgramClusters = getAcademicProgramClusters();

/** @deprecated Use `academicProgramClusters`. `category` was the misnamed cluster. */
export const academicProgramCategories = academicProgramClusters;

// Strict lookup: `undefined` when the value is not in the taxonomy. Use this
// wherever a miss must stay a miss (for example resolving an applicant's department,
// where silently falling back to the first program would file them under the wrong
// school). `getAcademicProgram()` below keeps the lenient fallback for pickers.
export const findAcademicProgram = (value) => (
  value ? academicPrograms.find((program) => program.value === value) : undefined
);

export const getAcademicProgram = (value) => academicPrograms.find((program) => program.value === value) ?? academicPrograms[0];