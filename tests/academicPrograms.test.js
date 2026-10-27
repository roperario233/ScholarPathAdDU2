import { describe, expect, it } from 'vitest';
import {
  ACADEMIC_TAXONOMY_VERSION,
  academicPrograms,
  getAcademicProgram,
  getAcademicProgramClusters,
  getAcademicProgramGroupLabel,
  getAcademicProgramGroups,
  isHierarchyProgram,
} from '../src/lib/academicPrograms';

// The `value` strings below are a contract: they are stored in
// profiles.degree_program, compared against scholarships.eligible_degrees, and
// frozen into every submitted application's profile snapshot. A rename would
// silently detach existing students from their program.
const LEGACY_VALUES = [
  'BS Architecture',
  'BS Aerospace Engineering (Academic Research)',
  'BS Aerospace Engineering (Industry and Technopreneurship)',
  'BS Civil Engineering (Construction Engineering and Management)',
  'BS Civil Engineering (Structural)',
  'BS Civil Engineering (Transportation)',
  'BS Chemical Engineering',
  'BS Computer Engineering',
  'BS Electrical Engineering',
  'BS Electronics Engineering',
  'BS Industrial Engineering',
  'BS Mechanical Engineering',
  'BS Robotics Engineering',
  'AB Anthropology',
  'BS Biology Major in General Biology',
  'BS Biology Major in Medical Biology',
  'BS Chemistry',
  'AB Communications',
  'AB Development Studies',
  'AB Economics',
  'AB English Language',
  'BS Environmental Science',
  'AB Interdisciplinary Studies Minor in Language and Literature',
  'AB Interdisciplinary Studies Minor in Media and Business',
  'AB Interdisciplinary Studies Minor in Media and Philosophy',
  'AB Interdisciplinary Studies Minor in Media and Technology',
  'AB Interdisciplinary Studies Minor in Philosophy and Theology',
  'AB International Studies Major in American Studies',
  'AB International Studies Major in Asian Studies',
  'AB Islamic Studies Minor in Education',
  'BS Mathematics',
  'AB Philosophy',
  'AB Political Science',
  'AB Psychology',
  'BS Psychology',
  'BS Social Work',
  'BS Sociology',
  'BS Computer Science',
  'BS Data Science',
  'BS Information Systems',
  'BS Information Technology',
  'Bachelor of Elementary Education',
  'Bachelor of Secondary Education',
  'Bachelor of Secondary Education Major in English',
  'Bachelor of Secondary Education Major in Mathematics',
  'Bachelor of Secondary Education Major in Social Studies',
  'Bachelor of Secondary Education Major in Science',
  'BS Accountancy',
  'BS Business Management',
  'BS Entrepreneurship',
  'BS Entrepreneurship Major in Agri-Business',
  'BS Finance',
  'BS Human Resource Development and Management',
  'BS Management Accounting',
  'BS Marketing',
  'BS Public Management',
  'BS Nursing',
];

const find = (value) => academicPrograms.find((program) => program.value === value);

describe('academic program hierarchy', () => {
  it('carries all four levels on every program', () => {
    expect(ACADEMIC_TAXONOMY_VERSION).toBe(2);
    expect(academicPrograms.length).toBe(59);
    academicPrograms.forEach((program) => {
      expect(isHierarchyProgram(program), program.value).toBe(true);
      expect(program.school.length).toBeGreaterThan(0);
      expect(program.department.length).toBeGreaterThan(0);
      // A cluster is either a real name or explicitly none (SEA / SOE / SON).
      expect(program.cluster === null || typeof program.cluster === 'string').toBe(true);
    });
  });

  it('keeps every legacy program value so no profile is orphaned', () => {
    const values = new Set(academicPrograms.map((program) => program.value));
    expect(LEGACY_VALUES.filter((value) => !values.has(value))).toEqual([]);
  });

  it('has retired the three "College of ..." school names', () => {
    expect(JSON.stringify(academicPrograms)).not.toContain('College of');
    const schools = new Set(academicPrograms.map((program) => program.school));
    expect([...schools].sort()).toEqual([
      'School of Arts and Sciences (SAS)',
      'School of Business and Governance (SBG)',
      'School of Education (SOE)',
      'School of Engineering and Architecture (SEA)',
      'School of Nursing (SON)',
    ]);
  });

  it('merges Computer Studies into SAS as a cluster, not a school', () => {
    const program = find('BS Information Technology');
    expect(program.school).toBe('School of Arts and Sciences (SAS)');
    expect(program.cluster).toBe('Computer Studies');
    expect(program.department).toBe('Information Technology and Information Systems Department');
    expect(find('BS Computer Science').department).toBe('Computer Science Department');
  });

  it('files Environmental Science under Natural Sciences and Mathematics', () => {
    const program = find('BS Environmental Science');
    expect(program.school).toBe('School of Arts and Sciences (SAS)');
    expect(program.cluster).toBe('Natural Sciences and Mathematics');
    expect(program.department).toBe('Environmental Science Department');
  });

  it('includes the two programs the corrected hierarchy added', () => {
    expect(find('BS Physics').department).toBe('Physics Department');
    expect(find('Bachelor of Early Childhood Education').department).toBe('Teacher Education Department');
  });

  it('labels BS Public Management with its printed name', () => {
    expect(find('BS Public Management').label).toBe('Bachelor of Public Management (BPM)');
  });

  it('leaves SEA, SOE, and SON without sub-clusters', () => {
    ['School of Engineering and Architecture (SEA)', 'School of Education (SOE)', 'School of Nursing (SON)'].forEach((school) => {
      academicPrograms.filter((program) => program.school === school).forEach((program) => {
        expect(program.cluster, program.value).toBeNull();
      });
    });
    expect(getAcademicProgramClusters()).toEqual([
      'Computer Studies',
      'Natural Sciences and Mathematics',
      'Social Sciences',
      'Humanities and Letters',
      'Accountancy',
      'Business and Management',
    ]);
  });
});

describe('academic program picker groups', () => {
  it('heads each group with School — Cluster and describes each program by department', () => {
    const options = getAcademicProgramGroups();
    const headers = options.filter((option) => option.isGroup);
    expect(headers.map((header) => header.label)).toContain('School of Arts and Sciences (SAS) — Computer Studies');
    expect(headers.map((header) => header.label)).toContain('School of Nursing (SON)');
    const option = options.find((entry) => entry.value === 'BS Information Technology');
    expect(option.label).toBe('BS Information Technology');
    expect(option.description).toBe('Information Technology and Information Systems Department');
  });

  it('uses the school alone as the group label when there is no cluster', () => {
    expect(getAcademicProgramGroupLabel(find('BS Nursing'))).toBe('School of Nursing (SON)');
    expect(getAcademicProgramGroupLabel(find('BS Computer Science'))).toBe('School of Arts and Sciences (SAS) — Computer Studies');
  });

  it('skips a cached record that predates the hierarchy', () => {
    // An old localStorage payload: `department` held the school and there was no
    // `school`, so it must never reach the picker.
    const legacy = { value: 'BS Old', label: 'BS Old', department: 'College of Computer Studies (CCS)', category: 'Computer Studies' };
    expect(isHierarchyProgram(legacy)).toBe(false);
    expect(getAcademicProgramGroups([legacy])).toEqual([]);
  });

  it('resolves a program by value with a safe fallback', () => {
    expect(getAcademicProgram('BS Nursing').department).toBe('Nursing Department');
    expect(getAcademicProgram('Not a program').value).toBe('BS Computer Science');
  });
});
