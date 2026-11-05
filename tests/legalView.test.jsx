import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LegalView from '../src/pages/LegalView';
import { PRIVACY_NOTICE_VERSION } from '../src/lib/legalDocs';

const render = (doc) => renderToStaticMarkup(<LegalView initialDoc={doc} />);

describe('legal pages', () => {
  it('opens on the privacy policy and names its version', () => {
    const html = render();

    expect(html).toContain('Privacy Policy');
    expect(html).toContain('RA 10173');
    expect(html).toContain('Who can read your information');
    expect(html).toContain(`Version ${PRIVACY_NOTICE_VERSION}`);
    // The reader matrix carries the office lanes and the reviewer ladder.
    expect(html).toContain('Admissions Office Admin');
    expect(html).toContain('Chairperson');
    expect(html).toContain('Never reads');
  });

  it('offers all three documents as tabs', () => {
    const html = render();

    expect(html).toContain('Cookies and storage');
    expect(html).toContain('Terms of Use');
    expect(html).toContain('role="tablist"');
  });

  it('renders the storage notice with the real storage names', () => {
    const html = render('storage');

    expect(html).toContain('Cookie and storage notice');
    expect(html).toContain('scholarpath-addu-state');
    expect(html).toContain('tawk.to');
    expect(html).toContain('What it is for');
  });

  it('renders the terms of use', () => {
    const html = render('terms');

    expect(html).toContain('Terms of Use');
    expect(html).toContain('Results are confidential');
    expect(html).toContain('does not disburse money');
  });

  it('falls back to the privacy policy for an unknown document', () => {
    expect(render('policies')).toContain('RA 10173');
  });

  it('says the wording is a prototype notice, not a legal instrument', () => {
    const html = render();

    expect(html).toContain('prototype wording');
    expect(html).toContain('Data Protection Officer');
  });
});
