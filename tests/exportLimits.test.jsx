import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExportButton } from '../src/components/ui';
import { EXPORT_ROW_LIMIT, downloadApplicantSummary } from '../src/lib/admissionsOffice';

describe('export size limit', () => {
  it('refuses an oversized export with a message that says what to do, before building anything', async () => {
    const applications = new Array(EXPORT_ROW_LIMIT + 1).fill({ id: 'a' });
    await expect(downloadApplicantSummary(applications, {})).rejects.toThrow(/limit is 5,000.*Narrow/);
  });

  it('renders the export action as an idle, enabled button', () => {
    const markup = renderToStaticMarkup(<ExportButton onClick={() => {}} />);
    expect(markup).toContain('Export to Excel');
    expect(markup).not.toContain('aria-busy');
    expect(markup).not.toMatch(/\sdisabled[\s=>]/);
  });

  it('keeps an export disabled when the page disables it', () => {
    expect(renderToStaticMarkup(<ExportButton disabled onClick={() => {}} />)).toMatch(/\sdisabled[\s=>]/);
  });
});
