import { describe, expect, it } from 'vitest';
import { getNextApplicationStatuses } from '../src/lib/constants';

describe('role-aware application stage actions', () => {
  it('lets the Department Chair endorse but not conduct central review decisions', () => {
    expect(getNextApplicationStatuses('For Verification', 'department_chair')).toEqual(['Endorsed']);
    expect(getNextApplicationStatuses('Endorsed', 'department_chair')).toEqual([]);
    expect(getNextApplicationStatuses('Interview', 'department_chair')).toEqual([]);
  });

  it('reserves verification, interview, approval, and release actions for Admissions Office', () => {
    expect(getNextApplicationStatuses('For Verification', 'admissions_office')).toEqual(['Rejected']);
    expect(getNextApplicationStatuses('Endorsed', 'admissions_office')).toEqual(['Rejected']);
    expect(getNextApplicationStatuses('Interview', 'admissions_office')).toContain('Rejected');
    expect(getNextApplicationStatuses('Recommended', 'admissions_office')).toContain('Approved');
    expect(getNextApplicationStatuses('Approved', 'admissions_office')).toEqual(['Released']);
  });

  it('preserves the generic legacy status map when no role is supplied', () => {
    expect(getNextApplicationStatuses('For Verification')).toEqual(['Endorsed', 'Rejected']);
  });
});