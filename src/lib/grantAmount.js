import { fmtCurrency } from './formatters';

// The grant amount the school's approving level records for an application
// (application_grant_amounts, 20261059000000). It is a recorded award figure, not a
// disbursement. `validateGrantAmount` mirrors the checks in
// set_application_grant_amount().

export const GRANT_AMOUNT_STATUSES = ['Recommended', 'Approved', 'Released'];
export const GRANT_AMOUNT_EDITABLE_STATUSES = ['Recommended', 'Approved'];
export const GRANT_NOTE_MAX_LENGTH = 500;

export const isGrantAmountStage = (status) => GRANT_AMOUNT_STATUSES.includes(status);
export const isGrantAmountEditableStage = (status) => GRANT_AMOUNT_EDITABLE_STATUSES.includes(status);

export const getGrantAmountForApplication = (rows = [], applicationId) => (
  (Array.isArray(rows) ? rows : []).find((entry) => entry?.applicationId === applicationId) || null
);

const toNumber = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/,/g, '');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

// Returns `{ values, errors }`. `values` is what the RPC receives; `errors` is keyed
// by field (`coveragePercent`, `amount`, `note`, `form`).
export const validateGrantAmount = ({ coveragePercent = '', amount = '', note = '' } = {}) => {
  const percent = toNumber(coveragePercent);
  const pesos = toNumber(amount);
  const trimmedNote = String(note || '').trim();
  const errors = {};

  if (Number.isNaN(percent)) errors.coveragePercent = 'Enter the coverage as a number.';
  else if (percent !== null && (percent < 0 || percent > 100)) errors.coveragePercent = 'Coverage must be between 0 and 100 percent.';

  if (Number.isNaN(pesos)) errors.amount = 'Enter the amount as a number.';
  else if (pesos !== null && pesos < 0) errors.amount = 'The amount cannot be negative.';

  if (trimmedNote.length > GRANT_NOTE_MAX_LENGTH) errors.note = `Keep the note to ${GRANT_NOTE_MAX_LENGTH} characters or fewer.`;

  if (!errors.coveragePercent && !errors.amount && percent === null && pesos === null) {
    errors.form = 'Enter a coverage percent, an amount per semester, or both.';
  }

  return {
    values: {
      coveragePercent: Number.isNaN(percent) ? null : percent,
      amountPerSemester: Number.isNaN(pesos) ? null : pesos,
      note: trimmedNote,
    },
    errors,
  };
};

// One phrasing for the modal and the student view: "100% tuition · Php 10,000 per semester".
export const describeGrantAmount = (row) => {
  if (!row) return '';
  const parts = [];
  if (row.coveragePercent !== null && row.coveragePercent !== undefined) {
    parts.push(`${Number(row.coveragePercent)}% tuition`);
  }
  if (row.amountPerSemester !== null && row.amountPerSemester !== undefined) {
    parts.push(`${fmtCurrency(row.amountPerSemester)} per semester`);
  }
  return parts.join(' · ');
};
