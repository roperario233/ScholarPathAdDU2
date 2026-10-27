import { describe, expect, it } from 'vitest';
import { academicPrograms } from '../src/lib/academicPrograms';
import {
  PANEL_LEVEL_ORDER,
  REVIEWER_ROLES,
  buildProgramScopeIndex,
  getApplicationScope,
  getPanelCandidateLevel,
  getReviewPageLabel,
  getReviewScopeLabel,
  getReviewerScope,
  getScopedQueue,
  isApplicationInReviewerScope,
  isReviewerRole,
} from '../src/lib/reviewScope';

const SAS = 'School of Arts and Sciences (SAS)';
const SBG = 'School of Business and Governance (SBG)';
const SEA = 'School of Engineering and Architecture (SEA)';

const dean = { role: 'dean', reviewSchool: SEA, department: SEA };
const assistantDean = { role: 'assistant_dean', reviewSchool: SAS, reviewCluster: 'Computer Studies', department: SAS };
const chair = { role: 'department_chair', reviewDepartment: 'Computer Science Department', department: SAS };

const application = (overrides = {}) => ({
  id: 'app-1',
  studentProgram: 'BS Computer Science',
  studentSchool: SAS,
  status: 'Submitted',
  ...overrides,
});

describe('reviewer scope ladder', () => {
  it('names the three academic levels and no others', () => {
    expect(REVIEWER_ROLES).toEqual(['dean', 'assistant_dean', 'department_chair']);
    expect(isReviewerRole('dean')).toBe(true);
    expect(isReviewerRole('assistant_dean')).toBe(true);
    expect(isReviewerRole('department_chair')).toBe(true);
    // The Admissions Office lanes read everything and never scope by level.
    expect(isReviewerRole('admissions_office')).toBe(false);
    expect(isReviewerRole('admissions_head')).toBe(false);
    expect(isReviewerRole('student')).toBe(false);
  });

  it('resolves each role to the level it owns', () => {
    expect(getReviewerScope(dean)).toMatchObject({ level: 'school', school: SEA });
    expect(getReviewerScope(assistantDean)).toMatchObject({ level: 'cluster', school: SAS, cluster: 'Computer Studies' });
    expect(getReviewerScope(chair)).toMatchObject({ level: 'department', department: 'Computer Science Department' });
    expect(getReviewerScope({ role: 'student' }).level).toBe('');
  });

  it('labels each page and shows the narrowest owned line', () => {
    expect(getReviewPageLabel('dean')).toBe('School Review');
    expect(getReviewPageLabel('assistant_dean')).toBe('Cluster Review');
    expect(getReviewPageLabel('department_chair')).toBe('Department Review');
    expect(getReviewScopeLabel(dean)).toBe(SEA);
    expect(getReviewScopeLabel(assistantDean)).toBe(`${SAS} · Computer Studies`);
    expect(getReviewScopeLabel(chair)).toBe('Computer Science Department');
  });

  it('resolves an applicant’s cluster and department from the degree program', () => {
    const index = buildProgramScopeIndex(academicPrograms);
    expect(getApplicationScope({ studentProgram: 'BS Computer Science' }, index)).toEqual({
      school: SAS,
      cluster: 'Computer Studies',
      department: 'Computer Science Department',
    });
    // An unknown program is a miss, not the first program in the catalog, so the
    // stored school still answers the school level.
    expect(getApplicationScope({ studentProgram: 'Not a program', studentSchool: SBG }, index)).toEqual({
      school: SBG,
      cluster: '',
      department: '',
    });
  });
});


describe('application scoping', () => {
  const index = buildProgramScopeIndex(academicPrograms);

  it('scopes a Dean to the whole school', () => {
    const scope = getReviewerScope(dean);
    expect(isApplicationInReviewerScope(application({ studentProgram: 'BS Architecture', studentSchool: SEA }), scope, index)).toBe(true);
    expect(isApplicationInReviewerScope(application({ studentProgram: 'BS Nursing', studentSchool: 'School of Nursing (SON)' }), scope, index)).toBe(false);
  });

  it('scopes an Assistant Dean to its cluster', () => {
    const scope = getReviewerScope(assistantDean);
    expect(isApplicationInReviewerScope(application(), scope, index)).toBe(true);
    // Same school, different cluster.
    expect(isApplicationInReviewerScope(application({ studentProgram: 'BS Physics' }), scope, index)).toBe(false);
  });

  it('scopes a Chairperson to its department', () => {
    const scope = getReviewerScope(chair);
    expect(isApplicationInReviewerScope(application(), scope, index)).toBe(true);
    // Same cluster, different department.
    expect(isApplicationInReviewerScope(application({ studentProgram: 'BS Information Technology' }), scope, index)).toBe(false);
  });

  it('keeps the legacy school-wide read for an unscoped Chairperson', () => {
    // No `reviewDepartment` yet: the account keeps the school it used to own, so a
    // migration that lands before an operator assigns departments locks nobody out.
    const legacy = getReviewerScope({ role: 'department_chair', department: SAS });
    expect(legacy.level).toBe('department');
    expect(legacy.department).toBe('');
    expect(isApplicationInReviewerScope(application(), legacy, index)).toBe(true);
    expect(isApplicationInReviewerScope(application({ studentProgram: 'BS Physics' }), legacy, index)).toBe(true);
    expect(isApplicationInReviewerScope(application({ studentProgram: 'BS Nursing', studentSchool: 'School of Nursing (SON)' }), legacy, index)).toBe(false);
  });

  it('never scopes a non-reviewer to anything', () => {
    expect(getScopedQueue([application()], { role: 'student' }, academicPrograms)).toEqual([]);
    expect(getScopedQueue([application()], { role: 'admissions_office' }, academicPrograms)).toEqual([]);
  });

  it('returns the queue inside the reviewer’s scope', () => {
    const queue = [
      application({ id: 'cs' }),
      application({ id: 'it', studentProgram: 'BS Information Technology' }),
      application({ id: 'physics', studentProgram: 'BS Physics' }),
      application({ id: 'nursing', studentProgram: 'BS Nursing', studentSchool: 'School of Nursing (SON)' }),
    ];
    expect(getScopedQueue(queue, chair, academicPrograms).map((entry) => entry.id)).toEqual(['cs']);
    expect(getScopedQueue(queue, assistantDean, academicPrograms).map((entry) => entry.id)).toEqual(['cs', 'it']);
    // The SEA Dean owns none of these SAS cases.
    expect(getScopedQueue(queue, dean, academicPrograms)).toEqual([]);
  });
});

describe('panel candidate levels (SOP 5a)', () => {
  const index = buildProgramScopeIndex(academicPrograms);

  it('orders the ladder narrowest first, then the Admissions Office', () => {
    expect(PANEL_LEVEL_ORDER).toEqual(['department', 'cluster', 'school', 'office']);
    const applicant = application();
    expect(getPanelCandidateLevel(chair, applicant, index)).toBe('department');
    expect(getPanelCandidateLevel(assistantDean, applicant, index)).toBe('cluster');
    // The SEA Dean is outside this SAS applicant's scope.
    expect(getPanelCandidateLevel(dean, applicant, index)).toBe(null);
    expect(getPanelCandidateLevel({ role: 'admissions_office' }, applicant, index)).toBe('office');
    expect(getPanelCandidateLevel({ role: 'admissions_head' }, applicant, index)).toBe('office');
  });

  it('returns null for a reviewer outside the applicant’s scope', () => {
    // A Chairperson of another department in the same cluster.
    expect(getPanelCandidateLevel({ role: 'department_chair', reviewDepartment: 'Physics Department' }, application(), index)).toBe(null);
  });
});
