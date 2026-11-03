import { describe, expect, it } from 'vitest';
import {
  describeGrantAmount,
  getGrantAmountForApplication,
  isGrantAmountEditableStage,
  isGrantAmountStage,
  validateGrantAmount,
} from '../src/lib/grantAmount';

describe('grant amount stages', () => {
  it('shows the tab from Recommended on and edits only before release', () => {
    expect(['Approved', 'Recommended', 'Released'].every(isGrantAmountStage)).toBe(true);
    expect(isGrantAmountStage('Interview')).toBe(false);
    expect(isGrantAmountStage('Rejected')).toBe(false);
    expect(isGrantAmountEditableStage('Recommended')).toBe(true);
    expect(isGrantAmountEditableStage('Approved')).toBe(true);
    expect(isGrantAmountEditableStage('Released')).toBe(false);
  });
});

describe('validateGrantAmount', () => {
  it('requires a percent, an amount, or both', () => {
    expect(validateGrantAmount({}).errors.form).toBeTruthy();
    expect(validateGrantAmount({ coveragePercent: '50' }).errors).toEqual({});
    expect(validateGrantAmount({ amount: '10,000' }).values.amountPerSemester).toBe(10000);
  });

  it('keeps coverage between 0 and 100 and the amount non-negative', () => {
    expect(validateGrantAmount({ coveragePercent: '101' }).errors.coveragePercent).toBeTruthy();
    expect(validateGrantAmount({ coveragePercent: '-1' }).errors.coveragePercent).toBeTruthy();
    expect(validateGrantAmount({ coveragePercent: '100' }).errors).toEqual({});
    expect(validateGrantAmount({ amount: '-5' }).errors.amount).toBeTruthy();
    expect(validateGrantAmount({ amount: 'abc' }).errors.amount).toBeTruthy();
    expect(validateGrantAmount({ coveragePercent: '0' }).errors).toEqual({});
  });

  it('limits and trims the note', () => {
    expect(validateGrantAmount({ coveragePercent: '50', note: `  ok  ` }).values.note).toBe('ok');
    expect(validateGrantAmount({ coveragePercent: '50', note: 'x'.repeat(501) }).errors.note).toBeTruthy();
  });
});

describe('describeGrantAmount', () => {
  it('phrases the percent and the peso amount once', () => {
    expect(describeGrantAmount({ coveragePercent: 100, amountPerSemester: null })).toBe('100% tuition');
    expect(describeGrantAmount({ coveragePercent: null, amountPerSemester: 10000 })).toBe('₱10,000 per semester');
    expect(describeGrantAmount({ coveragePercent: 50, amountPerSemester: 10000 })).toBe('50% tuition · ₱10,000 per semester');
    expect(describeGrantAmount(null)).toBe('');
  });
});

describe('getGrantAmountForApplication', () => {
  it('finds the row for one application', () => {
    const rows = [{ applicationId: 'a', coveragePercent: 50 }, { applicationId: 'b', coveragePercent: 100 }];
    expect(getGrantAmountForApplication(rows, 'b')).toBe(rows[1]);
    expect(getGrantAmountForApplication(rows, 'c')).toBeNull();
    expect(getGrantAmountForApplication(undefined, 'a')).toBeNull();
  });
});
