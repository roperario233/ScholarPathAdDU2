export const fmtCurrency = (value) => `₱${Number(value || 0).toLocaleString()}`;
export const fmtDate = (value) => {
  if (!value) return 'TBA';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'TBA';
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
};
export const toPercent = (value) => `${Math.max(0, Math.min(100, Math.round(value)))}%`;
export const plural = (count, singular, pluralForm = `${singular}s`) => `${count} ${count === 1 ? singular : pluralForm}`;
